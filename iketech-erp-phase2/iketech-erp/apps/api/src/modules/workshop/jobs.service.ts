import { Injectable } from '@nestjs/common';
import { Selectable, sql } from 'kysely';
import { DbService, Tx } from '../../db/db';
import { Jobs, JobStatus, ExceptionKind } from '../../db/types';
import { AuditService } from '../../audit/audit.service';
import { ConfigService } from '../../config/config.service';
import { AuthUser } from '../../auth/decorators';
import { DomainError, forbidden, notFound } from '../../common/errors';
import { z, uuid } from '../../common/zod';

export type Job = Selectable<Jobs>;

export const ReceptionInput = z.object({
  customerId: uuid,
  vehicleId: uuid,
  customerComplaint: z.string().trim().min(3).max(2000),
  requestedWork: z.string().trim().max(2000).optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  promisedAt: z.coerce.date().optional(),
  inspection: z.object({
    mileageIn: z.number().int().min(0).max(3_000_000),
    fuelLevel: z.enum(['E', '1/4', '1/2', '3/4', 'F']),
    warningLights: z.array(z.string().trim().max(60)).max(30).default([]),
    damageNotes: z.array(z.object({ area: z.string().max(60), note: z.string().max(300) })).max(50).default([]),
    accessories: z.array(z.string().trim().max(60)).max(50).default([]),
    checklist: z.record(z.string(), z.enum(['OK', 'ATTENTION', 'NOT_CHECKED'])).default({}),
    customerAck: z.object({ method: z.enum(['SIGNATURE', 'OTP', 'VERBAL_RECORDED']), name: z.string().trim().min(2).max(120) }).optional(),
  }),
  keyLocation: z.string().trim().max(60).default('Reception key cabinet'),
});

const ExceptionRequest = z.object({
  kind: z.enum(['START_REPAIR_WITHOUT_APPROVAL', 'SKIP_QC', 'RELEASE_WITHOUT_PAYMENT', 'MILEAGE_OVERRIDE', 'DISCOUNT_ABOVE_LIMIT']),
  reason: z.string().trim().min(10).max(1000),
  limitBp: z.number().int().min(0).max(10000).optional(), // for discount exceptions: the % (in basis points) authorised
});

/** Statuses the customer-facing workflow treats as "open". */
export const OPEN_STATUSES: JobStatus[] = ['RECEIVED', 'DIAGNOSING', 'QUOTE_PENDING', 'AWAITING_APPROVAL', 'APPROVED', 'IN_REPAIR', 'QC',
  'READY_TO_INVOICE', 'INVOICED', 'READY_FOR_COLLECTION', 'ON_HOLD'];

@Injectable()
export class JobsService {
  constructor(readonly dbs: DbService, readonly audit: AuditService, readonly config: ConfigService) {}

  async lock(trx: Tx, jobId: string): Promise<Job> {
    const job = await trx.selectFrom('jobs').selectAll().where('id', '=', jobId).forUpdate().executeTakeFirst();
    if (!job) throw notFound('Job');
    return job;
  }

  /** The only way a job's status changes: locked row, history row, audit row, one transaction. The DB trigger re-checks the edge. */
  async setStatus(trx: Tx, job: Job, to: JobStatus, actor: AuthUser, opts: { reason?: string; exceptionId?: string; extra?: Partial<Job> } = {}) {
    if (job.status === to) return job;
    const updated = await trx.updateTable('jobs').set({ ...(opts.extra as any), status: to, version: job.version + 1, updated_by: actor.id })
      .where('id', '=', job.id).returningAll().executeTakeFirstOrThrow();
    await trx.insertInto('job_status_history').values({
      job_id: job.id, from_status: job.status, to_status: to, reason: opts.reason ?? null, exception_id: opts.exceptionId ?? null, actor_id: actor.id,
    }).execute();
    await this.audit.write(trx, {
      actorId: actor.id, action: 'job.status', entity: 'job', entityId: job.id, ip: actor.ip, branchId: job.branch_id,
      before: { status: job.status }, after: { status: to, reason: opts.reason, exceptionId: opts.exceptionId },
    });
    return updated;
  }

