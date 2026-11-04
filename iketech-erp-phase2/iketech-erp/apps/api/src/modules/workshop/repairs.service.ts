import { Injectable } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { Tx } from '../../db/db';
import { AuthUser } from '../../auth/decorators';
import { DomainError, forbidden, notFound } from '../../common/errors';
import { z, uuid } from '../../common/zod';

const CompleteTask = z.object({
  notes: z.string().trim().min(5).max(4000),
  procedureRef: z.string().trim().max(200).optional(),
  labourMinutes: z.number().int().min(1).max(10000),
  measurements: z.record(z.string(), z.string().max(200)).default({}),
  partsUsed: z.array(z.object({ description: z.string().max(200), qty: z.number().positive(), partNo: z.string().max(60).optional() })).default([]),
  checklist: z.array(z.object({ item: z.string().max(200), required: z.boolean(), done: z.boolean() })).default([]),
});

const QcInput = z.object({
  results: z.array(z.object({ code: z.string(), passed: z.boolean(), note: z.string().max(500).optional() })).min(1),
  roadTestDone: z.boolean().default(false),
  roadTestNotes: z.string().max(2000).optional(),
  postScanClear: z.boolean().optional(),
  postScanNotes: z.string().max(2000).optional(),
  complaintResolved: z.boolean(),
  notes: z.string().max(2000).optional(),
});

const PRE_APPROVAL = ['RECEIVED', 'DIAGNOSING', 'QUOTE_PENDING', 'AWAITING_APPROVAL'] as const;

@Injectable()
export class RepairsService {
  constructor(private readonly jobs: JobsService) {}

  /**
   * Gate 1 — no repair without approval. Repair tasks are created only from approved quotation lines.
   * The only way around it is an authorised START_REPAIR_WITHOUT_APPROVAL exception (recorded on the task and in history).
   */
  async startRepair(jobId: string, actor: AuthUser) {
    return this.jobs.dbs.tx(async (trx) => {
      const job = await this.jobs.lock(trx, jobId);
      if (job.status === 'APPROVED') {
        const approved = await trx.selectFrom('quotation_items as i').innerJoin('quotations as q', 'q.id', 'i.quotation_id')
          .leftJoin('job_tasks as t', 't.quotation_item_id', 'i.id')
          .select(['i.id', 'i.kind', 'i.description', 't.id as task_id'])
          .where('q.job_id', '=', jobId).where('i.decision', '=', 'APPROVED').orderBy('q.created_at').orderBy('i.line_no').execute();
        const untasked = approved.filter((a) => !a.task_id);
        const work = untasked.filter((a) => a.kind === 'LABOUR' || a.kind === 'SUBLET');
        const toCreate = work.length ? work : untasked.slice(0, 1);
        for (const it of toCreate) {
          await trx.insertInto('job_tasks').values({
            job_id: jobId, kind: 'REPAIR', title: work.length ? it.description : `Fit approved items: ${it.description}`, quotation_item_id: it.id, created_by: actor.id,
          }).execute();
        }
        await trx.updateTable('job_tasks').set({ status: 'PENDING', updated_at: new Date() }).where('job_id', '=', jobId).where('status', '=', 'PAUSED').execute();
        return this.jobs.setStatus(trx, job, 'IN_REPAIR', actor, { reason: `Repair started (${toCreate.length} new task(s))` });
      }
      if ((PRE_APPROVAL as readonly string[]).includes(job.status)) {
        const ex = await this.jobs.useException(trx, jobId, 'START_REPAIR_WITHOUT_APPROVAL');
        if (!ex) throw new DomainError('APPROVAL_REQUIRED', 'Customer approval is required before repair work starts. An authorised exception is the only override.', 403);
        await trx.insertInto('job_tasks').values({ job_id: jobId, kind: 'REPAIR', title: 'Work authorised by exception (see job history)', exception_id: ex.id, created_by: actor.id }).execute();
        return this.jobs.setStatus(trx, job, 'IN_REPAIR', actor, { reason: 'Repair started under authorised exception', exceptionId: ex.id });
      }
      throw new DomainError('WRONG_STATUS', `Repair cannot start while the job is ${job.status}`, 409);
    });
  }

  private async lockTask(trx: Tx, taskId: string) {
    const t = await trx.selectFrom('job_tasks').selectAll().where('id', '=', taskId).forUpdate().executeTakeFirst();
    if (!t) throw notFound('Task');
    return t;
  }

