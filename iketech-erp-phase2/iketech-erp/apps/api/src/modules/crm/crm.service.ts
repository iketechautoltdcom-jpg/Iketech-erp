import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DbService } from '../../db/db';
import { AuditService } from '../../audit/audit.service';
import { ConfigService } from '../../config/config.service';
import { AuthUser } from '../../auth/decorators';
import { DomainError, notFound } from '../../common/errors';
import { z, phone } from '../../common/zod';

export const CustomerInput = z.object({
  type: z.enum(['INDIVIDUAL', 'CORPORATE']),
  name: z.string().trim().min(2).max(120),
  companyName: z.string().trim().max(160).optional(),
  phone,
  email: z.string().trim().toLowerCase().email().optional().or(z.literal('').transform(() => undefined)),
  address: z.string().trim().max(300).optional(),
  tin: z.string().trim().max(30).optional(),
  preferredChannel: z.enum(['WHATSAPP', 'SMS', 'EMAIL', 'PHONE']).default('WHATSAPP'),
  consentService: z.boolean().default(true),
  consentMarketing: z.boolean().default(false),
  /** Set true only after staff reviewed the possible duplicates the API returned. */
  confirmNotDuplicate: z.boolean().default(false),
}).refine((c) => c.type === 'INDIVIDUAL' || !!c.companyName, { message: 'Company name is required for corporate customers', path: ['companyName'] });

export const CustomerUpdate = z.object({
  version: z.number().int(),
  name: z.string().trim().min(2).max(120).optional(),
  companyName: z.string().trim().max(160).optional(),
  phone: phone.optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  address: z.string().trim().max(300).optional(),
  tin: z.string().trim().max(30).optional(),
  preferredChannel: z.enum(['WHATSAPP', 'SMS', 'EMAIL', 'PHONE']).optional(),
  consentService: z.boolean().optional(),
  consentMarketing: z.boolean().optional(),
});

/** Credit limit and payment terms are financial controls, changed only by finance roles. */
export const CreditUpdate = z.object({
  creditLimitNaira: z.number().nonnegative().max(1e9),
  paymentTermsDays: z.number().int().min(0).max(180),
});

export const VehicleInput = z.object({
  vin: z.string().trim().toUpperCase().regex(/^[A-HJ-NPR-Z0-9]{17}$/, 'VIN must be 17 characters (no I, O or Q)').optional()
    .or(z.literal('').transform(() => undefined)),
  plateNo: z.string().trim().toUpperCase().transform((s) => s.replace(/[\s-]/g, '')).pipe(z.string().min(3).max(12)),
  make: z.string().trim().min(1).max(40),
  model: z.string().trim().min(1).max(60),
  year: z.number().int().min(1950).max(new Date().getFullYear() + 1).optional(),
  engineCode: z.string().trim().max(30).optional(),
  transmission: z.enum(['MANUAL', 'AUTOMATIC', 'CVT', 'DCT', 'OTHER']).optional(),
  colour: z.string().trim().max(30).optional(),
});

/** ISO 3779 check digit. Applied as a warning: many vehicles sold in Nigeria are non-North-American and skip it. */
export function vinCheckDigitValid(vin: string): boolean {
  const map: Record<string, number> = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9 };
  const w = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 17; i++) { const c = vin[i]; sum += (/\d/.test(c) ? Number(c) : map[c]) * w[i]; }
  const r = sum % 11;
  return vin[8] === (r === 10 ? 'X' : String(r));
}

@Injectable()
export class CrmService {
  constructor(private readonly dbs: DbService, private readonly audit: AuditService, private readonly config: ConfigService) {}

  /** Possible duplicates: same phone or email (any type), or a very similar name. Staff decide before creating. */
  async findPossibleDuplicates(input: { phone?: string; email?: string; name?: string }) {
    const db = this.dbs.db;
    return db.selectFrom('customers').select(['id', 'ref', 'type', 'name', 'company_name', 'phone_e164', 'email'])
      .where('archived_at', 'is', null)
      .where((eb) => eb.or([
        ...(input.phone ? [eb('phone_e164', '=', input.phone)] : []),
        ...(input.email ? [eb('email', '=', input.email)] : []),
        ...(input.name ? [eb(sql`lower(regexp_replace(name, '\\s+', ' ', 'g'))`, '=', input.name.toLowerCase().replace(/\s+/g, ' '))] : []),
      ])).limit(10).execute();
  }

