import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { CapturingSms, createHarness, makeStaff, payOrder, resetDb, signIn } from '../test/helpers.js';
import { configureShop, makeProduct, weekdayOf } from '../test/fixtures.js';
import { drain } from '../automation/worker.js';
import { handleInboundSms, handleSmsStatus } from './notifications/sms-webhooks.js';
import { updateSetting } from './settings/service.js';
import { SYSTEM_ACTOR } from '../lib/audit.js';
import { normalizeFacebookUrl } from './content/facebook.js';
import { processImage, sniffType } from './uploads.js';
import { readinessChecks } from './settings/readiness.js';
import { isAllowlisted, loadEnv } from '../config/env.js';
import { queueCalendarPush } from './calendar/sync.js';
import { checkIntegrity } from './system/integrity.js';
import { parseCsv, templateCsv } from './catalog/import.js';
import { changeStock } from './inventory/service.js';
import sharp from 'sharp';

const sms = new CapturingSms();
const h = createHarness({ now: '2026-11-10T16:00:00Z', overrides: { sms } }); // 11 AM Saginaw
const { ctx } = h;
afterAll(() => ctx.db.destroy());

beforeEach(async () => {
  await resetDb(ctx);
  h.email.sent.length = 0;
  sms.sent.length = 0;
  h.clock.set('2026-11-10T16:00:00Z');
});

async function order(consents: Record<string, boolean> = {}, phone = '(989) 555-0123') {
  const shop = await configureShop(ctx);
  const product = await makeProduct(ctx);
  const b = h.browser();
  await b.post('/api/public/cart/items', { variant_id: product.variant_id, quantity: 1, options: {} });
  const cart = (await b.get('/api/public/cart')).json;
  const res = await b.post('/api/public/checkout', {
    idempotency_key: `k-${Math.random()}`,
    contact: { name: 'Text Example', email: 'text@example.test', phone },
    consents,
    fulfillments: [{ line_ids: cart.lines.map((l: { id: string }) => l.id), method: 'pickup', date: '2026-11-11', window_id: shop.windows[`pickup-${weekdayOf('2026-11-11')}`] }],
  });
  expect(res.status, res.text).toBe(201);
  return { orderId: res.json.order_id as string, shop, b };
}

describe('SMS consent and opt-out', () => {
  beforeEach(async () => {
    await updateSetting(ctx.db, 'sms', { enabled_templates: ['order_confirmation', 'order_ready_pickup'] }, SYSTEM_ACTOR);
  });

  it('sends nothing without an explicit opt-in', async () => {
    const { orderId } = await order();
    await payOrder(h, orderId);
    await drain(ctx);
    expect(sms.sent).toHaveLength(0);
    expect(h.email.to('text@example.test').length).toBeGreaterThan(0);
  });

  it('sends after opt-in, records the consent evidence, and identifies the sender', async () => {
    const { orderId } = await order({ sms_transactional: true });
    const consent = await ctx.db.selectFrom('customer_consents').selectAll().where('channel', '=', 'sms').executeTakeFirstOrThrow();
    expect(consent.granted).toBe(true);
    expect(consent.source).toBe('checkout');
    expect(consent.disclosure_text).toContain('Reply HELP');
    expect(consent.created_at).toBeTruthy();
    await payOrder(h, orderId);
    await drain(ctx);
    expect(sms.sent).toHaveLength(1);
    expect(sms.sent[0].to).toBe('+19895550123');
    expect(sms.sent[0].body).toContain('Blooms Boutique & Floral');
    expect(sms.sent[0].body).toContain('STOP');
  });

  it('never texts a message the owner has not switched on', async () => {
    await updateSetting(ctx.db, 'sms', { enabled_templates: [] }, SYSTEM_ACTOR);
    const { orderId } = await order({ sms_transactional: true });
    await payOrder(h, orderId);
    await drain(ctx);
    expect(sms.sent).toHaveLength(0);
  });

  it('marketing consent does not grant transactional texts, and vice versa', async () => {
    const { orderId } = await order({ sms_marketing: true });
    await payOrder(h, orderId);
    await drain(ctx);
    expect(sms.sent).toHaveLength(0);
  });

  it('STOP suppresses all future messages, even ones already queued', async () => {
    const { orderId } = await order({ sms_transactional: true });
    await payOrder(h, orderId);
    // The customer replies STOP before the worker gets to the queued text.
    await drain(ctx, 'w', 1).catch(() => {});
    const reply = await handleInboundSms(ctx, { From: '+19895550123', Body: 'stop please' });
    expect(reply).toContain('unsubscribed');
    await drain(ctx);
    const before = sms.sent.length;

    const owner = await makeStaff(ctx, { email: 'owner@example.test' });
    const staff = await signIn(h, owner.email);
    const detail = (await staff.get(`/api/admin/orders/${orderId}`)).json;
    await staff.post(`/api/admin/orders/${orderId}/items/status`, { item_ids: [detail.items[0].id], status: 'ready' });
    await drain(ctx);
    expect(sms.sent.length).toBe(before);
    const consent = await ctx.db.selectFrom('customer_consents').selectAll().where('channel', '=', 'sms').where('purpose', '=', 'transactional').orderBy('created_at', 'desc').executeTakeFirstOrThrow();
    expect(consent.granted).toBe(false);
    expect(await ctx.db.selectFrom('sms_suppressions').selectAll().executeTakeFirst()).toBeTruthy();
    expect(h.email.to('text@example.test').some((m) => m.subject.includes('Ready for pickup'))).toBe(true);
  });

  it('HELP gets a reply, START lifts the block but does not re-grant consent', async () => {
    await order({ sms_transactional: true });
    expect(await handleInboundSms(ctx, { From: '+19895550123', Body: 'HELP' })).toContain('for help call');
    await handleInboundSms(ctx, { From: '+19895550123', Body: 'STOP' });
    expect(await handleInboundSms(ctx, { From: '+19895550123', Body: 'START' })).toContain('re-subscribed');
    expect(await ctx.db.selectFrom('sms_suppressions').selectAll().execute()).toHaveLength(0);
    const latest = await ctx.db.selectFrom('customer_consents').select('granted').where('channel', '=', 'sms').where('purpose', '=', 'transactional').orderBy('created_at', 'desc').executeTakeFirstOrThrow();
    expect(latest.granted).toBe(false);
  });

  it('holds texts during quiet hours until morning', async () => {
    const { orderId } = await order({ sms_transactional: true });
    h.clock.set('2026-11-11T03:00:00Z'); // 10 PM Saginaw
    await payOrder(h, orderId);
    await drain(ctx);
    expect(sms.sent).toHaveLength(0);
    const queued = await ctx.db.selectFrom('notifications').selectAll().where('channel', '=', 'sms').executeTakeFirstOrThrow();
    expect(queued.status).toBe('deferred');
    h.clock.set('2026-11-11T14:05:00Z'); // 9:05 AM
    await drain(ctx);
    expect(sms.sent).toHaveLength(1);
  });

  it('records delivery callbacks, and does not let a late status undo "delivered"', async () => {
    const { orderId } = await order({ sms_transactional: true });
    await payOrder(h, orderId);
    await drain(ctx);
    const delivery = await ctx.db.selectFrom('notification_deliveries').select(['provider_message_id', 'notification_id']).where('provider', '=', 'capture').where('provider_message_id', 'like', 'sms-%').executeTakeFirstOrThrow();
    await ctx.db.updateTable('notification_deliveries').set({ provider: 'twilio' }).where('provider_message_id', '=', delivery.provider_message_id).execute();
    await handleSmsStatus(ctx, { MessageSid: delivery.provider_message_id as string, MessageStatus: 'delivered' });
    await handleSmsStatus(ctx, { MessageSid: delivery.provider_message_id as string, MessageStatus: 'failed', ErrorCode: '30003' });
    const n = await ctx.db.selectFrom('notifications').select('status').where('id', '=', delivery.notification_id).executeTakeFirstOrThrow();
    expect(n.status).toBe('delivered');
  });
});

