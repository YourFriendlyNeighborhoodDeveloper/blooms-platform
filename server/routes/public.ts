import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv, C } from '../http/types.js';
import { customerActor } from '../http/types.js';
import { cookieNames, readCookie, readJson, readQuery, setSessionCookie } from '../http/helpers.js';
import { badRequest, notFound } from '../lib/errors.js';
import { enforceRateLimit } from '../lib/ratelimit.js';
import { addDays, addHours, localDate } from '../lib/time.js';
import { generateReference, mintAccessToken, resolveAccessToken } from '../lib/tokens.js';
import { toE164 } from '../lib/phone.js';
import { emit } from '../automation/events.js';
import { getProduct, listCategories, listProducts } from '../modules/catalog/public.js';
import { addItem, addItemSchema, applyPromoCode, CART_TTL_HOURS, cartView, clearPromoCode, createCart, findCart, removeItem, setItemQuantity, type CartRow } from '../modules/cart/service.js';
import { loadCartLines } from '../modules/cart/lines.js';
import { earliestFeasible, findZone, listSlots, loadPolicyContext } from '../modules/availability/engine.js';
import { checkoutSchema, placeOrder, quoteCheckout, quoteSchema, upsertCustomer } from '../modules/orders/checkout.js';
import { publicOrderView } from '../modules/orders/views.js';
import { startOrderPayment } from '../modules/payments/service.js';
import { sendDirect } from '../modules/notifications/service.js';
import { firstName } from '../modules/notifications/vars.js';
import { loadSettings } from '../modules/settings/service.js';
import { publicWeddingRoutes } from './public-weddings.js';
import { publicContentRoutes } from './public-content.js';

export const publicRoutes = new Hono<AppEnv>();

publicRoutes.route('/', publicWeddingRoutes);
publicRoutes.route('/', publicContentRoutes);

const getCart = async (c: C): Promise<CartRow | null> => {
  const ctx = c.get('ctx');
  return findCart(ctx.db, readCookie(c, cookieNames(ctx.env).cart));
};

const ensureCart = async (c: C): Promise<CartRow> => {
  const ctx = c.get('ctx');
  const existing = await getCart(c);
  if (existing && existing.status !== 'converted') return existing;
  const attribution = z.object({ utm_source: z.string().max(100).optional(), utm_medium: z.string().max(100).optional(), utm_campaign: z.string().max(100).optional() }).safeParse(c.req.query());
  const created = await createCart(ctx, attribution.success ? (attribution.data as Record<string, string>) : {});
  setSessionCookie(c, ctx.env, cookieNames(ctx.env).cart, created.token, addHours(ctx.clock.now(), CART_TTL_HOURS));
  return created.cart;
};

const requireCart = async (c: C): Promise<CartRow> => {
  const cart = await getCart(c);
  if (!cart) throw notFound('Your cart is empty.');
  return cart;
};

publicRoutes.get('/products', async (c) => {
  const q = readQuery(
    c,
    z.object({
      division: z.string().max(40).optional(),
      category: z.string().max(100).optional(),
      q: z.string().max(100).optional(),
      sort: z.enum(['featured', 'price_asc', 'price_desc', 'newest']).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
      offset: z.coerce.number().int().min(0).optional(),
    }),
  );
  const ctx = c.get('ctx');
  const [products, categories] = await Promise.all([listProducts(ctx.db, q), listCategories(ctx.db, q.division)]);
  return c.json({ products, categories });
});

publicRoutes.get('/products/:slug', async (c) => c.json(await getProduct(c.get('ctx').db, c.req.param('slug'))));

publicRoutes.get('/cart', async (c) => c.json(await cartView(c.get('ctx'), await getCart(c))));

publicRoutes.post('/cart/items', async (c) => {
  const ctx = c.get('ctx');
  await enforceRateLimit(ctx.db, ctx.clock, `cart:${c.get('ip')}`, 120, 60);
  const body = await readJson(c, addItemSchema);
  const cart = await ensureCart(c);
  await addItem(ctx, cart, body);
  return c.json(await cartView(ctx, await refresh(c, cart)));
});

const refresh = async (c: C, cart: CartRow): Promise<CartRow> => {
  const row = await c.get('ctx').db.selectFrom('carts').select(['id', 'status', 'promotion_code', 'saved_details', 'customer_id']).where('id', '=', cart.id).executeTakeFirstOrThrow();
  return row;
};

publicRoutes.patch('/cart/items/:id', async (c) => {
  const ctx = c.get('ctx');
  const { quantity } = await readJson(c, z.object({ quantity: z.number().int().min(0).max(999) }));
  const cart = await requireCart(c);
  await setItemQuantity(ctx, cart, c.req.param('id'), quantity);
  return c.json(await cartView(ctx, cart));
});

publicRoutes.delete('/cart/items/:id', async (c) => {
  const ctx = c.get('ctx');
  const cart = await requireCart(c);
  await removeItem(ctx, cart, c.req.param('id'));
  return c.json(await cartView(ctx, cart));
});

