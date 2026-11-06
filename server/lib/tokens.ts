import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { Db } from '../db/client.js';
import type { Clock } from './time.js';
import { addMinutes } from './time.js';

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Random, non-sequential, easy to read aloud over the phone, e.g. BL-7K4M-2QXD. */
export function generateReference(prefix: string, groups = 2, size = 4): string {
  const parts: string[] = [];
  for (let g = 0; g < groups; g++) {
    let part = '';
    for (let i = 0; i < size; i++) part += ALPHABET[randomInt(ALPHABET.length)];
    parts.push(part);
  }
  return `${prefix}-${parts.join('-')}`;
}

export type TokenPurpose =
  | 'staff_invite'
  | 'password_reset'
  | 'customer_login'
  | 'order_access'
  | 'inquiry_access'
  | 'quote_access'
  | 'invoice_access'
  | 'project_access'
  | 'preferences'
  | 'calendar_feed'
  | 'review_action'
  | 'concierge_draft'
  | 'voice_stream';

export async function mintAccessToken(
  db: Db,
  clock: Clock,
  input: { purpose: TokenPurpose; subjectId?: string | null; email?: string | null; ttlMinutes: number; singleUse?: boolean },
): Promise<string> {
  const token = randomToken();
  await db
    .insertInto('access_tokens')
    .values({
      token_hash: hashToken(token),
      purpose: input.purpose,
      subject_id: input.subjectId ?? null,
      email: input.email ?? null,
      single_use: input.singleUse ?? false,
      expires_at: addMinutes(clock.now(), input.ttlMinutes),
    })
    .execute();
  return token;
}

export type ResolvedToken = { id: string; subject_id: string | null; email: string | null; purpose: string };

/** Validates a token for the given purposes. Returns null for anything unknown, used up or expired. */
export async function resolveAccessToken(db: Db, clock: Clock, token: string, purposes: TokenPurpose[]): Promise<ResolvedToken | null> {
  if (!token || token.length > 200) return null;
  const row = await db
    .selectFrom('access_tokens')
    .select(['id', 'subject_id', 'email', 'purpose', 'expires_at', 'consumed_at', 'single_use'])
    .where('token_hash', '=', hashToken(token))
    .where('purpose', 'in', purposes)
    .executeTakeFirst();
  if (!row) return null;
  if (row.expires_at <= clock.now()) return null;
  if (row.single_use && row.consumed_at) return null;
  return { id: row.id, subject_id: row.subject_id, email: row.email, purpose: row.purpose };
}

/** Atomically consumes a single-use token. Only the first of two concurrent callers wins. */
export async function consumeAccessToken(db: Db, clock: Clock, id: string): Promise<boolean> {
  const res = await db
    .updateTable('access_tokens')
    .set({ consumed_at: clock.now() })
    .where('id', '=', id)
    .where('consumed_at', 'is', null)
    .executeTakeFirst();
  return Number(res.numUpdatedRows) === 1;
}
