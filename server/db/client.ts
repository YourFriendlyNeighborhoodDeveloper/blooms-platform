import pg from 'pg';
import { Kysely, PostgresDialect, type Transaction } from 'kysely';
import type { DB } from './types.gen.js';

// Keep DATE and TIME as plain strings. Parsing a DATE into a JS Date shifts it through the
// server's timezone, which is exactly how a wedding ends up on the wrong day.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

export type Database = Kysely<DB>;
export type Trx = Transaction<DB>;
export type Db = Database | Trx;

export function createDb(connectionString: string, opts: { ssl?: boolean; max?: number } = {}) {
  const pool = new pg.Pool({
    connectionString,
    max: opts.max ?? 10,
    ssl: opts.ssl ? { rejectUnauthorized: false } : undefined,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on('error', (err) => {
    console.error(JSON.stringify({ level: 'error', msg: 'postgres pool error', error: err.message }));
  });
  const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  return { db, pool };
}

/** Runs fn in the given transaction, or opens one when handed a plain connection. */
export function inTransaction<T>(db: Db, fn: (trx: Trx) => Promise<T>): Promise<T> {
  if (db.isTransaction) return fn(db as Trx);
  return (db as Database).transaction().execute(fn);
}