  requireStatus(job: Job, ...allowed: JobStatus[]) {
    if (!allowed.includes(job.status)) {
      throw new DomainError('WRONG_STATUS', `Job ${job.job_no} is ${job.status}; this step needs ${allowed.join(' or ')}`, 409);
    }
  }

  /** Consumes an authorised, unexpired exception of the given kind for this job, or returns null. */
  async useException(trx: Tx, jobId: string, kind: ExceptionKind): Promise<{ id: string; limit_amount: number | null } | null> {
    const ex = await trx.selectFrom('approval_exceptions').select(['id', 'limit_amount'])
      .where('job_id', '=', jobId).where('kind', '=', kind).where('status', '=', 'AUTHORISED').where('expires_at', '>', new Date())
      .orderBy('decided_at', 'desc').forUpdate().executeTakeFirst();
    if (!ex) return null;
    await trx.updateTable('approval_exceptions').set({ status: 'USED', used_at: new Date() }).where('id', '=', ex.id).execute();
    return ex;
  }

  // ───────────── Reception ─────────────
  async receive(raw: unknown, actor: AuthUser) {
    const input = ReceptionInput.parse(raw);
    return this.dbs.tx(async (trx) => {
      const vehicle = await trx.selectFrom('customer_vehicles').selectAll().where('id', '=', input.vehicleId).forUpdate().executeTakeFirst();
      if (!vehicle || vehicle.archived_at) throw notFound('Vehicle');
      if (vehicle.customer_id !== input.customerId) throw new DomainError('VEHICLE_OWNER_MISMATCH', 'This vehicle is registered to a different customer');
      const previousMileage = vehicle.last_mileage;
      const mileageBelowRecord = previousMileage !== null && input.inspection.mileageIn < previousMileage;

      const branchCode = await this.config.branchCode(actor.branchId, trx);
      const jobNo = await this.config.nextNumber(trx, 'JOB', branchCode);
      const job = await trx.insertInto('jobs').values({
        job_no: jobNo, vehicle_id: vehicle.id, customer_id: input.customerId, branch_id: actor.branchId, status: 'RECEIVED',
        service_advisor_id: actor.id, priority: input.priority, customer_complaint: input.customerComplaint,
        requested_work: input.requestedWork ?? null, promised_at: input.promisedAt ?? null, created_by: actor.id,
      }).returningAll().executeTakeFirstOrThrow();

      const i = input.inspection;
      await trx.insertInto('vehicle_inspections').values({
        job_id: job.id, mileage_in: i.mileageIn, fuel_level: i.fuelLevel,
        warning_lights: JSON.stringify(i.warningLights) as any, damage_notes: JSON.stringify(i.damageNotes) as any,
        accessories: JSON.stringify(i.accessories) as any,
        checklist: JSON.stringify({ ...i.checklist, _previousMileage: previousMileage, _mileageBelowRecord: mileageBelowRecord }) as any,
        customer_concerns: input.customerComplaint,
        customer_ack_at: i.customerAck ? new Date() : null, ack_method: i.customerAck?.method ?? null, ack_name: i.customerAck?.name ?? null,
        created_by: actor.id,
      }).execute();
      await trx.insertInto('key_custody_events').values({ job_id: job.id, action: 'IN', location: input.keyLocation, holder_name: actor.fullName, actor_id: actor.id }).execute();
      await trx.insertInto('job_status_history').values({ job_id: job.id, from_status: null, to_status: 'RECEIVED', actor_id: actor.id, reason: 'Vehicle received' }).execute();
      if (!mileageBelowRecord) {
        await trx.updateTable('customer_vehicles').set({ last_mileage: i.mileageIn, updated_at: new Date() }).where('id', '=', vehicle.id).execute();
      }
      await this.audit.write(trx, { actorId: actor.id, action: 'job.receive', entity: 'job', entityId: job.id, after: { job, inspection: i }, ip: actor.ip, branchId: actor.branchId });
      return { ...job, warnings: mileageBelowRecord ? [`Mileage ${i.mileageIn} is below the last recorded ${previousMileage}. A MILEAGE_OVERRIDE exception is needed before diagnosis.`] : [] };
    });
  }

