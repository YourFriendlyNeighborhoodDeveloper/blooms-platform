import type { AppContext } from '../../context.js';
import { unavailable } from '../../lib/errors.js';
import { createStripeGateway } from './stripe.js';
import { createMockGateway } from './mock.js';

export type CheckoutLine = { name: string; description?: string; amount_cents: number };

export type CheckoutInput = {
  payment_id: string;
  amount_cents: number;
  currency: string;
  description: string;
  customer_email: string;
  lines: CheckoutLine[];
  success_url: string;
  cancel_url: string;
  expires_at: Date;
  metadata: Record<string, string>;
};

export type GatewaySession = {
  id: string;
  url: string | null;
  status: 'open' | 'complete' | 'expired';
  payment_status: 'paid' | 'unpaid' | 'no_payment_required';
  amount_total: number | null;
  payment_intent: string | null;
  expires_at: Date | null;
  livemode: boolean;
  metadata: Record<string, string>;
};

export type GatewayEvent = {
  id: string;
  type: string;
  livemode: boolean;
  object: Record<string, unknown>;
};

export type GatewayRefund = { id: string; status: 'pending' | 'succeeded' | 'failed' | 'cancelled'; failure_reason?: string | null };

/**
 * The application talks only to this interface. StripeGateway is the real thing; MockGateway stands
 * in during development, tests and demos, and produces identically signed webhooks so the same
 * processing code runs in both cases.
 */
export interface PaymentGateway {
  readonly name: 'stripe' | 'mock' | 'disabled';
  readonly livemode: boolean;
  createCheckoutSession(input: CheckoutInput): Promise<GatewaySession>;
  retrieveCheckoutSession(id: string): Promise<GatewaySession>;
  expireCheckoutSession(id: string): Promise<void>;
  refund(input: { payment_intent: string; amount_cents: number; idempotency_key: string; reason?: string | null; metadata?: Record<string, string> }): Promise<GatewayRefund>;
  /** Verifies the signature against the raw body. Throws if it is not authentic. */
  verifyWebhook(rawBody: string, signature: string | undefined): GatewayEvent;
}

const closed = () => unavailable('payments_disabled', 'Online payment is not available yet. Please call the shop to place your order.');

export const disabledGateway: PaymentGateway = {
  name: 'disabled',
  livemode: false,
  createCheckoutSession: async () => {
    throw closed();
  },
  retrieveCheckoutSession: async () => {
    throw closed();
  },
  expireCheckoutSession: async () => {},
  refund: async () => {
    throw closed();
  },
  verifyWebhook: () => {
    throw closed();
  },
};

export function createPaymentGateway(ctx: Pick<AppContext, 'env' | 'db' | 'clock'>): PaymentGateway {
  switch (ctx.env.PAYMENTS_MODE) {
    case 'stripe':
      return createStripeGateway(ctx.env);
    case 'mock':
      return createMockGateway(ctx);
    default:
      return disabledGateway;
  }
}
