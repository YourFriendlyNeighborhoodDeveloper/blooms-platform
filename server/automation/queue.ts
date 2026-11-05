import { sql } from 'kysely';
import type { Db } from '../db/client.js';
import type { Clock } from '../lib/time.js';
import { addMinutes } from '../lib/time.js';

export type EnqueueInput = {
  kind: string;
  payload?: Record<string, unknown>;
  runAt?: Date;
  dedupeKey?: string;
  maxAttempts?: number;
  eventId?: string | null;
};

export async function enqueue(db: Db, job: EnqueueInput) {
  await db
    .insertInto('automation_jobs')
    .values({
      kind: job.kind,
      payload: JSON.stringify(job.payload ?? {}),
      run_at: job.runAt ?? new Date(),
      dedupe_key: job.dedupeKey ?? null,
      max_attempts: job.maxAttempts ?? 8,
      event_id: job.eventId ?? null,
    })
    .onConflict((oc) => oc.column('dedupe_key').doNothing())
    .execute();
}

export type ClaimedJob = { id: string; kind: string; payload: Record<string, unknown>; attempts: number; max_attempts: number; event_id: string | null };

/** SKIP LOCKED lets any number of workers pull work without ever taking the same job. */
export async function claimJobs(db: Db, clock: Clock, workerId: string, limit: number, leaseMinutes = 5): Promise<ClaimedJob[]> {
  const now = clock.now();
  const res = await sql<ClaimedJob>`
    UPDATE automation_jobs SET
      status = 'running',
      attempts = attempts + 1,
      locked_by = ${workerId},
      locked_until = ${addMinutes(now, leaseMinutes)}
    WHERE id IN (
      SELECT id FROM automation_jobs
      WHERE status = 'queued' AND run_at <= ${now}
      ORDER BY run_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, kind, payload, attempts, max_attempts, event_id
  `.execute(db);
  return res.rows;
}

export async function completeJob(db: Db, clock: Clock, id: string) {
  await db
    .updateTable('automation_jobs')
    .set({ status: 'succeeded', finished_at: clock.now(), locked_by: null, locked_until: null, last_error: null })
    .where('id', '=', id)
    .execute();
}

/** 30s, 1m, 2m, 4m ... capped at 6 hours, with jitter so failures do not retry in lockstep. */
export function backoffSeconds(attempt: number, random = Math.random()): number {
  const base = Math.min(30 * 2 ** Math.max(0, attempt - 1), 6 * 3600);
  return Math.round(base * (0.8 + random * 0.4));
}

/** Schedules a retry, or parks the job as dead for human review. Returns true when dead. */
export async function failJob(db: Db, clock: Clock, job: Pick<ClaimedJob, 'id' | 'attempts' | 'max_attempts'>, error: string, opts: { permanent?: boolean } = {}): Promise<boolean> {
  const dead = opts.permanent || job.attempts >= job.max_attempts;
  await db
    .updateTable('automation_jobs')
    .set({
      status: dead ? 'dead' : 'queued',
      last_error: error.slice(0, 2000),
      locked_by: null,
      locked_until: null,
      run_at: dead ? clock.now() : new Date(clock.now().getTime() + backoffSeconds(job.attempts) * 1000),
      finished_at: dead ? clock.now() : null,
    })
    .where('id', '=', job.id)
    .execute();
  return dead;
}

/** Puts jobs back in the queue if their worker crashed mid-run and let its lease lapse. */
export async function reclaimExpiredLeases(db: Db, clock: Clock): Promise<number> {
  const now = clock.now();
  const res = await db
    .updateTable('automation_jobs')
    .set({ status: 'queued', locked_by: null, locked_until: null, run_at: now, last_error: 'Worker stopped before finishing; retrying.' })
    .where('status', '=', 'running')
    .where('locked_until', '<', now)
    .executeTakeFirst();
  return Number(res.numUpdatedRows);
}

export async function retryDeadJob(db: Db, clock: Clock, id: string) {
  await db
    .updateTable('automation_jobs')
    .set({ status: 'queued', attempts: 0, run_at: clock.now(), finished_at: null })
    .where('id', '=', id)
    .where('status', '=', 'dead')
    .execute();
}
