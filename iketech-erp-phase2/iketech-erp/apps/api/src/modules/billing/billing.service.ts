import { Injectable } from '@nestjs/common';
import { Selectable, sql } from 'kysely';
import { Tx } from '../../db/db';
import { Invoices } from '../../db/types';
import { JobsService } from '../workshop/jobs.service';
import { LedgerService, AccountKey } from './ledger.service';
import { AuthUser } from '../../auth/decorators';
import { DomainError, forbidden, notFound } from '../../common/errors';
import { z, uuid, naira } from '../../common/zod';
import { computeLine } from '../../common/money';

const PaymentInput = z.object({
  customerId: uuid,
  invoiceId: uuid.optional(),
  amount: naira.refine((k) => k > 0, 'Amount must be greater than zero'),
  method: z.enum(['CASH', 'BANK_TRANSFER', 'POS', 'GATEWAY', 'CHEQUE']),
  reference: z.string().trim().min(3).max(80).optional(),
  receivedAt: z.coerce.date().optional(),
  note: z.string().trim().max(500).optional(),
}).refine((p) => p.method === 'CASH' || !!p.reference, { message: 'A reference (transfer ID, POS slip or cheque number) is required', path: ['reference'] });

/** Overdue means the due date (Lagos calendar day) is before today — never on the day an invoice is issued. */
export const lagosDay = (d: Date | string) => new Date(new Date(d).getTime() + 3600000).toISOString().slice(0, 10);
export const isOverdue = (due: Date | string) => lagosDay(due) < lagosDay(new Date());

const revenueAccount = (kind: string): AccountKey => (kind === 'LABOUR' ? 'REV_LABOUR' : kind === 'PART' ? 'REV_PARTS' : 'REV_OTHER');

@Injectable()
export class BillingService {
  constructor(private readonly jobs: JobsService, private readonly ledger: LedgerService) {}

