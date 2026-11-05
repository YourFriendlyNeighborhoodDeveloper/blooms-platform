import { sql } from 'kysely';
import { loadEnv } from '../config/env.js';
import { createContext, type AppContext } from '../context.js';
import { createApp } from '../app.js';
import { seedBase } from '../db/seed-base.js';
import { createLogger } from '../lib/logger.js';
import type { EmailMessage, EmailProvider } from '../integrations/email/provider.js';
import type { SmsProvider } from '../integrations/sms/provider.js';
import { localStorage } from '../integrations/storage/provider.js';
import { mockEvent, mockSignature } from '../integrations/payments/mock.js';
import { createStaffUser } from '../auth/staff.js';
import { atLocal } from '../lib/time.js';

export const TZ = 'America/Detroit';

export class TestClock {
  current: Date;
  constructor(iso: string) {
    this.current = new Date(iso);
  }
  now = () => new Date(this.current);
  set(iso: string | Date) {
    this.current = new Date(iso);
  }
  advanceMinutes(m: number) {
    this.current = new Date(this.current.getTime() + m * 60_000);
  }
  advanceHours(h: number) {
    this.advanceMinutes(h * 60);
  }
}

export class CapturingEmail implements EmailProvider {
  name = 'capture';
  deliversForReal = false;
  sent: EmailMessage[] = [];
  failNext = 0;
  async send(m: EmailMessage) {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error('Simulated email provider outage');
    }
    this.sent.push(m);
    return { provider: 'capture', message_id: `msg-${this.sent.length}`, status: 'sent' as const };
  }
  to(address: string) {
    return this.sent.filter((m) => m.to === address);
  }
  subjects() {
    return this.sent.map((m) => m.subject);
  }
}

export class CapturingSms implements SmsProvider {
  enabled = true;
  name = 'capture';
  sent: Array<{ to: string; body: string }> = [];
  async send(input: { to: string; body: string }) {
    this.sent.push({ to: input.to, body: input.body });
    return { provider: 'capture', message_id: `sms-${this.sent.length}`, status: 'sent' as const };
  }
  validateWebhook() {
    return true;
  }
}

export type TestHarness = ReturnType<typeof createHarness>;

export function createHarness(opts: { now?: string; overrides?: Partial<AppContext>; env?: Record<string, string> } = {}) {
  const clock = new TestClock(opts.now ?? '2026-11-10T14:00:00Z');
  const email = new CapturingEmail();
  const env = loadEnv({
    APP_ENV: 'test',
    PAYMENTS_MODE: 'mock',
    PUBLIC_BASE_URL: 'http://localhost:5173',
    DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://blooms:blooms_dev_only@127.0.0.1:54329/blooms_test',
    STORAGE_LOCAL_DIR: 'storage/test',
    ...opts.env,
  });
  const ctx = createContext(env, { clock, email, log: createLogger({}, { silent: true }), storage: localStorage('storage/test'), ...opts.overrides });
  const app = createApp(ctx);

  class Browser {
    cookies = new Map<string, string>();
    async request(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
      const res = await app.request(path, {
        method,
        headers: {
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(this.cookies.size ? { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      for (const raw of res.headers.getSetCookie()) {
        const [pair] = raw.split(';');
        const eq = pair.indexOf('=');
        const name = pair.slice(0, eq);
        const value = pair.slice(eq + 1);
        if (value) this.cookies.set(name, value);
        else this.cookies.delete(name);
      }
      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = text;
      }
      return { status: res.status, json, headers: res.headers, text };
    }
    get = (p: string) => this.request('GET', p);
    post = (p: string, b: unknown = {}, headers: Record<string, string> = {}) => this.request('POST', p, b, headers);
    patch = (p: string, b: unknown) => this.request('PATCH', p, b);
    put = (p: string, b: unknown) => this.request('PUT', p, b);
    delete = (p: string) => this.request('DELETE', p);
  }

  return { ctx, app, clock, email, Browser, browser: () => new Browser() };
}

export type Browser = ReturnType<TestHarness['browser']>;

/** Clears all data but keeps the schema, then applies the same base seed production gets. */
export async function resetDb(ctx: AppContext) {
  const tables = await sql<{ tablename: string }>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations'`.execute(ctx.db);
  await sql.raw(`TRUNCATE ${tables.rows.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`).execute(ctx.db);
  await seedBase(ctx.db);
}

export const PASSWORD = 'correct-horse-battery-staple';

export async function makeStaff(ctx: AppContext, overrides: { email?: string; roles?: string[]; capabilities?: string[]; name?: string } = {}) {
  const email = overrides.email ?? `staff-${Math.random().toString(36).slice(2, 8)}@example.test`;
  const ids = await createStaffUser(ctx.db, {
    email,
    displayName: overrides.name ?? 'Test Staff',
    roleCodes: overrides.roles ?? ['owner'],
    password: PASSWORD,
    capabilities: overrides.capabilities ?? [],
  });
  return { ...ids, email };
}

export async function signIn(h: TestHarness, email: string) {
  const b = h.browser();
  const res = await b.post('/api/admin/auth/login', { email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`Login failed: ${res.text}`);
  return b;
}

/** Sends a correctly signed event to the real webhook endpoint, as Stripe would. */
export async function deliverWebhook(h: TestHarness, type: string, object: Record<string, unknown>, id?: string) {
  const event = mockEvent(type, object);
  if (id) event.id = id;
  const body = JSON.stringify(event);
  const res = await h.app.request('/api/webhooks/stripe', { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': mockSignature(body) }, body });
  return { status: res.status, json: (await res.json()) as any, eventId: event.id };
}

export async function sessionFor(h: TestHarness, orderId: string) {
  const payment = await h.ctx.db.selectFrom('payments').selectAll().where('order_id', '=', orderId).orderBy('created_at', 'desc').executeTakeFirstOrThrow();
  const s = await h.ctx.db.selectFrom('mock_gateway_sessions').selectAll().where('payment_id', '=', payment.id).executeTakeFirstOrThrow();
  return { payment, session: s };
}

export const sessionObject = (s: { id: string; amount_cents: number; payment_intent_id: string; metadata: unknown; expires_at: Date }, status: string, paymentStatus: string, amount?: number) => ({
  id: s.id,
  object: 'checkout.session',
  status,
  payment_status: paymentStatus,
  amount_total: amount ?? s.amount_cents,
  payment_intent: s.payment_intent_id,
  metadata: s.metadata,
  expires_at: Math.floor(s.expires_at.getTime() / 1000),
  livemode: false,
});

export async function payOrder(h: TestHarness, orderId: string) {
  const { session } = await sessionFor(h, orderId);
  const res = await deliverWebhook(h, 'checkout.session.completed', sessionObject(session, 'complete', 'paid'));
  await h.ctx.db.updateTable('mock_gateway_sessions').set({ status: 'paid' }).where('id', '=', session.id).execute();
  return res;
}

export const localInstant = (date: string, time: string) => atLocal(date, time, TZ);