  async assignTask(taskId: string, raw: unknown, actor: AuthUser) {
    const { userId } = z.object({ userId: uuid }).parse(raw);
    return this.jobs.dbs.tx(async (trx) => {
      const t = await this.lockTask(trx, taskId);
      await this.jobs.requireRole(trx, userId, ['REPAIR_TECH']);
      const after = await trx.updateTable('job_tasks').set({ assigned_to: userId, updated_at: new Date() }).where('id', '=', taskId).returningAll().executeTakeFirstOrThrow();
      await this.jobs.audit.write(trx, { actorId: actor.id, action: 'task.assign', entity: 'job_task', entityId: taskId, before: { assigned_to: t.assigned_to }, after: { assigned_to: userId }, ip: actor.ip });
      return after;
    });
  }

  async startTask(taskId: string, actor: AuthUser) {
    return this.jobs.dbs.tx(async (trx) => {
      const t = await this.lockTask(trx, taskId);
      const job = await this.jobs.lock(trx, t.job_id);
      this.jobs.requireStatus(job, 'IN_REPAIR');
      if (!['PENDING', 'PAUSED'].includes(t.status)) throw new DomainError('TASK_STATE', `Task is ${t.status}`, 409);
      if (t.assigned_to && t.assigned_to !== actor.id) throw forbidden('This task is assigned to another technician');
      const after = await trx.updateTable('job_tasks').set({ status: 'IN_PROGRESS', assigned_to: actor.id, started_at: t.started_at ?? new Date(), updated_at: new Date() })
        .where('id', '=', taskId).returningAll().executeTakeFirstOrThrow();
      await this.jobs.audit.write(trx, { actorId: actor.id, action: 'task.start', entity: 'job_task', entityId: taskId, ip: actor.ip });
      return after;
    });
  }

  async completeTask(taskId: string, raw: unknown, actor: AuthUser) {
    const input = CompleteTask.parse(raw);
    const missing = input.checklist.filter((c) => c.required && !c.done).map((c) => c.item);
    if (missing.length) throw new DomainError('CHECKLIST_INCOMPLETE', 'Required checklist steps are not done', 422, { missing });
    return this.jobs.dbs.tx(async (trx) => {
      const t = await this.lockTask(trx, taskId);
      const job = await this.jobs.lock(trx, t.job_id);
      this.jobs.requireStatus(job, 'IN_REPAIR');
      if (t.status !== 'IN_PROGRESS') throw new DomainError('TASK_STATE', 'Start the task before completing it', 409);
      if (t.assigned_to !== actor.id) throw forbidden('Only the technician working the task can complete it');
      await trx.insertInto('repair_records').values({
        task_id: taskId, notes: input.notes, procedure_ref: input.procedureRef ?? null,
        measurements: JSON.stringify(input.measurements) as any, parts_used: JSON.stringify(input.partsUsed) as any,
        checklist: JSON.stringify(input.checklist) as any, completed_by: actor.id,
      }).execute();
      const after = await trx.updateTable('job_tasks').set({ status: 'DONE', finished_at: new Date(), labour_minutes: input.labourMinutes, updated_at: new Date() })
        .where('id', '=', taskId).returningAll().executeTakeFirstOrThrow();
      await this.jobs.audit.write(trx, { actorId: actor.id, action: 'task.complete', entity: 'job_task', entityId: taskId, after: { ...input }, ip: actor.ip, branchId: job.branch_id });
      return after;
    });
  }

  async submitForQc(jobId: string, actor: AuthUser) {
    return this.jobs.dbs.tx(async (trx) => {
      const job = await this.jobs.lock(trx, jobId);
      this.jobs.requireStatus(job, 'IN_REPAIR');
      const tasks = await trx.selectFrom('job_tasks').select(['title', 'status']).where('job_id', '=', jobId).where('kind', '=', 'REPAIR').execute();
      const open = tasks.filter((t) => !['DONE', 'CANCELLED'].includes(t.status));
      if (!tasks.some((t) => t.status === 'DONE')) throw new DomainError('NO_COMPLETED_WORK', 'No repair task has been completed');
      if (open.length) throw new DomainError('TASKS_OPEN', 'All repair tasks must be completed before QC', 422, { open: open.map((t) => t.title) });
      return this.jobs.setStatus(trx, job, 'QC', actor, { reason: 'Repairs complete, sent to QC' });
    });
  }

  /** Gate 2 bypass: only with an authorised SKIP_QC exception. */
  async skipQc(jobId: string, actor: AuthUser) {
    return this.jobs.dbs.tx(async (trx) => {
      const job = await this.jobs.lock(trx, jobId);
      this.jobs.requireStatus(job, 'IN_REPAIR');
      const ex = await this.jobs.useException(trx, jobId, 'SKIP_QC');
      if (!ex) throw new DomainError('QC_REQUIRED', 'Quality control is mandatory. An authorised SKIP_QC exception is the only override.', 403);
      return this.jobs.setStatus(trx, job, 'READY_TO_INVOICE', actor, { reason: 'QC skipped under authorised exception', exceptionId: ex.id });
    });
  }