  // ───────────── Queries ─────────────
  async list(f: { status?: string; q?: string; branchId: string; limit?: number }) {
    let q = this.dbs.db.selectFrom('jobs as j')
      .innerJoin('customer_vehicles as v', 'v.id', 'j.vehicle_id')
      .innerJoin('customers as c', 'c.id', 'j.customer_id')
      .leftJoin('users as sa', 'sa.id', 'j.service_advisor_id')
      .leftJoin('users as dt', 'dt.id', 'j.diag_technician_id')
      .select(['j.id', 'j.job_no', 'j.status', 'j.priority', 'j.received_at', 'j.promised_at', 'j.customer_complaint', 'j.updated_at',
        'v.plate_no', 'v.make', 'v.model', 'v.year', 'c.name as customer_name', 'c.phone_e164', 'sa.full_name as advisor', 'dt.full_name as diag_tech'])
      .where('j.branch_id', '=', f.branchId).orderBy('j.received_at', 'desc').limit(f.limit ?? 200);
    if (f.status === 'OPEN') q = q.where('j.status', 'in', OPEN_STATUSES);
    else if (f.status) q = q.where('j.status', '=', f.status as JobStatus);
    if (f.q?.trim()) {
      const like = `%${f.q.trim()}%`;
      q = q.where((eb) => eb.or([eb('j.job_no', 'ilike', like), eb('v.plate_no', 'ilike', like.replace(/[\s-]/g, '')), eb('c.name', 'ilike', like)]));
    }
    return q.execute();
  }

  async get(id: string) {
    const db = this.dbs.db;
    const job = await db.selectFrom('jobs as j')
      .innerJoin('customer_vehicles as v', 'v.id', 'j.vehicle_id')
      .innerJoin('customers as c', 'c.id', 'j.customer_id')
      .leftJoin('users as sa', 'sa.id', 'j.service_advisor_id')
      .leftJoin('users as dt', 'dt.id', 'j.diag_technician_id')
      .leftJoin('users as sv', 'sv.id', 'j.supervisor_id')
      .selectAll('j')
      .select(['v.plate_no', 'v.vin', 'v.make', 'v.model', 'v.year', 'v.engine_code', 'v.ref as vehicle_ref',
        'c.name as customer_name', 'c.ref as customer_ref', 'c.phone_e164', 'c.email as customer_email', 'c.type as customer_type',
        'c.credit_limit', 'c.payment_terms_days',
        'sa.full_name as advisor', 'dt.full_name as diag_tech', 'sv.full_name as supervisor'])
      .where('j.id', '=', id).executeTakeFirst();
    if (!job) throw notFound('Job');
    const [inspection, history, keys, exceptions, tasks, reports, quotations, qc, invoices] = await Promise.all([
      db.selectFrom('vehicle_inspections').selectAll().where('job_id', '=', id).executeTakeFirst(),
      db.selectFrom('job_status_history as h').leftJoin('users as u', 'u.id', 'h.actor_id')
        .select(['h.id', 'h.from_status', 'h.to_status', 'h.reason', 'h.at', 'h.exception_id', 'u.full_name as actor']).where('h.job_id', '=', id).orderBy('h.at').execute(),
      db.selectFrom('key_custody_events').selectAll().where('job_id', '=', id).orderBy('at').execute(),
      db.selectFrom('approval_exceptions as e').leftJoin('users as r', 'r.id', 'e.requested_by').leftJoin('users as a', 'a.id', 'e.authorised_by')
        .selectAll('e').select(['r.full_name as requested_by_name', 'a.full_name as authorised_by_name']).where('e.job_id', '=', id).orderBy('e.created_at', 'desc').execute(),
      db.selectFrom('job_tasks as t').leftJoin('users as u', 'u.id', 't.assigned_to').leftJoin('repair_records as r', 'r.task_id', 't.id')
        .selectAll('t').select(['u.full_name as assignee', 'r.notes as repair_notes', 'r.checklist as repair_checklist', 'r.measurements', 'r.procedure_ref'])
        .where('t.job_id', '=', id).orderBy('t.created_at').execute(),
      db.selectFrom('diagnostic_reports as d').leftJoin('users as u', 'u.id', 'd.technician_id').selectAll('d').select('u.full_name as technician')
        .where('d.job_id', '=', id).orderBy('d.created_at').execute(),
      db.selectFrom('quotations').selectAll().where('job_id', '=', id).orderBy('created_at').execute(),
      db.selectFrom('quality_control_inspections as q').leftJoin('users as u', 'u.id', 'q.inspector_id').selectAll('q').select('u.full_name as inspector')
        .where('q.job_id', '=', id).orderBy('q.created_at').execute(),
      db.selectFrom('invoices').selectAll().where('job_id', '=', id).orderBy('created_at').execute(),
    ]);
    const reportIds = reports.map((r) => r.id);
    const findings = reportIds.length ? await db.selectFrom('diagnostic_findings').selectAll().where('report_id', 'in', reportIds).orderBy('created_at').execute() : [];
    const quoteIds = quotations.map((q) => q.id);
    const [items, approvals] = quoteIds.length ? await Promise.all([
      db.selectFrom('quotation_items').selectAll().where('quotation_id', 'in', quoteIds).orderBy('line_no').execute(),
      db.selectFrom('customer_approvals').selectAll().where('quotation_id', 'in', quoteIds).orderBy('decided_at').execute(),
    ]) : [[], []];
    return {
      ...job, inspection, history, keys, exceptions, tasks,
      diagnosticReports: reports.map((r) => ({ ...r, findings: findings.filter((f) => f.report_id === r.id) })),
      quotations: quotations.map((q) => ({ ...q, items: items.filter((i) => i.quotation_id === q.id), approvals: approvals.filter((a) => a.quotation_id === q.id) })),
      qcInspections: qc, invoices,
    };
  }