describe('Customer accounts', () => {
  it('signs in by emailed link and claims guest orders with that email', async () => {
    const { orderId } = await order();
    await payOrder(h, orderId);
    const b = h.browser();
    expect((await b.get('/api/account/orders')).status).toBe(401);

    expect((await b.post('/api/account/login', { email: 'text@example.test' })).json).toEqual({ sent: true });
    expect((await b.post('/api/account/login', { email: 'nobody-here@example.test' })).json).toEqual({ sent: true });
    await drain(ctx);
    const mail = h.email.to('text@example.test').find((m) => m.subject.includes('sign-in link'))!;
    const token = mail.text.match(/\/account\/verify\/([\w-]+)/)![1];

    expect((await b.post('/api/account/verify', { token })).status).toBe(200);
    const orders = (await b.get('/api/account/orders')).json.orders;
    expect(orders).toHaveLength(1);
    expect(orders[0].id).toBe(orderId);

    // A sign-in link works only once.
    expect((await h.browser().post('/api/account/verify', { token })).status).toBe(404);

    // Another customer cannot read this order.
    const other = h.browser();
    await other.post('/api/account/login', { email: 'someone-else@example.test' });
    await drain(ctx);
    const otherToken = h.email.to('someone-else@example.test').find((m) => m.subject.includes('sign-in link'))!.text.match(/\/account\/verify\/([\w-]+)/)![1];
    await other.post('/api/account/verify', { token: otherToken });
    expect((await other.get(`/api/account/orders/${orderId}`)).status).toBe(404);
    expect((await other.get('/api/account/orders')).json.orders).toHaveLength(0);
  });

  it('a guest checkout cannot change an existing customer’s details', async () => {
    await ctx.db.insertInto('customers').values({ email: 'text@example.test', name: 'Real Name', phone_e164: '+19895559999' }).execute();
    await order();
    const c = await ctx.db.selectFrom('customers').selectAll().where('email', '=', 'text@example.test').executeTakeFirstOrThrow();
    expect(c.name).toBe('Real Name');
    expect(c.phone_e164).toBe('+19895559999');
  });

  it('updates preferences with an audit trail and supports support requests', async () => {
    const b = h.browser();
    await b.post('/api/account/login', { email: 'pref@example.test' });
    await drain(ctx);
    const token = h.email.to('pref@example.test')[0].text.match(/\/account\/verify\/([\w-]+)/)![1];
    await b.post('/api/account/verify', { token });
    await b.patch('/api/account/me', { name: 'Pat Example', phone: '989-555-0100' });
    expect((await b.put('/api/account/preferences', { email_marketing: true, sms_transactional: true, sms_marketing: false })).status).toBe(200);
    expect((await b.get('/api/account/me')).json.preferences).toEqual({ email_marketing: true, sms_transactional: true, sms_marketing: false });
    await b.put('/api/account/preferences', { email_marketing: false, sms_transactional: true, sms_marketing: false });
    const rows = await ctx.db.selectFrom('customer_consents').select(['channel', 'purpose', 'granted']).orderBy('created_at').execute();
    expect(rows.filter((r) => r.channel === 'email').map((r) => r.granted)).toEqual([true, false]);
    expect((await b.post('/api/account/support', { topic: 'Question', message: 'Where is my order please?' })).status).toBe(201);
  });
});

describe('Privacy', () => {
  it('exports everything held, and erases a customer while keeping financial records', async () => {
    const { orderId, shop: _shop } = await order({ email_marketing: true });
    await payOrder(h, orderId);
    const owner = await makeStaff(ctx, { email: 'owner@example.test' });
    const staff = await signIn(h, owner.email);
    const customer = await ctx.db.selectFrom('customers').selectAll().where('email', '=', 'text@example.test').executeTakeFirstOrThrow();

    const exported = await staff.get(`/api/admin/customers/${customer.id}/export`);
    expect(exported.json.customer.email).toBe('text@example.test');
    expect(exported.json.orders).toHaveLength(1);

    // An open order blocks erasure, so the shop cannot lose track of something it owes.
    expect((await staff.post(`/api/admin/customers/${customer.id}/anonymize`)).status).toBe(409);

    const detail = (await staff.get(`/api/admin/orders/${orderId}`)).json;
    await staff.post(`/api/admin/orders/${orderId}/items/status`, { item_ids: [detail.items[0].id], status: 'fulfilled' });
    expect((await staff.post(`/api/admin/customers/${customer.id}/anonymize`)).status).toBe(200);

    const after = await ctx.db.selectFrom('customers').selectAll().where('id', '=', customer.id).executeTakeFirstOrThrow();
    expect(after.name).toBe('Erased customer');
    expect(after.phone_e164).toBeNull();
    expect(after.email).not.toContain('text@example.test');
    const orderRow = await ctx.db.selectFrom('orders').selectAll().where('id', '=', orderId).executeTakeFirstOrThrow();
    expect(orderRow.contact_email).not.toContain('text@example.test');
    expect(orderRow.contact_phone).toBeNull();
    expect(orderRow.total_cents).toBeGreaterThan(0);
    const audit = await ctx.db.selectFrom('audit_logs').select('action').where('action', '=', 'privacy.anonymize').execute();
    expect(audit).toHaveLength(1);
  });

  it('the audit log cannot be edited or deleted', async () => {
    await ctx.db.insertInto('audit_logs').values({ actor_type: 'system', action: 'test' }).execute();
    await expect(ctx.db.updateTable('audit_logs').set({ action: 'changed' }).execute()).rejects.toThrow(/append-only/);
    await expect(ctx.db.deleteFrom('audit_logs').execute()).rejects.toThrow(/append-only/);
  });
});

describe('Safe uploads', () => {
  it('identifies files by content, not by name', () => {
    expect(sniffType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffType(Buffer.from('%PDF-1.7'))).toBe('application/pdf');
    expect(sniffType(Buffer.from('<script>alert(1)</script>'))).toBeNull();
    expect(sniffType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
  });

  it('strips location metadata from photos', async () => {
    const withExif = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#b87f89' } }).jpeg().withExif({ IFD0: { Copyright: 'SECRET-MARKER' } }).toBuffer();
    expect(withExif.includes(Buffer.from('SECRET-MARKER'))).toBe(true);
    const clean = await processImage(withExif);
    expect(clean.mime).toBe('image/webp');
    expect(clean.body.includes(Buffer.from('SECRET-MARKER'))).toBe(false);
  });

  it('rejects anything that is not really an image, and oversized files', async () => {
    await expect(processImage(Buffer.from('<?php evil(); ?>'))).rejects.toThrow(/JPEG, PNG or WebP/);
    await expect(processImage(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(32)]))).rejects.toThrow(/could not be read/);
    await expect(processImage(Buffer.alloc(11 * 1024 * 1024, 1))).rejects.toThrow(/10 MB/);
  });

  it('keeps customer uploads private: draft tokens are scoped, and staff need a session', async () => {
    const owner = await makeStaff(ctx, { email: 'owner@example.test' });
    const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#e8d5cf' } }).png().toBuffer();
    const form = new FormData();
    form.set('file', new File([new Uint8Array(png)], 'inspiration.png', { type: 'image/png' }));
    const uploaded = await h.app.request('/api/public/planner/uploads', { method: 'POST', body: form });
    expect(uploaded.status).toBe(201);
    const { id, draft_token } = (await uploaded.json()) as { id: string; draft_token: string };

    expect((await h.app.request(`/api/public/planner/uploads/${id}/file?token=${draft_token}`)).status).toBe(200);
    expect((await h.app.request(`/api/public/planner/uploads/${id}/file?token=${'x'.repeat(30)}`)).status).toBe(404);
    expect((await h.browser().get(`/api/admin/weddings/documents/${id}/file`)).status).toBe(401);
    const staff = await signIn(h, owner.email);
    expect((await staff.get(`/api/admin/weddings/documents/${id}/file`)).status).toBe(200);
    const doc = await ctx.db.selectFrom('wedding_documents').select('storage_key').where('id', '=', id).executeTakeFirstOrThrow();
    expect(doc.storage_key.startsWith('private/')).toBe(true);
    expect((await h.app.request(`/media/${doc.storage_key}`)).status).toBe(404);
  });
});

describe('Facebook links', () => {
  it('accepts public video links and strips tracking', () => {
    expect(normalizeFacebookUrl('https://www.facebook.com/magicalidos/videos/123456/?fbclid=abc')).toBe('https://www.facebook.com/magicalidos/videos/123456/');
    expect(normalizeFacebookUrl('https://m.facebook.com/watch/?v=999&ref=sharing')).toBe('https://www.facebook.com/watch/?v=999');
    expect(normalizeFacebookUrl('https://fb.watch/abc123/?x=1')).toBe('https://fb.watch/abc123/');
  });

  it('refuses anything else', () => {
    expect(() => normalizeFacebookUrl('http://www.facebook.com/x/videos/1')).toThrow();
    expect(() => normalizeFacebookUrl('https://evil.example/facebook.com/videos/1')).toThrow();
    expect(() => normalizeFacebookUrl('https://www.facebook.com.evil.example/videos/1')).toThrow();
    expect(() => normalizeFacebookUrl('https://www.facebook.com/magicalidos/')).toThrow(/not to a video/);
    expect(() => normalizeFacebookUrl('javascript:alert(1)')).toThrow();
  });

  it('the public page keeps working with no videos at all', async () => {
    const res = await h.browser().get('/api/public/videos');
    expect(res.status).toBe(200);
    expect(res.json.videos).toEqual([]);
    expect(res.json.facebook_url).toContain('facebook.com');
  });
});

