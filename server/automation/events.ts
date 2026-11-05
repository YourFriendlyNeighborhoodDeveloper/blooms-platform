import type { Db } from '../db/client.js';

export type Subject = { type: string; id: string | null };

/**
 * Records a business event in the caller's transaction (a transactional outbox). If the change rolls
 * back, the event never existed. If the process dies right after commit, the worker still sees it.
 * A dedupe key makes re-emitting the same logical event a no-op.
 */
export async function emit(db: Db, type: string, subject: Subject | null, payload: Record<string, unknown> = {}, dedupeKey?: string) {
  await db
    .insertInto('automation_events')
    .values({
      type,
      subject_type: subject?.type ?? null,
      subject_id: subject?.id ?? null,
      payload: JSON.stringify(payload),
      dedupe_key: dedupeKey ?? null,
    })
    .onConflict((oc) => oc.column('dedupe_key').doNothing())
    .execute();
}

export async function raiseAlert(
  db: Db,
  alert: { code: string; severity?: 'info' | 'warning' | 'critical'; title: string; detail?: string | null; subject?: Subject | null; link?: string | null; dedupeKey?: string | null },
) {
  await db
    .insertInto('system_alerts')
    .values({
      code: alert.code,
      severity: alert.severity ?? 'warning',
      title: alert.title,
      detail: alert.detail ?? null,
      subject_type: alert.subject?.type ?? null,
      subject_id: alert.subject?.id ?? null,
      link: alert.link ?? null,
      dedupe_key: alert.dedupeKey ?? null,
    })
    .onConflict((oc) => oc.column('dedupe_key').where('status', '<>', 'resolved').where('dedupe_key', 'is not', null).doNothing())
    .execute();
}
