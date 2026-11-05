import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../http/types.js';
import { clearCookie, cookieNames, readCookie, readJson, setSessionCookie } from '../http/helpers.js';
import { badRequest, notFound } from '../lib/errors.js';
import { hitRateLimit } from '../lib/ratelimit.js';
import { audit } from '../lib/audit.js';
import { consumeAccessToken, generateReference, mintAccessToken, resolveAccessToken } from '../lib/tokens.js';
import { toE164 } from '../lib/phone.js';
import { emit } from '../automation/events.js';
import { requireCustomer } from '../http/middleware.js';
import { createSession, resolveSession, revokeSession } from '../auth/sessions.js';
import { sendDirect } from '../modules/notifications/service.js';
import { firstName } from '../modules/notifications/vars.js';
import { publicOrderView } from '../modules/orders/views.js';
import { upsertCustomer } from '../modules/orders/checkout.js';
import { loadSettings } from '../modules/settings/service.js';

export const accountRoutes = new Hono<AppEnv>();

/**
 * Sign-in by emailed link. There is no password to steal or forget, and recovery is the same as
 * signing in. Proving control of an email is also what lets a customer claim guest orders made with
 * it: they appear in the account the moment the link is used.
 */
accountRoutes.post('/login', async (c) => {
  const ctx = c.get('ctx');
  const { email } = await readJson(c, z.object({ email: z.string().trim().toLowerCase().email('Please check your email address.') }));
  const allowed = (await hitRateLimit(ctx.db, ctx.clock, `account-login-ip:${c.get('ip')}`, 10, 900)) && (await hitRateLimit(ctx.db, ctx.clock, `account-login:${email}`, 5, 900));
  if (allowed) {
    const token = await mintAccessToken(ctx.db, ctx.clock, { purpose: 'customer_login', email, ttlMinutes: 30, singleUse: true });
    const customer = await ctx.db.selectFrom('customers').select(['id', 'name']).where('email', '=', email).executeTakeFirst();
    await sendDirect(ctx, {
      template: 'customer_login',
      to: email,
      customerId: customer?.id ?? null,
      dedupe: `login:${email}:${token.slice(0, 12)}`,
      vars: { login: { url: `${ctx.env.PUBLIC_BASE_URL}/account/verify/${token}` }, customer: { first_name: customer ? firstName(customer.name) : '' } },
    });
  }
  // The same answer whether or not an account exists, so this cannot be used to probe for customers.
  return c.json({ sent: true });
});

accountRoutes.post('/verify', async (c) => {
  const ctx = c.get('ctx');
  const { token } = await readJson(c, z.object({ token: z.string().min(10).max(200) }));
  const row = await resolveAccessToken(ctx.db, ctx.clock, token, ['customer_login']);
  if (!row?.email) throw notFound('This sign-in link has expired. Please request a new one.');
  if (!(await consumeAccessToken(ctx.db, ctx.clock, row.id))) throw notFound('This sign-in link has already been used. Please request a new one.');
  const customerId = await upsertCustomer(ctx.db, { name: row.email.split('@')[0], email: row.email }, 'account');
  await ctx.db.updateTable('customers').set({ email_verified_at: ctx.clock.now() }).where('id', '=', customerId).execute();
  const session = await createSession(ctx.db, ctx.clock, { customerId }, { ip: c.get('ip'), userAgent: c.req.header('user-agent') });
  setSessionCookie(c, ctx.env, cookieNames(ctx.env).customer, session.token, session.expiresAt);
  await audit(ctx.db, { type: 'customer', id: customerId, ip: c.get('ip') }, 'account.login');
  return c.json({ ok: true });
});

accountRoutes.post('/logout', async (c) => {
  const ctx = c.get('ctx');
  const name = cookieNames(ctx.env).customer;
  const session = await resolveSession(ctx.db, ctx.clock, readCookie(c, name));
  if (session) await revokeSession(ctx.db, ctx.clock, session.id);
  clearCookie(c, ctx.env, name);
  return c.json({ ok: true });
});

const secured = new Hono<AppEnv>();
secured.use('*', requireCustomer);