describe('Launch readiness and safe defaults', () => {
  it('a fresh install promises nothing and is not ready to go live', async () => {
    const config = (await h.browser().get('/api/public/config')).json;
    expect(config.shop.has_products).toBe(false);
    expect(config.shop.accepting_orders).toBe(false);
    expect(config.shop.payments).toBe('test');
    expect(config.hours.confirmed).toBe(false);
    expect((await h.browser().get('/api/public/products')).json.products).toEqual([]);

    const { checks, ready_for_live } = await readinessChecks(ctx);
    expect(ready_for_live).toBe(false);
    const blockers = checks.filter((c) => c.status === 'blocker').map((c) => c.id);
    expect(blockers).toEqual(expect.arrayContaining(['payments', 'tax', 'hours', 'ordering_policy', 'catalog', 'privacy', 'launch', 'email']));
    expect(checks.find((c) => c.id === 'sms')?.status).toBe('ok');
  });

  it('warns about unsafe combinations', async () => {
    await updateSetting(ctx.db, 'general', { shop_open: true }, SYSTEM_ACTOR);
    await updateSetting(ctx.db, 'ordering', { same_day_enabled: true, same_day_cutoff: null }, SYSTEM_ACTOR);
    await makeProduct(ctx, { pickup: false, delivery: false, shipping: false });
    const { warnings, checks } = await readinessChecks(ctx);
    expect(warnings.join(' ')).toContain('no pickup or delivery times');
    expect(warnings.join(' ')).toContain('no cutoff');
    expect(warnings.join(' ')).toContain('cannot be purchased');
    expect(checks.find((c) => c.id === 'unbuyable')?.status).toBe('blocker');
  });

  it('rejects invalid settings', async () => {
    const owner = await makeStaff(ctx, { email: 'owner@example.test' });
    const staff = await signIn(h, owner.email);
    expect((await staff.put('/api/admin/settings/ordering', { same_day_cutoff: '25:99' })).status).toBe(400);
    expect((await staff.put('/api/admin/settings/ordering', { daily_order_limit: -1 })).status).toBe(400);
    expect((await staff.put('/api/admin/settings/general', { timezone: 'Mars/Olympus' })).status).toBe(400);
    expect((await staff.put('/api/admin/settings/nonsense', {})).status).toBe(404);
    expect((await staff.put('/api/admin/settings/ordering', { daily_order_limit: 15 })).status).toBe(200);
    const audit = await ctx.db.selectFrom('audit_logs').select('action').where('action', '=', 'settings.update').execute();
    expect(audit.length).toBeGreaterThan(0);
  });

  it('only an owner can approve business policies', async () => {
    await makeStaff(ctx, { roles: ['administrator'], email: 'admin@example.test' });
    const admin = await signIn(h, 'admin@example.test');
    expect((await admin.post('/api/admin/settings/ordering/approval', { approved: true })).status).toBe(400);
    const owner = await makeStaff(ctx, { roles: ['owner'], email: 'owner@example.test' });
    const boss = await signIn(h, owner.email);
    expect((await boss.post('/api/admin/settings/ordering/approval', { approved: true })).status).toBe(200);
  });

  it('team controls keep at least one owner, and a deactivated member loses access at once', async () => {
    const owner = await makeStaff(ctx, { roles: ['owner'], email: 'owner@example.test' });
    const florist = await makeStaff(ctx, { roles: ['florist'], email: 'fl@example.test' });
    const boss = await signIn(h, owner.email);
    expect((await boss.post(`/api/admin/team/${owner.staffId}/deactivate`)).status).toBe(409);
    const fl = await signIn(h, florist.email);
    expect((await fl.get('/api/admin/auth/me')).status).toBe(200);
    expect((await fl.get('/api/admin/team')).status).toBe(403);
    expect((await boss.post(`/api/admin/team/${florist.staffId}/deactivate`)).status).toBe(200);
    expect((await fl.get('/api/admin/auth/me')).status).toBe(401);
    expect((await h.browser().post('/api/admin/auth/login', { email: florist.email, password: 'correct-horse-battery-staple' })).status).toBe(401);
  });

  it('invites a team member by a single-use link', async () => {
    const owner = await makeStaff(ctx, { roles: ['owner'], email: 'owner@example.test' });
    const boss = await signIn(h, owner.email);
    const res = await boss.post('/api/admin/team/invite', { email: 'new@example.test', display_name: 'New Person', role_codes: ['florist'], capabilities: ['production'] });
    expect(res.status, res.text).toBe(201);
    await drain(ctx);
    const token = h.email.to('new@example.test')[0].text.match(/\/admin\/invite\/([\w-]+)/)![1];
    expect((await h.browser().post('/api/admin/auth/reset-password', { token, password: 'short' })).status).toBe(400);
    expect((await h.browser().post('/api/admin/auth/reset-password', { token, password: 'a-sufficiently-long-password' })).status).toBe(200);
    expect((await h.browser().post('/api/admin/auth/reset-password', { token, password: 'another-long-password-here' })).status).toBe(404);
    expect((await h.browser().post('/api/admin/auth/login', { email: 'new@example.test', password: 'a-sufficiently-long-password' })).status).toBe(200);
  });
});

describe('Message templates', () => {
  it('previews, refuses unknown placeholders, and protects STOP wording', async () => {
    const owner = await makeStaff(ctx, { email: 'owner@example.test' });
    const staff = await signIn(h, owner.email);
    const { templates } = (await staff.get('/api/admin/templates')).json;
    const email = templates.find((t: { code: string; channel: string }) => t.code === 'order_confirmation' && t.channel === 'email');
    const text = templates.find((t: { code: string; channel: string }) => t.code === 'order_confirmation' && t.channel === 'sms');
    const preview = await staff.post(`/api/admin/templates/${email.id}/preview`, {});
    expect(preview.json.subject).toContain('BL-SAMP-LE12');
    expect(preview.json.html).toContain('Sample Shop');
    expect((await staff.put(`/api/admin/templates/${email.id}`, { subject: 'Hi', body: 'Hello {{ customer.secret_field }}' })).status).toBe(400);
    expect((await staff.put(`/api/admin/templates/${text.id}`, { body: 'Hello there' })).status).toBe(400);
    expect((await staff.put(`/api/admin/templates/${email.id}`, { subject: 'Thanks!', body: 'Hi {{ customer.first_name }}' })).status).toBe(200);
    const test = await staff.post(`/api/admin/templates/${email.id}/test`, {});
    expect(test.json.sent_to).toBe(owner.email);
    await drain(ctx);
    // Payments are simulated here, so the message is labelled as a test.
    expect(h.email.to(owner.email).some((m) => m.subject === '[Test] Thanks!')).toBe(true);
    expect(h.email.sent.filter((m) => m.to !== owner.email)).toHaveLength(0);
  });

  it('a switched-off rule sends nothing', async () => {
    await ctx.db.updateTable('automation_rules').set({ enabled: false }).where('event_type', '=', 'order.paid').execute();
    const { orderId } = await order();
    await payOrder(h, orderId);
    await drain(ctx);
    expect(h.email.to('text@example.test').some((m) => m.subject.includes('We have your order'))).toBe(false);
  });
});

