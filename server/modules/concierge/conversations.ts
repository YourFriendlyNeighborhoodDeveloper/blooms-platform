import { sql } from 'kysely';
import type { AppContext } from '../../context.js';
import type { Db } from '../../db/client.js';
import { generateReference, hashToken, randomToken } from '../../lib/tokens.js';
import { localDate } from '../../lib/time.js';
import type { ChatItem } from '../../integrations/ai/provider.js';
import { loadSettings, type SettingsState } from '../settings/service.js';
import { telephonyCostMicros } from './pricing.js';
import { raiseAlert } from '../../automation/events.js';

export type Channel = 'chat' | 'voice';
export type Mode = 'demo' | 'customer';

export type Conversation = {
  id: string;
  reference: string;
  channel: Channel;
  mode: Mode;
  status: string;
  caller_phone_e164: string | null;
  call_sid: string | null;
  turns: number;
  texts_sent: number;
};

export async function startConversation(
  db: Db,
  clock: { now(): Date },
  input: { channel: Channel; mode: Mode; model: string; callSid?: string | null; callerPhone?: string | null; ipHash?: string | null; userAgent?: string | null },
): Promise<{ conversation: Conversation; clientToken: string | null }> {
  const clientToken = input.channel === 'chat' ? randomToken(24) : null;
  const row = await db
    .insertInto('concierge_conversations')
    .values({
      reference: generateReference('FL'),
      channel: input.channel,
      mode: input.mode,
      model: input.model,
      client_token_hash: clientToken ? hashToken(clientToken) : null,
      call_sid: input.callSid ?? null,
      caller_phone_e164: input.callerPhone ?? null,
      ip_hash: input.ipHash ?? null,
      user_agent: input.userAgent?.slice(0, 300) ?? null,
      started_at: clock.now(),
      last_activity_at: clock.now(),
    })
    .returning(['id', 'reference', 'channel', 'mode', 'status', 'caller_phone_e164', 'call_sid', 'turns', 'texts_sent'])
    .executeTakeFirstOrThrow();
  return { conversation: row as Conversation, clientToken };
}

const COLUMNS = ['id', 'reference', 'channel', 'mode', 'status', 'caller_phone_e164', 'call_sid', 'turns', 'texts_sent'] as const;

export async function conversationByToken(db: Db, token: string): Promise<Conversation | null> {
  if (!token || token.length > 100) return null;
  const row = await db.selectFrom('concierge_conversations').select(COLUMNS).where('client_token_hash', '=', hashToken(token)).executeTakeFirst();
  return (row as Conversation | undefined) ?? null;
}

export async function conversationById(db: Db, id: string): Promise<Conversation | null> {
  const row = await db.selectFrom('concierge_conversations').select(COLUMNS).where('id', '=', id).executeTakeFirst();
  return (row as Conversation | undefined) ?? null;
}

export type MessageInput = {
  role: 'customer' | 'assistant' | 'tool' | 'event';
  content?: string | null;
  tool_name?: string | null;
  tool_call_id?: string | null;
  tool_args?: unknown;
  tool_result?: unknown;
  refused?: boolean;
};

/** Transcripts are kept only when the owner allows it. Tool calls and events are always kept, as the audit trail. */
export async function appendMessage(db: Db, settings: SettingsState, conversationId: string, m: MessageInput) {
  const storeText = settings.concierge.store_transcripts || m.role === 'tool' || m.role === 'event';
  await db
    .insertInto('concierge_messages')
    .values({
      conversation_id: conversationId,
      role: m.role,
      content: storeText ? (m.content ?? null) : m.content ? '[not stored: transcripts are switched off]' : null,
      tool_name: m.tool_name ?? null,
      tool_call_id: m.tool_call_id ?? null,
      tool_args: m.tool_args === undefined ? null : JSON.stringify(m.tool_args),
      tool_result: m.tool_result === undefined ? null : JSON.stringify(m.tool_result),
      refused: m.refused ?? false,
    })
    .execute();
  await db.updateTable('concierge_conversations').set({ last_activity_at: sql`now()`, updated_at: sql`now()` }).where('id', '=', conversationId).execute();
}

export async function addUsage(
  db: Db,
  conversationId: string,
  u: { input?: number; cached?: number; output?: number; audioIn?: number; audioOut?: number; costMicros: number; turns?: number; toolCalls?: number },
) {
  await db
    .updateTable('concierge_conversations')
    .set({
      input_tokens: sql`input_tokens + ${u.input ?? 0}`,
      cached_tokens: sql`cached_tokens + ${u.cached ?? 0}`,
      output_tokens: sql`output_tokens + ${u.output ?? 0}`,
      audio_input_tokens: sql`audio_input_tokens + ${u.audioIn ?? 0}`,
      audio_output_tokens: sql`audio_output_tokens + ${u.audioOut ?? 0}`,
      est_cost_micros: sql`est_cost_micros + ${u.costMicros}`,
      turns: sql`turns + ${u.turns ?? 0}`,
      tool_calls: sql`tool_calls + ${u.toolCalls ?? 0}`,
      updated_at: sql`now()`,
    })
    .where('id', '=', conversationId)
    .execute();
}

