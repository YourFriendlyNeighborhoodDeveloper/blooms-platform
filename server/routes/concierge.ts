import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv, C } from '../http/types.js';
import { customerActor } from '../http/types.js';
import { readJson } from '../http/helpers.js';
import { enforceRateLimit } from '../lib/ratelimit.js';
import { chatInputSchema, chatStatus, chatTurn } from '../modules/concierge/chat.js';
import { continueWithCode, publicDraftView, submitDraft } from '../modules/concierge/drafts.js';
import { afterStreamTwiml, incomingCallTwiml, recordCallStatus } from '../modules/concierge/voice.js';

/** Flora on the website: the chat, and the private draft a conversation saved. */
export const conciergeRoutes = new Hono<AppEnv>();

conciergeRoutes.get('/status', async (c) => c.json(await chatStatus(c.get('ctx'))));

conciergeRoutes.post('/chat', async (c) => {
  const ctx = c.get('ctx');
  const body = await readJson(c, chatInputSchema);
  return c.json(await chatTurn(ctx, body, { ip: c.get('ip') ?? null, userAgent: c.req.header('user-agent') ?? null }));
});

conciergeRoutes.get('/drafts/:token', async (c) => c.json(await publicDraftView(c.get('ctx'), c.req.param('token'))));

conciergeRoutes.post('/drafts/:token/submit', async (c) => {
  const ctx = c.get('ctx');
  await enforceRateLimit(ctx.db, ctx.clock, `flora-submit:${c.get('ip')}`, 10, 600);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  return c.json(await submitDraft(ctx, c.req.param('token'), body, customerActor(c), c.req.header('user-agent') ?? null), 201);
});

conciergeRoutes.post('/continue', async (c) => {
  const ctx = c.get('ctx');
  const body = await readJson(c, z.object({ code: z.string().trim().transform((v) => v.replace(/\D/g, '')).pipe(z.string().length(6, 'The code has six digits.')), last4: z.string().trim().regex(/^\d{4}$/, 'Enter the last four digits of the phone you called from.') }));
  return c.json(await continueWithCode(ctx, { code: body.code, last4: body.last4, ip: c.get('ip') ?? null }));
});

/**
 * Twilio Voice webhooks. Each one is accepted only with a valid X-Twilio-Signature computed over
 * the exact public URL Twilio was given, so a forged request gets nothing.
 */
export const voiceWebhookRoutes = new Hono<AppEnv>();

const verified = async (c: C, path: string) => {
  const ctx = c.get('ctx');
  const params = (await c.req.parseBody()) as Record<string, string>;
  const ok = ctx.voice.validateWebhook(c.req.header('x-twilio-signature'), `${ctx.env.PUBLIC_BASE_URL}/api/webhooks/voice/${path}`, params);
  return ok ? params : null;
};

voiceWebhookRoutes.post('/incoming', async (c) => {
  const params = await verified(c, 'incoming');
  if (!params) return c.text('forbidden', 403);
  c.header('Content-Type', 'text/xml');
  return c.body(await incomingCallTwiml(c.get('ctx'), params));
});

voiceWebhookRoutes.post('/after-stream', async (c) => {
  const params = await verified(c, 'after-stream');
  if (!params) return c.text('forbidden', 403);
  c.header('Content-Type', 'text/xml');
  return c.body(await afterStreamTwiml(c.get('ctx'), params));
});

voiceWebhookRoutes.post('/status', async (c) => {
  const params = await verified(c, 'status');
  if (!params) return c.text('forbidden', 403);
  await recordCallStatus(c.get('ctx'), params);
  return c.body(null, 204);
});