describe('Calendar', () => {
  it('shows everything in one place, flags conflicts, and validates a drag', async () => {
    const shop = await configureShop(ctx, { dailyOrders: 1 });
    const owner = await makeStaff(ctx, { email: 'owner@example.test' });
    const staff = await signIn(h, owner.email);
    const { orderId } = await (async () => {
      const product = await makeProduct(ctx);
      const b = h.browser();
      await b.post('/api/public/cart/items', { variant_id: product.variant_id, quantity: 1, options: {} });
      const cart = (await b.get('/api/public/cart')).json;
      const res = await b.post('/api/public/checkout', { idempotency_key: 'calendar-key-1', contact: { name: 'Cal Example', email: 'cal@example.test' }, fulfillments: [{ line_ids: [cart.lines[0].id], method: 'delivery', date: '2026-11-11', window_id: shop.windows['delivery-3'], address: { line1: '1 Example St', city: 'Saginaw', region: 'MI', postal_code: '48609' } }] });
      expect(res.status, res.text).toBe(201);
      return { orderId: res.json.order_id as string };
    })();
    await payOrder(h, orderId);

    const cal = (await staff.get('/api/admin/calendar?from=2026-11-09&to=2026-11-15')).json;
    const delivery = cal.items.find((i: { kind: string }) => i.kind === 'delivery');
    expect(delivery.conflict).toBe(true); // no driver assigned yet
    expect(delivery.movable).toBe(true);
    expect(cal.summaries.find((s: { date: string }) => s.date === '2026-11-11').orders).toBe(1);
    expect(cal.items.some((i: { kind: string }) => i.kind === 'shift')).toBe(true);

    // Sunday has no window, so the drag is refused and nothing changes.
    const refused = await staff.post('/api/admin/calendar/move', { kind: 'delivery', id: delivery.source_id, date: '2026-11-15' });
    expect(refused.status).toBe(409);
    const before = await ctx.db.selectFrom('fulfillments').select('scheduled_date').where('id', '=', delivery.source_id).executeTakeFirstOrThrow();
    expect(before.scheduled_date).toBe('2026-11-11');

    const moved = await staff.post('/api/admin/calendar/move', { kind: 'delivery', id: delivery.source_id, date: '2026-11-13' });
    expect(moved.status, moved.text).toBe(200);
    const after = await ctx.db.selectFrom('fulfillments').select('scheduled_date').where('id', '=', delivery.source_id).executeTakeFirstOrThrow();
    expect(after.scheduled_date).toBe('2026-11-13');
    const claim = await ctx.db.selectFrom('capacity_claims').select(['claim_date', 'status']).where('order_id', '=', orderId).executeTakeFirstOrThrow();
    expect(claim).toEqual({ claim_date: '2026-11-13', status: 'active' });
    await drain(ctx);
    expect(h.email.to('cal@example.test').some((m) => m.subject.includes('Updated time'))).toBe(true);

    const feed = await staff.post('/api/admin/calendar/feed-link', {});
    const path = new URL(feed.json.url).pathname;
    const ics = await h.app.request(path);
    expect(ics.headers.get('content-type')).toContain('text/calendar');
    const text = await ics.text();
    expect(text).toContain('BEGIN:VCALENDAR');
    expect(text).not.toContain('cal@example.test');
    expect((await h.app.request('/api/calendar/feed/not-a-real-token.ics')).status).toBe(404);
  });
});

describe('Inventory operations', () => {
  it('records waste, low stock alerts once per dip, and full movement history', async () => {
    const owner = await makeStaff(ctx, { email: 'owner@example.test' });
    const staff = await signIn(h, owner.email);
    const item = await staff.post('/api/admin/inventory/items', { sku: 'STEM-1', name: 'Fictional Stem', kind: 'material', unit: 'stem', low_stock_threshold: 5, perishable: true });
    expect(item.status, item.text).toBe(201);
    const id = item.json.id;
    expect((await staff.post(`/api/admin/inventory/items/${id}/adjust`, { delta: 20, reason: 'receive', best_by: '2026-11-11' })).status).toBe(200);
    expect((await staff.post(`/api/admin/inventory/items/${id}/adjust`, { delta: 5, reason: 'waste' })).status).toBe(400);
    expect((await staff.post(`/api/admin/inventory/items/${id}/adjust`, { delta: -100, reason: 'waste' })).status).toBe(400);
    expect((await staff.post(`/api/admin/inventory/items/${id}/adjust`, { delta: -16, reason: 'spoilage', note: 'Wilted' })).status).toBe(200);
    expect((await staff.post(`/api/admin/inventory/items/${id}/adjust`, { delta: -1, reason: 'waste' })).status).toBe(200);
    const detail = (await staff.get(`/api/admin/inventory/items/${id}`)).json;
    expect(detail.levels[0].on_hand).toBe(3);
    expect(detail.movements).toHaveLength(3);
    expect(detail.lots).toHaveLength(1);
    await drain(ctx);
    expect(h.email.to(owner.email).filter((m) => m.subject.includes('Low stock'))).toHaveLength(1);
    expect((await staff.post(`/api/admin/inventory/items/${id}/adjust`, { delta: 10, reason: 'receive' })).status).toBe(200);
    expect(await ctx.db.selectFrom('low_stock_events').select('id').where('resolved_at', 'is', null).execute()).toHaveLength(0);
  });

  it('runs purchasing from suggestion to received stock', async () => {
    const owner = await makeStaff(ctx, { email: 'owner@example.test' });
    const staff = await signIn(h, owner.email);
    const supplier = await staff.post('/api/admin/inventory/suppliers', { name: 'Fictional Growers', lead_time_days: 3 });
    const item = await staff.post('/api/admin/inventory/items', { sku: 'ROSE-1', name: 'Fictional Rose', kind: 'material', unit: 'stem', low_stock_threshold: 10, reorder_quantity: 50, default_supplier_id: supplier.json.id });
    const suggestions = (await staff.get('/api/admin/inventory/purchasing-suggestions')).json;
    expect(suggestions.note).toContain('Supplier stock is not visible');
    const line = suggestions.suggestions.find((s: { id: string }) => s.id === item.json.id);
    expect(line.suggested_quantity).toBe(50);
    const po = await staff.post('/api/admin/inventory/purchase-orders', { supplier_id: supplier.json.id, lines: [{ item_id: item.json.id, quantity: 50 }] });
    expect(po.status, po.text).toBe(201);
    const list = (await staff.get('/api/admin/inventory/purchase-orders')).json.purchase_orders;
    const lineId = list[0].lines[0].id;
    expect((await staff.post(`/api/admin/inventory/purchase-orders/${po.json.id}/receive`, { lines: [{ line_id: lineId, quantity: 60 }] })).status).toBe(400);
    expect((await staff.post(`/api/admin/inventory/purchase-orders/${po.json.id}/receive`, { lines: [{ line_id: lineId, quantity: 20 }] })).status).toBe(200);
    expect((await ctx.db.selectFrom('purchase_orders').select('status').executeTakeFirstOrThrow()).status).toBe('partially_received');
    expect((await staff.post(`/api/admin/inventory/purchase-orders/${po.json.id}/receive`, { lines: [{ line_id: lineId, quantity: 30 }] })).status).toBe(200);
    expect((await ctx.db.selectFrom('purchase_orders').select('status').executeTakeFirstOrThrow()).status).toBe('received');
    expect((await ctx.db.selectFrom('inventory_levels').select('on_hand').where('item_id', '=', item.json.id).executeTakeFirstOrThrow()).on_hand).toBe(50);
  });

  it('substitutes only where a rule allows it, moving stock with the approval', async () => {
    const shop = await configureShop(ctx);
    const owner = await makeStaff(ctx, { email: 'owner@example.test' });
    const staff = await signIn(h, owner.email);
    const product = await makeProduct(ctx, { stock: null, name: 'Recipe Bouquet' });
    const location = (await ctx.db.selectFrom('inventory_locations').select('id').where('is_default', '=', true).executeTakeFirstOrThrow()).id;
    const make = async (sku: string, qty: number) => {
      const i = await ctx.db.insertInto('inventory_items').values({ sku, name: sku, kind: 'material' }).returning('id').executeTakeFirstOrThrow();
      await ctx.db.insertInto('inventory_levels').values({ item_id: i.id, location_id: location, on_hand: qty }).execute();
      return i.id;
    };
    const rose = await make('ROSE', 10);
    const peony = await make('PEONY', 10);
    const tulip = await make('TULIP', 10);
    const recipe = await ctx.db.insertInto('product_recipes').values({ product_id: product.id }).returning('id').executeTakeFirstOrThrow();
    const comp = await ctx.db.insertInto('recipe_components').values({ recipe_id: recipe.id, item_id: rose, quantity: 5 }).returning('id').executeTakeFirstOrThrow();
    await ctx.db.insertInto('recipe_substitutes').values({ component_id: comp.id, item_id: peony, quantity: 3 }).execute();
    const b = h.browser();
    await b.post('/api/public/cart/items', { variant_id: product.variant_id, quantity: 1, options: {} });
    const cart = (await b.get('/api/public/cart')).json;
    const res = await b.post('/api/public/checkout', { idempotency_key: 'substitute-key-1', contact: { name: 'Sub Example', email: 'sub@example.test' }, fulfillments: [{ line_ids: [cart.lines[0].id], method: 'pickup', date: '2026-11-11', window_id: shop.windows['pickup-3'] }] });
    await payOrder(h, res.json.order_id);
    const item = await ctx.db.selectFrom('order_items').select('id').where('order_id', '=', res.json.order_id).executeTakeFirstOrThrow();
    expect((await staff.post('/api/admin/inventory/substitute', { order_item_id: item.id, component_id: comp.id, substitute_item_id: tulip })).status).toBe(409);
    expect((await staff.post('/api/admin/inventory/substitute', { order_item_id: item.id, component_id: comp.id, substitute_item_id: peony })).status).toBe(200);
    const level = (id: string) => ctx.db.selectFrom('inventory_levels').select('reserved').where('item_id', '=', id).executeTakeFirstOrThrow();
    expect((await level(rose)).reserved).toBe(0);
    expect((await level(peony)).reserved).toBe(3);
  });
});

