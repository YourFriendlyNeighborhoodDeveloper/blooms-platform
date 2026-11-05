import Stripe from 'stripe';
import { randomBytes } from 'node:crypto';
import type { AppContext } from '../../context.js';
import type { GatewayEvent, GatewaySession, PaymentGateway } from './gateway.js';

export const MOCK_WEBHOOK_SECRET = 'whsec_mock_gateway_local_only';

// A placeholder that satisfies the SDK constructor. Only offline signature helpers are used.
const verifier = new Stripe('sk_test_mock_never_sent_anywhere');

const id = (prefix: string) => `${prefix}_mock_${randomBytes(12).toString('hex')}`;

export function mockSignature(payload: string) {
  return verifier.webhooks.generateTestHeaderString({ payload, secret: MOCK_WEBHOOK_SECRET });
}

export function mockEvent(type: string, object: Record<string, unknown>) {
  return { id: id('evt'), object: 'event', type, livemode: false, created: Math.floor(Date.now() / 1000), data: { object } };
}

/**
 * Simulated gateway for development, tests and staging demos. It moves no money and is refused at
 * startup when APP_ENV=production. Sessions persist in PostgreSQL so the web process and the worker
 * see the same state, and webhooks go through the real signature verification.
 */
export function createMockGateway(ctx: Pick<AppContext, 'db' | 'clock' | 'env'>): PaymentGateway {
  const toSession = (row: {
    id: string;
    status: string;
    amount_cents: number;
    payment_intent_id: string;
    expires_at: Date;
    metadata: unknown;
  }): GatewaySession => ({
    id: row.id,
    url: `${ctx.env.PUBLIC_BASE_URL}/api/dev/mock-checkout/${row.id}`,
    status: row.status === 'paid' || row.status === 'processing' ? 'complete' : row.status === 'expired' ? 'expired' : 'open',
    payment_status: row.status === 'paid' ? 'paid' : 'unpaid',
    amount_total: row.amount_cents,
    payment_intent: row.payment_intent_id,
    expires_at: row.expires_at,
    livemode: false,
    metadata: (row.metadata ?? {}) as Record<string, string>,
  });

  return {
    name: 'mock',
    livemode: false,
    async createCheckoutSession(input) {
      const existing = await ctx.db.selectFrom('mock_gateway_sessions').selectAll().where('payment_id', '=', input.payment_id).where('status', '=', 'open').executeTakeFirst();
      if (existing) return toSession(existing);
      const row = await ctx.db
        .insertInto('mock_gateway_sessions')
        .values({
          id: id('cs'),
          payment_id: input.payment_id,
          payment_intent_id: id('pi'),
          amount_cents: input.amount_cents,
          description: input.description,
          success_url: input.success_url,
          cancel_url: input.cancel_url,
          metadata: JSON.stringify(input.metadata),
          expires_at: input.expires_at,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return toSession(row);
    },
    async retrieveCheckoutSession(sessionId) {
      const row = await ctx.db.selectFrom('mock_gateway_sessions').selectAll().where('id', '=', sessionId).executeTakeFirstOrThrow();
      return toSession(row);
    },
    async expireCheckoutSession(sessionId) {
      await ctx.db.updateTable('mock_gateway_sessions').set({ status: 'expired' }).where('id', '=', sessionId).where('status', '=', 'open').execute();
    },
    async refund() {
      return { id: id('re'), status: 'succeeded' };
    },
    verifyWebhook(rawBody, signature): GatewayEvent {
      if (!signature) throw new Error('Missing signature');
      const event = verifier.webhooks.constructEvent(rawBody, signature, MOCK_WEBHOOK_SECRET);
      return { id: event.id, type: event.type, livemode: event.livemode, object: event.data.object as unknown as Record<string, unknown> };
    },
  };
}
