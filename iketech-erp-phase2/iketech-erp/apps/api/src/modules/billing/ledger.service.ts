import { Injectable } from '@nestjs/common';
import { Tx } from '../../db/db';
import { DomainError } from '../../common/errors';

/** Starter chart of accounts (Blueprint §6). The accountant reviews and extends it. */
export const ACCOUNTS = {
  CASH: { code: '1000', name: 'Cash on hand', type: 'ASSET' },
  BANK: { code: '1010', name: 'Bank and POS settlements', type: 'ASSET' },
  AR: { code: '1100', name: 'Accounts receivable', type: 'ASSET' },
  DEPOSITS: { code: '2100', name: 'Customer deposits and unapplied receipts', type: 'LIABILITY' },
  VAT_OUT: { code: '2200', name: 'Output VAT payable', type: 'LIABILITY' },
  REV_LABOUR: { code: '4000', name: 'Service revenue — labour', type: 'REVENUE' },
  REV_PARTS: { code: '4010', name: 'Service revenue — parts', type: 'REVENUE' },
  REV_OTHER: { code: '4020', name: 'Service revenue — sublet and fees', type: 'REVENUE' },
} as const;
export type AccountKey = keyof typeof ACCOUNTS;

export interface PostingLine { account: AccountKey; debit?: number; credit?: number; customerId?: string }

@Injectable()
export class LedgerService {
  private cache = new Map<string, string>();

  private async accountId(trx: Tx, key: AccountKey) {
    const code = ACCOUNTS[key].code;
    if (!this.cache.has(code)) {
      const a = await trx.selectFrom('accounts').select('id').where('code', '=', code).executeTakeFirst();
      if (!a) throw new DomainError('ACCOUNT_MISSING', `Ledger account ${code} is not configured`, 500);
      this.cache.set(code, a.id);
    }
    return this.cache.get(code)!;
  }

  /** Writes one balanced journal entry. The database rejects the transaction at commit if it does not balance. */
  async post(trx: Tx, e: { date: Date; branchId: string; sourceType: string; sourceId: string; memo: string; actorId: string; lines: PostingLine[] }) {
    const lines = e.lines.filter((l) => (l.debit ?? 0) > 0 || (l.credit ?? 0) > 0);
    const dr = lines.reduce((s, l) => s + (l.debit ?? 0), 0);
    const cr = lines.reduce((s, l) => s + (l.credit ?? 0), 0);
    if (dr !== cr) throw new DomainError('UNBALANCED_JOURNAL', `Debits ${dr} ≠ credits ${cr}`, 500);
    if (dr === 0) return null;
    const entry = await trx.insertInto('journal_entries').values({
      entry_date: e.date, branch_id: e.branchId, source_type: e.sourceType, source_id: e.sourceId, memo: e.memo, created_by: e.actorId,
    }).returning('id').executeTakeFirstOrThrow();
    for (const l of lines) {
      await trx.insertInto('journal_lines').values({
        entry_id: entry.id, account_id: await this.accountId(trx, l.account), debit: l.debit ?? 0, credit: l.credit ?? 0, customer_id: l.customerId ?? null,
      }).execute();
    }
    return entry.id;
  }
}