  // ───────────── Assignment & diagnosis start ─────────────
  async assign(id: string, raw: unknown, actor: AuthUser) {
    const input = z.object({ diagTechnicianId: uuid.optional(), supervisorId: uuid.optional(), repairCategory: z.string().trim().toUpperCase().max(40).optional() }).parse(raw);
    return this.dbs.tx(async (trx) => {
      const job = await this.lock(trx, id);
      if (['CLOSED', 'CANCELLED', 'DELIVERED'].includes(job.status)) throw new DomainError('JOB_CLOSED', 'This job is finished');
      if (input.diagTechnicianId) await this.requireRole(trx, input.diagTechnicianId, ['DIAG_TECH']);
      if (input.supervisorId) await this.requireRole(trx, input.supervisorId, ['OPS_MANAGER', 'CEO']);
      const after = await trx.updateTable('jobs').set({
        diag_technician_id: input.diagTechnicianId ?? job.diag_technician_id, supervisor_id: input.supervisorId ?? job.supervisor_id,
        repair_category: input.repairCategory ?? job.repair_category, version: job.version + 1, updated_by: actor.id,
      }).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
      await this.audit.write(trx, { actorId: actor.id, action: 'job.assign', entity: 'job', entityId: id, before: job, after, ip: actor.ip, branchId: job.branch_id });
      return after;
    });
  }

  async requireRole(trx: Tx, userId: string, roles: string[]) {
    const ok = await trx.selectFrom('user_roles as ur').innerJoin('roles as r', 'r.id', 'ur.role_id').innerJoin('users as u', 'u.id', 'ur.user_id')
      .select('ur.user_id').where('ur.user_id', '=', userId).where('r.code', 'in', roles).where('u.status', '=', 'ACTIVE').executeTakeFirst();
    if (!ok) throw new DomainError('INVALID_ASSIGNEE', `The selected person does not hold the ${roles.join('/')} role`);
  }

