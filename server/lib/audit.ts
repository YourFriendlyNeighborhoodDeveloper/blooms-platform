import type { Db } from '../db/client.js';

export type Actor = {
  type: 'staff' | 'customer' | 'system' | 'webhook';
  id?: string | null;
  label?: string | null;
  ip?: string | null;
};

export const SYSTEM_ACTOR: Actor = { type: 'system', label: 'automation' };

export async function audit(
  db: Db,
  actor: Actor,
  action: string,
  subject?: { type: string; id?: string | null } | null,
  data: Record<string, unknown> = {},
) {
  await db
    .insertInto('audit_logs')
    .values({
      actor_type: actor.type,
      actor_id: actor.id ?? null,
      actor_label: actor.label ?? null,
      action,
      subject_type: subject?.type ?? null,
      subject_id: subject?.id ?? null,
      data: JSON.stringify(data),
      ip: actor.ip ?? null,
    })
    .execute();
}