publicRoutes.post('/cart/promo', async (c) => {
  const ctx = c.get('ctx');
  await enforceRateLimit(ctx.db, ctx.clock, `promo:${c.get('ip')}`, 20, 300);
  const { code } = await readJson(c, z.object({ code: z.string().trim().min(1).max(60) }));
  const cart = await requireCart(c);
  await applyPromoCode(ctx, cart, code);
  return c.json(await cartView(ctx, await refresh(c, cart)));
});

publicRoutes.delete('/cart/promo', async (c) => {
  const ctx = c.get('ctx');
  const cart = await requireCart(c);
  await clearPromoCode(ctx, cart);
  return c.json(await cartView(ctx, await refresh(c, cart)));
});

// Saved server-side, so details survive a failed payment, a split cart or a browser restart.
publicRoutes.put('/cart/details', async (c) => {
  const ctx = c.get('ctx');
  const body = await readJson(c, z.record(z.string(), z.unknown()));
  if (JSON.stringify(body).length > 8000) throw badRequest('That is too much information to save.');
  const cart = await requireCart(c);
  await ctx.db.updateTable('carts').set({ saved_details: JSON.stringify(body) }).where('id', '=', cart.id).execute();
  return c.json({ saved: true });
});

publicRoutes.post('/availability/slots', async (c) => {
  const ctx = c.get('ctx');
  await enforceRateLimit(ctx.db, ctx.clock, `slots:${c.get('ip')}`, 120, 60);
  const body = await readJson(
    c,
    z.object({
      method: z.enum(['pickup', 'delivery']),
      postal_code: z.string().trim().max(10).optional().nullable(),
      line_ids: z.array(z.string().uuid()).min(1),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      days: z.number().int().min(1).max(60).optional(),
    }),
  );
  const cart = await requireCart(c);
  const lines = (await loadCartLines(ctx.db, cart.id)).filter((l) => body.line_ids.includes(l.id));
  if (!lines.length) throw badRequest('Those items are not in your cart.');
  const settings = await loadSettings(ctx.db);
  const tz = settings.general.timezone;
  const today = localDate(ctx.clock.now(), tz);
  const from = body.from && body.from > today ? body.from : today;
  const days = body.days ?? settings.ordering.slot_horizon_days;
  const policy = await loadPolicyContext(ctx.db, ctx.clock, addDays(from, -1, tz), addDays(from, days + 90, tz));
  const zone = body.method === 'delivery' ? findZone(policy, body.postal_code) : null;
  if (body.method === 'delivery' && !zone) {
    return c.json({ zone: null, out_of_area: Boolean(body.postal_code), slots: [], earliest: null, timezone: tz });
  }
  const demand = { lines, subtotal_cents: lines.reduce((s, l) => s + l.line_subtotal_cents, 0) };
  const slots = listSlots(policy, demand, body.method, zone, from, days);
  return c.json({
    zone: zone ? { id: zone.id, name: zone.name, fee_cents: zone.fee_cents, min_order_cents: zone.min_order_cents } : null,
    out_of_area: false,
    timezone: tz,
    earliest: earliestFeasible(slots),
    slots,
  });
});

publicRoutes.post('/checkout/quote', async (c) => {
  const ctx = c.get('ctx');
  await enforceRateLimit(ctx.db, ctx.clock, `quote:${c.get('ip')}`, 60, 60);
  const body = await readJson(c, quoteSchema);
  return c.json(await quoteCheckout(ctx, await requireCart(c), body.fulfillments));
});

publicRoutes.post('/checkout', async (c) => {
  const ctx = c.get('ctx');
  await enforceRateLimit(ctx.db, ctx.clock, `checkout:${c.get('ip')}`, 20, 60);
  const body = await readJson(c, checkoutSchema);
  const placed = await placeOrder(ctx, await requireCart(c), body, customerActor(c), c.req.header('user-agent'));
  return c.json(placed, 201);
});

const orderIdFromToken = async (c: C) => {
  const ctx = c.get('ctx');
  const token = await resolveAccessToken(ctx.db, ctx.clock, c.req.param('token') ?? '', ['order_access']);
  if (!token?.subject_id) throw notFound('This link has expired or is not valid. You can request a new one.');
  return token.subject_id;
};

publicRoutes.get('/track/:token', async (c) => c.json(await publicOrderView(c.get('ctx').db, await orderIdFromToken(c))));

publicRoutes.post('/track/:token/pay', async (c) => {
  const ctx = c.get('ctx');
  await enforceRateLimit(ctx.db, ctx.clock, `pay:${c.get('ip')}`, 20, 60);
  const orderId = await orderIdFromToken(c);
  return c.json(await startOrderPayment(ctx, orderId, c.req.param('token') ?? ''));
});

