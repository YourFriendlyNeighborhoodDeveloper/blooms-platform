import type { Db } from '../db/client.js';
import { hashToken, randomToken } from '../lib/tokens.js';
import type { Clock } from '../lib/time.js';
import { addHours } from '../lib/time.js';

export const STAFF_SESSION_HOURS = 12;
export const CUSTOMER_SESSION_HOURS = 24 * 30;
const TOUCH_INTERVAL_MS = 5 * 60_000;

export async function createSession(
  db: Db,
  clock: Clock,
  subject: { userId?: string; customerId?: string },
  meta: { ip?: string | null; userAgent?: string | null },
): Promise<{ token: string; id: string; expiresAt: Date }> {
  const token = randomToken();
  const expiresAt = addHours(clock.now(), subject.userId ? STAFF_SESSION_HOURS : CUSTOMER_SESSION_HOURS);
  const row = await db
    .insertInto('sessions')
    .values({
      token_hash: hashToken(token),
      user_id: subject.userId ?? null,
      customer_id: subject.customerId ?? null,
      ip: meta.ip ?? null,
      user_agent: meta.userAgent?.slice(0, 300) ?? null,
      expires_at: expiresAt,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { token, id: row.id, expiresAt };
}

export type SessionRow = { id: string; user_id: string | null; customer_id: string | null };

/** Sliding expiry for staff sessions, which end after 12 hours without activity. */
export async function resolveSession(db: Db, clock: Clock, token: string | undefined): Promise<SessionRow | null> {
  if (!token || token.length > 200) return null;
  const now = clock.now();
  const row = await db
    .selectFrom('sessions')
    .select(['id', 'user_id', 'customer_id', 'expires_at', 'revoked_at', 'last_seen_at'])
    .where('token_hash', '=', hashToken(token))
    .executeTakeFirst();
  if (!row || row.revoked_at || row.expires_at <= now) return null;
  if (now.getTime() - row.last_seen_at.getTime() > TOUCH_INTERVAL_MS) {
    await db
      .updateTable('sessions')
      .set({ last_seen_at: now, expires_at: row.user_id ? addHours(now, STAFF_SESSION_HOURS) : row.expires_at })
      .where('id', '=', row.id)
      .execute();
  }
  return { id: row.id, user_id: row.user_id, customer_id: row.customer_id };
}

export async function revokeSession(db: Db, clock: Clock, id: string) {
  await db.updateTable('sessions').set({ revoked_at: clock.now() }).where('id', '=', id).where('revoked_at', 'is', null).execute();
}

export async function revokeAllForUser(db: Db, clock: Clock, userId: string, exceptSessionId?: string) {
  let q = db.updateTable('sessions').set({ revoked_at: clock.now() }).where('user_id', '=', userId).where('revoked_at', 'is', null);
  if (exceptSessionId) q = q.where('id', '!=', exceptSessionId);
  await q.execute();
}