  async startDiagnosis(id: string, actor: AuthUser) {
    return this.dbs.tx(async (trx) => {
      const job = await this.lock(trx, id);
      this.requireStatus(job, 'RECEIVED');
      if (!job.diag_technician_id) throw new DomainError('NO_TECHNICIAN', 'Assign a diagnostic technician first');
      const insp = await trx.selectFrom('vehicle_inspections').select(['checklist', 'mileage_in']).where('job_id', '=', id).executeTakeFirstOrThrow();
      const meta = insp.checklist as any;
      let exceptionId: string | undefined;
      if (meta?._mileageBelowRecord) {
        const ex = await this.useException(trx, id, 'MILEAGE_OVERRIDE');
        if (!ex) throw new DomainError('MILEAGE_BELOW_RECORD', `Mileage in (${insp.mileage_in}) is below the last record (${meta._previousMileage}). An authorised MILEAGE_OVERRIDE exception is required.`);
        exceptionId = ex.id;
        await trx.updateTable('vehicle_inspections').set({ mileage_override_exception_id: ex.id }).where('job_id', '=', id).execute();
        await trx.updateTable('customer_vehicles').set({ last_mileage: insp.mileage_in }).where('id', '=', job.vehicle_id).execute();
      }
      return this.setStatus(trx, job, 'DIAGNOSING', actor, { reason: 'Diagnosis started', exceptionId });
    });
  }

  // ───────────── Hold / resume / cancel ─────────────
  async hold(id: string, reason: string, actor: AuthUser) {
    if (!reason || reason.trim().length < 5) throw new DomainError('REASON_REQUIRED', 'Give a reason for the hold', 400);
    return this.dbs.tx(async (trx) => {
      const job = await this.lock(trx, id);
      return this.setStatus(trx, job, 'ON_HOLD', actor, { reason, extra: { hold_from_status: job.status } as any });
    });
  }

  async resume(id: string, actor: AuthUser) {
    return this.dbs.tx(async (trx) => {
      const job = await this.lock(trx, id);
      this.requireStatus(job, 'ON_HOLD');
      return this.setStatus(trx, job, job.hold_from_status!, actor, { reason: 'Resumed', extra: { hold_from_status: null } as any });
    });
  }

  async cancel(id: string, reason: string, actor: AuthUser) {
    if (!reason || reason.trim().length < 5) throw new DomainError('REASON_REQUIRED', 'Give a reason for cancelling', 400);
    return this.dbs.tx(async (trx) => {
      const job = await this.lock(trx, id);
      const doneWork = await trx.selectFrom('job_tasks').select('id').where('job_id', '=', id).where('kind', '=', 'REPAIR').where('status', '=', 'DONE').executeTakeFirst();
      const invoiced = await trx.selectFrom('invoices').select('id').where('job_id', '=', id).where('status', '<>', 'VOID').executeTakeFirst();
      if (doneWork && !invoiced) throw new DomainError('WORK_NOT_INVOICED', 'Repair work has been done on this job. Invoice it (or get it written off in Phase 2) before cancelling.');
      return this.setStatus(trx, job, 'CANCELLED', actor, { reason });
    });
  }

  // ───────────── Exceptions (segregation of duties enforced here and by a DB check) ─────────────
  async requestException(jobId: string, raw: unknown, actor: AuthUser) {
    const input = ExceptionRequest.parse(raw);
    return this.dbs.tx(async (trx) => {
      const job = await this.lock(trx, jobId);
      const hours = await this.config.get<number>('exception.default_expiry_hours', trx);
      const row = await trx.insertInto('approval_exceptions').values({
        job_id: jobId, kind: input.kind, reason: input.reason, limit_amount: input.limitBp ?? null, requested_by: actor.id,
        expires_at: new Date(Date.now() + hours * 3600000),
      }).returningAll().executeTakeFirstOrThrow();
      await this.audit.write(trx, { actorId: actor.id, action: 'exception.request', entity: 'approval_exception', entityId: row.id, after: row, ip: actor.ip, branchId: job.branch_id });
      return row;
    });
  }