describe('Reports', () => {
  it('computes from real records, separates test data, and labels definitions', async () => {
    const owner = await makeStaff(ctx, { email: 'owner@example.test' });
    const boss = await signIn(h, owner.email);
    const { orderId } = await order();
    await payOrder(h, orderId);
    await boss.post(`/api/admin/orders/${orderId}/refund`, { amount_cents: 1000, reason: 'Goodwill' });

    const included = (await boss.get('/api/admin/reports/sales?from=2026-11-01&to=2026-11-30&include_test=true')).json;
    expect(included.orders).toBe(1);
    expect(included.refunds_cents).toBe(1000);
    expect(included.net_cents).toBe(included.gross_cents - 1000);
    expect(included.definitions.profit).toContain('Not shown');
    const excluded = (await boss.get('/api/admin/reports/sales?from=2026-11-01&to=2026-11-30&include_test=false')).json;
    expect(excluded.orders).toBe(0);
    const csv = await boss.get('/api/admin/reports/sales.csv?from=2026-11-01&to=2026-11-30&include_test=true');
    expect(csv.text).toContain('Net sales');
    const florist = await makeStaff(ctx, { roles: ['florist'], email: 'fl2@example.test' });
    const fl = await signIn(h, florist.email);
    expect((await fl.get('/api/admin/reports/sales?from=2026-11-01&to=2026-11-30')).status).toBe(403);
  });

  it('the overview never shows invented numbers', async () => {
    const owner = await makeStaff(ctx, { email: 'owner@example.test' });
    const boss = await signIn(h, owner.email);
    const empty = (await boss.get('/api/admin/overview')).json;
    expect(empty.orders.today).toBe(0);
    expect(empty.orders.paid_today).toBe(0);
    expect(empty.weddings.pending).toBe(0);
    expect(empty.deliveries).toEqual([]);
  });
});

describe('Health', () => {
  it('reports liveness and readiness without details', async () => {
    expect((await h.app.request('/healthz')).status).toBe(200);
    const notReady = await h.app.request('/readyz');
    expect(notReady.status).toBe(503);
    await ctx.db.insertInto('worker_heartbeats').values({ worker_id: 'w1', last_seen_at: h.clock.now() }).execute();
    expect((await h.app.request('/readyz')).status).toBe(200);
  });

  it('sets security headers and never exposes unknown API routes as the app', async () => {
    const res = await h.app.request('/api/public/config');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect((await h.app.request('/api/nope')).status).toBe(404);
  });

  it('the simulated gateway routes do not exist when payments are real or disabled', () => {
    const env = loadEnv({ APP_ENV: 'test', PAYMENTS_MODE: 'disabled' });
    expect(env.PAYMENTS_MODE).toBe('disabled');
  });
});

describe('Google Calendar push', () => {
  const google = { GOOGLE_CALENDAR_ID: 'calendar@example.test', GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_REFRESH_TOKEN: 'token' };
  const event = async (type: string) =>
    (await ctx.db.insertInto('automation_events').values({ type, subject_type: 'booking', subject_id: '00000000-0000-4000-8000-000000000001' }).returning('id').executeTakeFirstOrThrow()).id;
  const pushJobs = () => ctx.db.selectFrom('automation_jobs').select('payload').where('kind', '=', 'calendar.push').execute();

  it('queues nothing unless Google is configured', async () => {
    expect(await queueCalendarPush(ctx, await event('booking.confirmed'))).toBe(false);
    expect(await pushJobs()).toHaveLength(0);
  });

  it('queues a push for booking changes only, once per event', async () => {
    const configured = { ...ctx, env: { ...ctx.env, ...google } };
    const id = await event('booking.confirmed');
    expect(await queueCalendarPush(configured, id)).toBe(true);
    await queueCalendarPush(configured, id);
    const jobs = await pushJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].payload).toEqual({ source_type: 'booking', source_id: '00000000-0000-4000-8000-000000000001' });

    expect(await queueCalendarPush(configured, await event('order.created'))).toBe(false);
    expect(await pushJobs()).toHaveLength(1);
  });
});

describe('Request limits', () => {
  it('refuses an oversized JSON body before it reaches a route', async () => {
    const b = h.browser();
    const res = await b.post('/api/public/contact', { name: 'Big Example', email: 'big@example.test', topic: 'general', message: 'x'.repeat(1_100_000) });
    expect(res.status).toBe(413);
    expect(res.json.error.code).toBe('too_large');
  });
});

describe('Out of stock follows the owner setting', () => {
  it('shows sold out only when the rule stops the sale', async () => {
    await configureShop(ctx);
    const product = await makeProduct(ctx, { name: 'Last Candle', stock: 0, shipping: true });
    const b = h.browser();
    const listed = async () => (await b.get('/api/public/products')).json.products.find((p: { slug: string }) => p.slug === product.slug);
    const detail = async () => (await b.get(`/api/public/products/${product.slug}`)).json;

    expect((await listed()).sold_out).toBe(true);
    expect((await detail()).out_of_stock_behavior).toBe('reject');

    await updateSetting(ctx.db, 'ordering', { out_of_stock_behavior: 'review' }, SYSTEM_ACTOR);
    expect((await listed()).sold_out).toBe(false);
    expect((await detail()).out_of_stock_behavior).toBe('review');

    // A product's own rule wins over the shop's.
    await ctx.db.updateTable('products').set({ out_of_stock_behavior: 'reject' }).where('id', '=', product.id).execute();
    expect((await listed()).sold_out).toBe(true);
    expect((await detail()).out_of_stock_behavior).toBe('reject');
  });
});

describe('Record integrity checks', () => {
  it('passes on a normal order, and catches records that disagree', async () => {
    const shop = await configureShop(ctx);
    const product = await makeProduct(ctx, { stock: 5 });
    const b = h.browser();
    await b.post('/api/public/cart/items', { variant_id: product.variant_id, quantity: 2, options: {} });
    const cart = (await b.get('/api/public/cart')).json;
    const res = await b.post('/api/public/checkout', {
      idempotency_key: `k-${Math.random()}`,
      contact: { name: 'Integrity Example', email: 'integrity@example.test' },
      fulfillments: [{ line_ids: cart.lines.map((l: { id: string }) => l.id), method: 'pickup', date: '2026-11-11', window_id: shop.windows[`pickup-${weekdayOf('2026-11-11')}`] }],
    });
    expect(res.status, res.text).toBe(201);
    await payOrder(h, res.json.order_id);
    await drain(ctx);

    const healthy = await checkIntegrity(ctx.db);
    expect(healthy.checks.filter((c) => c.violations > 0).map((c) => c.id)).toEqual([]);
    expect(healthy.ok).toBe(true);

    await ctx.db.updateTable('inventory_levels').set({ on_hand: 99 }).where('item_id', '=', product.item_id as string).execute();
    await ctx.db.updateTable('orders').set({ paid_cents: 1 }).where('id', '=', res.json.order_id).execute();
    const broken = await checkIntegrity(ctx.db);
    expect(broken.ok).toBe(false);
    expect(broken.checks.filter((c) => c.violations > 0).map((c) => c.id).sort()).toEqual(['order_paid_matches_payments', 'stock_matches_movements']);
  });
});