  async templateFor(trx: any, category: string | null) {
    const fallback = await this.jobs.config.get<string>('qc.default_category', trx);
    for (const c of [category, fallback]) {
      if (!c) continue;
      const t = await trx.selectFrom('qc_templates').selectAll().where('repair_category', '=', c).where('active', '=', true).executeTakeFirst();
      if (t) {
        const items = await trx.selectFrom('qc_template_items').selectAll().where('template_id', '=', t.id).orderBy('sort').execute();
        return { ...t, items };
      }
    }
    throw new DomainError('NO_QC_TEMPLATE', 'No active QC template for this repair category');
  }

  async qcTemplateForJob(jobId: string) {
    const job = await this.jobs.dbs.db.selectFrom('jobs').select('repair_category').where('id', '=', jobId).executeTakeFirst();
    if (!job) throw notFound('Job');
    return this.templateFor(this.jobs.dbs.db, job.repair_category);
  }

  /** Outcome is computed by the server from the checklist, never chosen by the inspector. */
  async submitQc(jobId: string, raw: unknown, actor: AuthUser) {
    const input = QcInput.parse(raw);
    return this.jobs.dbs.tx(async (trx) => {
      const job = await this.jobs.lock(trx, jobId);
      this.jobs.requireStatus(job, 'QC');
      const tpl = await this.templateFor(trx, job.repair_category);
      const byCode = new Map(input.results.map((r) => [r.code, r]));
      const missing = tpl.items.filter((i: any) => !byCode.has(i.code)).map((i: any) => i.text);
      if (missing.length) throw new DomainError('QC_INCOMPLETE', 'Every checklist item must be answered', 422, { missing });

      if (tpl.requires_independent) {
        const worked = await trx.selectFrom('job_tasks as t').leftJoin('repair_records as r', 'r.task_id', 't.id').select('t.id')
          .where('t.job_id', '=', jobId).where((eb) => eb.or([eb('t.assigned_to', '=', actor.id), eb('r.completed_by', '=', actor.id)])).executeTakeFirst();
        if (worked) throw forbidden('This repair category needs independent QC. You worked on this job, so another inspector must do it.');
      }
      const failures: string[] = tpl.items.filter((i: any) => i.required && !byCode.get(i.code)!.passed).map((i: any) => i.text);
      if (tpl.requires_road_test && !input.roadTestDone) failures.push('Road test not done');
      if (tpl.requires_post_scan && input.postScanClear !== true) failures.push('Post-repair scan not clear');
      if (!input.complaintResolved) failures.push('Original complaint not confirmed resolved');
      const outcome = failures.length ? 'FAIL' : 'PASS';

      const row = await trx.insertInto('quality_control_inspections').values({
        job_id: jobId, template_id: tpl.id, inspector_id: actor.id, results: JSON.stringify(input.results) as any,
        road_test_done: input.roadTestDone, road_test_notes: input.roadTestNotes ?? null, post_scan_clear: input.postScanClear ?? null,
        post_scan_notes: input.postScanNotes ?? null, complaint_resolved: input.complaintResolved, outcome, notes: input.notes ?? null,
      }).returningAll().executeTakeFirstOrThrow();
      await this.jobs.audit.write(trx, { actorId: actor.id, action: `qc.${outcome.toLowerCase()}`, entity: 'job', entityId: jobId, after: { ...row, failures }, ip: actor.ip, branchId: job.branch_id });

      if (outcome === 'PASS') {
        await this.jobs.setStatus(trx, job, 'READY_TO_INVOICE', actor, { reason: 'QC passed' });
      } else {
        const anchor = await trx.selectFrom('job_tasks').select(['quotation_item_id', 'exception_id']).where('job_id', '=', jobId).where('kind', '=', 'REPAIR').where('status', '=', 'DONE').orderBy('created_at').executeTakeFirstOrThrow();
        await trx.insertInto('job_tasks').values({
          job_id: jobId, kind: 'REPAIR', title: `Rework after QC: ${failures.join('; ').slice(0, 250)}`,
          quotation_item_id: anchor.quotation_item_id, exception_id: anchor.exception_id, created_by: actor.id,
        }).execute();
        await this.jobs.setStatus(trx, job, 'IN_REPAIR', actor, { reason: `QC failed: ${failures.join('; ')}` });
      }
      return { ...row, failures };
    });
  }
}