export async function endConversation(db: Db, conversationId: string, input: { status?: 'ended' | 'failed'; reason: string; outcome?: string | null; callSeconds?: number | null }) {
  await db
    .updateTable('concierge_conversations')
    .set({
      status: input.status ?? 'ended',
      end_reason: input.reason,
      ended_at: sql`coalesce(ended_at, now())`,
      ...(input.outcome !== undefined ? { outcome: input.outcome } : {}),
      ...(input.callSeconds != null ? { call_seconds: input.callSeconds, est_cost_micros: sql`est_cost_micros + ${telephonyCostMicros(input.callSeconds)}` } : {}),
      updated_at: sql`now()`,
    })
    .where('id', '=', conversationId)
    .where('status', '=', 'active')
    .execute();
}

/** The conversation so far, as the model sees it. Purged transcripts simply drop out. */
export async function chatHistory(db: Db, conversationId: string, limit = 60): Promise<ChatItem[]> {
  const rows = await db
    .selectFrom('concierge_messages')
    .select(['role', 'content', 'tool_name', 'tool_call_id', 'tool_args', 'tool_result'])
    .where('conversation_id', '=', conversationId)
    .where('role', 'in', ['customer', 'assistant', 'tool'])
    .orderBy('position', 'desc')
    .limit(limit)
    .execute();
  const items: ChatItem[] = [];
  for (const r of rows.reverse()) {
    if (r.role === 'customer' && r.content) items.push({ type: 'message', role: 'user', content: r.content });
    else if (r.role === 'assistant' && r.content) items.push({ type: 'message', role: 'assistant', content: r.content });
    else if (r.role === 'tool' && r.tool_call_id && r.tool_name) {
      items.push({ type: 'function_call', call_id: r.tool_call_id, name: r.tool_name, arguments: JSON.stringify(r.tool_args ?? {}) });
      items.push({ type: 'function_call_output', call_id: r.tool_call_id, output: JSON.stringify(r.tool_result ?? {}) });
    }
  }
  // A history that starts with a tool output and no call is rejected by the API.
  while (items[0] && items[0].type === 'function_call_output') items.shift();
  return items;
}

/** Estimated spend this calendar month, in the shop's timezone, including phone time. */
export async function monthToDateMicros(ctx: Pick<AppContext, 'db' | 'clock'>, settings: SettingsState): Promise<number> {
  const today = localDate(ctx.clock.now(), settings.general.timezone);
  const monthStart = `${today.slice(0, 8)}01`;
  const row = await sql<{ total: string | null }>`
    SELECT sum(est_cost_micros)::text AS total FROM concierge_conversations
    WHERE (started_at AT TIME ZONE ${settings.general.timezone})::date >= ${monthStart}::date
  `.execute(ctx.db);
  return Number(row.rows[0]?.total ?? 0);
}

export type Availability = { ok: true } | { ok: false; reason: 'disabled' | 'no_provider' | 'provider_unavailable' | 'no_budget' | 'budget_reached'; message: string };

// When the provider refuses for money or credentials, every further request would fail the same way.
// Flora pauses instead: an open alert in the database records it, so every process and every restart
// agrees, and the owner sees it. The worker checks the provider every few minutes and resumes her once
// it answers again. She never buys credits herself.
export type ProviderProblem = 'credits' | 'credentials';
const ALERT_CODE: Record<ProviderProblem, string> = { credits: 'concierge_provider_credits', credentials: 'concierge_provider_credentials' };
const PAUSE_CACHE_MS = 5_000;
let pauseCache: { at: number; problem: ProviderProblem | null } = { at: 0, problem: null };

/** Whether an error means the provider will refuse everything until a person fixes the account. */
export function accountProblem(err: unknown): ProviderProblem | null {
  const e = err as { status?: number; code?: string; type?: string; message?: string; error?: { code?: string; type?: string } };
  const code = `${e.code ?? e.error?.code ?? ''} ${e.type ?? e.error?.type ?? ''} ${e.message ?? ''}`;
  if (/insufficient_quota|credit_balance_exhausted|billing_hard_limit|no credits/i.test(code)) return 'credits';
  if (e.status === 401 || /invalid_api_key|incorrect api key/i.test(code)) return 'credentials';
  return null;
}