secured.get('/me', async (c) => {
  const ctx = c.get('ctx');
  const { customerId } = c.get('customer');
  const me = await ctx.db.selectFrom('customers').select(['id', 'name', 'email', 'phone_e164', 'email_verified_at']).where('id', '=', customerId).executeTakeFirstOrThrow();
  const latest = async (channel: 'email' | 'sms', purpose: 'transactional' | 'marketing') =>
    (await ctx.db.selectFrom('customer_consents').select('granted').where('customer_id', '=', customerId).where('channel', '=', channel).where('purpose', '=', purpose).orderBy('created_at', 'desc').limit(1).executeTakeFirst())?.granted ?? false;
  const settings = await loadSettings(ctx.db);
  return c.json({
    ...me,
    preferences: { email_marketing: await latest('email', 'marketing'), sms_transactional: await latest('sms', 'transactional'), sms_marketing: await latest('sms', 'marketing') },
    sms_available: ctx.sms.enabled,
    sms_consent_text: { transactional: settings.sms.consent_text_transactional, marketing: settings.sms.consent_text_marketing },
  });
});

secured.patch('/me', async (c) => {
  const ctx = c.get('ctx');
  const { customerId } = c.get('customer');
  const body = await readJson(c, z.object({ name: z.string().trim().min(2, 'Please enter your name.').max(120).optional(), phone: z.string().trim().max(30).nullable().optional() }));
  const phone = body.phone === undefined ? undefined : body.phone ? toE164(body.phone) : null;
  if (body.phone && !phone) throw badRequest('Please enter a 10-digit US phone number.');
  await ctx.db.updateTable('customers').set({ ...(body.name ? { name: body.name } : {}), ...(phone !== undefined ? { phone_e164: phone } : {}) }).where('id', '=', customerId).execute();
  await audit(ctx.db, { type: 'customer', id: customerId, ip: c.get('ip') }, 'account.update');
  return c.json({ ok: true });
});

secured.put('/preferences', async (c) => {
  const ctx = c.get('ctx');
  const { customerId } = c.get('customer');
  const body = await readJson(c, z.object({ email_marketing: z.boolean(), sms_transactional: z.boolean(), sms_marketing: z.boolean() }));
  const me = await ctx.db.selectFrom('customers').select('phone_e164').where('id', '=', customerId).executeTakeFirstOrThrow();
  const settings = await loadSettings(ctx.db);
  const rows = [
    { channel: 'email' as const, purpose: 'marketing' as const, granted: body.email_marketing, text: 'Send me occasional news and offers by email.' },
    { channel: 'sms' as const, purpose: 'transactional' as const, granted: body.sms_transactional, text: settings.sms.consent_text_transactional },
    { channel: 'sms' as const, purpose: 'marketing' as const, granted: body.sms_marketing, text: settings.sms.consent_text_marketing },
  ];
  for (const r of rows) {
    const current = await ctx.db.selectFrom('customer_consents').select('granted').where('customer_id', '=', customerId).where('channel', '=', r.channel).where('purpose', '=', r.purpose).orderBy('created_at', 'desc').limit(1).executeTakeFirst();
    if ((current?.granted ?? false) === r.granted) continue;
    if (r.channel === 'sms' && r.granted && !me.phone_e164) throw badRequest('Add a phone number first.');
    await ctx.db.insertInto('customer_consents').values({ customer_id: customerId, channel: r.channel, purpose: r.purpose, granted: r.granted, source: 'account', phone_e164: r.channel === 'sms' ? me.phone_e164 : null, disclosure_text: r.granted ? r.text : null, ip: c.get('ip'), user_agent: c.req.header('user-agent')?.slice(0, 300) ?? null }).execute();
  }
  return c.json({ ok: true });
});

secured.get('/orders', async (c) => {
  const ctx = c.get('ctx');
  const { customerId } = c.get('customer');
  const rows = await ctx.db.selectFrom('orders').select(['id', 'reference', 'status', 'payment_status', 'placed_at', 'total_cents']).where('customer_id', '=', customerId).where('status', 'not in', ['expired']).orderBy('placed_at', 'desc').limit(100).execute();
  return c.json({ orders: rows });
});

secured.get('/orders/:id', async (c) => {
  const ctx = c.get('ctx');
  const { customerId } = c.get('customer');
  const owned = await ctx.db.selectFrom('orders').select('id').where('id', '=', c.req.param('id')).where('customer_id', '=', customerId).executeTakeFirst();
  if (!owned) throw notFound('Order not found.');
  const token = await mintAccessToken(ctx.db, ctx.clock, { purpose: 'order_access', subjectId: owned.id, ttlMinutes: 60 });
  return c.json({ ...(await publicOrderView(ctx.db, owned.id)), token });
});