  /**
   * Gate 3 input — invoices are built only from approved quotation lines whose work was not cancelled,
   * copied at the approved price. Posts Dr Receivables / Cr Revenue by type / Cr Output VAT.
   */
  async issueForJob(jobId: string, actor: AuthUser) {
    return this.jobs.dbs.tx(async (trx) => {
      const job = await this.jobs.lock(trx, jobId);
      this.jobs.requireStatus(job, 'READY_TO_INVOICE', 'DECLINED');
      type Line = { kind: 'LABOUR' | 'PART' | 'SUBLET' | 'FEE'; description: string; qty: number; unit_price: number; discount: number; tax_code: string; net_amount: number; tax_amount: number; line_total: number; source_quotation_item_id: string | null };
      let lines: Line[];
      if (job.status === 'READY_TO_INVOICE') {
        const rows = await trx.selectFrom('quotation_items as i').innerJoin('quotations as q', 'q.id', 'i.quotation_id')
          .selectAll('i').where('q.job_id', '=', jobId).where('i.decision', '=', 'APPROVED')
          .where('q.status', 'in', ['APPROVED', 'PARTIALLY_APPROVED'])
          .orderBy('q.created_at').orderBy('i.line_no').execute();
        const tasks = await trx.selectFrom('job_tasks').select(['quotation_item_id', 'status']).where('job_id', '=', jobId).where('kind', '=', 'REPAIR').execute();
        // A line whose work task(s) never reached DONE (e.g. cancelled) is not billed; parts lines without their own task are.
        const billable = (itemId: string) => {
          const t = tasks.filter((x) => x.quotation_item_id === itemId);
          return t.length === 0 || t.some((x) => x.status === 'DONE');
        };
        rows.splice(0, rows.length, ...rows.filter((r) => billable(r.id)));
        lines = rows.map((r) => ({ ...r, source_quotation_item_id: r.id }));
        if (!lines.length) throw new DomainError('NOTHING_TO_INVOICE', 'There are no approved, completed lines to invoice. Work done under an exception must be quoted and approved first.');
      } else {
        if (!(await this.jobs.config.get<boolean>('diagnosis.fee_on_decline', trx))) throw new DomainError('NO_DIAGNOSIS_FEE', 'Diagnosis fees on declined jobs are switched off in settings');
        const fee = await this.jobs.config.get<number | null>('diagnosis.fee_kobo', trx);
        if (!fee) throw new DomainError('DIAGNOSIS_FEE_NOT_SET', 'Management has not set the diagnosis fee (setting diagnosis.fee_kobo)');
        const taxCode = await this.jobs.config.get<string>('diagnosis.fee_tax_code', trx);
        const rate = await this.jobs.config.taxRate(taxCode, new Date(), trx);
        const a = computeLine({ qty: 1, unitPrice: fee, discount: 0, rateBp: rate, pricesIncludeTax: false });
        lines = [{ kind: 'FEE', description: 'Diagnosis fee (repair declined)', qty: 1, unit_price: fee, discount: 0, tax_code: taxCode, net_amount: a.net, tax_amount: a.tax, line_total: a.total, source_quotation_item_id: null }];
      }
      const discountTotal = lines.reduce((s, l) => s + Number(l.discount), 0);
      const taxTotal = lines.reduce((s, l) => s + Number(l.tax_amount), 0);
      const total = lines.reduce((s, l) => s + Number(l.line_total), 0);
      const subtotal = total - taxTotal + discountTotal;

      const customer = await trx.selectFrom('customers').select(['payment_terms_days']).where('id', '=', job.customer_id).executeTakeFirstOrThrow();
      const branchCode = await this.jobs.config.branchCode(job.branch_id, trx);
      const now = new Date();
      const invoice = await trx.insertInto('invoices').values({
        invoice_no: await this.jobs.config.nextNumber(trx, 'INV', branchCode), job_id: jobId, customer_id: job.customer_id, branch_id: job.branch_id,
        issue_date: now, due_date: new Date(now.getTime() + customer.payment_terms_days * 86400000),
        subtotal, discount_total: discountTotal, tax_total: taxTotal, total, amount_paid: 0, balance: total, created_by: actor.id,
      }).returningAll().executeTakeFirstOrThrow();
      for (const l of lines) {
        await trx.insertInto('invoice_items').values({
          invoice_id: invoice.id, source_quotation_item_id: l.source_quotation_item_id, kind: l.kind, description: l.description, qty: l.qty,
          unit_price: l.unit_price, discount: l.discount, tax_code: l.tax_code, net_amount: l.net_amount, tax_amount: l.tax_amount, line_total: l.line_total,
        }).execute();
      }
      const revenue = new Map<AccountKey, number>();
      for (const l of lines) revenue.set(revenueAccount(l.kind), (revenue.get(revenueAccount(l.kind)) ?? 0) + Number(l.net_amount));
      await this.ledger.post(trx, {
        date: now, branchId: job.branch_id, sourceType: 'INVOICE', sourceId: invoice.id, memo: `Invoice ${invoice.invoice_no}`, actorId: actor.id,
        lines: [
          { account: 'AR', debit: total, customerId: job.customer_id },
          ...[...revenue].map(([account, credit]) => ({ account, credit })),
          { account: 'VAT_OUT', credit: taxTotal },
        ],
      });
      await this.jobs.audit.write(trx, { actorId: actor.id, action: 'invoice.issue', entity: 'invoice', entityId: invoice.id, after: { ...invoice, lines }, ip: actor.ip, branchId: job.branch_id });
      await this.jobs.setStatus(trx, job, 'INVOICED', actor, { reason: `Invoice ${invoice.invoice_no} issued` });

      // Apply any unallocated customer deposits (oldest first), then release the vehicle if fully paid.
      await this.applyDeposits(trx, invoice.id, actor);
      await this.autoRelease(trx, jobId, actor);
      return this.getInvoice(invoice.id, trx);
    });
  }

