import { Injectable } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { Tx } from '../../db/db';
import { AuthUser } from '../../auth/decorators';
import { DomainError, notFound } from '../../common/errors';
import { z, uuid, naira } from '../../common/zod';
import { computeLine } from '../../common/money';

const ItemInput = z.object({
  kind: z.enum(['LABOUR', 'PART', 'SUBLET', 'FEE']),
  description: z.string().trim().min(2).max(300),
  qty: z.number().positive().max(10000).refine((q) => Math.round(q * 100) === q * 100, 'At most 2 decimal places'),
  unitPrice: naira, // naira in, kobo stored
  discount: naira.default(0),
  taxCode: z.string().trim().toUpperCase().default('VAT_STANDARD'),
  isOptional: z.boolean().default(false),
});
const QuoteInput = z.object({ items: z.array(ItemInput).min(1).max(100), pricesIncludeTax: z.boolean().default(false) });

const DecisionInput = z.object({
  approvedItemIds: z.array(uuid).max(100),
  channel: z.enum(['IN_PERSON', 'PHONE', 'WHATSAPP', 'EMAIL', 'PORTAL']),
  approverName: z.string().trim().min(2).max(120),
  approverContact: z.string().trim().min(5).max(120),
  evidenceNote: z.string().trim().min(5).max(1000).optional(),
});

@Injectable()
export class QuotationsService {
  constructor(private readonly jobs: JobsService) {}

  private async buildLines(trx: Tx, quoteId: string, items: z.infer<typeof ItemInput>[], inclusive: boolean) {
    const rates = new Map<string, number>();
    let subtotal = 0, discountTotal = 0, taxTotal = 0, total = 0;
    let lineNo = 0;
    for (const it of items) {
      if (!rates.has(it.taxCode)) rates.set(it.taxCode, await this.jobs.config.taxRate(it.taxCode, new Date(), trx));
      let amt;
      try {
        amt = computeLine({ qty: it.qty, unitPrice: it.unitPrice, discount: it.discount, rateBp: rates.get(it.taxCode)!, pricesIncludeTax: inclusive });
      } catch (e) {
        throw new DomainError('INVALID_DISCOUNT', `Line ${lineNo + 1}: ${(e as Error).message}`, 400);
      }
      lineNo++;
      await trx.insertInto('quotation_items').values({
        quotation_id: quoteId, line_no: lineNo, kind: it.kind, description: it.description, qty: it.qty, unit_price: it.unitPrice,
        discount: it.discount, tax_code: it.taxCode, net_amount: amt.net, tax_amount: amt.tax, line_total: amt.total, is_optional: it.isOptional,
      }).execute();
      // Totals: subtotal is the pre-discount net value, so subtotal - discount + tax = total holds for both pricing modes.
      subtotal += amt.net + it.discount;
      discountTotal += it.discount;
      taxTotal += amt.tax;
      total += amt.total;
    }
    await trx.updateTable('quotations').set({ subtotal, discount_total: discountTotal, tax_total: taxTotal, total, updated_at: new Date() })
      .where('id', '=', quoteId).execute();
    return { subtotal, discountTotal, taxTotal, total };
  }

  private async openQuote(trx: Tx, jobId: string) {
    return trx.selectFrom('quotations').select(['id', 'status']).where('job_id', '=', jobId).where('status', 'in', ['DRAFT', 'SENT']).executeTakeFirst();
  }

  async create(jobId: string, raw: unknown, actor: AuthUser) {
    const input = QuoteInput.parse(raw);
    return this.jobs.dbs.tx(async (trx) => {
      const job = await this.jobs.lock(trx, jobId);
      this.jobs.requireStatus(job, 'QUOTE_PENDING', 'IN_REPAIR');
      if (await this.openQuote(trx, jobId)) throw new DomainError('QUOTE_OPEN', 'This job already has an open quotation. Revise it instead.', 409);
      const isSupplementary = job.status === 'IN_REPAIR';
      const days = await this.jobs.config.get<number>('quotation.validity_days', trx);
      const branchCode = await this.jobs.config.branchCode(job.branch_id, trx);
      const quoteNo = await this.jobs.config.nextNumber(trx, 'QUO', branchCode);
      const q = await trx.insertInto('quotations').values({
        quote_no: quoteNo, version: 1, job_id: jobId, is_supplementary: isSupplementary, prices_include_tax: input.pricesIncludeTax,
        valid_until: new Date(Date.now() + days * 86400000), created_by: actor.id,
      }).returningAll().executeTakeFirstOrThrow();
      const totals = await this.buildLines(trx, q.id, input.items, input.pricesIncludeTax);
      await this.jobs.audit.write(trx, { actorId: actor.id, action: 'quotation.create', entity: 'quotation', entityId: q.id, after: { ...q, ...totals, items: input.items }, ip: actor.ip, branchId: job.branch_id });
      return this.get(q.id, trx);
    });
  }