  async createCustomer(raw: unknown, actor: AuthUser) {
    const input = CustomerInput.parse(raw);
    const dups = await this.findPossibleDuplicates({ phone: input.phone, email: input.email, name: input.name });
    // Exact phone/email matches of the same type are blocked by unique indexes; near matches need confirmation.
    if (dups.length && !input.confirmNotDuplicate) {
      throw new DomainError('POSSIBLE_DUPLICATE', 'Possible existing customer found. Review the matches, then confirm to continue.', 409, { matches: dups });
    }
    return this.dbs.tx(async (trx) => {
      const ref = await this.config.nextNumber(trx, 'CUS');
      const row = await trx.insertInto('customers').values({
        ref, type: input.type, name: input.name, company_name: input.companyName ?? null, phone_e164: input.phone,
        email: input.email ?? null, address: input.address ?? null, tin: input.tin ?? null, preferred_channel: input.preferredChannel,
        consent_service: input.consentService, consent_marketing: input.consentMarketing, branch_id: actor.branchId, created_by: actor.id,
      }).returningAll().executeTakeFirstOrThrow();
      await this.audit.write(trx, { actorId: actor.id, action: 'customer.create', entity: 'customer', entityId: row.id, after: row, ip: actor.ip, branchId: actor.branchId });
      return row;
    });
  }