  // ───────────── Payments ─────────────
  /** Cash is cleared on receipt. Transfers, POS, gateway and cheques stay PENDING until finance confirms them in the bank. */
  async recordPayment(raw: unknown, actor: AuthUser) {
    const input = PaymentInput.parse(raw);
    return this.jobs.dbs.tx(async (trx) => {
      const cust = await trx.selectFrom('customers').select(['id', 'branch_id']).where('id', '=', input.customerId).executeTakeFirst();
      if (!cust) throw notFound('Customer');
      if (input.invoiceId) {
        const inv = await trx.selectFrom('invoices').select(['customer_id', 'status']).where('id', '=', input.invoiceId).executeTakeFirst();
        if (!inv || inv.customer_id !== input.customerId) throw new DomainError('INVOICE_MISMATCH', 'This invoice belongs to a different customer');
        if (inv.status === 'VOID') throw new DomainError('INVOICE_VOID', 'This invoice is void');
      }
      const p = await trx.insertInto('payments').values({
        customer_id: input.customerId, branch_id: actor.branchId, amount: input.amount, method: input.method, reference: input.reference ?? null,
        received_at: input.receivedAt ?? new Date(), received_by: actor.id, note: input.note ?? null, intended_invoice_id: input.invoiceId ?? null,
      }).returningAll().executeTakeFirstOrThrow();
      await this.jobs.audit.write(trx, { actorId: actor.id, action: 'payment.record', entity: 'payment', entityId: p.id, after: p, ip: actor.ip, branchId: actor.branchId });
      if (input.method === 'CASH') return this.clearInTx(trx, p.id, actor, true);
      return p;
    });
  }

  async clearPayment(paymentId: string, actor: AuthUser) {
    return this.jobs.dbs.tx((trx) => this.clearInTx(trx, paymentId, actor, false));
  }

  private async clearInTx(trx: Tx, paymentId: string, actor: AuthUser, onReceipt: boolean) {
    const p = await trx.selectFrom('payments').selectAll().where('id', '=', paymentId).forUpdate().executeTakeFirst();
    if (!p) throw notFound('Payment');
    if (p.status !== 'PENDING') throw new DomainError('PAYMENT_STATE', `Payment is already ${p.status}`, 409);
    if (!onReceipt && p.received_by === actor.id) throw forbidden('Someone other than the person who recorded this payment must confirm it');
    const branchCode = await this.jobs.config.branchCode(p.branch_id, trx);
    const now = new Date();
    const cleared = await trx.updateTable('payments').set({
      status: 'CLEARED', cleared_at: now, cleared_by: actor.id, receipt_no: await this.jobs.config.nextNumber(trx, 'RCT', branchCode),
    }).where('id', '=', paymentId).returningAll().executeTakeFirstOrThrow();
    await this.ledger.post(trx, {
      date: now, branchId: p.branch_id, sourceType: 'PAYMENT_CLEARED', sourceId: p.id, memo: `Receipt ${cleared.receipt_no}`, actorId: actor.id,
      lines: [{ account: p.method === 'CASH' ? 'CASH' : 'BANK', debit: p.amount }, { account: 'DEPOSITS', credit: p.amount, customerId: p.customer_id }],
    });
    await this.jobs.audit.write(trx, { actorId: actor.id, action: 'payment.clear', entity: 'payment', entityId: p.id, before: { status: p.status }, after: cleared, ip: actor.ip, branchId: p.branch_id });

    // Allocate to the intended invoice first, then any other open invoices of the customer, oldest first. The rest stays as a deposit.
    let remaining = p.amount;
    const targets = await trx.selectFrom('invoices').select(['id']).where('customer_id', '=', p.customer_id).where('balance', '>', 0)
      .where('status', 'in', ['ISSUED', 'PARTIALLY_PAID'])
      .orderBy(sql`CASE WHEN id = ${p.intended_invoice_id} THEN 0 ELSE 1 END`).orderBy('issue_date').execute();
    for (const t of targets) {
      if (remaining <= 0) break;
      remaining -= await this.allocate(trx, p.id, t.id, remaining, actor);
    }
    return { ...cleared, unallocated: remaining };
  }