  /** Draft: lines are replaced. Sent but undecided: a new version is issued and the old one is superseded. */
  async revise(quoteId: string, raw: unknown, actor: AuthUser) {
    const input = QuoteInput.parse(raw);
    return this.jobs.dbs.tx(async (trx) => {
      const q = await trx.selectFrom('quotations').selectAll().where('id', '=', quoteId).forUpdate().executeTakeFirst();
      if (!q) throw notFound('Quotation');
      const job = await this.jobs.lock(trx, q.job_id);
      const beforeItems = await trx.selectFrom('quotation_items').selectAll().where('quotation_id', '=', quoteId).execute();
      if (q.status === 'DRAFT') {
        await trx.deleteFrom('quotation_items').where('quotation_id', '=', quoteId).execute();
        await trx.updateTable('quotations').set({ prices_include_tax: input.pricesIncludeTax }).where('id', '=', quoteId).execute();
        const totals = await this.buildLines(trx, quoteId, input.items, input.pricesIncludeTax);
        await this.jobs.audit.write(trx, { actorId: actor.id, action: 'quotation.revise_draft', entity: 'quotation', entityId: quoteId, before: { ...q, items: beforeItems }, after: { ...totals, items: input.items }, ip: actor.ip });
        return this.get(quoteId, trx);
      }
      if (q.status !== 'SENT') throw new DomainError('QUOTE_DECIDED', `A ${q.status} quotation cannot be revised. Create a supplementary quotation for extra work.`, 409);
      await trx.updateTable('quotations').set({ status: 'SUPERSEDED', updated_at: new Date() }).where('id', '=', quoteId).execute();
      const days = await this.jobs.config.get<number>('quotation.validity_days', trx);
      const nq = await trx.insertInto('quotations').values({
        quote_no: q.quote_no, version: q.version + 1, job_id: q.job_id, parent_quote_id: q.id, is_supplementary: q.is_supplementary,
        prices_include_tax: input.pricesIncludeTax, valid_until: new Date(Date.now() + days * 86400000), created_by: actor.id,
      }).returningAll().executeTakeFirstOrThrow();
      const totals = await this.buildLines(trx, nq.id, input.items, input.pricesIncludeTax);
      if (!q.is_supplementary && job.status === 'AWAITING_APPROVAL') {
        await this.jobs.setStatus(trx, job, 'QUOTE_PENDING', actor, { reason: `Quotation ${q.quote_no} revised to v${nq.version}` });
      }
      await this.jobs.audit.write(trx, { actorId: actor.id, action: 'quotation.new_version', entity: 'quotation', entityId: nq.id, before: { ...q, items: beforeItems }, after: { ...nq, ...totals, items: input.items }, ip: actor.ip });
      return this.get(nq.id, trx);
    });
  }

  async send(quoteId: string, raw: unknown, actor: AuthUser) {
    const { channel } = z.object({ channel: z.enum(['IN_PERSON', 'PHONE', 'WHATSAPP', 'EMAIL']) }).parse(raw);
    return this.jobs.dbs.tx(async (trx) => {
      const q = await trx.selectFrom('quotations').selectAll().where('id', '=', quoteId).forUpdate().executeTakeFirst();
      if (!q) throw notFound('Quotation');
      if (q.status !== 'DRAFT') throw new DomainError('NOT_DRAFT', 'Only a draft quotation can be sent', 409);
      const job = await this.jobs.lock(trx, q.job_id);
      if (q.is_supplementary) this.jobs.requireStatus(job, 'IN_REPAIR', 'AWAITING_APPROVAL');
      else this.jobs.requireStatus(job, 'QUOTE_PENDING');

      // Discount authority: the sender's role limit, or an authorised DISCOUNT_ABOVE_LIMIT exception that covers it.
      let discountExceptionId: string | null = null;
      if (q.discount_total > 0) {
        const pctBp = Math.ceil((q.discount_total * 10000) / Math.max(q.subtotal, 1));
        const limit = await this.jobs.config.approvalLimit(actor.roles, 'DISCOUNT_PERCENT_BP', trx);
        if (pctBp > limit) {
          const ex = await this.jobs.useException(trx, job.id, 'DISCOUNT_ABOVE_LIMIT');
          if (!ex || (ex.limit_amount ?? 0) < pctBp) {
            throw new DomainError('DISCOUNT_NEEDS_APPROVAL', `Discount of ${(pctBp / 100).toFixed(2)}% is above your limit of ${limit / 100}%. Request a discount exception from a manager.`, 403);
          }
          discountExceptionId = ex.id;
        }
      }
      const hours = await this.jobs.config.get<number>('quotation.approval_deadline_hours', trx);
      const after = await trx.updateTable('quotations').set({
        status: 'SENT', sent_at: new Date(), sent_channel: channel, approval_deadline: new Date(Date.now() + hours * 3600000),
        discount_exception_id: discountExceptionId, updated_at: new Date(),
      }).where('id', '=', quoteId).returningAll().executeTakeFirstOrThrow();
      if (job.status !== 'AWAITING_APPROVAL') {
        await this.jobs.setStatus(trx, job, 'AWAITING_APPROVAL', actor, { reason: `Quotation ${q.quote_no} v${q.version} sent by ${channel}` });
        if (q.is_supplementary) {
          await trx.updateTable('job_tasks').set({ status: 'PAUSED', updated_at: new Date() }).where('job_id', '=', job.id).where('status', '=', 'IN_PROGRESS').execute();
        }
      }
      await this.jobs.audit.write(trx, { actorId: actor.id, action: 'quotation.send', entity: 'quotation', entityId: quoteId, before: { status: q.status }, after: { status: 'SENT', channel }, ip: actor.ip, branchId: job.branch_id });
      return after;
    });
  }

