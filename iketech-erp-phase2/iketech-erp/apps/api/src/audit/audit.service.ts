import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { Tx, DbService } from '../db/db';

const SENSITIVE = /password|secret|token|mfa/i;

/** Removes secrets before anything is written to the audit trail. */
function scrub(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return v.map(scrub);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, SENSITIVE.test(k) ? '[redacted]' : scrub(x)]));
  }
  return v;
}

export interface AuditEntry {
  actorId: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string;
  branchId?: string | null;
}

@Injectable()
export class AuditService {
  constructor(private readonly dbs: DbService) {}

  /** Written inside the caller's transaction, so the change and its audit row commit or fail together. */
  async write(trx: Tx, e: AuditEntry) {
    await trx.insertInto('audit_logs').values({
      actor_id: e.actorId, action: e.action, entity: e.entity, entity_id: e.entityId ?? null,
      before: e.before === undefined ? null : (JSON.stringify(scrub(e.before)) as any),
      after: e.after === undefined ? null : (JSON.stringify(scrub(e.after)) as any),
      ip: e.ip ?? null, branch_id: e.branchId ?? null,
      prev_hash: '', hash: '', // set by the database hash-chain trigger
    }).execute();
  }

  async verify(): Promise<{ intact: boolean; brokenAtSeq: number | null; rows: number }> {
    const r = await sql<{ broken: number | null }>`SELECT audit_verify() AS broken`.execute(this.dbs.db);
    const n = await this.dbs.db.selectFrom('audit_logs').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
    const broken = r.rows[0].broken;
    return { intact: broken === null, brokenAtSeq: broken === null ? null : Number(broken), rows: Number(n.n) };
  }

  list(filter: { entity?: string; entityId?: string; limit: number }) {
    let q = this.dbs.db.selectFrom('audit_logs as a').leftJoin('users as u', 'u.id', 'a.actor_id')
      .select(['a.seq', 'a.at', 'a.action', 'a.entity', 'a.entity_id', 'a.before', 'a.after', 'a.ip', 'u.full_name as actor'])
      .orderBy('a.seq', 'desc').limit(filter.limit);
    if (filter.entity) q = q.where('a.entity', '=', filter.entity);
    if (filter.entityId) q = q.where('a.entity_id', '=', filter.entityId);
    return q.execute();
  }
}
