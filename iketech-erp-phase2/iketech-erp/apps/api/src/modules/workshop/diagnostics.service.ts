import { Injectable } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { AuthUser } from '../../auth/decorators';
import { DomainError, notFound } from '../../common/errors';
import { z, uuid } from '../../common/zod';

const ReportUpdate = z.object({
  complaintVerified: z.boolean().optional(),
  toolsUsed: z.string().trim().max(500).optional(),
  summary: z.string().trim().max(4000).optional(),
  rootCause: z.string().trim().max(2000).optional(),
  recommendedRepair: z.string().trim().max(4000).optional(),
  safetyNotes: z.string().trim().max(2000).optional(),
});

const FindingInput = z.object({
  kind: z.enum(['DTC', 'FREEZE_FRAME', 'LIVE_DATA', 'TEST', 'MEASUREMENT', 'OBSERVATION']),
  code: z.string().trim().toUpperCase().max(20).optional(),
  value: z.string().trim().max(500).optional(),
  unit: z.string().trim().max(20).optional(),
  interpretation: z.string().trim().max(2000).optional(),
  isRootCause: z.boolean().default(false),
  supportsId: uuid.optional(),
}).refine((f) => f.kind !== 'DTC' || !!f.code, { message: 'DTC findings need a code (e.g. P0301)', path: ['code'] });

const EVIDENCE_KINDS = ['TEST', 'MEASUREMENT', 'OBSERVATION', 'LIVE_DATA'];

@Injectable()
export class DiagnosticsService {
  constructor(private readonly jobs: JobsService) {}

  /** Opens (or returns) the technician's draft report for a job that is in diagnosis. */
  async openReport(jobId: string, actor: AuthUser) {
    return this.jobs.dbs.tx(async (trx) => {
      const job = await this.jobs.lock(trx, jobId);
      this.jobs.requireStatus(job, 'DIAGNOSING');
      const existing = await trx.selectFrom('diagnostic_reports').selectAll().where('job_id', '=', jobId).where('status', '=', 'DRAFT').executeTakeFirst();
      if (existing) return existing;
      const row = await trx.insertInto('diagnostic_reports').values({ job_id: jobId, technician_id: actor.id }).returningAll().executeTakeFirstOrThrow();
      await this.jobs.audit.write(trx, { actorId: actor.id, action: 'diagnosis.open', entity: 'diagnostic_report', entityId: row.id, ip: actor.ip, branchId: job.branch_id });
      return row;
    });
  }

  private async lockDraft(trx: any, reportId: string) {
    const r = await trx.selectFrom('diagnostic_reports').selectAll().where('id', '=', reportId).forUpdate().executeTakeFirst();
    if (!r) throw notFound('Diagnostic report');
    if (r.status !== 'DRAFT') throw new DomainError('REPORT_SUBMITTED', 'This report is already submitted and cannot be changed', 409);
    return r;
  }

  async update(reportId: string, raw: unknown, actor: AuthUser) {
    const input = ReportUpdate.parse(raw);
    return this.jobs.dbs.tx(async (trx) => {
      const before = await this.lockDraft(trx, reportId);
      const after = await trx.updateTable('diagnostic_reports').set({
        complaint_verified: input.complaintVerified ?? before.complaint_verified, tools_used: input.toolsUsed ?? before.tools_used,
        summary: input.summary ?? before.summary, root_cause: input.rootCause ?? before.root_cause,
        recommended_repair: input.recommendedRepair ?? before.recommended_repair, safety_notes: input.safetyNotes ?? before.safety_notes,
        updated_at: new Date(),
      }).where('id', '=', reportId).returningAll().executeTakeFirstOrThrow();
      await this.jobs.audit.write(trx, { actorId: actor.id, action: 'diagnosis.update', entity: 'diagnostic_report', entityId: reportId, before, after, ip: actor.ip });
      return after;
    });
  }

  async addFinding(reportId: string, raw: unknown, actor: AuthUser) {
    const input = FindingInput.parse(raw);
    return this.jobs.dbs.tx(async (trx) => {
      await this.lockDraft(trx, reportId);
      if (input.supportsId) {
        const target = await trx.selectFrom('diagnostic_findings').select(['id', 'report_id']).where('id', '=', input.supportsId).executeTakeFirst();
        if (!target || target.report_id !== reportId) throw new DomainError('INVALID_SUPPORT', 'A supporting finding must belong to the same report');
      }
      const row = await trx.insertInto('diagnostic_findings').values({
        report_id: reportId, kind: input.kind, code: input.code ?? null, value: input.value ?? null, unit: input.unit ?? null,
        interpretation: input.interpretation ?? null, is_root_cause: input.isRootCause, supports_id: input.supportsId ?? null, created_by: actor.id,
      }).returningAll().executeTakeFirstOrThrow();
      await this.jobs.audit.write(trx, { actorId: actor.id, action: 'diagnosis.finding', entity: 'diagnostic_report', entityId: reportId, after: row, ip: actor.ip });
      return row;
    });
  }

  /**
   * Submitting requires a root cause backed by evidence. A DTC on its own is never accepted as proof:
   * every root-cause finding must be a test, measurement, observation or live-data reading — or a DTC
   * that a test/measurement/observation finding in the same report explicitly confirms.
   */
  async submit(reportId: string, actor: AuthUser) {
    return this.jobs.dbs.tx(async (trx) => {
      const report = await this.lockDraft(trx, reportId);
      const job = await this.jobs.lock(trx, report.job_id);
      this.jobs.requireStatus(job, 'DIAGNOSING');
      const problems: string[] = [];
      if (!report.complaint_verified) problems.push('Confirm whether the customer complaint was verified');
      if (!report.root_cause?.trim()) problems.push('State the root cause');
      if (!report.recommended_repair?.trim()) problems.push('State the recommended repair');
      const findings = await trx.selectFrom('diagnostic_findings').selectAll().where('report_id', '=', reportId).execute();
      const rootCauses = findings.filter((f) => f.is_root_cause);
      if (!rootCauses.length) problems.push('Mark at least one finding as the root cause');
      for (const rc of rootCauses) {
        if (rc.kind === 'DTC' || rc.kind === 'FREEZE_FRAME') {
          const confirmed = findings.some((f) => f.supports_id === rc.id && EVIDENCE_KINDS.includes(f.kind));
          if (!confirmed) problems.push(`${rc.code ?? rc.kind} is a code, not proof. Add a test, measurement or observation that confirms it.`);
        }
      }
      if (problems.length) throw new DomainError('DIAGNOSIS_INCOMPLETE', 'The diagnosis cannot be submitted yet', 422, { problems });
      const after = await trx.updateTable('diagnostic_reports').set({ status: 'SUBMITTED', submitted_at: new Date(), updated_at: new Date() })
        .where('id', '=', reportId).returningAll().executeTakeFirstOrThrow();
      await this.jobs.audit.write(trx, { actorId: actor.id, action: 'diagnosis.submit', entity: 'diagnostic_report', entityId: reportId, after, ip: actor.ip, branchId: job.branch_id });
      await this.jobs.setStatus(trx, job, 'QUOTE_PENDING', actor, { reason: 'Diagnosis submitted' });
      return after;
    });
  }
}