  /** Moves cleared money from deposits to an invoice: Dr Deposits / Cr Receivables. Returns the amount applied. */
  private async allocate(trx: Tx, paymentId: string, invoiceId: string, max: number, actor: AuthUser): Promise<number> {
    const inv = await trx.selectFrom('invoices').selectAll().where('id', '=', invoiceId).forUpdate().executeTakeFirstOrThrow();
    const amount = Math.min(max, inv.balance);
    if (amount <= 0) return 0;
    const alloc = await trx.insertInto('payment_allocations').values({ payment_id: paymentId, invoice_id: invoiceId, amount, created_by: actor.id }).returning('id').executeTakeFirstOrThrow();
    const paid = inv.amount_paid + amount;
    const balance = inv.total - paid;
    await trx.updateTable('invoices').set({ amount_paid: paid, balance, status: balance === 0 ? 'PAID' : 'PARTIALLY_PAID', version: inv.version + 1 })
      .where('id', '=', invoiceId).execute();
    await this.ledger.post(trx, {
      date: new Date(), branchId: inv.branch_id, sourceType: 'ALLOCATION', sourceId: alloc.id, memo: `Applied to ${inv.invoice_no}`, actorId: actor.id,
      lines: [{ account: 'DEPOSITS', debit: amount, customerId: inv.customer_id }, { account: 'AR', credit: amount, customerId: inv.customer_id }],
    });
    await this.jobs.audit.write(trx, { actorId: actor.id, action: 'payment.allocate', entity: 'invoice', entityId: invoiceId, before: { amount_paid: inv.amount_paid, balance: inv.balance }, after: { amount_paid: paid, balance, paymentId, amount }, ip: actor.ip, branchId: inv.branch_id });
    if (inv.job_id && balance === 0) await this.autoRelease(trx, inv.job_id, actor);
    return amount;
  }

  private async applyDeposits(trx: Tx, invoiceId: string, actor: AuthUser) {
    const inv = await trx.selectFrom('invoices').select(['customer_id']).where('id', '=', invoiceId).executeTakeFirstOrThrow();
    const pays = await trx.selectFrom('payments as p').select(['p.id', 'p.amount',
      (eb) => eb.fn.coalesce(eb.selectFrom('payment_allocations as a').whereRef('a.payment_id', '=', 'p.id').select((e) => e.fn.sum<number>('a.amount').as('s')), sql<number>`0`).as('allocated')])
      .where('p.customer_id', '=', inv.customer_id).where('p.status', '=', 'CLEARED').orderBy('p.cleared_at').execute();
    for (const p of pays) {
      const free = Number(p.amount) - Number(p.allocated);
      if (free > 0) {
        const applied = await this.allocate(trx, p.id, invoiceId, free, actor);
        if (applied < free) break;
      }
    }
  }

  /** Gate 3 — the vehicle is released only when the invoice is fully paid (automatic), on approved credit, or by exception. */
  private async autoRelease(trx: Tx, jobId: string, actor: AuthUser) {
    const job = await this.jobs.lock(trx, jobId);
    if (job.status !== 'INVOICED') return;
    const open = await trx.selectFrom('invoices').select((eb) => eb.fn.coalesce(eb.fn.sum<number>('balance'), sql<number>`0`).as('b'))
      .where('job_id', '=', jobId).where('status', '<>', 'VOID').executeTakeFirstOrThrow();
    if (Number(open.b) === 0) await this.jobs.setStatus(trx, job, 'READY_FOR_COLLECTION', actor, { reason: 'Invoice paid in full' });
  }

