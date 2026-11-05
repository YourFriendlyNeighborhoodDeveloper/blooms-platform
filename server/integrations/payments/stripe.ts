import Stripe from 'stripe';
import type { Env } from '../../config/env.js';
import type { CheckoutInput, GatewayEvent, GatewayRefund, GatewaySession, PaymentGateway } from './gateway.js';

const REFUND_STATUS: Record<string, GatewayRefund['status']> = {
  pending: 'pending',
  requires_action: 'pending',
  succeeded: 'succeeded',
  failed: 'failed',
  canceled: 'cancelled',
};

export const mapRefundStatus = (status: string | null | undefined): GatewayRefund['status'] => REFUND_STATUS[status ?? ''] ?? 'pending';

function toSession(s: Stripe.Checkout.Session): GatewaySession {
  return {
    id: s.id,
    url: s.url,
    status: (s.status ?? 'open') as GatewaySession['status'],
    payment_status: s.payment_status as GatewaySession['payment_status'],
    amount_total: s.amount_total,
    payment_intent: typeof s.payment_intent === 'string' ? s.payment_intent : (s.payment_intent?.id ?? null),
    expires_at: s.expires_at ? new Date(s.expires_at * 1000) : null,
    livemode: s.livemode,
    metadata: (s.metadata ?? {}) as Record<string, string>,
  };
}

/** Hosted Stripe Checkout: card details never touch this application. */
export function createStripeGateway(env: Env): PaymentGateway {
  const secret = env.STRIPE_SECRET_KEY as string;
  const stripe = new Stripe(secret, {
    maxNetworkRetries: 2,
    timeout: 20_000,
    ...(env.STRIPE_API_HOST ? { host: env.STRIPE_API_HOST, port: env.STRIPE_API_PORT, protocol: env.STRIPE_API_PROTOCOL } : {}),
    appInfo: { name: 'blooms-platform' },
  });
  const livemode = secret.startsWith('sk_live_') || secret.startsWith('rk_live_');

  return {
    name: 'stripe',
    livemode,
    async createCheckoutSession(input: CheckoutInput) {
      const session = await stripe.checkout.sessions.create(
        {
          mode: 'payment',
          customer_email: input.customer_email,
          client_reference_id: input.payment_id,
          line_items: input.lines.map((l) => ({
            quantity: 1,
            price_data: {
              currency: input.currency,
              unit_amount: l.amount_cents,
              product_data: { name: l.name, ...(l.description ? { description: l.description } : {}) },
            },
          })),
          success_url: input.success_url,
          cancel_url: input.cancel_url,
          expires_at: Math.floor(input.expires_at.getTime() / 1000),
          metadata: input.metadata,
          payment_intent_data: { description: input.description, metadata: input.metadata },
        },
        { idempotencyKey: `checkout:${input.payment_id}` },
      );
      return toSession(session);
    },
    async retrieveCheckoutSession(id) {
      return toSession(await stripe.checkout.sessions.retrieve(id));
    },
    async expireCheckoutSession(id) {
      try {
        await stripe.checkout.sessions.expire(id);
      } catch (err) {
        // Already completed or expired: nothing to do, and the webhook carries the real state.
        if ((err as { code?: string }).code !== 'checkout_session_already_expired' && (err as { statusCode?: number }).statusCode !== 400) throw err;
      }
    },
    async refund(input) {
      const refund = await stripe.refunds.create(
        {
          payment_intent: input.payment_intent,
          amount: input.amount_cents,
          metadata: input.metadata,
          ...(input.reason === 'duplicate' || input.reason === 'fraudulent' || input.reason === 'requested_by_customer' ? { reason: input.reason } : {}),
        },
        { idempotencyKey: `refund:${input.idempotency_key}` },
      );
      return { id: refund.id, status: mapRefundStatus(refund.status), failure_reason: refund.failure_reason ?? null };
    },
    verifyWebhook(rawBody, signature): GatewayEvent {
      if (!signature) throw new Error('Missing Stripe-Signature header');
      const event = stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET as string);
      return { id: event.id, type: event.type, livemode: event.livemode, object: event.data.object as unknown as Record<string, unknown> };
    },
  };
}
