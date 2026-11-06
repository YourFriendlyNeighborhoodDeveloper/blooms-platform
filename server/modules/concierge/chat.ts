import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { hashToken } from '../../lib/tokens.js';
import { hitRateLimit } from '../../lib/ratelimit.js';
import { conflict, notFound, tooMany, unavailable } from '../../lib/errors.js';
import { AiUnavailableError, type ChatItem } from '../../integrations/ai/provider.js';
import { loadSettings } from '../settings/service.js';
import { chatCostMicros } from './pricing.js';
import { accountProblem, addUsage, appendMessage, chatHistory, conciergeAvailability, conversationByToken, noteProviderProblem, providerProblem, startConversation, type Conversation } from './conversations.js';
import { buildInstructions, chatOpening } from './prompt.js';
import { availableTools, executeTool, type Action, type ToolContext } from './tools.js';

export const chatInputSchema = z.object({
  conversation_token: z.string().max(100).nullable().optional(),
  message: z.string().trim().min(1, 'Type a message.').max(1500, 'Please keep messages under 1,500 characters.'),
});

const MAX_TOOL_ROUNDS = 5;
const MAX_OUTPUT_TOKENS = 700;

/**
 * What the website shows before the first message. `shown` is whether the owner has set Flora up at
 * all; only then does the launcher appear. `available` is whether she can answer right now. When she
 * cannot, the launcher stays visible and says so, rather than disappearing.
 */
export async function chatStatus(ctx: AppContext) {
  const settings = await loadSettings(ctx.db);
  const available = await conciergeAvailability(ctx, settings, 'chat');
  const c = settings.concierge;
  const shown = c.chat_enabled && ctx.ai.enabled && c.monthly_budget_cents > 0;
  const state = available.ok ? 'online' : available.reason === 'budget_reached' ? 'resting' : 'offline';
  const problem = available.ok ? null : await providerProblem(ctx.db);
  return {
    shown,
    available: available.ok,
    state,
    status_message:
      state === 'online'
        ? null
        : state === 'resting'
          ? "She has reached this month's limit and can't answer messages until next month. You can still shop, plan your event, track an order, or call the shop."
          : "She can't answer messages at the moment. You can still shop, plan your event, track an order, or call the shop.",
    demo_note:
      c.chat_mode === 'demo' && problem === 'credits'
        ? 'Demonstration note: the AI account for this demo has no credits, so Flora is paused until credits are added. She comes back on her own within a few minutes once they are.'
        : c.chat_mode === 'demo' && problem === 'credentials'
          ? 'Demonstration note: the AI key for this demo was rejected, so Flora is paused.'
          : null,
    phone_e164: settings.contact.phone_e164,
    name: c.assistant_name,
    title: c.assistant_title,
    greeting: chatOpening(settings, c.chat_mode),
    mode: c.chat_mode,
    simulated: ctx.ai.name === 'mock',
    quick_actions: [
      { label: 'Shop flowers', message: 'I would like help choosing flowers.' },
      { label: 'Plan my wedding', message: 'I would like help planning flowers for my wedding.' },
      { label: 'Track my order', message: 'I would like to check on my order.' },
    ],
  };
}

/**
 * One visitor message and Flora's reply. The model sees the conversation and a short list of tools;
 * every tool call it makes goes through the server's own checks before anything runs.
 */
export async function chatTurn(ctx: AppContext, input: z.output<typeof chatInputSchema>, client: { ip: string | null; userAgent: string | null }) {
  const settings = await loadSettings(ctx.db);
  const c = settings.concierge;
  const available = await conciergeAvailability(ctx, settings, 'chat');
  if (!available.ok) throw unavailable('assistant_unavailable', `${available.message} You can still use the shop, the wedding planner and order tracking.`, { reason: available.reason });
  const ipKey = hashToken(`flora-ip:${client.ip ?? 'unknown'}`).slice(0, 24);
  if (!(await hitRateLimit(ctx.db, ctx.clock, `flora-msg:${ipKey}`, 60, 3600))) throw tooMany('That is a lot of messages. Please wait a little, or use the planner and contact form.');

  let conversation: Conversation | null = null;
  let token = input.conversation_token ?? null;
  if (token) {
    conversation = await conversationByToken(ctx.db, token);
    if (!conversation) throw notFound('This conversation has ended. Start a new one.');
    if (conversation.status !== 'active') throw conflict('conversation_ended', 'This conversation has ended. Start a new one.');
  } else {
    if (!(await hitRateLimit(ctx.db, ctx.clock, `flora-chat:${ipKey}`, c.max_chats_per_visitor_per_hour, 3600))) throw tooMany('Please wait a little before starting another conversation.');
    const started = await startConversation(ctx.db, ctx.clock, { channel: 'chat', mode: c.chat_mode, model: c.chat_model, ipHash: ipKey, userAgent: client.userAgent });
    conversation = started.conversation;
    token = started.clientToken;
    await appendMessage(ctx.db, settings, conversation.id, { role: 'assistant', content: chatOpening(settings, conversation.mode) });
  }
  if (conversation.turns >= c.max_messages_per_chat) {
    throw conflict('conversation_limit', 'This conversation has reached its length limit. Start a new one, or use the contact form to reach the team.');
  }

  await appendMessage(ctx.db, settings, conversation.id, { role: 'customer', content: input.message });
  const instructions = await buildInstructions(ctx.db, ctx.clock, settings, { channel: 'chat', mode: conversation.mode, isProduction: ctx.env.isProduction });
  const actions: Action[] = [];
  const tc: ToolContext = { ctx, settings, conversation, actions, lastCustomerText: () => input.message };
  const items: ChatItem[] = await chatHistory(ctx.db, conversation.id);

  let reply = '';
  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const tools = round === MAX_TOOL_ROUNDS ? [] : await availableTools(tc);
      const res = await ctx.ai.respond({ model: c.chat_model, instructions, items, tools, maxOutputTokens: MAX_OUTPUT_TOKENS, safetyId: hashToken(`flora:${conversation.id}`).slice(0, 32) });
      await addUsage(ctx.db, conversation.id, { input: res.usage.input_tokens, cached: res.usage.cached_tokens, output: res.usage.output_tokens, costMicros: chatCostMicros(c.chat_model, res.usage) });
      if (!res.calls.length) {
        reply = res.text.trim();
        break;
      }
      for (const call of res.calls) {
        const result = await executeTool(tc, call);
        items.push({ type: 'function_call', call_id: call.call_id, name: call.name, arguments: call.arguments });
        items.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result) });
      }
    }
  } catch (err) {
    if (err instanceof AiUnavailableError) throw unavailable('assistant_unavailable', 'The assistant is not available right now.');
    const problem = accountProblem(err);
    if (problem) await noteProviderProblem(ctx, problem);
    ctx.log.error('concierge chat failed', { error: err, conversation: conversation.reference });
    reply = "I'm sorry, I'm having trouble answering right now. You can use the shop, the wedding planner or the contact form, and the team will help.";
  }
  if (!reply) reply = "I'm sorry, I couldn't put an answer together. Could you say that another way?";

  await appendMessage(ctx.db, settings, conversation.id, { role: 'assistant', content: reply });
  await addUsage(ctx.db, conversation.id, { costMicros: 0, turns: 1 });
  const seen = new Set<string>();
  return {
    conversation_token: token,
    reference: conversation.reference,
    mode: conversation.mode,
    reply,
    actions: actions.filter((a) => (seen.has(a.url) ? false : (seen.add(a.url), true))).slice(0, 4),
  };
}
