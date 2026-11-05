import { randomUUID } from 'node:crypto';
import { AwsClient } from 'aws4fetch';
import Stripe from 'stripe';
import twilio from 'twilio';
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../config/env.js';
import { createEmailProvider } from './email/provider.js';
import { createStripeGateway } from './payments/stripe.js';
import { createSmsProvider } from './sms/provider.js';
import { s3Storage } from './storage/provider.js';
import { createLogger } from '../lib/logger.js';

/**
 * Runs the real adapters against local stand-ins, with no real account involved. Each block is
 * skipped unless its stand-in is running. See docs/testing.md for how to start them.
 *
 *   STRIPE_MOCK_PORT  stripe-mock, which checks requests against Stripe's published API definition
 *   MAILPIT_URL + SMTP_TEST_URL  Mailpit, a local mail catcher
 *   S3_TEST_ENDPOINT  any S3-compatible server
 */
const log = createLogger({}, { silent: true });
const base = { APP_ENV: 'test', DATABASE_URL: 'postgres://unused' };

describe.skipIf(!process.env.STRIPE_MOCK_PORT)('Stripe adapter against stripe-mock', () => {
  const gateway = () =>
    createStripeGateway(
      loadEnv({
        ...base,
        PAYMENTS_MODE: 'stripe',
        STRIPE_SECRET_KEY: 'sk_test_contract',
        STRIPE_WEBHOOK_SECRET: 'whsec_contract',
        STRIPE_API_HOST: '127.0.0.1',
        STRIPE_API_PORT: process.env.STRIPE_MOCK_PORT,
        STRIPE_API_PROTOCOL: 'http',
      }),
    );

  it('creates, reads and expires a Checkout session with parameters Stripe accepts', async () => {
    const g = gateway();
    expect(g.livemode).toBe(false);
    const session = await g.createCheckoutSession({
      payment_id: randomUUID(),
      amount_cents: 11800,
      currency: 'usd',
      description: 'Order BL-TEST',
      customer_email: 'customer@example.test',
      lines: [{ name: 'Garden Bouquet', description: 'Deluxe', amount_cents: 10000 }, { name: 'Delivery', amount_cents: 1200 }, { name: 'Sales tax', amount_cents: 600 }],
      success_url: 'https://example.test/track/abc?from=checkout',
      cancel_url: 'https://example.test/checkout?cancelled=1',
      expires_at: new Date(Date.now() + 40 * 60_000),
      metadata: { order_id: randomUUID(), payment_id: randomUUID() },
    });
    expect(session.id).toBeTruthy();
    const again = await g.retrieveCheckoutSession(session.id);
    expect(again.id).toBeTruthy();
    await g.expireCheckoutSession(session.id);
  });

  it('issues a partial refund with parameters Stripe accepts', async () => {
    const refund = await gateway().refund({ payment_intent: 'pi_contract', amount_cents: 500, idempotency_key: randomUUID(), reason: 'requested_by_customer', metadata: { order_id: 'o1' } });
    expect(refund.id).toBeTruthy();
    expect(['pending', 'succeeded', 'failed', 'cancelled']).toContain(refund.status);
  });

  it('accepts a correctly signed webhook, using the same signing scheme Stripe documents, and refuses anything else', () => {
    const g = gateway();
    const payload = JSON.stringify({ id: 'evt_contract', object: 'event', type: 'checkout.session.completed', livemode: false, data: { object: { id: 'cs_contract' } } });
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_contract' });
    expect(g.verifyWebhook(payload, header).id).toBe('evt_contract');
    expect(() => g.verifyWebhook(payload.replace('evt_contract', 'evt_forged'), header)).toThrow();
    expect(() => g.verifyWebhook(payload, Stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_wrong' }))).toThrow();
    expect(() => g.verifyWebhook(payload, '')).toThrow();
    const old = Stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_contract', timestamp: Math.floor(Date.now() / 1000) - 3600 });
    expect(() => g.verifyWebhook(payload, old)).toThrow();
  });
});

describe.skipIf(!process.env.MAILPIT_URL)('SMTP adapter against a local mail catcher', () => {
  const send = (to: string, allow: string) => {
    const provider = createEmailProvider(
      loadEnv({ ...base, EMAIL_PROVIDER: 'smtp', SMTP_URL: process.env.SMTP_TEST_URL, EMAIL_FROM: 'shop@example.test', MESSAGE_ALLOWLIST: allow }),
      log,
    );
    return provider.send({ to, subject: `Contract ${randomUUID()}`, text: 'Plain body', html: '<p>Html body</p>', from_name: 'Blooms Boutique & Floral', reply_to: 'reply@example.test', idempotency_key: randomUUID() });
  };

  it('delivers a real SMTP message, with the sender and reply-to set', async () => {
    const to = `contract-${randomUUID().slice(0, 8)}@example.test`;
    const result = await send(to, to);
    expect(result.status).toBe('sent');
    const found = (await (await fetch(`${process.env.MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)).json()) as { messages: Array<{ ID: string; Subject: string; From: { Name: string; Address: string } }> };
    expect(found.messages).toHaveLength(1);
    expect(found.messages[0].From.Address).toBe('shop@example.test');
    expect(found.messages[0].From.Name).toBe('Blooms Boutique & Floral');
    const full = (await (await fetch(`${process.env.MAILPIT_URL}/api/v1/message/${found.messages[0].ID}`)).json()) as { Text: string; HTML: string; ReplyTo: Array<{ Address: string }> };
    expect(full.Text).toContain('Plain body');
    expect(full.HTML).toContain('Html body');
    expect(full.ReplyTo[0].Address).toBe('reply@example.test');
  });

  it('outside production, refuses any address not on the allowlist', async () => {
    const to = `not-allowed-${randomUUID().slice(0, 8)}@example.test`;
    const result = await send(to, 'someone-else@example.test');
    expect(result.status).toBe('skipped');
    const found = (await (await fetch(`${process.env.MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)).json()) as { messages: unknown[] };
    expect(found.messages).toHaveLength(0);
  });
});

describe.skipIf(!process.env.S3_TEST_ENDPOINT)('S3 adapter against an S3-compatible server', () => {
  const credentials = { S3_ACCESS_KEY_ID: process.env.S3_TEST_KEY ?? 'blooms-test-key', S3_SECRET_ACCESS_KEY: process.env.S3_TEST_SECRET ?? 'blooms-test-secret-only' };
  it('stores, reads and deletes a private file, and refuses wrong credentials', async () => {
    const bucket = `blooms-contract-${randomUUID().slice(0, 8)}`;
    const client = new AwsClient({ accessKeyId: credentials.S3_ACCESS_KEY_ID, secretAccessKey: credentials.S3_SECRET_ACCESS_KEY, service: 's3', region: 'us-east-1' });
    const created = await client.fetch(`${process.env.S3_TEST_ENDPOINT}/${bucket}`, { method: 'PUT' });
    expect(created.ok, await created.text()).toBe(true);

    const env = loadEnv({ ...base, STORAGE_PROVIDER: 's3', S3_ENDPOINT: process.env.S3_TEST_ENDPOINT, S3_BUCKET: bucket, S3_REGION: 'us-east-1', ...credentials });
    const storage = s3Storage(env);
    const body = Buffer.from('fictional inspiration photo');
    await storage.put('planner/photo-one.webp', body, 'image/webp');
    const read = await storage.get('planner/photo-one.webp');
    expect(read?.body.equals(body)).toBe(true);
    expect(read?.contentType).toBe('image/webp');
    await storage.verify();

    // Nothing is public: a request with no signature gets nothing.
    const anonymous = await fetch(`${process.env.S3_TEST_ENDPOINT}/${bucket}/planner/photo-one.webp`);
    expect(anonymous.ok).toBe(false);

    const wrong = s3Storage(loadEnv({ ...base, STORAGE_PROVIDER: 's3', S3_ENDPOINT: process.env.S3_TEST_ENDPOINT, S3_BUCKET: bucket, S3_REGION: 'us-east-1', S3_ACCESS_KEY_ID: 'wrong', S3_SECRET_ACCESS_KEY: 'wrong-wrong-wrong' }));
    await expect(wrong.get('planner/photo-one.webp')).rejects.toThrow();

    await storage.delete('planner/photo-one.webp');
    expect(await storage.get('planner/photo-one.webp')).toBeNull();
    await storage.delete('never/existed.webp');

    // Keys come from the application, and anything that could escape the bucket path is refused.
    await expect(storage.put('../outside.webp', body, 'image/webp')).rejects.toThrow('Invalid storage key');
  });
});

describe('Twilio adapter', () => {
  const token = 'fictional-auth-token';
  const sms = () =>
    createSmsProvider(
      loadEnv({ ...base, SMS_ENABLED: 'true', TWILIO_ACCOUNT_SID: `AC${'0'.repeat(32)}`, TWILIO_AUTH_TOKEN: token, TWILIO_MESSAGING_SERVICE_SID: `MG${'0'.repeat(32)}`, MESSAGE_ALLOWLIST: '+19895550100' }),
      log,
    );
  const url = 'https://example.test/api/webhooks/twilio/inbound';
  const params = { From: '+19895550100', To: '+19895550199', Body: 'STOP', MessageSid: 'SM1' };

  it('accepts only webhooks carrying a valid Twilio signature', () => {
    const provider = sms();
    const signature = twilio.getExpectedTwilioSignature(token, url, params);
    expect(provider.validateWebhook(signature, url, params)).toBe(true);
    expect(provider.validateWebhook(signature, url, { ...params, Body: 'START' })).toBe(false);
    expect(provider.validateWebhook('forged', url, params)).toBe(false);
    expect(provider.validateWebhook(undefined, url, params)).toBe(false);
  });

  it('never contacts Twilio for a number outside the allowlist in development', async () => {
    const result = await sms().send({ to: '+19895550111', body: 'Hello' });
    expect(result.status).toBe('skipped');
    expect(result.message_id).toBeNull();
  });

  it('stays off, with a warning, when production has not recorded A2P registration', () => {
    const env = loadEnv({ ...base, APP_ENV: 'production', DATABASE_URL: 'postgres://x', SESSION_SECRET: 'x'.repeat(40), PUBLIC_BASE_URL: 'https://example.test', SMS_ENABLED: 'true', TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't', TWILIO_MESSAGING_SERVICE_SID: 'MG1' });
    expect(env.SMS_ENABLED).toBe(false);
    expect(env.warnings.join(' ')).toContain('A2P');
    expect(createSmsProvider(env, log).enabled).toBe(false);
  });
});
