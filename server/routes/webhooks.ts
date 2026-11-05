import { Hono } from 'hono';
import { sql } from 'kysely';
import type { AppEnv } from '../http/types.js';
import { processGatewayEvent } from '../modules/payments/service.js';
import { raiseAlert } from '../automation/events.js';
import { handleInboundSms, handleSmsStatus } from '../modules/notifications/sms-webhooks.js';

export const webhookRoutes = new Hono<AppEnv>();

/**
 * Stripe retries until it gets a 2xx, and may deliver an event more than once or out of order.
 * The UNIQUE (provider, event_id) row plus a lock on it serializes duplicates, and each transition
 * below is idempotent. Failures return 500 so Stripe retries later.
 */
webhookRoutes.post('/stripe', async (c) => {
  const ctx = c.get('ctx');
  const raw = await c.req.text();
  let event;
  try {
    event = ctx.payments.verifyWebhook(raw, c.req.header('stripe-signature'));
  } catch (err) {
    ctx.log.warn('rejected webhook with an invalid signature', { error: err });
    return c.json({ error: 'invalid signature' }, 400);
  }

  if (event.livemode !== ctx.payments.livemode) {
    await raiseAlert(ctx.db, {
      code: 'webhook_mode_mismatch',
      severity: 'critical',
      title: `Received a ${event.livemode ? 'live' : 'test'} payment event on a ${ctx.payments.livemode ? 'live' : 'test'} system`,
      detail: 'Check that the Stripe webhook endpoint and API keys belong to the same mode.',
      dedupeKey: 'webhook-mode-mismatch',
    });
    return c.json({ received: true, ignored: 'mode mismatch' });
  }

  await ctx.db
    .insertInto('webhook_events')
    .values({ provider: 'stripe', event_id: event.id, event_type: event.type, payload: raw })
    .onConflict((oc) => oc.columns(['provider', 'event_id']).doNothing())
    .execute();

  try {
    const outcome = await ctx.db.transaction().execute(async (trx) => {
      const row = await trx.selectFrom('webhook_events').select(['id', 'status']).where('provider', '=', 'stripe').where('event_id', '=', event.id).forUpdate().executeTakeFirstOrThrow();
      if (row.status === 'processed' || row.status === 'ignored') return 'duplicate' as const;
      const result = await processGatewayEvent(ctx, trx, event);
      await trx
        .updateTable('webhook_events')
        .set({ status: result, processed_at: ctx.clock.now(), attempts: sql`attempts + 1`, error: null })
        .where('id', '=', row.id)
        .execute();
      return result;
    });
    return c.json({ received: true, outcome });
  } catch (err) {
    ctx.log.error('webhook processing failed', { event: event.id, type: event.type, error: err });
    await ctx.db
      .updateTable('webhook_events')
      .set({ status: 'failed', attempts: sql`attempts + 1`, error: (err as Error).message.slice(0, 1000) })
      .where('provider', '=', 'stripe')
      .where('event_id', '=', event.id)
      .execute();
    return c.json({ error: 'processing failed' }, 500);
  }
});

const twiml = (message?: string | null) =>
  `<?xml version="1.0" encoding="UTF-8"?><Response>${message ? `<Message>${message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</Message>` : ''}</Response>`;

webhookRoutes.post('/twilio/inbound', async (c) => {
  const ctx = c.get('ctx');
  const params = (await c.req.parseBody()) as Record<string, string>;
  const url = `${ctx.env.PUBLIC_BASE_URL}/api/webhooks/twilio/inbound`;
  if (!ctx.sms.validateWebhook(c.req.header('x-twilio-signature'), url, params)) return c.text('forbidden', 403);
  const reply = await handleInboundSms(ctx, params);
  c.header('Content-Type', 'text/xml');
  return c.body(twiml(reply));
});

webhookRoutes.post('/twilio/status', async (c) => {
  const ctx = c.get('ctx');
  const params = (await c.req.parseBody()) as Record<string, string>;
  const url = `${ctx.env.PUBLIC_BASE_URL}/api/webhooks/twilio/status`;
  if (!ctx.sms.validateWebhook(c.req.header('x-twilio-signature'), url, params)) return c.text('forbidden', 403);
  await handleSmsStatus(ctx, params);
  return c.body(null, 204);
});