  async release(jobId: string, actor: AuthUser) {
    return this.jobs.dbs.tx(async (trx) => {
      const job = await this.jobs.lock(trx, jobId);
      this.jobs.requireStatus(job, 'INVOICED');
      const inv = await trx.selectFrom('invoices').select((eb) => eb.fn.coalesce(eb.fn.sum<number>('balance'), sql<number>`0`).as('b'))
        .where('job_id', '=', jobId).where('status', '<>', 'VOID').executeTakeFirstOrThrow();
      const due = Number(inv.b);
      if (due === 0) return this.jobs.setStatus(trx, job, 'READY_FOR_COLLECTION', actor, { reason: 'Invoice paid in full' });
      const c = await trx.selectFrom('customers').select(['type', 'credit_limit', 'payment_terms_days']).where('id', '=', job.customer_id).executeTakeFirstOrThrow();
      const exposure = await trx.selectFrom('invoices').select((eb) => eb.fn.coalesce(eb.fn.sum<number>('balance'), sql<number>`0`).as('b'))
        .where('customer_id', '=', job.customer_id).where('status', '<>', 'VOID').executeTakeFirstOrThrow();
      const overdue = await trx.selectFrom('invoices').select('id').where('customer_id', '=', job.customer_id).where('balance', '>', 0)
        .where(sql<boolean>`((now() AT TIME ZONE 'Africa/Lagos')::date - (due_date AT TIME ZONE 'Africa/Lagos')::date) >= 1`).where('status', '<>', 'VOID').executeTakeFirst();
      if (c.type === 'CORPORATE' && c.payment_terms_days > 0 && Number(exposure.b) <= c.credit_limit && !overdue) {
        return this.jobs.setStatus(trx, job, 'READY_FOR_COLLECTION', actor, { reason: `Released on credit terms (${c.payment_terms_days} days); total owed within limit` });
      }
      const ex = await this.jobs.useException(trx, jobId, 'RELEASE_WITHOUT_PAYMENT');
      if (!ex) throw new DomainError('PAYMENT_REQUIRED', `₦${(due / 100).toLocaleString('en-NG')} is still due. Release needs full payment, approved credit terms, or an authorised RELEASE_WITHOUT_PAYMENT exception.`, 403);
      return this.jobs.setStatus(trx, job, 'READY_FOR_COLLECTION', actor, { reason: 'Released with balance due under authorised exception', exceptionId: ex.id });
    });
  }

  async failPayment(paymentId: string, reason: string, actor: AuthUser) {
    if (!reason || reason.trim().length < 5) throw new DomainError('REASON_REQUIRED', 'Give a reason', 400);
    return this.jobs.dbs.tx(async (trx) => {
      const p = await trx.selectFrom('payments').selectAll().where('id', '=', paymentId).forUpdate().executeTakeFirst();
      if (!p) throw notFound('Payment');
      if (p.received_by === actor.id) throw forbidden('The person who recorded a payment cannot fail or reverse it');
      if (p.status === 'PENDING') {
        const after = await trx.updateTable('payments').set({ status: 'FAILED', reversed_by: actor.id, reversal_reason: reason }).where('id', '=', paymentId).returningAll().executeTakeFirstOrThrow();
        await this.jobs.audit.write(trx, { actorId: actor.id, action: 'payment.fail', entity: 'payment', entityId: p.id, before: p, after, ip: actor.ip });
        return after;
      }
      if (p.status === 'CLEARED') {
        const alloc = await trx.selectFrom('payment_allocations').select('id').where('payment_id', '=', paymentId).executeTakeFirst();
        if (alloc) throw new DomainError('PAYMENT_ALLOCATED', 'This payment is applied to an invoice. Reversing applied payments needs a credit-note workflow (Phase 2).', 409);
        const after = await trx.updateTable('payments').set({ status: 'REVERSED', reversed_by: actor.id, reversal_reason: reason }).where('id', '=', paymentId).returningAll().executeTakeFirstOrThrow();
        await this.ledger.post(trx, {
          date: new Date(), branchId: p.branch_id, sourceType: 'PAYMENT_REVERSED', sourceId: p.id, memo: `Reversal of ${p.receipt_no}: ${reason}`, actorId: actor.id,
          lines: [{ account: 'DEPOSITS', debit: p.amount, customerId: p.customer_id }, { account: p.method === 'CASH' ? 'CASH' : 'BANK', credit: p.amount }],
        });
        await this.jobs.audit.write(trx, { actorId: actor.id, action: 'payment.reverse', entity: 'payment', entityId: p.id, before: p, after, ip: actor.ip });
        return after;
      }
      throw new DomainError('PAYMENT_STATE', `Payment is ${p.status}`, 409);
    });
  }

