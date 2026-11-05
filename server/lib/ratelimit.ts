import { sql } from 'kysely';
import type { Db } from '../db/client.js';
import type { Clock } from './time.js';
import { tooMany } from './errors.js';

/** Fixed-window limiter in PostgreSQL, so limits hold across restarts and multiple instances. */
export async function hitRateLimit(db: Db, clock: Clock, key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const now = clock.now().getTime();
  const windowStart = new Date(Math.floor(now / (windowSeconds * 1000)) * windowSeconds * 1000);
  const row = await sql<{ count: number }>`
    INSERT INTO rate_limits (key, window_start, count) VALUES (${key}, ${windowStart}, 1)
    ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
    RETURNING count
  `.execute(db);
  return (row.rows[0]?.count ?? 0) <= limit;
}

export async function enforceRateLimit(db: Db, clock: Clock, key: string, limit: number, windowSeconds: number) {
  if (!(await hitRateLimit(db, clock, key, limit, windowSeconds))) throw tooMany();
}