describe('Staff assignments', () => {
  it('assigns people to an order, warns about days off, and respects roles', async () => {
    const shop = await configureShop(ctx);
    const owner = await makeStaff(ctx, { roles: ['owner'], email: 'owner@example.test' });
    const product = await makeProduct(ctx);
    const b = h.browser();
    await b.post('/api/public/cart/items', { variant_id: product.variant_id, quantity: 1, options: {} });
    const cart = (await b.get('/api/public/cart')).json;
    const placed = await b.post('/api/public/checkout', {
      idempotency_key: `k-${Math.random()}`,
      contact: { name: 'Assign Example', email: 'assign@example.test' },
      fulfillments: [{ line_ids: cart.lines.map((l: { id: string }) => l.id), method: 'pickup', date: '2026-11-11', window_id: shop.windows[`pickup-${weekdayOf('2026-11-11')}`] }],
    });
    const orderId = placed.json.order_id as string;
    const staff = await signIn(h, owner.email);
    const assign = (staffId: string) => staff.post('/api/admin/assignments', { subject_type: 'order', subject_id: orderId, staff_id: staffId, role: 'lead' });

    const ok = await assign(shop.florist.staffId as string);
    expect(ok.status, ok.text).toBe(201);
    expect(ok.json.warning).toBeNull();

    await ctx.db.insertInto('staff_time_off').values({ staff_id: shop.driver.staffId as string, starts_on: '2026-11-11', ends_on: '2026-11-11', kind: 'vacation' }).execute();
    const off = await assign(shop.driver.staffId as string);
    expect(off.status).toBe(201);
    expect(off.json.warning).toContain('off on 2026-11-11');

    const list = (await staff.get(`/api/admin/assignments?subject_type=order&subject_id=${orderId}`)).json;
    expect(list.assignments.map((a: { display_name: string }) => a.display_name).sort()).toEqual(['Drew Driver', 'Fiona Florist']);

    // The team filter on the calendar follows the assignment.
    await payOrder(h, orderId);
    const forFlorist = (await staff.get(`/api/admin/calendar?from=2026-11-11&to=2026-11-11&kinds=pickup&staff_id=${shop.florist.staffId}`)).json;
    expect(forFlorist.items).toHaveLength(1);
    expect(forFlorist.items[0].detail).toContain('Fiona Florist');
    const forOwner = (await staff.get(`/api/admin/calendar?from=2026-11-11&to=2026-11-11&kinds=pickup&staff_id=${owner.staffId}`)).json;
    expect(forOwner.items).toHaveLength(0);

    const driver = await signIn(h, shop.driver.email);
    expect((await driver.post('/api/admin/assignments', { subject_type: 'order', subject_id: orderId, staff_id: shop.driver.staffId })).status).toBe(403);
    expect((await driver.delete(`/api/admin/assignments/${list.assignments[0].id}`)).status).toBe(403);

    expect((await staff.delete(`/api/admin/assignments/${list.assignments[0].id}`)).status).toBe(200);
    expect((await staff.get(`/api/admin/assignments?subject_type=order&subject_id=${orderId}`)).json.assignments).toHaveLength(1);
  });
});

describe('Returns', () => {
  it('restocks, tracks the item, and closes the order as returned when everything is back', async () => {
    const shop = await configureShop(ctx);
    const owner = await makeStaff(ctx, { roles: ['owner'], email: 'owner@example.test' });
    const product = await makeProduct(ctx, { stock: 5, division: 'boutique' });
    const b = h.browser();
    await b.post('/api/public/cart/items', { variant_id: product.variant_id, quantity: 2, options: {} });
    const cart = (await b.get('/api/public/cart')).json;
    const placed = await b.post('/api/public/checkout', {
      idempotency_key: `k-${Math.random()}`,
      contact: { name: 'Return Example', email: 'return@example.test' },
      fulfillments: [{ line_ids: cart.lines.map((l: { id: string }) => l.id), method: 'pickup', date: '2026-11-11', window_id: shop.windows[`pickup-${weekdayOf('2026-11-11')}`] }],
    });
    const orderId = placed.json.order_id as string;
    await payOrder(h, orderId);
    const staff = await signIn(h, owner.email);
    const item = await ctx.db.selectFrom('order_items').select('id').where('order_id', '=', orderId).executeTakeFirstOrThrow();
    expect((await staff.post(`/api/admin/orders/${orderId}/items/status`, { item_ids: [item.id], status: 'fulfilled' })).status).toBe(200);
    const stock = async () => (await ctx.db.selectFrom('inventory_levels').select('on_hand').where('item_id', '=', product.item_id as string).executeTakeFirstOrThrow()).on_hand;
    expect(await stock()).toBe(3);

    // Part of it comes back: stock returns, the order stays fulfilled.
    const part = await staff.post(`/api/admin/orders/${orderId}/returns`, { order_item_id: item.id, quantity: 1, reason: 'Wrong size', restock: true });
    expect(part.status, part.text).toBe(201);
    expect(await stock()).toBe(4);
    expect((await ctx.db.selectFrom('orders').select('status').where('id', '=', orderId).executeTakeFirstOrThrow()).status).toBe('fulfilled');

    // A full return moves the item and the order.
    const full = await staff.post(`/api/admin/orders/${orderId}/returns`, { order_item_id: item.id, quantity: 2, reason: 'Changed their mind', restock: false });
    expect(full.status, full.text).toBe(201);
    expect(await stock()).toBe(4);
    expect((await ctx.db.selectFrom('order_items').select('status').where('id', '=', item.id).executeTakeFirstOrThrow()).status).toBe('returned');
    expect((await ctx.db.selectFrom('orders').select('status').where('id', '=', orderId).executeTakeFirstOrThrow()).status).toBe('returned');
    // A return moves no money by itself.
    expect((await ctx.db.selectFrom('orders').select('refunded_cents').where('id', '=', orderId).executeTakeFirstOrThrow()).refunded_cents).toBe(0);
  });
});

describe('Client addresses behind a proxy', () => {
  const statuses = async (env: Record<string, string>, headersFor: (i: number) => Record<string, string>) => {
    const proxied = createHarness({ now: '2026-11-10T16:00:00Z', env });
    await resetDb(proxied.ctx);
    const b = proxied.browser();
    const out: number[] = [];
    for (let i = 0; i < 10; i++) out.push((await b.post('/api/public/track/lookup', { reference: `BL-${i}`, email: `probe-${i}@example.test` }, headersFor(i))).status);
    await proxied.ctx.db.destroy();
    return out;
  };

  it('with one proxy, the address it appended is what counts', async () => {
    // Different real clients, as seen by the proxy, each have their own allowance.
    expect(await statuses({ TRUST_PROXY: 'true' }, (i) => ({ 'x-forwarded-for': `203.0.113.${i}` }))).not.toContain(429);
  });

  it('a client cannot dodge rate limits by inventing an X-Forwarded-For', async () => {
    const result = await statuses({ TRUST_PROXY: 'true' }, (i) => ({ 'x-forwarded-for': `10.0.0.${i}, 203.0.113.7` }));
    expect(result).toContain(429);
  });

  it('a client cannot dodge rate limits with a Cloudflare header unless Cloudflare is configured', async () => {
    const result = await statuses({ TRUST_PROXY: 'true' }, (i) => ({ 'cf-connecting-ip': `198.51.100.${i}`, 'x-forwarded-for': '203.0.113.8' }));
    expect(result).toContain(429);
  });

  it('with Cloudflare configured, its header is what counts', async () => {
    expect(await statuses({ TRUST_PROXY: 'cloudflare' }, (i) => ({ 'cf-connecting-ip': `198.51.100.${i}` }))).not.toContain(429);
    expect(await statuses({ TRUST_PROXY: 'cloudflare' }, (i) => ({ 'cf-connecting-ip': '198.51.100.9', 'x-forwarded-for': `10.0.0.${i}` }))).toContain(429);
  });
});

describe('Idempotency keys', () => {
  it('a key used on another cart returns nothing about that order', async () => {
    const shop = await configureShop(ctx);
    const product = await makeProduct(ctx);
    const body = (lineIds: string[]) => ({
      idempotency_key: 'shared-key-from-somewhere',
      contact: { name: 'Key Example', email: 'key@example.test' },
      fulfillments: [{ line_ids: lineIds, method: 'pickup', date: '2026-11-11', window_id: shop.windows[`pickup-${weekdayOf('2026-11-11')}`] }],
    });
    const place = async (b: ReturnType<typeof h.browser>) => {
      await b.post('/api/public/cart/items', { variant_id: product.variant_id, quantity: 1, options: {} });
      const cart = (await b.get('/api/public/cart')).json;
      return b.post('/api/public/checkout', body(cart.lines.map((l: { id: string }) => l.id)));
    };
    const first = h.browser();
    const original = await place(first);
    expect(original.status, original.text).toBe(201);

    const other = await place(h.browser());
    expect(other.status).toBe(409);
    expect(other.json.error.code).toBe('idempotency_conflict');
    expect(other.text).not.toContain(original.json.tracking_token);
    expect(other.text).not.toContain(original.json.order_id);
    expect(await ctx.db.selectFrom('orders').select('id').execute()).toHaveLength(1);
  });

  it('a planner key used with another email address returns nothing about that plan', async () => {
    const plan = (email: string) => ({ idempotency_key: 'shared-plan-key-1', contact: { name: 'Plan Example', email }, event_type: 'Wedding', event_date: '2027-08-14', ceremony_time: '15:00', style: {}, selections: [] });
    const first = await h.browser().post('/api/public/planner/submit', plan('plan-a@example.test'));
    expect(first.status, first.text).toBe(201);
    const retry = await h.browser().post('/api/public/planner/submit', plan('plan-a@example.test'));
    expect(retry.json.reference).toBe(first.json.reference);
    const other = await h.browser().post('/api/public/planner/submit', plan('plan-b@example.test'));
    expect(other.status).toBe(409);
    expect(other.text).not.toContain(first.json.reference);
  });
});