  // ───────────── Queries ─────────────
  async getInvoice(id: string, db: any = this.jobs.dbs.db) {
    const inv: Selectable<Invoices> & Record<string, unknown> = await db.selectFrom('invoices as i').innerJoin('customers as c', 'c.id', 'i.customer_id')
      .leftJoin('jobs as j', 'j.id', 'i.job_id').leftJoin('customer_vehicles as v', 'v.id', 'j.vehicle_id')
      .selectAll('i').select(['c.name as customer_name', 'c.ref as customer_ref', 'c.phone_e164', 'c.email', 'c.address', 'c.tin', 'c.company_name',
        'j.job_no', 'v.plate_no', 'v.make', 'v.model', 'v.vin'])
      .where('i.id', '=', id).executeTakeFirst();
    if (!inv) throw notFound('Invoice');
    const [items, allocations] = await Promise.all([
      db.selectFrom('invoice_items').selectAll().where('invoice_id', '=', id).execute(),
      db.selectFrom('payment_allocations as a').innerJoin('payments as p', 'p.id', 'a.payment_id')
        .select(['a.id', 'a.amount', 'a.created_at', 'p.receipt_no', 'p.method', 'p.reference', 'p.cleared_at']).where('a.invoice_id', '=', id).orderBy('a.created_at').execute(),
    ]);
    return { ...inv, items, allocations, overdue: inv.balance > 0 && isOverdue(inv.due_date as any) };
  }

  listInvoices(f: { branchId: string; status?: string; customerId?: string }) {
    let q = this.jobs.dbs.db.selectFrom('invoices as i').innerJoin('customers as c', 'c.id', 'i.customer_id').leftJoin('jobs as j', 'j.id', 'i.job_id')
      .select(['i.id', 'i.invoice_no', 'i.status', 'i.issue_date', 'i.due_date', 'i.total', 'i.amount_paid', 'i.balance', 'c.name as customer_name', 'j.job_no', 'j.id as job_id'])
      .where('i.branch_id', '=', f.branchId).orderBy('i.issue_date', 'desc').limit(300);
    if (f.status === 'OPEN') q = q.where('i.balance', '>', 0).where('i.status', '<>', 'VOID');
    else if (f.status === 'OVERDUE') q = q.where('i.balance', '>', 0).where(sql<boolean>`((now() AT TIME ZONE 'Africa/Lagos')::date - (i.due_date AT TIME ZONE 'Africa/Lagos')::date) >= 1`).where('i.status', '<>', 'VOID');
    if (f.customerId) q = q.where('i.customer_id', '=', f.customerId);
    return q.execute();
  }

  listPayments(f: { branchId: string; status?: string }) {
    let q = this.jobs.dbs.db.selectFrom('payments as p').innerJoin('customers as c', 'c.id', 'p.customer_id')
      .leftJoin('users as r', 'r.id', 'p.received_by').leftJoin('invoices as i', 'i.id', 'p.intended_invoice_id')
      .select(['p.id', 'p.receipt_no', 'p.amount', 'p.method', 'p.reference', 'p.status', 'p.received_at', 'p.cleared_at', 'p.received_by',
        'c.name as customer_name', 'r.full_name as received_by_name', 'i.invoice_no as intended_invoice_no'])
      .where('p.branch_id', '=', f.branchId).orderBy('p.received_at', 'desc').limit(300);
    if (f.status) q = q.where('p.status', '=', f.status as any);
    return q.execute();
  }

  async getReceipt(paymentId: string) {
    const db = this.jobs.dbs.db;
    const p = await db.selectFrom('payments as p').innerJoin('customers as c', 'c.id', 'p.customer_id').leftJoin('users as u', 'u.id', 'p.received_by')
      .selectAll('p').select(['c.name as customer_name', 'c.ref as customer_ref', 'u.full_name as received_by_name']).where('p.id', '=', paymentId).executeTakeFirst();
    if (!p) throw notFound('Payment');
    if (p.status !== 'CLEARED' && p.status !== 'REVERSED') throw new DomainError('NO_RECEIPT', 'A receipt is issued only after the payment clears', 409);
    const allocations = await db.selectFrom('payment_allocations as a').innerJoin('invoices as i', 'i.id', 'a.invoice_id')
      .select(['a.amount', 'i.invoice_no', 'i.balance']).where('a.payment_id', '=', paymentId).execute();
    const applied = allocations.reduce((s, a) => s + Number(a.amount), 0);
    return { ...p, allocations, unapplied: Number(p.amount) - applied };
  }
}