secured.get('/events', async (c) => {
  const ctx = c.get('ctx');
  const { customerId } = c.get('customer');
  const inquiries = await ctx.db
    .selectFrom('wedding_inquiries as i')
    .leftJoin('wedding_projects as p', 'p.inquiry_id', 'i.id')
    .select(['i.id', 'i.reference', 'i.event_type', 'i.event_date', 'i.status', 'p.id as project_id', 'p.status as project_status'])
    .where('i.customer_id', '=', customerId)
    .orderBy('i.event_date', 'desc')
    .execute();
  const out = [];
  for (const i of inquiries) {
    const plan_token = await mintAccessToken(ctx.db, ctx.clock, { purpose: 'inquiry_access', subjectId: i.id, ttlMinutes: 120 });
    const project_token = i.project_id ? await mintAccessToken(ctx.db, ctx.clock, { purpose: 'project_access', subjectId: i.project_id, ttlMinutes: 120 }) : null;
    out.push({ reference: i.reference, event_type: i.event_type, event_date: i.event_date, status: i.status, project_status: i.project_status, plan_token, project_token });
  }
  return c.json({ events: out });
});

secured.get('/invoices', async (c) => {
  const ctx = c.get('ctx');
  const { customerId } = c.get('customer');
  const rows = await ctx.db.selectFrom('invoices').select(['id', 'number', 'kind', 'status', 'total_cents', 'paid_cents', 'due_on']).where('customer_id', '=', customerId).where('status', '!=', 'draft').orderBy('created_at', 'desc').execute();
  const out = [];
  for (const r of rows) {
    const open = r.status !== 'void' && r.paid_cents < r.total_cents;
    out.push({ number: r.number, kind: r.kind, status: r.status, total_cents: r.total_cents, paid_cents: r.paid_cents, due_on: r.due_on, pay_token: open ? await mintAccessToken(ctx.db, ctx.clock, { purpose: 'invoice_access', subjectId: r.id, ttlMinutes: 120 }) : null });
  }
  return c.json({ invoices: out });
});

secured.post('/support', async (c) => {
  const ctx = c.get('ctx');
  const customer = c.get('customer');
  const body = await readJson(c, z.object({ topic: z.string().trim().min(1).max(60), message: z.string().trim().min(5, 'Please say a little more.').max(4000), order_id: z.string().uuid().nullable().optional() }));
  if (!(await hitRateLimit(ctx.db, ctx.clock, `support:${customer.customerId}`, 10, 3600))) throw badRequest('Please wait a little before sending another message.');
  if (body.order_id) {
    const owned = await ctx.db.selectFrom('orders').select('id').where('id', '=', body.order_id).where('customer_id', '=', customer.customerId).executeTakeFirst();
    if (!owned) throw notFound('Order not found.');
  }
  const reference = generateReference('MSG');
  await ctx.db.transaction().execute(async (trx) => {
    const row = await trx.insertInto('support_requests').values({ reference, customer_id: customer.customerId, topic: body.topic, name: customer.name, email: customer.email, message: body.message, order_id: body.order_id ?? null, source: 'account' }).returning('id').executeTakeFirstOrThrow();
    await trx.insertInto('customer_communications').values({ customer_id: customer.customerId, direction: 'inbound', channel: 'portal', subject: body.topic, body: body.message, subject_type: 'support', subject_id: row.id }).execute();
    await emit(trx, 'support.created', { type: 'support', id: row.id });
  });
  return c.json({ reference }, 201);
});

secured.post('/data-request', async (c) => {
  const ctx = c.get('ctx');
  const customer = c.get('customer');
  const { kind } = await readJson(c, z.object({ kind: z.enum(['export', 'delete']) }));
  await ctx.db.insertInto('data_requests').values({ customer_id: customer.customerId, kind }).execute();
  await audit(ctx.db, { type: 'customer', id: customer.customerId, ip: c.get('ip') }, `privacy.${kind}_requested`);
  return c.json({ received: true }, 201);
});

accountRoutes.route('/', secured);
