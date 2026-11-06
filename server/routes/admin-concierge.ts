import { Hono } from 'hono';
import { sql } from 'kysely';
import { z } from 'zod';
import type { AppEnv } from '../http/types.js';
import { staffActor } from '../http/types.js';
import { readJson, readQuery, requirePermission } from '../http/helpers.js';
import { audit } from '../lib/audit.js';
import { notFound } from '../lib/errors.js';
import { localDate } from '../lib/time.js';
import { loadSettings } from '../modules/settings/service.js';
import { conciergeAvailability, monthToDateMicros } from '../modules/concierge/conversations.js';
import { deleteKnowledge, knowledgeSchema, listKnowledge, saveKnowledge } from '../modules/concierge/knowledge.js';
import { PRICES_CHECKED_ON, isKnownModel } from '../modules/concierge/pricing.js';

/** The Flora section of the dashboard: what she did, what it cost, and what she knows. */
export const adminConciergeRoutes = new Hono<AppEnv>();

const dollars = (micros: number | string | null) => Math.round(Number(micros ?? 0) / 10_000) / 100;

adminConciergeRoutes.get('/overview', async (c) => {
  requirePermission(c, 'concierge.view');
  const ctx = c.get('ctx');
  const settings = await loadSettings(ctx.db);
  const tz = settings.general.timezone;
  const today = localDate(ctx.clock.now(), tz);
  const monthStart = `${today.slice(0, 8)}01`;
  const spent = await monthToDateMicros(ctx, settings);
  const counts = await sql<{ channel: string; mode: string; conversations: number; drafts: number; calls_minutes: number }>`
    SELECT cc.channel, cc.mode, count(*)::int AS conversations,
           count(DISTINCT d.id)::int AS drafts,
           coalesce(round(sum(cc.call_seconds) / 60.0), 0)::int AS calls_minutes
    FROM concierge_conversations cc
    LEFT JOIN concierge_drafts d ON d.conversation_id = cc.id
    WHERE (cc.started_at AT TIME ZONE ${tz})::date >= ${monthStart}::date
    GROUP BY cc.channel, cc.mode
  `.execute(ctx.db);
  const openTickets = await ctx.db
    .selectFrom('support_requests')
    .select(['priority', sql<number>`count(*)::int`.as('n')])
    .where('status', '<>', 'closed')
    .where('sandbox', '=', false)
    .where('conversation_id', 'is not', null)
    .groupBy('priority')
    .execute();
  const chat = await conciergeAvailability(ctx, settings, 'chat');
  const voice = await conciergeAvailability(ctx, settings, 'voice');
  const c2 = settings.concierge;
  return c.json({
    month: monthStart.slice(0, 7),
    spent_dollars: dollars(spent),
    budget_dollars: c2.monthly_budget_cents / 100,
    prices_checked_on: PRICES_CHECKED_ON,
    models: {
      chat: { model: c2.chat_model, priced: isKnownModel(c2.chat_model) },
      voice: { model: c2.voice_model, priced: isKnownModel(c2.voice_model) },
      transcription: { model: c2.transcription_model, priced: isKnownModel(c2.transcription_model) },
    },
    channels: {
      chat: { enabled: c2.chat_enabled, mode: c2.chat_mode, available: chat.ok, reason: chat.ok ? null : chat.message },
      voice: { enabled: c2.voice_enabled, mode: c2.voice_mode, available: voice.ok, reason: voice.ok ? null : voice.message, number: ctx.voice.number, line_configured: ctx.voice.enabled },
    },
    provider: ctx.ai.name,
    texting: { available: ctx.sms.enabled, note: ctx.sms.enabled ? null : 'Texting is off: it needs a Twilio messaging service with approved A2P 10DLC registration. Flora gives callers a six-digit code for the website instead.' },
    activity: counts.rows,
    open_requests: Object.fromEntries(openTickets.map((t) => [t.priority, t.n])),
  });
});

adminConciergeRoutes.get('/conversations', async (c) => {
  requirePermission(c, 'concierge.view');
  const q = readQuery(c, z.object({ mode: z.enum(['demo', 'customer']).optional(), channel: z.enum(['chat', 'voice']).optional() }));
  let query = c
    .get('ctx')
    .db.selectFrom('concierge_conversations as cc')
    .leftJoin('concierge_drafts as d', 'd.conversation_id', 'cc.id')
    .select([
      'cc.id', 'cc.reference', 'cc.channel', 'cc.mode', 'cc.status', 'cc.started_at', 'cc.ended_at', 'cc.end_reason', 'cc.outcome', 'cc.turns', 'cc.tool_calls',
      'cc.call_seconds', 'cc.est_cost_micros', 'cc.texts_sent', 'cc.caller_phone_e164', 'd.reference as draft_reference', 'd.status as draft_status',
    ])
    .orderBy('cc.started_at', 'desc')
    .limit(200);
  if (q.mode) query = query.where('cc.mode', '=', q.mode);
  if (q.channel) query = query.where('cc.channel', '=', q.channel);
  const rows = await query.execute();
  return c.json({ conversations: rows.map((r) => ({ ...r, est_cost_dollars: dollars(r.est_cost_micros), est_cost_micros: undefined })) });
});

