import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type { AppContext } from '../context.js';
import { claimJobs, completeJob, enqueue, failJob, reclaimExpiredLeases, type ClaimedJob } from './queue.js';
import { emit, raiseAlert } from './events.js';
import { runEventRules } from './rules.js';
import { SWEEPS } from './sweeps.js';
import { deliverNotification } from '../modules/notifications/service.js';
import { pushCalendarEntry, queueCalendarPush } from '../modules/calendar/sync.js';

export type JobHandler = (ctx: AppContext, job: ClaimedJob) => Promise<void>;

const handlers: Record<string, JobHandler> = {
  'event.dispatch': async (ctx, job) => {
    await runEventRules(ctx, job.payload.event_id as string);
    await queueCalendarPush(ctx, job.payload.event_id as string);
  },
  'notification.deliver': async (ctx, job) => {
    await deliverNotification(ctx, job.payload.id as string, job.attempts);
  },
  'calendar.push': async (ctx, job) => pushCalendarEntry(ctx, job.payload as { source_type: string; source_id: string }),
};

for (const sweep of SWEEPS) {
  handlers[`sweep.${sweep.name}`] = async (ctx) => {
    await sweep.run(ctx);
  };
}

/** Turns newly committed events into jobs. Runs before claiming, so a single loop finishes the path from event to message. */
export async function dispatchEvents(ctx: AppContext, limit = 100): Promise<number> {
  return ctx.db.transaction().execute(async (trx) => {
    const res = await sql<{ id: string; type: string }>`
      SELECT id, type FROM automation_events WHERE status = 'pending' ORDER BY created_at LIMIT ${limit} FOR UPDATE SKIP LOCKED
    `.execute(trx);
    for (const event of res.rows) {
      await enqueue(trx, { kind: 'event.dispatch', payload: { event_id: event.id, type: event.type }, dedupeKey: `event:${event.id}`, eventId: event.id });
    }
    if (res.rows.length) {
      await trx.updateTable('automation_events').set({ status: 'dispatched', dispatched_at: ctx.clock.now() }).where('id', 'in', res.rows.map((r) => r.id)).execute();
    }
    return res.rows.length;
  });
}

/** Queues sweeps that are due. The time-bucket dedupe key means many workers still run each sweep once per interval. */
export async function scheduleSweeps(ctx: AppContext) {
  const now = ctx.clock.now().getTime();
  for (const sweep of SWEEPS) {
    const bucket = Math.floor(now / (sweep.everyMinutes * 60_000));
    await enqueue(ctx.db, { kind: `sweep.${sweep.name}`, dedupeKey: `sweep:${sweep.name}:${bucket}`, runAt: new Date(now), maxAttempts: 3 });
  }
}

export async function runJob(ctx: AppContext, job: ClaimedJob) {
  const handler = handlers[job.kind];
  if (!handler) {
    await failJob(ctx.db, ctx.clock, job, `No handler for job kind "${job.kind}"`, { permanent: true });
    return;
  }
  try {
    await handler(ctx, job);
    await completeJob(ctx.db, ctx.clock, job.id);
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    ctx.log.warn('job failed', { job: job.kind, id: job.id, attempt: job.attempts, error: message });
    const dead = await failJob(ctx.db, ctx.clock, job, message);
    if (dead) {
      ctx.log.error('job moved to failed review', { job: job.kind, id: job.id, error: message });
      await raiseAlert(ctx.db, {
        code: 'job_dead',
        severity: 'critical',
        title: `Automation stopped retrying: ${job.kind}`,
        detail: message.slice(0, 500),
        link: '/admin/system/jobs',
        dedupeKey: `job-dead:${job.id}`,
      });
      // A failing "job failed" alert must not create another failing job, so this one is not re-alerted.
      if (job.kind !== 'notification.deliver' || !String(job.payload.staff_alert ?? '')) {
        await emit(ctx.db, 'job.failed', { type: 'job', id: job.id }, { kind: job.kind, attempts: job.attempts, error: message.slice(0, 300) }, `job-failed:${job.id}`);
      }
    }
  }
}

/** One pass: recover, dispatch, schedule, run. Tests call this directly to run the system deterministically. */
export async function tick(ctx: AppContext, workerId: string, opts: { batch?: number; sweeps?: boolean } = {}): Promise<number> {
  await reclaimExpiredLeases(ctx.db, ctx.clock);
  await dispatchEvents(ctx);
  if (opts.sweeps) await scheduleSweeps(ctx);
  const jobs = await claimJobs(ctx.db, ctx.clock, workerId, opts.batch ?? 10);
  for (const job of jobs) await runJob(ctx, job);
  await dispatchEvents(ctx);
  return jobs.length;
}

/** Runs ticks until there is nothing left to do. Useful in tests and for a clean shutdown. */
export async function drain(ctx: AppContext, workerId = 'drain', maxPasses = 50) {
  let total = 0;
  for (let i = 0; i < maxPasses; i++) {
    const n = await tick(ctx, workerId);
    total += n;
    const pending = await ctx.db.selectFrom('automation_events').select('id').where('status', '=', 'pending').limit(1).execute();
    if (n === 0 && !pending.length) break;
  }
  return total;
}

export type RunningWorker = { stop(): Promise<void>; id: string };

export function startWorker(ctx: AppContext, opts: { pollMs?: number; sweepMs?: number } = {}): RunningWorker {
  const id = `worker-${process.pid}-${randomUUID().slice(0, 8)}`;
  const pollMs = opts.pollMs ?? 1000;
  const sweepMs = opts.sweepMs ?? 30_000;
  let stopped = false;
  let lastSweep = 0;
  let processed = 0;
  let wake: (() => void) | null = null;

  const loop = (async () => {
    await ctx.db.insertInto('worker_heartbeats').values({ worker_id: id }).onConflict((oc) => oc.column('worker_id').doNothing()).execute();
    ctx.log.info('worker started', { worker: id });
    while (!stopped) {
      let worked = 0;
      try {
        const now = Date.now();
        const runSweeps = now - lastSweep >= sweepMs;
        if (runSweeps) lastSweep = now;
        worked = await tick(ctx, id, { sweeps: runSweeps });
        processed += worked;
        if (runSweeps || worked) {
          await ctx.db.updateTable('worker_heartbeats').set({ last_seen_at: ctx.clock.now(), jobs_processed: processed }).where('worker_id', '=', id).execute();
        }
      } catch (err) {
        // Database blips must not kill the worker. It simply tries again.
        ctx.log.error('worker pass failed', { error: err });
      }
      if (!worked && !stopped) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, pollMs);
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
      }
    }
    ctx.log.info('worker stopped', { worker: id });
  })();

  return {
    id,
    async stop() {
      stopped = true;
      wake?.();
      await loop;
    },
  };
}