  /** Records the customer's decision with who decided, how, and when. Partial approval is supported per line. */
  async recordDecision(quoteId: string, raw: unknown, actor: AuthUser) {
    const input = DecisionInput.parse(raw);
    if (input.channel !== 'PORTAL' && !input.evidenceNote) {
      throw new DomainError('EVIDENCE_REQUIRED', 'Record how the customer gave the decision (e.g. "Approved by phone call at 14:05, spoke to Mr X")', 400);
    }
    return this.jobs.dbs.tx(async (trx) => {
      const q = await trx.selectFrom('quotations').selectAll().where('id', '=', quoteId).forUpdate().executeTakeFirst();
      if (!q) throw notFound('Quotation');
      if (q.status !== 'SENT') throw new DomainError('NOT_AWAITING_DECISION', `This quotation is ${q.status}`, 409);
      if (q.valid_until < new Date()) {
        await trx.updateTable('quotations').set({ status: 'EXPIRED' }).where('id', '=', quoteId).execute();
        throw new DomainError('QUOTE_EXPIRED', 'This quotation has expired. Revise it to issue a new version.', 409);
      }
      const job = await this.jobs.lock(trx, q.job_id);
      this.jobs.requireStatus(job, 'AWAITING_APPROVAL');
      const items = await trx.selectFrom('quotation_items').select(['id', 'line_no']).where('quotation_id', '=', quoteId).execute();
      const ids = new Set(items.map((i) => i.id));
      const approved = input.approvedItemIds.filter((id) => ids.has(id));
      if (approved.length !== input.approvedItemIds.length) throw new DomainError('INVALID_ITEMS', 'Some approved lines do not belong to this quotation', 400);

      for (const it of items) {
        await trx.updateTable('quotation_items').set({ decision: approved.includes(it.id) ? 'APPROVED' : 'REJECTED' }).where('id', '=', it.id).execute();
      }
      const decision = approved.length === 0 ? 'REJECTED' : approved.length === items.length ? 'APPROVED' : 'PARTIAL';
      const approval = await trx.insertInto('customer_approvals').values({
        quotation_id: quoteId, decision, approved_item_ids: approved, channel: input.channel, approver_name: input.approverName,
        approver_contact: input.approverContact, evidence_note: input.evidenceNote ?? null, ip: actor.ip ?? null, recorded_by: actor.id,
      }).returningAll().executeTakeFirstOrThrow();
      await trx.updateTable('quotations').set({
        status: decision === 'APPROVED' ? 'APPROVED' : decision === 'PARTIAL' ? 'PARTIALLY_APPROVED' : 'REJECTED', updated_at: new Date(),
      }).where('id', '=', quoteId).execute();
      await this.jobs.audit.write(trx, { actorId: actor.id, action: `quotation.${decision.toLowerCase()}`, entity: 'quotation', entityId: quoteId, after: approval, ip: actor.ip, branchId: job.branch_id });

      // Any approved work on the job (this or an earlier quotation) means the job can proceed; otherwise it is declined.
      const anyApproved = await trx.selectFrom('quotation_items as i').innerJoin('quotations as q', 'q.id', 'i.quotation_id')
        .select('i.id').where('q.job_id', '=', job.id).where('i.decision', '=', 'APPROVED').executeTakeFirst();
      await this.jobs.setStatus(trx, job, anyApproved ? 'APPROVED' : 'DECLINED', actor, {
        reason: `Customer ${decision.toLowerCase()} ${q.quote_no} v${q.version} via ${input.channel} (${input.approverName})`,
      });
      return approval;
    });
  }

  async get(id: string, db: any = this.jobs.dbs.db) {
    const q = await db.selectFrom('quotations').selectAll().where('id', '=', id).executeTakeFirst();
    if (!q) throw notFound('Quotation');
    const items = await db.selectFrom('quotation_items').selectAll().where('quotation_id', '=', id).orderBy('line_no').execute();
    const approvals = await db.selectFrom('customer_approvals').selectAll().where('quotation_id', '=', id).orderBy('decided_at').execute();
    return { ...q, items, approvals };
  }
}
