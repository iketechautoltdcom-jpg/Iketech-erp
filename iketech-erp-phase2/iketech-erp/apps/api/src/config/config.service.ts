import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { Tx, DbService, Db } from '../db/db';
import { DomainError } from '../common/errors';

/** Defaults are the proposals in Blueprint Section 12; every one is overridable in the settings table. */
export const SETTING_DEFAULTS: Record<string, { value: unknown; description: string }> = {
  'quotation.validity_days': { value: 7, description: 'Days a quotation stays valid' },
  'quotation.approval_deadline_hours': { value: 48, description: 'Hours the customer has to decide before the advisor is alerted' },
  'exception.default_expiry_hours': { value: 24, description: 'Hours an authorised gate exception stays usable' },
  'diagnosis.fee_on_decline': { value: true, description: 'Invoice a diagnosis fee when the customer declines the repair' },
  'diagnosis.fee_kobo': { value: null, description: 'Diagnosis fee in kobo (must be set by management before it can be invoiced)' },
  'diagnosis.fee_tax_code': { value: 'VAT_STANDARD', description: 'Tax code applied to the diagnosis fee' },
  'followup.days_after_delivery': { value: 3, description: 'Days after delivery that the follow-up call is due' },
  'tax.confirmed_by_adviser': { value: false, description: 'Set true only after a Nigerian tax professional has confirmed the tax configuration' },
  'qc.default_category': { value: 'GENERAL', description: 'QC template used when a job has no repair category' },
};

@Injectable()
export class ConfigService {
  constructor(private readonly dbs: DbService) {}

  async get<T = unknown>(key: string, db: Db | Tx = this.dbs.db): Promise<T> {
    const row = await db.selectFrom('settings').select('value').where('key', '=', key).executeTakeFirst();
    if (row) return row.value as T;
    if (key in SETTING_DEFAULTS) return SETTING_DEFAULTS[key].value as T;
    throw new DomainError('UNKNOWN_SETTING', `Unknown setting ${key}`, 500);
  }

  async all() {
    const rows = await this.dbs.db.selectFrom('settings').selectAll().execute();
    const stored = new Map(rows.map((r) => [r.key, r]));
    return Object.entries(SETTING_DEFAULTS).map(([key, d]) => ({
      key, description: d.description, value: stored.has(key) ? stored.get(key)!.value : d.value, isDefault: !stored.has(key),
    }));
  }

  /** Gapless, per-branch, per-year numbering. The row lock is held until the caller's transaction ends. */
  async nextNumber(trx: Tx, docType: 'CUS' | 'VEH' | 'JOB' | 'QUO' | 'INV' | 'RCT', branchCode?: string, at = new Date()): Promise<string> {
    const perBranch = !['CUS', 'VEH'].includes(docType);
    const scope = perBranch ? `${branchCode}-${at.getUTCFullYear()}` : 'GLOBAL';
    await trx.insertInto('number_sequences').values({ doc_type: docType, scope, next_value: 1 })
      .onConflict((oc) => oc.columns(['doc_type', 'scope']).doNothing()).execute();
    const r = await trx.updateTable('number_sequences').set({ next_value: sql`next_value + 1` })
      .where('doc_type', '=', docType).where('scope', '=', scope).returning('next_value').executeTakeFirstOrThrow();
    const n = r.next_value - 1;
    const width = docType === 'INV' || docType === 'RCT' || !perBranch ? 6 : 5;
    return perBranch ? `${docType}-${scope}-${String(n).padStart(width, '0')}` : `${docType}-${String(n).padStart(width, '0')}`;
  }

  /** Tax rate (basis points) for a tax code on a date. Rates are data, never constants in code. */
  async taxRate(code: string, on: Date, db: Db | Tx = this.dbs.db): Promise<number> {
    const day = on.toISOString().slice(0, 10);
    const row = await db.selectFrom('tax_configurations').select('rate_bp')
      .where('tax_code', '=', code).where('effective_from', '<=', day as any)
      .where((eb) => eb.or([eb('effective_to', 'is', null), eb('effective_to', '>=', day as any)]))
      .executeTakeFirst();
    if (!row) throw new DomainError('TAX_CODE_NOT_CONFIGURED', `No tax rate is configured for ${code} on ${day}`);
    return row.rate_bp;
  }

  async branchCode(branchId: string, db: Db | Tx = this.dbs.db) {
    return (await db.selectFrom('branches').select('code').where('id', '=', branchId).executeTakeFirstOrThrow()).code;
  }

  async approvalLimit(roles: string[], action: string, db: Db | Tx = this.dbs.db): Promise<number> {
    if (!roles.length) return 0;
    const r = await db.selectFrom('approval_limits').select((eb) => eb.fn.max('max_value').as('m'))
      .where('role_code', 'in', roles).where('action', '=', action).executeTakeFirst();
    return Number(r?.m ?? 0);
  }
}
