import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Kysely, PostgresDialect, Transaction } from 'kysely';
import { Pool, types } from 'pg';
import { DB } from './types';

// int8 → number (money in kobo stays well inside Number.MAX_SAFE_INTEGER), numeric → number
types.setTypeParser(20, (v) => Number(v));
types.setTypeParser(1700, (v) => Number(v));

export type Db = Kysely<DB>;
export type Tx = Transaction<DB>;

export function createDb(connectionString: string): Db {
  return new Kysely<DB>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString, max: 10 }) }),
  });
}

@Injectable()
export class DbService implements OnModuleDestroy {
  readonly db: Db = createDb(process.env.DATABASE_URL!);

  /** Every state change runs inside one transaction with its audit row and ledger entry. */
  tx<T>(fn: (trx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction().setIsolationLevel('read committed').execute(fn);
  }

  async onModuleDestroy() {
    await this.db.destroy();
  }
}