export async function noteProviderProblem(ctx: Pick<AppContext, 'db' | 'log'>, kind: ProviderProblem) {
  pauseCache = { at: Date.now(), problem: kind };
  ctx.log.error('concierge paused: provider account problem', { kind });
  await raiseAlert(ctx.db, {
    code: ALERT_CODE[kind],
    severity: 'critical',
    title: kind === 'credits' ? 'Flora is paused: the AI provider has no credits' : 'Flora is paused: the AI provider rejected the key',
    detail:
      kind === 'credits'
        ? 'OpenAI refused requests because the account has no credits. Flora never buys credits. Add credits or a budget in the OpenAI dashboard; Flora checks every few minutes and comes back on her own.'
        : 'Check OPENAI_API_KEY in the deployment secrets. Flora checks every few minutes and comes back on her own.',
    link: '/admin/flora',
    dedupeKey: `concierge-provider-${kind}`,
  });
}

/** The open provider problem, if any. Cached briefly, because every page load asks. */
export async function providerProblem(db: Db): Promise<ProviderProblem | null> {
  if (Date.now() - pauseCache.at < PAUSE_CACHE_MS) return pauseCache.problem;
  const rows = await db.selectFrom('system_alerts').select('code').where('code', 'in', Object.values(ALERT_CODE)).where('status', '<>', 'resolved').execute();
  const problem = rows.some((r) => r.code === ALERT_CODE.credentials) ? 'credentials' : rows.length ? 'credits' : null;
  pauseCache = { at: Date.now(), problem };
  return problem;
}

/**
 * Run by the worker while Flora is paused. One tiny request: if the provider answers, the alerts are
 * resolved and Flora is back. If it still refuses, nothing changes.
 */
let checkedSinceStart = false;

export async function resumeIfProviderRecovered(ctx: AppContext) {
  if (!ctx.ai.enabled) return 'not_configured';
  const open = await ctx.db.selectFrom('system_alerts').select(['id', 'created_at']).where('code', 'in', Object.values(ALERT_CODE)).where('status', '<>', 'resolved').execute();
  if (!open.length) {
    // Once after each start, check the account, so a restart or a reset never shows Flora as online
    // when the provider will refuse her. A refused check costs nothing; a working one, a fraction of a cent.
    if (checkedSinceStart) return 'not_paused';
    const settings = await loadSettings(ctx.db);
    // Not switched on yet, for example during a fresh seed: check on a later run instead.
    if (!settings.concierge.chat_enabled && !settings.concierge.voice_enabled) return 'not_paused';
    checkedSinceStart = true;
    const result = await ctx.ai.probe(settings.concierge.chat_model);
    if (result === 'credits' || result === 'credentials') {
      await noteProviderProblem(ctx, result);
      return 'paused';
    }
    return 'not_paused';
  }
  // The first check waits a couple of minutes, so a pause never flickers off and on.
  if (open.every((r) => Date.now() - new Date(r.created_at).getTime() < 2 * 60_000)) return 'waiting';
  const settings = await loadSettings(ctx.db);
  const result = await ctx.ai.probe(settings.concierge.chat_model);
  if (result !== 'ok') return result;
  await ctx.db.updateTable('system_alerts').set({ status: 'resolved', resolved_at: new Date() }).where('id', 'in', open.map((r) => r.id)).execute();
  pauseCache = { at: 0, problem: null };
  ctx.log.info('concierge resumed: the provider answers again');
  return 'resumed';
}

export const resetProviderPause = () => {
  pauseCache = { at: 0, problem: null };
  checkedSinceStart = false;
};

/** Whether Flora may start or continue work on a channel right now. */
export async function conciergeAvailability(ctx: AppContext, settings: SettingsState, channel: Channel): Promise<Availability> {
  const c = settings.concierge;
  if (channel === 'chat' && !c.chat_enabled) return { ok: false, reason: 'disabled', message: 'The assistant is switched off.' };
  if (channel === 'voice' && (!c.voice_enabled || !ctx.voice.enabled)) return { ok: false, reason: 'disabled', message: 'The phone assistant is switched off.' };
  if (!ctx.ai.enabled) return { ok: false, reason: 'no_provider', message: 'No AI provider is configured.' };
  const problem = await providerProblem(ctx.db);
  if (problem) return { ok: false, reason: 'provider_unavailable', message: problem === 'credits' ? 'The AI provider account has no credits left. Flora is paused.' : 'The AI provider rejected the API key. Flora is paused.' };
  if (c.monthly_budget_cents <= 0) return { ok: false, reason: 'no_budget', message: 'No monthly budget is set for the assistant.' };
  const spent = await monthToDateMicros(ctx, settings);
  if (spent >= c.monthly_budget_cents * 10_000) return { ok: false, reason: 'budget_reached', message: "This month's assistant budget has been used." };
  return { ok: true };
}