  async decideException(exceptionId: string, decision: 'AUTHORISED' | 'REJECTED', actor: AuthUser) {
    return this.dbs.tx(async (trx) => {
      const ex = await trx.selectFrom('approval_exceptions').selectAll().where('id', '=', exceptionId).forUpdate().executeTakeFirst();
      if (!ex) throw notFound('Exception');
      if (ex.status !== 'PENDING') throw new DomainError('ALREADY_DECIDED', `This exception is already ${ex.status}`, 409);
      if (ex.requested_by === actor.id) throw forbidden('You cannot authorise an exception you requested');
      if (ex.kind === 'DISCOUNT_ABOVE_LIMIT' && decision === 'AUTHORISED') {
        const limit = await this.config.approvalLimit(actor.roles, 'DISCOUNT_PERCENT_BP', trx);
        if ((ex.limit_amount ?? 10000) > limit) throw forbidden(`Your discount authority is ${limit / 100}%; this request needs ${(ex.limit_amount ?? 10000) / 100}%`);
      }
      const hours = await this.config.get<number>('exception.default_expiry_hours', trx);
      const after = await trx.updateTable('approval_exceptions').set({
        status: decision, authorised_by: actor.id, decided_at: new Date(), expires_at: new Date(Date.now() + hours * 3600000),
      }).where('id', '=', exceptionId).returningAll().executeTakeFirstOrThrow();
      await this.audit.write(trx, { actorId: actor.id, action: `exception.${decision.toLowerCase()}`, entity: 'approval_exception', entityId: ex.id, before: ex, after, ip: actor.ip });
      return after;
    });
  }

  listPendingExceptions(branchId: string) {
    return this.dbs.db.selectFrom('approval_exceptions as e').innerJoin('jobs as j', 'j.id', 'e.job_id').leftJoin('users as u', 'u.id', 'e.requested_by')
      .select(['e.id', 'e.kind', 'e.reason', 'e.limit_amount', 'e.created_at', 'e.requested_by', 'j.id as job_id', 'j.job_no', 'u.full_name as requested_by_name'])
      .where('e.status', '=', 'PENDING').where('j.branch_id', '=', branchId).orderBy('e.created_at').execute();
  }

  // ───────────── Collection & follow-up ─────────────
  async deliver(id: string, raw: unknown, actor: AuthUser) {
    const input = z.object({
      collectedByName: z.string().trim().min(2).max(120),
      identityChecked: z.literal(true, { message: 'Confirm the collector identity was checked' }),
      mileageOut: z.number().int().min(0),
    }).parse(raw);
    return this.dbs.tx(async (trx) => {
      const job = await this.lock(trx, id);
      this.requireStatus(job, 'READY_FOR_COLLECTION');
      const insp = await trx.selectFrom('vehicle_inspections').select('mileage_in').where('job_id', '=', id).executeTakeFirstOrThrow();
      if (input.mileageOut < insp.mileage_in) throw new DomainError('MILEAGE_OUT_INVALID', 'Mileage out cannot be lower than mileage in');
      const days = await this.config.get<number>('followup.days_after_delivery', trx);
      await trx.insertInto('key_custody_events').values({ job_id: id, action: 'OUT', holder_name: input.collectedByName, note: 'Keys handed to collector; identity checked', actor_id: actor.id }).execute();
      await trx.updateTable('customer_vehicles').set({ last_mileage: sql`greatest(coalesce(last_mileage,0), ${input.mileageOut})` }).where('id', '=', job.vehicle_id).execute();
      return this.setStatus(trx, job, 'DELIVERED', actor, {
        reason: `Collected by ${input.collectedByName}`,
        extra: { delivered_at: new Date(), mileage_out: input.mileageOut, follow_up_at: new Date(Date.now() + days * 86400000) } as any,
      });
    });
  }

  async followUp(id: string, raw: unknown, actor: AuthUser) {
    const input = z.object({ outcome: z.string().trim().min(3).max(1000), satisfaction: z.number().int().min(1).max(5).optional() }).parse(raw);
    return this.dbs.tx(async (trx) => {
      const job = await this.lock(trx, id);
      this.requireStatus(job, 'DELIVERED', 'DECLINED');
      await this.audit.write(trx, { actorId: actor.id, action: 'job.follow_up', entity: 'job', entityId: id, after: input, ip: actor.ip, branchId: job.branch_id });
      return this.setStatus(trx, job, 'CLOSED', actor, { reason: `Follow-up: ${input.outcome}${input.satisfaction ? ` (rating ${input.satisfaction}/5)` : ''}`, extra: { closed_at: new Date() } as any });
    });
  }
}