  async updateCustomer(id: string, raw: unknown, actor: AuthUser) {
    const input = CustomerUpdate.parse(raw);
    return this.dbs.tx(async (trx) => {
      const before = await trx.selectFrom('customers').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!before) throw notFound('Customer');
      if (before.version !== input.version) throw new DomainError('STALE', 'This customer was changed by someone else. Reload and try again.', 409);
      const after = await trx.updateTable('customers').set({
        name: input.name ?? before.name, company_name: input.companyName ?? before.company_name, phone_e164: input.phone ?? before.phone_e164,
        email: input.email ?? before.email, address: input.address ?? before.address, tin: input.tin ?? before.tin,
        preferred_channel: input.preferredChannel ?? before.preferred_channel,
        consent_service: input.consentService ?? before.consent_service, consent_marketing: input.consentMarketing ?? before.consent_marketing,
        version: before.version + 1, updated_at: new Date(), updated_by: actor.id,
      }).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
      await this.audit.write(trx, { actorId: actor.id, action: 'customer.update', entity: 'customer', entityId: id, before, after, ip: actor.ip, branchId: actor.branchId });
      return after;
    });
  }

  async updateCredit(id: string, raw: unknown, actor: AuthUser) {
    const input = CreditUpdate.parse(raw);
    return this.dbs.tx(async (trx) => {
      const before = await trx.selectFrom('customers').select(['credit_limit', 'payment_terms_days', 'version']).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!before) throw notFound('Customer');
      const after = await trx.updateTable('customers').set({
        credit_limit: Math.round(input.creditLimitNaira * 100), payment_terms_days: input.paymentTermsDays,
        version: before.version + 1, updated_at: new Date(), updated_by: actor.id,
      }).where('id', '=', id).returning(['credit_limit', 'payment_terms_days']).executeTakeFirstOrThrow();
      await this.audit.write(trx, { actorId: actor.id, action: 'customer.credit_change', entity: 'customer', entityId: id, before, after, ip: actor.ip });
      return after;
    });
  }

  async listCustomers(q: string | undefined, limit = 50) {
    let query = this.dbs.db.selectFrom('customers as c')
      .select(['c.id', 'c.ref', 'c.type', 'c.name', 'c.company_name', 'c.phone_e164', 'c.email', 'c.created_at',
        (eb) => eb.selectFrom('customer_vehicles as v').whereRef('v.customer_id', '=', 'c.id').where('v.archived_at', 'is', null)
          .select((e) => e.fn.countAll<number>().as('n')).as('vehicle_count'),
        (eb) => eb.selectFrom('invoices as i').whereRef('i.customer_id', '=', 'c.id').where('i.status', '<>', 'VOID')
          .select((e) => e.fn.coalesce(e.fn.sum<number>('i.balance'), sql<number>`0`).as('b')).as('outstanding')])
      .where('c.archived_at', 'is', null).orderBy('c.created_at', 'desc').limit(limit);
    if (q?.trim()) {
      const like = `%${q.trim().toLowerCase()}%`;
      const digits = q.replace(/\D/g, '');
      query = query.where((eb) => eb.or([
        eb(sql`lower(c.name)`, 'like', like), eb(sql`lower(coalesce(c.company_name, ''))`, 'like', like), eb('c.ref', 'ilike', like),
        ...(digits.length >= 4 ? [eb('c.phone_e164', 'like', `%${digits.slice(-9)}%`)] : []),
        eb.exists(eb.selectFrom('customer_vehicles as v').select('v.id').whereRef('v.customer_id', '=', 'c.id')
          .where((e) => e.or([e('v.plate_no', 'ilike', like.replace(/[\s-]/g, '')), e('v.vin', 'ilike', like)]))),
      ]));
    }
    return query.execute();
  }

  async getCustomer(id: string) {
    const db = this.dbs.db;
    const customer = await db.selectFrom('customers').selectAll().where('id', '=', id).executeTakeFirst();
    if (!customer) throw notFound('Customer');
    const [vehicles, jobs, contacts, balance] = await Promise.all([
      db.selectFrom('customer_vehicles').selectAll().where('customer_id', '=', id).where('archived_at', 'is', null).orderBy('created_at').execute(),
      db.selectFrom('jobs as j').innerJoin('customer_vehicles as v', 'v.id', 'j.vehicle_id')
        .select(['j.id', 'j.job_no', 'j.status', 'j.received_at', 'j.customer_complaint', 'v.plate_no', 'v.make', 'v.model'])
        .where('j.customer_id', '=', id).orderBy('j.received_at', 'desc').limit(100).execute(),
      db.selectFrom('customer_contacts').selectAll().where('customer_id', '=', id).execute(),
      db.selectFrom('invoices').select((eb) => [
        eb.fn.coalesce(eb.fn.sum<number>('balance'), sql<number>`0`).as('outstanding'),
        eb.fn.coalesce(eb.fn.sum<number>(sql`CASE WHEN ((now() AT TIME ZONE 'Africa/Lagos')::date - (due_date AT TIME ZONE 'Africa/Lagos')::date) >= 1 THEN balance ELSE 0 END`), sql<number>`0`).as('overdue'),
      ]).where('customer_id', '=', id).where('status', '<>', 'VOID').executeTakeFirstOrThrow(),
    ]);
    return { ...customer, vehicles, jobs, contacts, outstanding: Number(balance.outstanding), overdue: Number(balance.overdue) };
  }

  async addVehicle(customerId: string, raw: unknown, actor: AuthUser) {
    const input = VehicleInput.parse(raw);
    return this.dbs.tx(async (trx) => {
      const c = await trx.selectFrom('customers').select(['id', 'archived_at']).where('id', '=', customerId).executeTakeFirst();
      if (!c || c.archived_at) throw notFound('Customer');
      const ref = await this.config.nextNumber(trx, 'VEH');
      const row = await trx.insertInto('customer_vehicles').values({
        ref, customer_id: customerId, vin: input.vin ?? null, plate_no: input.plateNo, make: input.make, model: input.model,
        year: input.year ?? null, engine_code: input.engineCode ?? null, transmission: input.transmission ?? null,
        colour: input.colour ?? null, branch_id: actor.branchId, created_by: actor.id,
      }).returningAll().executeTakeFirstOrThrow();
      await this.audit.write(trx, { actorId: actor.id, action: 'vehicle.create', entity: 'vehicle', entityId: row.id, after: row, ip: actor.ip, branchId: actor.branchId });
      return { ...row, warnings: input.vin && !vinCheckDigitValid(input.vin) ? ['VIN check digit does not match (normal for many non-US vehicles). Re-read the VIN plate to be sure.'] : [] };
    });
  }

  async getVehicle(id: string) {
    const db = this.dbs.db;
    const v = await db.selectFrom('customer_vehicles as v').innerJoin('customers as c', 'c.id', 'v.customer_id')
      .selectAll('v').select(['c.name as customer_name', 'c.ref as customer_ref', 'c.phone_e164'])
      .where('v.id', '=', id).executeTakeFirst();
    if (!v) throw notFound('Vehicle');
    const history = await db.selectFrom('jobs as j').leftJoin('vehicle_inspections as i', 'i.job_id', 'j.id')
      .select(['j.id', 'j.job_no', 'j.status', 'j.received_at', 'j.delivered_at', 'j.customer_complaint', 'i.mileage_in'])
      .where('j.vehicle_id', '=', id).orderBy('j.received_at', 'desc').execute();
    return { ...v, history };
  }

  async searchVehicles(q: string) {
    const like = `%${q.trim().toUpperCase().replace(/[\s-]/g, '')}%`;
    return this.dbs.db.selectFrom('customer_vehicles as v').innerJoin('customers as c', 'c.id', 'v.customer_id')
      .select(['v.id', 'v.ref', 'v.plate_no', 'v.vin', 'v.make', 'v.model', 'v.year', 'v.customer_id', 'c.name as customer_name', 'c.phone_e164'])
      .where('v.archived_at', 'is', null)
      .where((eb) => eb.or([eb('v.plate_no', 'like', like), eb('v.vin', 'like', like)])).limit(20).execute();
  }
}
