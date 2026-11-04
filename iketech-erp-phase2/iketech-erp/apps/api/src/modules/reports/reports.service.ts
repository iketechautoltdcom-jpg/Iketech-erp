import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DbService } from '../../db/db';
import { ACCOUNTS } from '../billing/ledger.service';

const n = (v: unknown) => Number(v ?? 0);

/**
 * Basic Phase 1 reporting. Revenue comes from issued invoices, cash from cleared payments, receivables from
 * open balances — three separate sources — and each is cross-checked against the ledger.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly dbs: DbService) {}

  private async ledgerSum(branchId: string, code: string, side: 'debit' | 'credit' | 'net', from?: Date, to?: Date) {
    let q = this.dbs.db.selectFrom('journal_lines as l').innerJoin('journal_entries as e', 'e.id', 'l.entry_id').innerJoin('accounts as a', 'a.id', 'l.account_id')
      .select((eb) => [eb.fn.coalesce(eb.fn.sum<number>('l.debit'), sql<number>`0`).as('d'), eb.fn.coalesce(eb.fn.sum<number>('l.credit'), sql<number>`0`).as('c')])
      .where('a.code', '=', code).where('e.branch_id', '=', branchId);
    if (from) q = q.where('e.entry_date', '>=', from);
    if (to) q = q.where('e.entry_date', '<', to);
    const r = await q.executeTakeFirstOrThrow();
    return side === 'debit' ? n(r.d) : side === 'credit' ? n(r.c) : n(r.d) - n(r.c);
  }

  async summary(branchId: string, from: Date, to: Date) {
    const db = this.dbs.db;
    const inRange = (col: any) => (eb: any) => eb.and([eb(col, '>=', from), eb(col, '<', to)]);

    const [received, delivered, byStatus, delayed, invoiceAgg, cashAgg, receivables, qc, turnaround] = await Promise.all([
      db.selectFrom('jobs').select((eb) => eb.fn.countAll<number>().as('n')).where('branch_id', '=', branchId).where(inRange('received_at')).executeTakeFirstOrThrow(),
      db.selectFrom('jobs').select((eb) => eb.fn.countAll<number>().as('n')).where('branch_id', '=', branchId).where(inRange('delivered_at')).executeTakeFirstOrThrow(),
      db.selectFrom('jobs').select(['status', (eb) => eb.fn.countAll<number>().as('n')]).where('branch_id', '=', branchId)
        .where('status', 'not in', ['CLOSED', 'CANCELLED']).groupBy('status').execute(),
      db.selectFrom('jobs').select((eb) => eb.fn.countAll<number>().as('n')).where('branch_id', '=', branchId).where('promised_at', '<', new Date())
        .where('status', 'not in', ['READY_FOR_COLLECTION', 'DELIVERED', 'CLOSED', 'CANCELLED', 'DECLINED']).executeTakeFirstOrThrow(),
      db.selectFrom('invoices').select((eb) => [
        eb.fn.coalesce(eb.fn.sum<number>(sql`subtotal - discount_total`), sql<number>`0`).as('revenue'),
        eb.fn.coalesce(eb.fn.sum<number>('tax_total'), sql<number>`0`).as('tax'),
        eb.fn.coalesce(eb.fn.sum<number>('total'), sql<number>`0`).as('billed'),
        eb.fn.countAll<number>().as('count'),
      ]).where('branch_id', '=', branchId).where('status', '<>', 'VOID').where(inRange('issue_date')).executeTakeFirstOrThrow(),
      db.selectFrom('payments').select((eb) => [
        eb.fn.coalesce(eb.fn.sum<number>('amount'), sql<number>`0`).as('cleared'),
        eb.fn.countAll<number>().as('count'),
      ]).where('branch_id', '=', branchId).where('status', 'in', ['CLEARED', 'REVERSED']).where(inRange('cleared_at')).executeTakeFirstOrThrow(),
      db.selectFrom('invoices').select((eb) => [
        eb.fn.coalesce(eb.fn.sum<number>('balance'), sql<number>`0`).as('outstanding'),
        eb.fn.coalesce(eb.fn.sum<number>(sql`CASE WHEN ((now() AT TIME ZONE 'Africa/Lagos')::date - (due_date AT TIME ZONE 'Africa/Lagos')::date) >= 1 THEN balance ELSE 0 END`), sql<number>`0`).as('overdue'),
        eb.fn.coalesce(eb.fn.sum<number>(sql`CASE WHEN ((now() AT TIME ZONE 'Africa/Lagos')::date - (due_date AT TIME ZONE 'Africa/Lagos')::date) BETWEEN 1 AND 30 THEN balance ELSE 0 END`), sql<number>`0`).as('d1_30'),
        eb.fn.coalesce(eb.fn.sum<number>(sql`CASE WHEN ((now() AT TIME ZONE 'Africa/Lagos')::date - (due_date AT TIME ZONE 'Africa/Lagos')::date) BETWEEN 31 AND 60 THEN balance ELSE 0 END`), sql<number>`0`).as('d31_60'),
        eb.fn.coalesce(eb.fn.sum<number>(sql`CASE WHEN ((now() AT TIME ZONE 'Africa/Lagos')::date - (due_date AT TIME ZONE 'Africa/Lagos')::date) BETWEEN 61 AND 90 THEN balance ELSE 0 END`), sql<number>`0`).as('d61_90'),
        eb.fn.coalesce(eb.fn.sum<number>(sql`CASE WHEN ((now() AT TIME ZONE 'Africa/Lagos')::date - (due_date AT TIME ZONE 'Africa/Lagos')::date) > 90 THEN balance ELSE 0 END`), sql<number>`0`).as('d90'),
      ]).where('branch_id', '=', branchId).where('status', '<>', 'VOID').executeTakeFirstOrThrow(),
      db.selectFrom('quality_control_inspections as q').innerJoin('jobs as j', 'j.id', 'q.job_id').select((eb) => [
        eb.fn.countAll<number>().as('total'),
        eb.fn.sum<number>(sql`CASE WHEN q.outcome = 'FAIL' THEN 1 ELSE 0 END`).as('failed'),
      ]).where('j.branch_id', '=', branchId).where(inRange('q.created_at')).executeTakeFirstOrThrow(),
      sql<{ diag_hours: number | null; repair_hours: number | null }>`
        WITH h AS (
          SELECT h.job_id,
            min(h.at) FILTER (WHERE h.to_status = 'RECEIVED') AS received,
            min(h.at) FILTER (WHERE h.to_status = 'QUOTE_PENDING') AS diagnosed,
            min(h.at) FILTER (WHERE h.to_status = 'IN_REPAIR') AS repair_start,
            max(h.at) FILTER (WHERE h.to_status = 'READY_TO_INVOICE') AS repair_done
          FROM job_status_history h JOIN jobs j ON j.id = h.job_id
          WHERE j.branch_id = ${branchId} GROUP BY h.job_id)
        SELECT avg(extract(epoch FROM diagnosed - received) / 3600) FILTER (WHERE diagnosed >= ${from} AND diagnosed < ${to}) AS diag_hours,
               avg(extract(epoch FROM repair_done - repair_start) / 3600) FILTER (WHERE repair_done >= ${from} AND repair_done < ${to}) AS repair_hours
        FROM h`.execute(db),
    ]);

    // Ledger cross-checks
    const ledgerRevenue = (await Promise.all(['4000', '4010', '4020'].map((c) => this.ledgerSum(branchId, c, 'credit', from, to)))).reduce((a, b) => a + b, 0);
    const ledgerCashIn = (await Promise.all([ACCOUNTS.CASH.code, ACCOUNTS.BANK.code].map((c) =>
      this.dbs.db.selectFrom('journal_lines as l').innerJoin('journal_entries as e', 'e.id', 'l.entry_id').innerJoin('accounts as a', 'a.id', 'l.account_id')
        .select((eb) => eb.fn.coalesce(eb.fn.sum<number>('l.debit'), sql<number>`0`).as('d'))
        .where('a.code', '=', c).where('e.branch_id', '=', branchId).where('e.source_type', '=', 'PAYMENT_CLEARED')
        .where('e.entry_date', '>=', from).where('e.entry_date', '<', to).executeTakeFirstOrThrow()))).reduce((s, r) => s + n(r.d), 0);
    const ledgerAR = await this.ledgerSum(branchId, ACCOUNTS.AR.code, 'net');
    const deposits = -(await this.ledgerSum(branchId, ACCOUNTS.DEPOSITS.code, 'net'));
    const vatPayable = -(await this.ledgerSum(branchId, ACCOUNTS.VAT_OUT.code, 'net'));
    const reversals = (await Promise.all([ACCOUNTS.CASH.code, ACCOUNTS.BANK.code].map((c) =>
      this.dbs.db.selectFrom('journal_lines as l').innerJoin('journal_entries as e', 'e.id', 'l.entry_id').innerJoin('accounts as a', 'a.id', 'l.account_id')
        .select((eb) => eb.fn.coalesce(eb.fn.sum<number>('l.credit'), sql<number>`0`).as('c'))
        .where('a.code', '=', c).where('e.branch_id', '=', branchId).where('e.source_type', '=', 'PAYMENT_REVERSED')
        .where('e.entry_date', '>=', from).where('e.entry_date', '<', to).executeTakeFirstOrThrow()))).reduce((s, r) => s + n(r.c), 0);

    const revenue = n(invoiceAgg.revenue);
    const cash = n(cashAgg.cleared);
    const qcTotal = n(qc.total);
    return {
      period: { from, to },
      operations: {
        vehiclesReceived: n(received.n), vehiclesDelivered: n(delivered.n),
        openJobsByStatus: Object.fromEntries(byStatus.map((r) => [r.status, n(r.n)])),
        awaitingApproval: n(byStatus.find((r) => r.status === 'AWAITING_APPROVAL')?.n), delayedJobs: n(delayed.n),
        avgDiagnosisHours: turnaround.rows[0]?.diag_hours != null ? Math.round(Number(turnaround.rows[0].diag_hours) * 10) / 10 : null,
        avgRepairHours: turnaround.rows[0]?.repair_hours != null ? Math.round(Number(turnaround.rows[0].repair_hours) * 10) / 10 : null,
        qcInspections: qcTotal, qcFailed: n(qc.failed), qcFailureRatePct: qcTotal ? Math.round((n(qc.failed) / qcTotal) * 1000) / 10 : null,
      },
      finance: {
        revenueEarned: revenue, // issued invoices, excluding tax
        taxInvoiced: n(invoiceAgg.tax), invoicesIssued: n(invoiceAgg.count), amountBilled: n(invoiceAgg.billed),
        cashCollected: cash, // cleared payments only; pending transfers and unpaid invoices are never counted
        paymentsCleared: n(cashAgg.count), paymentReversals: reversals, netCashCollected: cash - reversals,
        outstandingReceivables: n(receivables.outstanding), overdueReceivables: n(receivables.overdue),
        ageing: { '1-30': n(receivables.d1_30), '31-60': n(receivables.d31_60), '61-90': n(receivables.d61_90), '90+': n(receivables.d90) },
        customerDeposits: deposits, vatPayable,
      },
      reconciliation: {
        revenueMatchesLedger: revenue === ledgerRevenue,
        cashMatchesLedger: cash === ledgerCashIn,
        receivablesMatchLedger: n(receivables.outstanding) === ledgerAR,
        details: { ledgerRevenue, ledgerCashIn, ledgerAR },
      },
    };
  }

  /** Trial balance — Σ debits must equal Σ credits across all accounts. */
  async trialBalance(branchId: string) {
    const rows = await this.dbs.db.selectFrom('accounts as a')
      .leftJoin('journal_lines as l', 'l.account_id', 'a.id').leftJoin('journal_entries as e', (j) => j.onRef('e.id', '=', 'l.entry_id'))
      .select(['a.code', 'a.name', 'a.type',
        (eb) => eb.fn.coalesce(eb.fn.sum<number>(sql`CASE WHEN e.branch_id = ${branchId} THEN l.debit ELSE 0 END`), sql<number>`0`).as('debit'),
        (eb) => eb.fn.coalesce(eb.fn.sum<number>(sql`CASE WHEN e.branch_id = ${branchId} THEN l.credit ELSE 0 END`), sql<number>`0`).as('credit')])
      .groupBy(['a.code', 'a.name', 'a.type']).orderBy('a.code').execute();
    const accounts = rows.map((r) => ({ ...r, debit: n(r.debit), credit: n(r.credit), balance: n(r.debit) - n(r.credit) }));
    const totalDebit = accounts.reduce((s, a) => s + a.debit, 0);
    const totalCredit = accounts.reduce((s, a) => s + a.credit, 0);
    return { accounts, totalDebit, totalCredit, balanced: totalDebit === totalCredit };
  }
}
