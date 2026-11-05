import { Hono } from 'hono';
import { sql } from 'kysely';
import type { AppEnv } from '../http/types.js';
import { addMinutes } from '../lib/time.js';

export const healthRoutes = new Hono<AppEnv>();

/** Liveness: the process is up. */
healthRoutes.get('/healthz', (c) => c.json({ status: 'ok' }));

/** Readiness: the database answers and a worker has checked in recently. Reveals no details beyond that. */
healthRoutes.get('/readyz', async (c) => {
  const ctx = c.get('ctx');
  const checks: Record<string, boolean> = { database: false, worker: false };
  try {
    await sql`SELECT 1`.execute(ctx.db);
    checks.database = true;
    const beat = await ctx.db.selectFrom('worker_heartbeats').select('worker_id').where('last_seen_at', '>', addMinutes(ctx.clock.now(), -5)).limit(1).executeTakeFirst();
    checks.worker = Boolean(beat);
  } catch (err) {
    ctx.log.error('readiness check failed', { error: err });
  }
  const ok = checks.database && (checks.worker || ctx.env.WORKER_EMBEDDED);
  return c.json({ status: ok ? 'ready' : 'degraded', checks }, ok ? 200 : 503);
});