describe('Dashboard operations', () => {
  async function paidOrder() {
    const shop = await configureShop(ctx);
    const owner = await makeStaff(ctx, { roles: ['owner'], email: 'owner@example.test' });
    const product = await makeProduct(ctx, { stock: 5 });
    const b = h.browser();
    await b.post('/api/public/cart/items', { variant_id: product.variant_id, quantity: 1, options: {} });
    const cart = (await b.get('/api/public/cart')).json;
    const placed = await b.post('/api/public/checkout', {
      idempotency_key: `k-${Math.random()}`,
      contact: { name: 'Ops Example', email: 'ops@example.test' },
      fulfillments: [{ line_ids: cart.lines.map((l: { id: string }) => l.id), method: 'pickup', date: '2026-11-11', window_id: shop.windows[`pickup-${weekdayOf('2026-11-11')}`] }],
    });
    expect(placed.status, placed.text).toBe(201);
    await payOrder(h, placed.json.order_id);
    return { shop, owner, product, orderId: placed.json.order_id as string, staff: await signIn(h, owner.email) };
  }

  it('offers windows for a fulfilment, moves it through the rules, and refuses closed days', async () => {
    const { shop, orderId, staff } = await paidOrder();
    const f = await ctx.db.selectFrom('fulfillments').select('id').where('order_id', '=', orderId).executeTakeFirstOrThrow();
    const windows = (await staff.get(`/api/admin/fulfillments/${f.id}/windows`)).json.windows;
    expect(windows.length).toBe(6);

    const moved = await staff.post(`/api/admin/fulfillments/${f.id}/reschedule`, { date: '2026-11-12', window_id: shop.windows[`pickup-${weekdayOf('2026-11-12')}`] });
    expect(moved.status, moved.text).toBe(200);
    expect((await ctx.db.selectFrom('fulfillments').select('scheduled_date').where('id', '=', f.id).executeTakeFirstOrThrow()).scheduled_date).toBe('2026-11-12');

    await staff.post('/api/admin/blackouts', { starts_on: '2026-11-13', ends_on: '2026-11-13', reason: 'closure', affects: [] });
    const refused = await staff.post(`/api/admin/fulfillments/${f.id}/reschedule`, { date: '2026-11-13', window_id: shop.windows[`pickup-${weekdayOf('2026-11-13')}`] });
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect((await ctx.db.selectFrom('fulfillments').select('scheduled_date').where('id', '=', f.id).executeTakeFirstOrThrow()).scheduled_date).toBe('2026-11-12');
  });

  it('a closure for one department leaves the others open', async () => {
    const { shop, staff } = await paidOrder();
    const divisions = (await staff.get('/api/admin/catalog/meta')).json.divisions as Array<{ id: string; code: string }>;
    const boutique = divisions.find((d) => d.code === 'boutique')?.id;
    expect((await staff.post('/api/admin/blackouts', { scope: 'division', division_id: boutique, starts_on: '2026-11-13', ends_on: '2026-11-13', reason: 'special_event', affects: [] })).status).toBe(201);

    const slotsFor = async (division: 'floral' | 'boutique') => {
      const product = await makeProduct(ctx, { division, name: `${division} check` });
      const b = h.browser();
      await b.post('/api/public/cart/items', { variant_id: product.variant_id, quantity: 1, options: {} });
      const cart = (await b.get('/api/public/cart')).json;
      const res = await b.post('/api/public/availability/slots', { method: 'pickup', postal_code: null, line_ids: cart.lines.map((l: { id: string }) => l.id) });
      return (res.json.slots as Array<{ date: string; window_id: string; status: string }>).find((s) => s.date === '2026-11-13' && s.window_id === shop.windows[`pickup-${weekdayOf('2026-11-13')}`]);
    };
    expect((await slotsFor('boutique'))?.status).toBe('blocked');
    expect((await slotsFor('floral'))?.status).toBe('open');
  });

  it('lists approved substitutes and swaps stock only for those', async () => {
    const { orderId, product, staff } = await paidOrder();
    const location = (await ctx.db.selectFrom('inventory_locations').select('id').where('is_default', '=', true).executeTakeFirstOrThrow()).id;
    const makeItem = async (sku: string, onHand: number) => {
      const item = await ctx.db.insertInto('inventory_items').values({ sku, name: sku, kind: 'material' }).returning('id').executeTakeFirstOrThrow();
      await ctx.db.insertInto('inventory_levels').values({ item_id: item.id, location_id: location }).execute();
      if (onHand) await changeStock(ctx.db, { item_id: item.id, delta: onHand, reason: 'receive' }, SYSTEM_ACTOR);
      return item.id;
    };
    const rose = await makeItem('ROSE', 5);
    const lily = await makeItem('LILY', 5);
    const recipe = await ctx.db.insertInto('product_recipes').values({ product_id: product.id }).returning('id').executeTakeFirstOrThrow();
    const component = await ctx.db.insertInto('recipe_components').values({ recipe_id: recipe.id, item_id: rose, quantity: 2 }).returning('id').executeTakeFirstOrThrow();
    await ctx.db.insertInto('recipe_substitutes').values({ component_id: component.id, item_id: lily, quantity: 3 }).execute();
    const item = await ctx.db.selectFrom('order_items').select('id').where('order_id', '=', orderId).executeTakeFirstOrThrow();

    const list = (await staff.get(`/api/admin/inventory/substitutes?order_item_id=${item.id}`)).json.substitutes;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ substitute_name: 'LILY', needed: 3, available: 5 });

    const ok = await staff.post('/api/admin/inventory/substitute', { order_item_id: item.id, component_id: component.id, substitute_item_id: lily });
    expect(ok.status, ok.text).toBe(200);
    const level = await ctx.db.selectFrom('inventory_levels').select('reserved').where('item_id', '=', lily).executeTakeFirstOrThrow();
    expect(level.reserved).toBe(3);

    const unapproved = await staff.post('/api/admin/inventory/substitute', { order_item_id: item.id, component_id: component.id, substitute_item_id: rose });
    expect(unapproved.status).toBe(409);
  });

  it('only owners edit roles, the owner role is locked, and permissions take effect', async () => {
    const { shop, staff } = await paidOrder();
    const team = (await staff.get('/api/admin/team')).json;
    const florist = team.roles.find((r: { code: string }) => r.code === 'florist');
    const owner = team.roles.find((r: { code: string }) => r.code === 'owner');
    expect((await staff.put(`/api/admin/roles/${owner.id}/permissions`, { permissions: [] })).status).toBe(409);

    const flo = await signIn(h, shop.florist.email);
    expect((await flo.put(`/api/admin/roles/${florist.id}/permissions`, { permissions: ['orders.refund'] })).status).toBe(403);
    expect((await flo.get('/api/admin/calendar?from=2026-11-11&to=2026-11-11')).status).toBe(200);

    expect((await staff.put(`/api/admin/roles/${florist.id}/permissions`, { permissions: florist.permissions.filter((p: string) => p !== 'calendar.view') })).status).toBe(200);
    expect((await flo.get('/api/admin/calendar?from=2026-11-11&to=2026-11-11')).status).toBe(403);
  });

  it('adds a department and a stock location', async () => {
    const { staff } = await paidOrder();
    const created = await staff.post('/api/admin/catalog/divisions', { name: 'Gift Registry', description: null });
    expect(created.status, created.text).toBe(201);
    expect((await staff.get('/api/admin/catalog/meta')).json.divisions.map((d: { name: string }) => d.name)).toContain('Gift Registry');
    expect((await staff.post('/api/admin/inventory/locations', { name: 'Cooler' })).status).toBe(201);
    expect((await staff.get('/api/admin/inventory/locations')).json.locations.map((l: { name: string }) => l.name)).toContain('Cooler');
  });
});