adminConciergeRoutes.get('/conversations/:id', async (c) => {
  requirePermission(c, 'concierge.view');
  const ctx = c.get('ctx');
  const id = c.req.param('id');
  const conv = await ctx.db.selectFrom('concierge_conversations').selectAll().where('id', '=', id).executeTakeFirst();
  if (!conv) throw notFound('That conversation does not exist.');
  const messages = await ctx.db.selectFrom('concierge_messages').select(['id', 'role', 'content', 'tool_name', 'tool_args', 'tool_result', 'refused', 'created_at']).where('conversation_id', '=', id).orderBy('position').execute();
  const drafts = await ctx.db.selectFrom('concierge_drafts').select(['id', 'reference', 'sandbox', 'status', 'data', 'contact_name', 'contact_email', 'contact_phone_e164', 'preferred_consultation_at', 'link_channel', 'link_sent_at', 'inquiry_id', 'sandbox_result', 'submitted_at']).where('conversation_id', '=', id).execute();
  const tickets = await ctx.db.selectFrom('support_requests').select(['id', 'reference', 'topic', 'priority', 'category', 'status', 'acknowledged_at', 'escalated_at', 'sandbox', 'created_at']).where('conversation_id', '=', id).execute();
  const verifications = await ctx.db.selectFrom('concierge_verifications as v').innerJoin('orders as o', 'o.id', 'v.order_id').select(['o.reference', 'v.verified_at', 'v.failures', 'v.created_at']).where('v.conversation_id', '=', id).execute();
  const { client_token_hash: _hidden, ip_hash: _ip, ...safe } = conv;
  void _hidden;
  void _ip;
  return c.json({ conversation: { ...safe, est_cost_dollars: dollars(conv.est_cost_micros) }, messages, drafts, tickets, verifications });
});

/** The demonstration sandbox: plans saved in demo mode. None of them is a business record. */
adminConciergeRoutes.get('/sandbox', async (c) => {
  requirePermission(c, 'concierge.view');
  const rows = await c
    .get('ctx')
    .db.selectFrom('concierge_drafts as d')
    .leftJoin('concierge_conversations as cc', 'cc.id', 'd.conversation_id')
    .select(['d.id', 'd.reference', 'd.status', 'd.data', 'd.contact_name', 'd.contact_email', 'd.contact_phone_e164', 'd.preferred_consultation_at', 'd.link_channel', 'd.sandbox_result', 'd.submitted_at', 'd.created_at', 'cc.id as conversation_id', 'cc.reference as conversation_reference', 'cc.channel'])
    .where('d.sandbox', '=', true)
    .orderBy('d.created_at', 'desc')
    .limit(200)
    .execute();
  return c.json({ drafts: rows });
});

adminConciergeRoutes.delete('/sandbox', async (c) => {
  requirePermission(c, 'concierge.manage');
  const ctx = c.get('ctx');
  const conversations = await ctx.db.selectFrom('concierge_conversations').select('id').where('mode', '=', 'demo').execute();
  const ids = conversations.map((r) => r.id);
  await ctx.db.transaction().execute(async (trx) => {
    await trx.deleteFrom('support_requests').where('sandbox', '=', true).execute();
    await trx.deleteFrom('concierge_drafts').where('sandbox', '=', true).execute();
    if (ids.length) await trx.deleteFrom('concierge_conversations').where('id', 'in', ids).execute();
  });
  await audit(ctx.db, staffActor(c), 'concierge.sandbox_clear', null, { conversations: ids.length });
  return c.json({ cleared: ids.length });
});

adminConciergeRoutes.get('/knowledge', async (c) => {
  requirePermission(c, 'concierge.view');
  return c.json({ entries: await listKnowledge(c.get('ctx').db) });
});

adminConciergeRoutes.post('/knowledge', async (c) => {
  requirePermission(c, 'concierge.manage');
  const body = await readJson(c, knowledgeSchema);
  return c.json(await saveKnowledge(c.get('ctx').db, null, body, staffActor(c)), 201);
});

adminConciergeRoutes.patch('/knowledge/:id', async (c) => {
  requirePermission(c, 'concierge.manage');
  const body = await readJson(c, knowledgeSchema);
  return c.json(await saveKnowledge(c.get('ctx').db, c.req.param('id'), body, staffActor(c)));
});

adminConciergeRoutes.delete('/knowledge/:id', async (c) => {
  requirePermission(c, 'concierge.manage');
  await deleteKnowledge(c.get('ctx').db, c.req.param('id'), staffActor(c));
  return c.json({ ok: true });
});
