// Checks the real Stripe adapter against a real Stripe test-mode account. It refuses live keys, and
// creates only a test session that it then expires, so nothing is charged and no customer is contacted.
//
//   STRIPE_SECRET_KEY=sk_test_... STRIPE_WEBHOOK_SECRET=whsec_... PUBLIC_BASE_URL=https://... npm run verify:stripe
//
// Use a key from the business's own Stripe account. On success, the result is recorded so the launch
// checklist can show it. A full payment still has to be made by hand: see docs/integrations.md.
import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { loadEnv } from '../server/config/env.js';
import { createDb } from '../server/db/client.js';
import { createStripeGateway } from '../server/integrations/payments/stripe.js';

export const REQUIRED_WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
  'payment_intent.payment_failed',
  'refund.updated',
  'refund.failed',
  'charge.dispute.created',
];

const ok = (m: string) => console.log(`  ok    ${m}`);
const warn = (m: string) => console.log(`  CHECK ${m}`);
const fail = (m: string): never => {
  console.error(`  FAIL  ${m}`);
  process.exit(1);
};

const key = process.env.STRIPE_SECRET_KEY ?? '';
if (!key) fail('Set STRIPE_SECRET_KEY to a test key from the business\'s own Stripe account.');
if (!key.startsWith('sk_test_') && !key.startsWith('rk_test_')) fail('This check only runs with a test key. It will not run with a live key.');

const env = loadEnv({ ...process.env, PAYMENTS_MODE: 'stripe', STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_not_set_yet' });
const stripe = new Stripe(key);
const gateway = createStripeGateway(env);

console.log('Stripe test-mode check\n');

const account = await stripe.accounts.retrieveCurrent();
console.log(`  Account: ${account.settings?.dashboard?.display_name ?? account.business_profile?.name ?? account.id} (${account.id})`);
console.log('  Confirm that this is the business\'s own account, and not a personal or developer account.\n');

const session = await gateway.createCheckoutSession({
  payment_id: randomUUID(),
  amount_cents: 1234,
  currency: 'usd',
  description: 'Blooms platform connection check',
  customer_email: 'connection-check@example.com',
  lines: [{ name: 'Connection check (never charged)', amount_cents: 1234 }],
  success_url: `${env.PUBLIC_BASE_URL}/track/connection-check`,
  cancel_url: `${env.PUBLIC_BASE_URL}/checkout?cancelled=1`,
  expires_at: new Date(Date.now() + 40 * 60_000),
  metadata: { purpose: 'connection-check' },
});
if (session.livemode) fail('Stripe reports live mode. Stopping.');
if (!session.url || session.status !== 'open') fail(`Unexpected session state: ${session.status}`);
ok('Created a hosted Checkout session in test mode');

const read = await gateway.retrieveCheckoutSession(session.id);
if (read.amount_total !== 1234) fail(`Stripe reports a total of ${read.amount_total}, expected 1234.`);
ok('Read it back, with the correct total');

await gateway.expireCheckoutSession(session.id);
const expired = await gateway.retrieveCheckoutSession(session.id);
if (expired.status !== 'expired') fail(`Expected the session to be expired, got ${expired.status}.`);
ok('Expired it, so it can never be paid');

const payload = JSON.stringify({ id: 'evt_connection_check', object: 'event', type: 'ping', livemode: false, data: { object: {} } });
if (process.env.STRIPE_WEBHOOK_SECRET) {
  const signed = Stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
  gateway.verifyWebhook(payload, signed);
  let refused = false;
  try {
    gateway.verifyWebhook(payload.replace('ping', 'pong'), signed);
  } catch {
    refused = true;
  }
  if (!refused) fail('A tampered webhook was accepted.');
  ok('Webhook signature checking works with your signing secret');
} else {
  warn('STRIPE_WEBHOOK_SECRET is not set, so the signature check was skipped');
}

const expectedUrl = `${env.PUBLIC_BASE_URL.replace(/\/$/, '')}/api/webhooks/stripe`;
const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
const endpoint = endpoints.data.find((e) => e.url === expectedUrl);
if (!endpoint) {
  warn(`No webhook endpoint for ${expectedUrl}. Add one in the Stripe dashboard before taking payments.`);
} else {
  const missing = endpoint.enabled_events.includes('*') ? [] : REQUIRED_WEBHOOK_EVENTS.filter((e) => !endpoint.enabled_events.includes(e as never));
  if (missing.length) warn(`The webhook endpoint is missing these events: ${missing.join(', ')}`);
  else ok(`Webhook endpoint found, with the events it needs: ${expectedUrl}`);
}

if (process.env.DATABASE_URL) {
  const { db } = createDb(env.DATABASE_URL, { ssl: env.DATABASE_SSL, max: 1 });
  await db
    .insertInto('integration_settings')
    .values({ provider: 'stripe', enabled: true, last_verified_at: new Date(), last_error: null, config: JSON.stringify({ account: account.id, mode: 'test', webhook_endpoint_found: Boolean(endpoint) }) })
    .onConflict((oc) => oc.column('provider').doUpdateSet({ enabled: true, last_verified_at: new Date(), last_error: null, config: JSON.stringify({ account: account.id, mode: 'test', webhook_endpoint_found: Boolean(endpoint) }) }))
    .execute();
  await db.destroy();
  ok('Recorded this check for the launch checklist');
}

console.log('\nThe connection works. Next, complete a real test payment by hand, using the steps in docs/integrations.md.');