describe('Launch checklist records', () => {
  it('records a tested restore, for owners only, and asks again after 90 days', async () => {
    const owner = await makeStaff(ctx, { roles: ['owner'], email: 'owner@example.test' });
    const finance = await makeStaff(ctx, { roles: ['administrator'], email: 'admin@example.test' });
    let staff = await signIn(h, owner.email);
    const backups = async () => {
      const res = await staff.get('/api/admin/readiness');
      expect(res.status, res.text).toBe(200);
      return res.json.checks.find((c: { id: string }) => c.id === 'backups');
    };
    expect((await backups()).status).toBe('todo');

    const admin = await signIn(h, finance.email);
    expect((await admin.post('/api/admin/readiness/backups', {})).status).toBe(403);
    expect((await staff.post('/api/admin/readiness/backups', {})).status).toBe(200);
    expect((await backups()).status).toBe('ok');

    h.clock.set('2027-03-01T16:00:00Z');
    // Months later the old session has expired too, so sign in again.
    staff = await signIn(h, owner.email);
    const stale = await backups();
    expect(stale.status).toBe('todo');
    expect(stale.detail).toContain('more than 90 days');
  });
});

describe('Message allowlist outside production', () => {
  it('matches exact addresses and whole reserved domains, and nothing else', () => {
    const env = loadEnv({ APP_ENV: 'test', DATABASE_URL: 'postgres://unused', MESSAGE_ALLOWLIST: 'Tester@Example.com, @demo.example, +19895550100' });
    expect(isAllowlisted(env, 'tester@example.com')).toBe(true);
    expect(isAllowlisted(env, 'riley@demo.example')).toBe(true);
    expect(isAllowlisted(env, 'RILEY@DEMO.EXAMPLE')).toBe(true);
    expect(isAllowlisted(env, '+19895550100')).toBe(true);
    expect(isAllowlisted(env, '@demo.example')).toBe(false);
    expect(isAllowlisted(env, 'someone@notdemo.example.com')).toBe(false);
    expect(isAllowlisted(env, 'owner@realbusiness.com')).toBe(false);
    expect(isAllowlisted(loadEnv({ APP_ENV: 'test', DATABASE_URL: 'postgres://unused' }), 'anyone@demo.example')).toBe(false);
  });

  it('labels every message tied to test data', async () => {
    await configureShop(ctx);
    const product = await makeProduct(ctx);
    const b = h.browser();
    await b.post('/api/public/cart/items', { variant_id: product.variant_id, quantity: 1, options: {} });
    await b.post('/api/public/contact', { name: 'Label Example', email: 'label@example.test', topic: 'general', message: 'Do you deliver on Sundays?' });
    await drain(ctx);
    const mail = h.email.sent.find((m) => m.to === 'label@example.test');
    expect(mail?.subject.startsWith('[Test] ')).toBe(true);
    expect(mail?.text.startsWith('TEST MESSAGE')).toBe(true);
    expect(mail?.html).toContain('Test message.');
  });
});

describe('Record check for rentals', () => {
  it('counts reservations that start together once each, and still catches real overbooking', async () => {
    const arch = await ctx.db.insertInto('rental_items').values({ name: 'Check Arch', quantity: 2, cleaning_buffer_minutes: 60 }).returning('id').executeTakeFirstOrThrow();
    const start = new Date('2027-01-16T16:00:00Z');
    const end = new Date('2027-01-17T04:00:00Z');
    for (let i = 0; i < 2; i++) {
      await ctx.db.insertInto('rental_reservations').values({ rental_item_id: arch.id, quantity: 1, starts_at: start, ends_at: end, buffer_minutes: 60, blocked_until: new Date(end.getTime() + 3_600_000), status: 'confirmed' }).execute();
    }
    const rentalCheck = async () => (await checkIntegrity(ctx.db)).checks.find((c) => c.id === 'rentals_within_quantity');
    expect((await rentalCheck())?.violations).toBe(0);

    // Owning fewer than are booked is exactly what the check exists to catch.
    await ctx.db.updateTable('rental_items').set({ quantity: 1 }).where('id', '=', arch.id).execute();
    expect((await rentalCheck())?.violations).toBe(1);
  });
});

describe('Spreadsheet import', () => {
  const header = 'name,department,category,variant,sku,price,sale_price,cost,stock,low_stock_alert,prep_minutes,workload_points,min_notice_hours,pickup,delivery,shipping,tax_category,short_description,description,status';
  const file = (...rows: string[]) => [header, ...rows].join('\r\n');

  it('reads quoted fields, commas, line breaks and a byte-order mark', () => {
    expect(parseCsv('\uFEFFa,b\r\n"one, two","say ""hi""\nagain"\r\n')).toEqual([['a', 'b'], ['one, two', 'say "hi"\nagain']]);
    expect(parseCsv(templateCsv())[0][0]).toBe('name');
  });

  it('checks every row, reports problems by line, and writes nothing until the whole file is valid', async () => {
    await configureShop(ctx);
    const owner = await makeStaff(ctx, { roles: ['owner'], email: 'owner@example.test' });
    const staff = await signIn(h, owner.email);
    const bad = file(
      'Spring Tulips,Floral,Bouquets,Standard,TUL-1,45,,,10,2,20,2,0,yes,yes,no,,Fresh tulips,,draft',
      'Spring Tulips,Floral,Bouquets,Large,TUL-1,65,,,,,,,,yes,yes,no,,,,draft',
      'Mystery Box,Groceries,,Standard,MB-1,ten,,,,,,,,maybe,,,,,,',
    );
    const checked = (await staff.post('/api/admin/catalog/import', { csv: bad, dry_run: false })).json;
    expect(checked.ok).toBe(false);
    const messages = checked.errors.map((e: { line: number; message: string }) => `${e.line}: ${e.message}`).join(' | ');
    expect(messages).toContain('3: SKU TUL-1 is also on line 2');
    expect(messages).toContain('4: Price must be an amount in dollars');
    expect(messages).toContain('4: Pickup must be yes or no');
    expect(await ctx.db.selectFrom('products').select('id').where('name', '=', 'Spring Tulips').execute()).toHaveLength(0);

    const good = file(
      'Spring Tulips,Floral,Spring Specials,Standard,TUL-1,45,,18,10,2,20,2,0,yes,yes,no,,Fresh tulips,,draft',
      'Spring Tulips,Floral,Spring Specials,Large,TUL-2,65,55,26,4,2,30,3,0,yes,yes,no,,,,draft',
      '"Linen Napkins, set of 4",Boutique,,Natural,NAP-1,$32.00,,,,,,,,yes,no,yes,,,,active',
    );
    const preview = (await staff.post('/api/admin/catalog/import', { csv: good, dry_run: true })).json;
    expect(preview).toMatchObject({ ok: true, dry_run: true, products: 2, variants: 3, stocked: 2, categories_created: ['Spring Specials'] });
    expect(await ctx.db.selectFrom('products').select('id').where('name', '=', 'Spring Tulips').execute()).toHaveLength(0);

    const done = (await staff.post('/api/admin/catalog/import', { csv: good, dry_run: false })).json;
    expect(done.ok).toBe(true);
    const tulips = await ctx.db.selectFrom('products').selectAll().where('name', '=', 'Spring Tulips').executeTakeFirstOrThrow();
    expect(tulips.status).toBe('draft');
    const variants = await ctx.db.selectFrom('product_variants').select(['sku', 'price_cents', 'sale_price_cents']).where('product_id', '=', tulips.id).orderBy('sort_order').execute();
    expect(variants).toEqual([{ sku: 'TUL-1', price_cents: 4500, sale_price_cents: null }, { sku: 'TUL-2', price_cents: 6500, sale_price_cents: 5500 }]);
    const level = await ctx.db.selectFrom('inventory_items as i').innerJoin('inventory_levels as l', 'l.item_id', 'i.id').select('l.on_hand').where('i.sku', '=', 'INV-TUL-1').executeTakeFirstOrThrow();
    expect(level.on_hand).toBe(10);
    const napkins = await ctx.db.selectFrom('products').select(['status', 'allow_shipping']).where('name', '=', 'Linen Napkins, set of 4').executeTakeFirstOrThrow();
    expect(napkins).toEqual({ status: 'active', allow_shipping: true });

    // Importing the same file again is refused, rather than making duplicates.
    const again = (await staff.post('/api/admin/catalog/import', { csv: good, dry_run: true })).json;
    expect(again.ok).toBe(false);
    expect(again.errors.map((e: { message: string }) => e.message).join(' ')).toContain('already exists');

    const florist = await signIn(h, (await makeStaff(ctx, { roles: ['florist'], email: 'flo@example.test' })).email);
    expect((await florist.post('/api/admin/catalog/import', { csv: good, dry_run: true })).status).toBe(403);
  });
});