// Always the same answer, so this cannot be used to test whether an order or email exists.
publicRoutes.post('/track/lookup', async (c) => {
  const ctx = c.get('ctx');
  await enforceRateLimit(ctx.db, ctx.clock, `lookup:${c.get('ip')}`, 8, 300);
  const body = await readJson(c, z.object({ reference: z.string().trim().toUpperCase().max(30), email: z.string().trim().toLowerCase().email() }));
  await enforceRateLimit(ctx.db, ctx.clock, `lookup-email:${body.email}`, 5, 3600);
  const order = await ctx.db
    .selectFrom('orders')
    .select(['id', 'reference', 'customer_id', 'contact_email', 'contact_name'])
    .where('reference', '=', body.reference)
    .where('contact_email', '=', body.email)
    .executeTakeFirst();
  if (order) {
    const token = await mintAccessToken(ctx.db, ctx.clock, { purpose: 'order_access', subjectId: order.id, ttlMinutes: 60 * 24 * 7 });
    await sendDirect(ctx, {
      template: 'order_access_link',
      to: order.contact_email,
      customerId: order.customer_id,
      dedupe: `order-link:${order.id}:${token.slice(0, 12)}`,
      vars: { order: { reference: order.reference, tracking_url: `${ctx.env.PUBLIC_BASE_URL}/track/${token}` }, customer: { first_name: firstName(order.contact_name) } },
    });
  }
  return c.json({ sent: true });
});

publicRoutes.post('/contact', async (c) => {
  const ctx = c.get('ctx');
  await enforceRateLimit(ctx.db, ctx.clock, `contact:${c.get('ip')}`, 5, 600);
  const body = await readJson(
    c,
    z.object({
      name: z.string().trim().min(2, 'Please share your name.').max(120),
      email: z.string().trim().toLowerCase().email('Please check the email format (name@example.com).').max(200),
      phone: z.string().trim().max(30).optional().nullable(),
      topic: z.string().trim().min(1, 'What is your note about?').max(40),
      message: z.string().trim().min(10, 'A few more words, please: at least 10 characters.').max(2000),
      website: z.string().max(200).optional(), // Honeypot: people never see or fill this field.
    }),
  );
  // Claim success to a bot without storing anything, so it has no reason to adapt.
  if (body.website) return c.json({ received: true, reference: generateReference('MSG') }, 201);
  const reference = generateReference('MSG');
  const phone = toE164(body.phone);
  if (body.phone && !phone) throw badRequest('Please enter a 10-digit US phone number, or leave it blank.');
  await ctx.db.transaction().execute(async (trx) => {
    const customerId = await upsertCustomer(trx, { name: body.name, email: body.email, phone }, 'contact_form');
    const row = await trx
      .insertInto('support_requests')
      .values({ reference, customer_id: customerId, topic: body.topic, name: body.name, email: body.email, phone_e164: phone, message: body.message, source: 'contact_form' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('customer_communications')
      .values({ customer_id: customerId, direction: 'inbound', channel: 'portal', subject: body.topic, body: body.message, subject_type: 'support', subject_id: row.id })
      .execute();
    await emit(trx, 'support.created', { type: 'support', id: row.id });
  });
  return c.json({ received: true, reference }, 201);
});

const preferenceCustomer = async (c: C) => {
  const ctx = c.get('ctx');
  const token = await resolveAccessToken(ctx.db, ctx.clock, c.req.param('token') ?? '', ['preferences']);
  if (!token?.subject_id) throw notFound('This link has expired. Sign in to your account to manage your preferences.');
  return token.subject_id;
};

const latestConsent = async (c: C, customerId: string, channel: 'email' | 'sms', purpose: 'transactional' | 'marketing') => {
  const row = await c
    .get('ctx')
    .db.selectFrom('customer_consents')
    .select('granted')
    .where('customer_id', '=', customerId)
    .where('channel', '=', channel)
    .where('purpose', '=', purpose)
    .orderBy('created_at', 'desc')
    .limit(1)
    .executeTakeFirst();
  return row?.granted ?? false;
};

publicRoutes.get('/preferences/:token', async (c) => {
  const id = await preferenceCustomer(c);
  return c.json({
    email_marketing: await latestConsent(c, id, 'email', 'marketing'),
    sms_marketing: await latestConsent(c, id, 'sms', 'marketing'),
    sms_transactional: await latestConsent(c, id, 'sms', 'transactional'),
  });
});

publicRoutes.put('/preferences/:token', async (c) => {
  const ctx = c.get('ctx');
  const id = await preferenceCustomer(c);
  const body = await readJson(c, z.object({ email_marketing: z.boolean(), sms_marketing: z.boolean(), sms_transactional: z.boolean() }));
  const customer = await ctx.db.selectFrom('customers').select('phone_e164').where('id', '=', id).executeTakeFirstOrThrow();
  const rows = [
    { channel: 'email' as const, purpose: 'marketing' as const, granted: body.email_marketing },
    { channel: 'sms' as const, purpose: 'marketing' as const, granted: body.sms_marketing },
    { channel: 'sms' as const, purpose: 'transactional' as const, granted: body.sms_transactional },
  ];
  for (const r of rows) {
    if ((await latestConsent(c, id, r.channel, r.purpose)) === r.granted) continue;
    await ctx.db
      .insertInto('customer_consents')
      .values({ customer_id: id, channel: r.channel, purpose: r.purpose, granted: r.granted, source: 'preferences_link', phone_e164: r.channel === 'sms' ? customer.phone_e164 : null, ip: c.get('ip') })
      .execute();
  }
  return c.json({ saved: true });
});

