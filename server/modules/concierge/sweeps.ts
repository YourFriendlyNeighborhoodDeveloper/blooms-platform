import { sql } from 'kysely';
import type { AppContext } from '../../context.js';
import { getSetting } from '../settings/service.js';
import { escalateOverdueTickets } from './tickets.js';

/** Removes what people said after the owner's retention period. The record of what Flora did stays. */
export async function purgeOldTranscripts(ctx: AppContext) {
  const { transcript_retention_days } = await getSetting(ctx.db, 'concierge');
  const old = await ctx.db
    .selectFrom('concierge_conversations')
    .select('id')
    .where('transcript_purged_at', 'is', null)
    .where('started_at', '<', sql<Date>`now() - make_interval(days => ${transcript_retention_days})`)
    .limit(500)
    .execute();
  if (!old.length) return 0;
  const ids = old.map((r) => r.id);
  await ctx.db.updateTable('concierge_messages').set({ content: null }).where('conversation_id', 'in', ids).where('role', 'in', ['customer', 'assistant']).execute();
  await ctx.db.updateTable('concierge_conversations').set({ transcript_purged_at: sql`now()`, caller_phone_e164: null, user_agent: null }).where('id', 'in', ids).execute();
  return ids.length;
}

/** Drafts nobody finished expire, and their contact details go with them. */
export async function expireDrafts(ctx: AppContext) {
  const res = await ctx.db
    .updateTable('concierge_drafts')
    .set({ status: 'expired', contact_name: null, contact_email: null, contact_phone_e164: null, continue_code_hash: null, data: JSON.stringify({}), updated_at: sql`now()` })
    .where('status', '=', 'draft')
    .where('expires_at', '<', ctx.clock.now())
    .executeTakeFirst();
  return Number(res.numUpdatedRows);
}

/** A call or chat with no activity for a long time is closed, so limits and costs stay accurate. */
export async function closeIdleConversations(ctx: AppContext) {
  const res = await ctx.db
    .updateTable('concierge_conversations')
    .set({ status: 'ended', end_reason: 'idle', ended_at: sql`now()`, updated_at: sql`now()` })
    .where('status', '=', 'active')
    .where((eb) => eb.or([eb.and([eb('channel', '=', 'voice'), eb('last_activity_at', '<', sql<Date>`now() - interval '45 minutes'`)]), eb.and([eb('channel', '=', 'chat'), eb('last_activity_at', '<', sql<Date>`now() - interval '24 hours'`)])]))
    .executeTakeFirst();
  return Number(res.numUpdatedRows);
}

export const CONCIERGE_SWEEPS = [
  { name: 'concierge.escalate', everyMinutes: 1, run: (ctx: AppContext) => escalateOverdueTickets(ctx) },
  { name: 'concierge.close_idle', everyMinutes: 15, run: (ctx: AppContext) => closeIdleConversations(ctx) },
  { name: 'concierge.expire_drafts', everyMinutes: 60, run: (ctx: AppContext) => expireDrafts(ctx) },
  { name: 'concierge.retention', everyMinutes: 60, run: (ctx: AppContext) => purgeOldTranscripts(ctx) },
];
