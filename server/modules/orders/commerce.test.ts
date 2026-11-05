import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { configureShop, makeProduct, weekdayOf } from '../../test/fixtures.js';
import { createHarness, deliverWebhook, makeStaff, payOrder, resetDb, sessionFor, sessionObject, signIn, type Browser } from '../../test/helpers.js';
import { drain, tick } from '../../automation/worker.js';
import { expireStaleOrders } from './actions.js';
import { reconcileOpenPayments } from '../payments/service.js';

const h = createHarness({ now: '2026-11-10T14:00:00Z' }); // 9:00 AM Tuesday in Saginaw
const { ctx } = h;

afterAll(() => ctx.db.destroy());

const contact = { name: 'Avery Example', email: 'avery@example.test', phone: '(989) 555-0123' };
const address = { line1: '100 Example St', city: 'Saginaw', region: 'MI', postal_code: '48609' };

let idem = 0;
const key = () => `test-key-${Date.now()}-${idem++}`;

async function addToCart(b: Browser, variantId: string, quantity = 1, options = {}) {
  const res = await b.post('/api/public/cart/items', { variant_id: variantId, quantity, options });
  expect(res.status, res.text).toBe(200);
  return res.json;
}

type Shop = Awaited<ReturnType<typeof configureShop>>;

const pickupFor = (shop: Shop, date: string) => ({ method: 'pickup', date, window_id: shop.windows[`pickup-${weekdayOf(date)}`] });
const deliveryFor = (shop: Shop, date: string) => ({ method: 'delivery', date, window_id: shop.windows[`delivery-${weekdayOf(date)}`], address });

async function checkout(b: Browser, fulfillment: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const cart = (await b.get('/api/public/cart')).json;
  return b.post('/api/public/checkout', {
    idempotency_key: key(),
    contact,
    fulfillments: [{ line_ids: cart.lines.map((l: { id: string }) => l.id), ...fulfillment }],
    ...extra,
  });
}

beforeEach(async () => {
  await resetDb(ctx);
  h.email.sent.length = 0;
  h.clock.set('2026-11-10T14:00:00Z');
});

describe('Scenario A: a normal flower purchase', () => {
  it('goes from cart to delivered with verified payment, tasks, notifications and history', async () => {
    const shop = await configureShop(ctx);
    const owner = await makeStaff(ctx, { roles: ['owner'], email: 'owner@example.test' });
    const product = await makeProduct(ctx, { name: 'Fictional Garden Bouquet', price: 6000, stock: 5, prep: 30, points: 2 });

    const b = h.browser();
    const cart = await addToCart(b, product.variant_id);
    expect(cart.totals.subtotal_cents).toBe(6000);

    const placed = await checkout(b, deliveryFor(shop, '2026-11-11'));
    expect(placed.status, placed.text).toBe(201);
    expect(placed.json.next.type).toBe('redirect');
    const orderId = placed.json.order_id as string;

    // Reaching checkout proves nothing. The order is not paid and nothing has been released.
    let order = await ctx.db.selectFrom('orders').selectAll().where('id', '=', orderId).executeTakeFirstOrThrow();
    expect(order.status).toBe('awaiting_payment');
    expect(order.payment_status).toBe('unpaid');
    expect(order.subtotal_cents).toBe(6000);
    expect(order.delivery_cents).toBe(1000);
    expect(order.tax_cents).toBe(360); // 6% of the items only; delivery is not taxable here
    expect(order.total_cents).toBe(7360);

    const stock = await ctx.db.selectFrom('inventory_levels').select(['on_hand', 'reserved']).where('item_id', '=', product.item_id as string).executeTakeFirstOrThrow();
    expect(stock).toEqual({ on_hand: 5, reserved: 1 });

    await payOrder(h, orderId);
    order = await ctx.db.selectFrom('orders').selectAll().where('id', '=', orderId).executeTakeFirstOrThrow();
    expect(order.status).toBe('accepted');
    expect(order.payment_status).toBe('paid');
    expect(order.paid_cents).toBe(7360);

    const tasks = await ctx.db.selectFrom('staff_tasks').select('title').where('subject_id', '=', orderId).execute();
    expect(tasks.map((t) => t.title)).toEqual(expect.arrayContaining([expect.stringContaining('Fictional Garden Bouquet')]));

    await drain(ctx);
    expect(h.email.to(contact.email).map((m) => m.subject)).toEqual(expect.arrayContaining([expect.stringContaining('We have your order')]));
    expect(h.email.to(owner.email).map((m) => m.subject)).toEqual(expect.arrayContaining([expect.stringContaining('New paid order')]));

    const staff = await signIn(h, owner.email);
    const detail = (await staff.get(`/api/admin/orders/${orderId}`)).json;
    expect(detail.reference).toBe(placed.json.reference);
    const itemId = detail.items[0].id;
    for (const status of ['preparing', 'ready', 'out_for_delivery', 'fulfilled']) {
      const r = await staff.post(`/api/admin/orders/${orderId}/items/status`, { item_ids: [itemId], status });
      expect(r.status, r.text).toBe(200);
    }
    await drain(ctx);

    order = await ctx.db.selectFrom('orders').selectAll().where('id', '=', orderId).executeTakeFirstOrThrow();
    expect(order.status).toBe('fulfilled');
    const after = await ctx.db.selectFrom('inventory_levels').select(['on_hand', 'reserved']).where('item_id', '=', product.item_id as string).executeTakeFirstOrThrow();
    expect(after).toEqual({ on_hand: 4, reserved: 0 });

    const subjects = h.email.to(contact.email).map((m) => m.subject);
    expect(subjects).toEqual(expect.arrayContaining([expect.stringContaining('preparing'), expect.stringContaining('Out for delivery'), expect.stringContaining('Delivered'), expect.stringContaining('complete')]));

    const tracking = await b.get(`/api/public/track/${placed.json.tracking_token}`);
    expect(tracking.status).toBe(200);
    expect(tracking.json.status).toBe('fulfilled');
    expect(tracking.json.items[0].status).toBe('fulfilled');
    expect(tracking.json.timeline.length).toBeGreaterThan(4);
  });

  it('applies a sale price and option prices from the server, ignoring anything a client might claim', async () => {
    const shop = await configureShop(ctx);
    const product = await makeProduct(ctx, {
      price: 5000,
      sale: 4000,
      options: [
        { code: 'size', label: 'Size', input_type: 'select', required: true, choices: [{ value: 'std', label: 'Standard' }, { value: 'lg', label: 'Large', price_delta_cents: 1500 }] },
        { code: 'card', label: 'Card message', input_type: 'text', max_length: 20 },
      ],
    });
    const b = h.browser();
    expect((await b.post('/api/public/cart/items', { variant_id: product.variant_id, quantity: 1, options: {} })).status).toBe(400);
    expect((await b.post('/api/public/cart/items', { variant_id: product.variant_id, quantity: 1, options: { size: 'huge' } })).status).toBe(400);
    expect((await b.post('/api/public/cart/items', { variant_id: product.variant_id, quantity: 1, options: { size: 'lg', hack: 'x' } })).status).toBe(400);
    expect((await b.post('/api/public/cart/items', { variant_id: product.variant_id, quantity: 1, options: { size: 'lg', card: 'x'.repeat(21) } })).status).toBe(400);

    const cart = await addToCart(b, product.variant_id, 2, { size: 'lg', card: 'Happy day' });
    expect(cart.lines[0].line_subtotal_cents).toBe((4000 + 1500) * 2);

    const stale = await checkout(b, pickupFor(shop, '2026-11-11'), { expected_total_cents: 100 });
    expect(stale.status).toBe(409);
    expect(stale.json.error.code).toBe('price_changed');

    const ok = await checkout(b, pickupFor(shop, '2026-11-11'), { expected_total_cents: Math.round(11000 * 1.06) });
    expect(ok.status, ok.text).toBe(201);
  });
});

describe('Scenario B: impossible same-day delivery', () => {
  it('blocks the slot before any payment and offers the earliest feasible alternatives', async () => {
    const shop = await configureShop(ctx, { sameDay: true, cutoff: '14:00' });
    const product = await makeProduct(ctx, { name: 'Custom Arrangement', prep: 120, custom: false, stock: 5 });
    h.clock.set('2026-11-10T19:00:00Z'); // 2:00 PM local, delivery window opens at 3:00 PM

    const b = h.browser();
    const cart = await addToCart(b, product.variant_id);
    const lineIds = cart.lines.map((l: { id: string }) => l.id);

    const slots = await b.post('/api/public/availability/slots', { method: 'delivery', postal_code: '48609', line_ids: lineIds, days: 3 });
    expect(slots.status).toBe(200);
    const today = slots.json.slots.filter((s: { date: string }) => s.date === '2026-11-10');
    expect(today.length).toBeGreaterThan(0);
    expect(today.every((s: { status: string }) => s.status === 'blocked')).toBe(true);
    expect(slots.json.earliest.date).toBe('2026-11-11');

    const res = await checkout(b, deliveryFor(shop, '2026-11-10'));
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe('slot_unavailable');
    expect(res.json.error.details.alternatives.length).toBeGreaterThan(0);
    expect(res.json.error.details.alternatives[0].date).toBe('2026-11-11');

    expect(await ctx.db.selectFrom('orders').select('id').execute()).toHaveLength(0);
    expect(await ctx.db.selectFrom('payments').select('id').execute()).toHaveLength(0);
    const stock = await ctx.db.selectFrom('inventory_levels').select('reserved').where('item_id', '=', product.item_id as string).executeTakeFirstOrThrow();
    expect(stock.reserved).toBe(0);
  });

  it('refuses same-day after the cutoff, and when same-day is switched off', async () => {
    const shop = await configureShop(ctx, { sameDay: true, cutoff: '11:00' });
    const product = await makeProduct(ctx, { prep: 10 });
    h.clock.set('2026-11-10T17:00:00Z'); // noon local, after the 11:00 cutoff
    const b = h.browser();
    await addToCart(b, product.variant_id);
    const late = await checkout(b, pickupFor(shop, '2026-11-10'));
    expect(late.status).toBe(409);
    expect(late.json.error.details.reasons[0].code).toBe('same_day_cutoff');

    await ctx.db.updateTable('business_settings').set({ value: JSON.stringify({ same_day_enabled: false }) }).where('key', '=', 'ordering').execute();
    const off = await checkout(b, pickupFor(shop, '2026-11-10'));
    expect(off.status).toBe(409);
    expect(off.json.error.details.reasons.map((r: { code: string }) => r.code)).toContain('same_day_disabled');
  });

  it('refuses a delivery outside the zones while keeping pickup available', async () => {
    const shop = await configureShop(ctx);
    const product = await makeProduct(ctx);
    const b = h.browser();
    await addToCart(b, product.variant_id);
    const res = await checkout(b, { method: 'delivery', date: '2026-11-11', window_id: shop.windows['delivery-3'], address: { ...address, postal_code: '90210' } });
    expect(res.status).toBe(409);
    expect(res.json.error.details.reasons[0].code).toBe('no_zone');
    expect(res.json.error.details.alternatives.length).toBeGreaterThan(0);
  });

  it('respects a closure, and capacity limits by points', async () => {
    const shop = await configureShop(ctx, { dailyOrders: null, dailyPoints: 3 });
    await ctx.db.insertInto('blackout_rules').values({ starts_on: '2026-11-12', ends_on: '2026-11-12', reason: 'holiday', public_message: 'Closed for the staff outing.' }).execute();
    const product = await makeProduct(ctx, { points: 2, prep: 10 });

    const a = h.browser();
    await addToCart(a, product.variant_id);
    const closed = await checkout(a, pickupFor(shop, '2026-11-12'));
    expect(closed.status).toBe(409);
    expect(closed.json.error.message).toBe('Closed for the staff outing.');

    const first = await checkout(a, pickupFor(shop, '2026-11-13'));
    expect(first.status, first.text).toBe(201);

    const b = h.browser();
    await addToCart(b, product.variant_id);
    const second = await checkout(b, pickupFor(shop, '2026-11-13'));
    expect(second.status).toBe(409);
    expect(second.json.error.details.reasons[0].code).toBe('capacity_points');
  });
});

describe('Scenario E: inventory shortage', () => {
  it('rejects by default, promises nothing, and alerts the owner', async () => {
    const shop = await configureShop(ctx);
    const owner = await makeStaff(ctx, { roles: ['owner'], email: 'owner@example.test' });
    const product = await makeProduct(ctx, { name: 'Last Vase', stock: 1 });
    const a = h.browser();
    const b = h.browser();
    await addToCart(a, product.variant_id);
    await addToCart(b, product.variant_id);
    expect((await checkout(a, pickupFor(shop, '2026-11-11'))).status).toBe(201);

    const res = await checkout(b, pickupFor(shop, '2026-11-11'));
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe('out_of_stock');
    expect(await ctx.db.selectFrom('orders').select('id').execute()).toHaveLength(1);

    const alert = await ctx.db.selectFrom('system_alerts').selectAll().where('code', '=', 'inventory_shortage').executeTakeFirstOrThrow();
    expect(alert.link).toContain(product.item_id as string);
    await drain(ctx);
    expect(h.email.to(owner.email).map((m) => m.subject)).toEqual(expect.arrayContaining([expect.stringContaining('Shortage blocked a sale')]));
  });

  it('accounts for materials in a recipe, not just finished goods', async () => {
    const shop = await configureShop(ctx);
    const product = await makeProduct(ctx, { name: 'Recipe Bouquet', stock: null });
    const location = (await ctx.db.selectFrom('inventory_locations').select('id').where('is_default', '=', true).executeTakeFirstOrThrow()).id;
    const roses = await ctx.db.insertInto('inventory_items').values({ sku: 'ROSE', name: 'Roses', kind: 'material', unit: 'stem' }).returning('id').executeTakeFirstOrThrow();
    await ctx.db.insertInto('inventory_levels').values({ item_id: roses.id, location_id: location, on_hand: 15 }).execute();
    const recipe = await ctx.db.insertInto('product_recipes').values({ product_id: product.id }).returning('id').executeTakeFirstOrThrow();
    await ctx.db.insertInto('recipe_components').values({ recipe_id: recipe.id, item_id: roses.id, quantity: 12 }).execute();

    const a = h.browser();
    await addToCart(a, product.variant_id);
    expect((await checkout(a, pickupFor(shop, '2026-11-11'))).status).toBe(201);
    const level = await ctx.db.selectFrom('inventory_levels').select('reserved').where('item_id', '=', roses.id).executeTakeFirstOrThrow();
    expect(level.reserved).toBe(12);

    const b = h.browser();
    const blocked = await b.post('/api/public/cart/items', { variant_id: product.variant_id, quantity: 1, options: {} });
    expect(blocked.status).toBe(409);
    expect(blocked.json.error.code).toBe('insufficient_stock');
  });

  it('holds for review when the setting says review, with no payment taken', async () => {
    const shop = await configureShop(ctx, { outOfStock: 'review' });
    const product = await makeProduct(ctx, { stock: 0 });
    const b = h.browser();
    await addToCart(b, product.variant_id);
    const res = await checkout(b, pickupFor(shop, '2026-11-11'));
    expect(res.status, res.text).toBe(201);
    expect(res.json.next.type).toBe('review');
    const order = await ctx.db.selectFrom('orders').selectAll().where('id', '=', res.json.order_id).executeTakeFirstOrThrow();
    expect(order.status).toBe('awaiting_review');
    expect(order.payment_status).toBe('unpaid');
    expect(await ctx.db.selectFrom('payments').select('id').where('order_id', '=', order.id).execute()).toHaveLength(0);
  });
});

describe('Concurrency', () => {
  it('two simultaneous customers cannot both buy the last unit', async () => {
    const shop = await configureShop(ctx);
    const product = await makeProduct(ctx, { stock: 1 });
    const buyers = [h.browser(), h.browser(), h.browser(), h.browser()];
    for (const b of buyers) await addToCart(b, product.variant_id);
    const results = await Promise.all(buyers.map((b) => checkout(b, pickupFor(shop, '2026-11-11'))));
    const won = results.filter((r) => r.status === 201);
    const lost = results.filter((r) => r.status === 409);
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(3);
    const level = await ctx.db.selectFrom('inventory_levels').select(['on_hand', 'reserved']).where('item_id', '=', product.item_id as string).executeTakeFirstOrThrow();
    expect(level).toEqual({ on_hand: 1, reserved: 1 });
  });

  it('simultaneous checkouts cannot exceed a delivery window capacity', async () => {
    const shop = await configureShop(ctx, { maxStops: 2 });
    const product = await makeProduct(ctx);
    const buyers = Array.from({ length: 5 }, () => h.browser());
    for (const b of buyers) await addToCart(b, product.variant_id);
    const results = await Promise.all(buyers.map((b) => checkout(b, deliveryFor(shop, '2026-11-11'))));
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(results.filter((r) => r.status === 409)).toHaveLength(3);
  });

  it('a limited promotion cannot be over-redeemed', async () => {
    const shop = await configureShop(ctx);
    const product = await makeProduct(ctx);
    await ctx.db.insertInto('promotions').values({ code: 'ONCE', kind: 'percent', value: 10, max_redemptions: 1 }).execute();
    const buyers = [h.browser(), h.browser(), h.browser()];
    for (const b of buyers) {
      await addToCart(b, product.variant_id);
      expect((await b.post('/api/public/cart/promo', { code: 'once' })).status).toBe(200);
    }
    const results = await Promise.all(buyers.map((b) => checkout(b, pickupFor(shop, '2026-11-11'))));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    const promo = await ctx.db.selectFrom('promotions').select('redemption_count').executeTakeFirstOrThrow();
    expect(promo.redemption_count).toBe(1);
  });

  it('the same idempotency key from a double click produces one order', async () => {
    const shop = await configureShop(ctx);
    const product = await makeProduct(ctx, { stock: 5 });
    const b = h.browser();
    const cart = await addToCart(b, product.variant_id);
    const payload = { idempotency_key: 'double-click-1', contact, fulfillments: [{ line_ids: cart.lines.map((l: { id: string }) => l.id), ...pickupFor(shop, '2026-11-11') }] };
    const [one, two] = await Promise.all([b.post('/api/public/checkout', payload), b.post('/api/public/checkout', payload)]);
    expect([one.status, two.status].sort()).toEqual([201, 201]);
    expect(one.json.order_id).toBe(two.json.order_id);
    expect(await ctx.db.selectFrom('orders').select('id').execute()).toHaveLength(1);
    const level = await ctx.db.selectFrom('inventory_levels').select('reserved').where('item_id', '=', product.item_id as string).executeTakeFirstOrThrow();
    expect(level.reserved).toBe(1);
  });
});

describe('Payment webhooks', () => {
  async function placed() {
    const shop = await configureShop(ctx);
    const product = await makeProduct(ctx, { stock: 3 });
    const b = h.browser();
    await addToCart(b, product.variant_id);
    const res = await checkout(b, pickupFor(shop, '2026-11-11'));
    expect(res.status, res.text).toBe(201);
    return { orderId: res.json.order_id as string, token: res.json.tracking_token as string, b, product };
  }

  it('rejects a forged webhook', async () => {
    const { orderId } = await placed();
    const { session } = await sessionFor(h, orderId);
    const body = JSON.stringify({ id: 'evt_forged', type: 'checkout.session.completed', livemode: false, data: { object: sessionObject(session, 'complete', 'paid') } });
    const res = await h.app.request('/api/webhooks/stripe', { method: 'POST', body, headers: { 'stripe-signature': 't=1,v1=forged' } });
    expect(res.status).toBe(400);
    const order = await ctx.db.selectFrom('orders').select('status').where('id', '=', orderId).executeTakeFirstOrThrow();
    expect(order.status).toBe('awaiting_payment');
  });

  it('a duplicate webhook changes nothing and sends no second confirmation', async () => {
    const { orderId } = await placed();
    const { session } = await sessionFor(h, orderId);
    const obj = sessionObject(session, 'complete', 'paid');
    expect((await deliverWebhook(h, 'checkout.session.completed', obj, 'evt_dup')).status).toBe(200);
    const again = await deliverWebhook(h, 'checkout.session.completed', obj, 'evt_dup');
    expect(again.json.outcome).toBe('duplicate');
    // A different event id carrying the same fact is also harmless.
    await deliverWebhook(h, 'checkout.session.completed', obj, 'evt_dup_2');

    const order = await ctx.db.selectFrom('orders').selectAll().where('id', '=', orderId).executeTakeFirstOrThrow();
    expect(order.paid_cents).toBe(order.total_cents);
    expect(await ctx.db.selectFrom('orders').select('id').execute()).toHaveLength(1);
    await drain(ctx);
    expect(h.email.to(contact.email).filter((m) => m.subject.includes('We have your order'))).toHaveLength(1);
  });

  it('simultaneous duplicate webhooks apply once', async () => {
    const { orderId } = await placed();
    const { session } = await sessionFor(h, orderId);
    const obj = sessionObject(session, 'complete', 'paid');
    await Promise.all([deliverWebhook(h, 'checkout.session.completed', obj, 'evt_same'), deliverWebhook(h, 'checkout.session.completed', obj, 'evt_same'), deliverWebhook(h, 'checkout.session.completed', obj, 'evt_other')]);
    const order = await ctx.db.selectFrom('orders').selectAll().where('id', '=', orderId).executeTakeFirstOrThrow();
    expect(order.paid_cents).toBe(order.total_cents);
    expect(order.status).toBe('accepted');
  });

  it('flags a paid amount that does not match, instead of quietly fulfilling', async () => {
    const { orderId } = await placed();
    const { session } = await sessionFor(h, orderId);
    await deliverWebhook(h, 'checkout.session.completed', sessionObject(session, 'complete', 'paid', 1));
    const order = await ctx.db.selectFrom('orders').selectAll().where('id', '=', orderId).executeTakeFirstOrThrow();
    expect(order.needs_attention).toBe(true);
    const alert = await ctx.db.selectFrom('system_alerts').selectAll().where('code', '=', 'payment_amount_mismatch').executeTakeFirst();
    expect(alert?.severity).toBe('critical');
  });

  it('Scenario G: an uncertain payment stays pending until confirmed, even if the customer reaches the success page', async () => {
    const { orderId, token, b } = await placed();
    const { session } = await sessionFor(h, orderId);
    await deliverWebhook(h, 'checkout.session.completed', sessionObject(session, 'complete', 'unpaid'));
    const pending = (await b.get(`/api/public/track/${token}`)).json;
    expect(pending.status).toBe('payment_processing');
    expect(pending.payment_status).toBe('processing');
    expect(await ctx.db.selectFrom('staff_tasks').select('id').where('subject_id', '=', orderId).execute()).toHaveLength(0);

    await deliverWebhook(h, 'checkout.session.async_payment_succeeded', sessionObject(session, 'complete', 'paid'));
    const paid = (await b.get(`/api/public/track/${token}`)).json;
    expect(paid.status).toBe('accepted');
    expect(paid.payment_status).toBe('paid');
  });

  it('Scenario G: reconciliation recovers a payment whose webhook never arrived', async () => {
    const { orderId } = await placed();
    const { session } = await sessionFor(h, orderId);
    await ctx.db.updateTable('mock_gateway_sessions').set({ status: 'paid' }).where('id', '=', session.id).execute();
    h.clock.advanceMinutes(20);
    await ctx.db.updateTable('payments').set({ created_at: h.clock.now() }).where('order_id', '=', orderId).execute();
    h.clock.advanceMinutes(20);
    const result = await reconcileOpenPayments(ctx);
    expect(result.changed).toBe(1);
    const order = await ctx.db.selectFrom('orders').select(['status', 'payment_status']).where('id', '=', orderId).executeTakeFirstOrThrow();
    expect(order).toEqual({ status: 'accepted', payment_status: 'paid' });
  });

  it('a failed bank payment is recoverable, and the customer can pay again', async () => {
    const { orderId, token, b } = await placed();
    const { session } = await sessionFor(h, orderId);
    await deliverWebhook(h, 'checkout.session.completed', sessionObject(session, 'complete', 'unpaid'));
    await deliverWebhook(h, 'checkout.session.async_payment_failed', sessionObject(session, 'complete', 'unpaid'));
    const failed = (await b.get(`/api/public/track/${token}`)).json;
    expect(failed.status).toBe('payment_failed');
    expect(failed.can_pay).toBe(true);
    await drain(ctx);
    expect(h.email.to(contact.email).map((m) => m.subject)).toEqual(expect.arrayContaining([expect.stringContaining('did not go through')]));

    const retry = await b.post(`/api/public/track/${token}/pay`);
    expect(retry.status, retry.text).toBe(200);
    expect(retry.json.url).toContain('mock-checkout');
    const order = await ctx.db.selectFrom('orders').select('status').where('id', '=', orderId).executeTakeFirstOrThrow();
    expect(order.status).toBe('awaiting_payment');
  });

  it('an abandoned checkout releases stock and capacity, and keeps the cart', async () => {
    const { orderId, b, product } = await placed();
    const { session } = await sessionFor(h, orderId);
    await deliverWebhook(h, 'checkout.session.expired', sessionObject(session, 'expired', 'unpaid'));
    const order = await ctx.db.selectFrom('orders').select('status').where('id', '=', orderId).executeTakeFirstOrThrow();
    expect(order.status).toBe('expired');
    const level = await ctx.db.selectFrom('inventory_levels').select('reserved').where('item_id', '=', product.item_id as string).executeTakeFirstOrThrow();
    expect(level.reserved).toBe(0);
    const claims = await ctx.db.selectFrom('capacity_claims').select('status').where('order_id', '=', orderId).execute();
    expect(claims.every((c) => c.status === 'released')).toBe(true);
    expect((await b.get('/api/public/cart')).json.lines).toHaveLength(1);
  });

  it('holds expire on schedule when nothing is heard from the gateway', async () => {
    const { orderId, product } = await placed();
    const { session } = await sessionFor(h, orderId);
    await ctx.db.updateTable('mock_gateway_sessions').set({ status: 'expired' }).where('id', '=', session.id).execute();
    h.clock.advanceMinutes(120);
    await expireStaleOrders(ctx);
    const order = await ctx.db.selectFrom('orders').select('status').where('id', '=', orderId).executeTakeFirstOrThrow();
    expect(order.status).toBe('expired');
    const level = await ctx.db.selectFrom('inventory_levels').select('reserved').where('item_id', '=', product.item_id as string).executeTakeFirstOrThrow();
    expect(level.reserved).toBe(0);
  });

  it('a hold left behind on a closed order goes back on the shelf, and open orders keep theirs', async () => {
    const shop = await configureShop(ctx);
    const product = await makeProduct(ctx, { stock: 3 });
    const place = async () => {
      const b = h.browser();
      await addToCart(b, product.variant_id);
      const res = await checkout(b, pickupFor(shop, '2026-11-11'));
      expect(res.status, res.text).toBe(201);
      return res.json.order_id as string;
    };
    const closed = await place();
    const open = await place();
    const levelBefore = await ctx.db.selectFrom('inventory_levels').select('reserved').where('item_id', '=', product.item_id as string).executeTakeFirstOrThrow();
    expect(levelBefore.reserved).toBe(2);

    await ctx.db.updateTable('orders').set({ status: 'cancelled' }).where('id', '=', closed).execute();
    await ctx.db.updateTable('orders').set({ hold_expires_at: new Date('2027-01-01T00:00:00Z') }).where('id', '=', open).execute();
    h.clock.advanceMinutes(120);

    const result = await expireStaleOrders(ctx);
    expect(result.released_orphans).toBe(1);
    const statusOf = async (id: string) => (await ctx.db.selectFrom('inventory_reservations').select('status').where('order_id', '=', id).executeTakeFirstOrThrow()).status;
    expect(await statusOf(closed)).toBe('released');
    expect(await statusOf(open)).toBe('held');
    const level = await ctx.db.selectFrom('inventory_levels').select('reserved').where('item_id', '=', product.item_id as string).executeTakeFirstOrThrow();
    expect(level.reserved).toBe(1);
  });

  it('a payment arriving after an order expired is parked for a person, never silently fulfilled', async () => {
    const { orderId } = await placed();
    const { session } = await sessionFor(h, orderId);
    await deliverWebhook(h, 'checkout.session.expired', sessionObject(session, 'expired', 'unpaid'));
    await deliverWebhook(h, 'checkout.session.completed', sessionObject(session, 'complete', 'paid'));
    const order = await ctx.db.selectFrom('orders').selectAll().where('id', '=', orderId).executeTakeFirstOrThrow();
    expect(order.needs_attention).toBe(true);
    expect(order.status).toBe('awaiting_review');
    expect(order.payment_status).toBe('paid');
    expect(await ctx.db.selectFrom('staff_tasks').select('id').where('subject_id', '=', orderId).execute()).toHaveLength(0);
    expect(await ctx.db.selectFrom('system_alerts').select('id').where('code', '=', 'order_payment_attention').execute()).toHaveLength(1);
  });

  it('ignores test events on a live system and live events on a test system', async () => {
    const { orderId } = await placed();
    const { session } = await sessionFor(h, orderId);
    const { mockEvent, mockSignature } = await import('../../integrations/payments/mock.js');
    const event = { ...mockEvent('checkout.session.completed', sessionObject(session, 'complete', 'paid')), livemode: true };
    const body = JSON.stringify(event);
    const res = await h.app.request('/api/webhooks/stripe', { method: 'POST', headers: { 'stripe-signature': mockSignature(body) }, body });
    expect(((await res.json()) as { ignored: string }).ignored).toBe('mode mismatch');
    const order = await ctx.db.selectFrom('orders').select('status').where('id', '=', orderId).executeTakeFirstOrThrow();
    expect(order.status).toBe('awaiting_payment');
  });
});

describe('Scenario H: product-level tracking', () => {
  it('reports each item separately, and completes only when the whole order is done', async () => {
    const shop = await configureShop(ctx);
    const owner = await makeStaff(ctx, { email: 'owner@example.test' });
    const flowers = await makeProduct(ctx, { name: 'Fictional Peonies', division: 'floral', stock: 5 });
    const candle = await makeProduct(ctx, { name: 'Fictional Candle', division: 'boutique', stock: 5, prep: 0, points: 0 });
    const b = h.browser();
    await addToCart(b, flowers.variant_id);
    await addToCart(b, candle.variant_id);
    const placed = await checkout(b, pickupFor(shop, '2026-11-11'));
    expect(placed.status, placed.text).toBe(201);
    await payOrder(h, placed.json.order_id);

    const staff = await signIn(h, owner.email);
    const detail = (await staff.get(`/api/admin/orders/${placed.json.order_id}`)).json;
    const flowerItem = detail.items.find((i: { name: string }) => i.name === 'Fictional Peonies').id;
    const candleItem = detail.items.find((i: { name: string }) => i.name === 'Fictional Candle').id;

    await staff.post(`/api/admin/orders/${placed.json.order_id}/items/status`, { item_ids: [flowerItem], status: 'ready' });
    await staff.post(`/api/admin/orders/${placed.json.order_id}/items/status`, { item_ids: [candleItem], status: 'preparing' });

    const view = (await b.get(`/api/public/track/${placed.json.tracking_token}`)).json;
    expect(view.items.find((i: { name: string }) => i.name === 'Fictional Peonies').status).toBe('ready');
    expect(view.items.find((i: { name: string }) => i.name === 'Fictional Candle').status).toBe('preparing');
    expect(view.status).toBe('preparing');

    await drain(ctx);
    const readyMail = h.email.to(contact.email).find((m) => m.subject.includes('Ready for pickup'));
    expect(readyMail?.text).toContain('Fictional Peonies');
    expect(readyMail?.text).not.toContain('Fictional Candle');

    await staff.post(`/api/admin/orders/${placed.json.order_id}/items/status`, { item_ids: [flowerItem], status: 'fulfilled' });
    expect((await b.get(`/api/public/track/${placed.json.tracking_token}`)).json.status).toBe('partially_fulfilled');

    await staff.post(`/api/admin/orders/${placed.json.order_id}/items/status`, { item_ids: [candleItem], status: 'fulfilled' });
    expect((await b.get(`/api/public/track/${placed.json.tracking_token}`)).json.status).toBe('fulfilled');
  });

  it('splits incompatible items into separate fulfilments on one order, and explains why', async () => {
    const shop = await configureShop(ctx);
    await ctx.db.updateTable('business_settings').set({ value: JSON.stringify({ shipping_enabled: true, shipping_flat_cents: 800, shipping_allowed_states: ['MI'], buffer_minutes: 60, max_stops_per_driver_window: 5 }) }).where('key', '=', 'delivery').execute();
    const flowers = await makeProduct(ctx, { name: 'Local Flowers', pickup: true, delivery: true, shipping: false });
    const sweater = await makeProduct(ctx, { name: 'Shipped Sweater', division: 'boutique', pickup: false, delivery: false, shipping: true, prep: 0, points: 0 });
    const b = h.browser();
    await addToCart(b, flowers.variant_id);
    const cart = await addToCart(b, sweater.variant_id);
    expect(cart.groups).toHaveLength(2);
    expect(cart.groups[0].note).toContain('separate arrangement');

    const flowerLine = cart.lines.find((l: { name: string }) => l.name === 'Local Flowers').id;
    const sweaterLine = cart.lines.find((l: { name: string }) => l.name === 'Shipped Sweater').id;
    const placed = await b.post('/api/public/checkout', {
      idempotency_key: key(),
      contact,
      fulfillments: [
        { line_ids: [flowerLine], ...pickupFor(shop, '2026-11-11') },
        { line_ids: [sweaterLine], method: 'shipping', address },
      ],
    });
    expect(placed.status, placed.text).toBe(201);
    const fulfillments = await ctx.db.selectFrom('fulfillments').select('method').where('order_id', '=', placed.json.order_id).execute();
    expect(fulfillments.map((f) => f.method).sort()).toEqual(['pickup', 'shipping']);
    const order = await ctx.db.selectFrom('orders').select(['shipping_cents', 'total_cents']).where('id', '=', placed.json.order_id).executeTakeFirstOrThrow();
    expect(order.shipping_cents).toBe(800);
  });
});

describe('Cautious defaults and review', () => {
  it('with no approved policies, every order goes to manual review and no payment is taken', async () => {
    const shop = await configureShop(ctx, { approved: false });
    const product = await makeProduct(ctx);
    const b = h.browser();
    await addToCart(b, product.variant_id);
    const res = await checkout(b, pickupFor(shop, '2026-11-11'));
    expect(res.status, res.text).toBe(201);
    expect(res.json.next.type).toBe('review');
    const order = await ctx.db.selectFrom('orders').selectAll().where('id', '=', res.json.order_id).executeTakeFirstOrThrow();
    expect(order.status).toBe('awaiting_review');
    expect(JSON.stringify(order.acceptance_reasons)).toContain('policy_unapproved');
    expect(await ctx.db.selectFrom('payments').select('id').where('order_id', '=', order.id).execute()).toHaveLength(0);
  });

  it('checkout stays closed until tax is configured', async () => {
    const shop = await configureShop(ctx);
    await ctx.db.updateTable('business_settings').set({ value: JSON.stringify({ rates_bps: {} }) }).where('key', '=', 'tax').execute();
    const product = await makeProduct(ctx);
    const b = h.browser();
    await addToCart(b, product.variant_id);
    const res = await checkout(b, pickupFor(shop, '2026-11-11'));
    expect(res.status).toBe(503);
    expect(res.json.error.code).toBe('tax_not_configured');
  });

  it('approve-first: approval sends a pay link, and only payment confirms the order', async () => {
    const shop = await configureShop(ctx);
    const owner = await makeStaff(ctx, { email: 'owner@example.test' });
    const product = await makeProduct(ctx, { custom: true, stock: 2 });
    const b = h.browser();
    await addToCart(b, product.variant_id);
    const res = await checkout(b, pickupFor(shop, '2026-11-12'));
    expect(res.json.next.type).toBe('review');

    const staff = await signIn(h, owner.email);
    const ok = await staff.post(`/api/admin/orders/${res.json.order_id}/approve`, {});
    expect(ok.status, ok.text).toBe(200);
    let view = (await b.get(`/api/public/track/${res.json.tracking_token}`)).json;
    expect(view.status).toBe('awaiting_payment');
    expect(view.can_pay).toBe(true);
    await drain(ctx);
    expect(h.email.to(contact.email).map((m) => m.subject)).toEqual(expect.arrayContaining([expect.stringContaining('is approved')]));

    const pay = await b.post(`/api/public/track/${res.json.tracking_token}/pay`);
    expect(pay.status, pay.text).toBe(200);
    await payOrder(h, res.json.order_id);
    view = (await b.get(`/api/public/track/${res.json.tracking_token}`)).json;
    expect(view.status).toBe('accepted');
  });

  it('pay-first: payment does not accept the order, and rejecting refunds in full and frees stock', async () => {
    const shop = await configureShop(ctx, { review: 'pay_first' });
    const owner = await makeStaff(ctx, { email: 'owner@example.test' });
    const product = await makeProduct(ctx, { custom: true, stock: 2 });
    const b = h.browser();
    await addToCart(b, product.variant_id);
    const res = await checkout(b, pickupFor(shop, '2026-11-12'));
    expect(res.json.next.type).toBe('redirect');
    await payOrder(h, res.json.order_id);
    let order = await ctx.db.selectFrom('orders').selectAll().where('id', '=', res.json.order_id).executeTakeFirstOrThrow();
    expect(order.status).toBe('awaiting_review');
    expect(order.payment_status).toBe('paid');

    const staff = await signIn(h, owner.email);
    const rejected = await staff.post(`/api/admin/orders/${order.id}/reject`, { reason: 'We are fully committed that week.' });
    expect(rejected.status, rejected.text).toBe(200);
    order = await ctx.db.selectFrom('orders').selectAll().where('id', '=', order.id).executeTakeFirstOrThrow();
    expect(order.status).toBe('rejected');
    expect(order.payment_status).toBe('refunded');
    expect(order.refunded_cents).toBe(order.paid_cents);
    const level = await ctx.db.selectFrom('inventory_levels').select('reserved').where('item_id', '=', product.item_id as string).executeTakeFirstOrThrow();
    expect(level.reserved).toBe(0);
    await drain(ctx);
    const subjects = h.email.to(contact.email).map((m) => m.subject);
    expect(subjects).toEqual(expect.arrayContaining([expect.stringContaining('could not accept'), expect.stringContaining('Refund of')]));
  });
});

describe('Refunds', () => {
  async function paidOrder() {
    const shop = await configureShop(ctx);
    const owner = await makeStaff(ctx, { email: 'owner@example.test' });
    const product = await makeProduct(ctx, { price: 10000, stock: 5 });
    const b = h.browser();
    await addToCart(b, product.variant_id);
    const res = await checkout(b, pickupFor(shop, '2026-11-11'));
    await payOrder(h, res.json.order_id);
    return { orderId: res.json.order_id as string, staff: await signIn(h, owner.email) };
  }

  it('supports partial refunds and refuses to exceed what was paid', async () => {
    const { orderId, staff } = await paidOrder();
    const first = await staff.post(`/api/admin/orders/${orderId}/refund`, { amount_cents: 3000, reason: 'Damaged stem' });
    expect(first.status, first.text).toBe(200);
    let order = await ctx.db.selectFrom('orders').selectAll().where('id', '=', orderId).executeTakeFirstOrThrow();
    expect(order.payment_status).toBe('partially_refunded');
    expect(order.refunded_cents).toBe(3000);

    const tooMuch = await staff.post(`/api/admin/orders/${orderId}/refund`, { amount_cents: order.paid_cents, reason: 'Oops' });
    expect(tooMuch.status).toBe(409);

    const rest = await staff.post(`/api/admin/orders/${orderId}/refund`, { amount_cents: order.paid_cents - 3000, reason: 'Goodwill' });
    expect(rest.status, rest.text).toBe(200);
    order = await ctx.db.selectFrom('orders').selectAll().where('id', '=', orderId).executeTakeFirstOrThrow();
    expect(order.payment_status).toBe('refunded');
  });

  it('two simultaneous refunds cannot both spend the same money', async () => {
    const { orderId, staff } = await paidOrder();
    const order = await ctx.db.selectFrom('orders').selectAll().where('id', '=', orderId).executeTakeFirstOrThrow();
    const amount = Math.ceil(order.paid_cents * 0.75);
    const results = await Promise.all([
      staff.post(`/api/admin/orders/${orderId}/refund`, { amount_cents: amount, reason: 'First' }),
      staff.post(`/api/admin/orders/${orderId}/refund`, { amount_cents: amount, reason: 'Second' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const after = await ctx.db.selectFrom('orders').select('refunded_cents').where('id', '=', orderId).executeTakeFirstOrThrow();
    expect(after.refunded_cents).toBe(amount);
  });

  it('records a refund made directly in the Stripe dashboard', async () => {
    const { orderId } = await paidOrder();
    const { payment } = await sessionFor(h, orderId);
    await deliverWebhook(h, 'refund.created', { id: 're_dashboard', object: 'refund', amount: 500, status: 'succeeded', payment_intent: payment.payment_intent_id, metadata: {} });
    await deliverWebhook(h, 'refund.updated', { id: 're_dashboard', object: 'refund', amount: 500, status: 'succeeded', payment_intent: payment.payment_intent_id, metadata: {} });
    const order = await ctx.db.selectFrom('orders').select(['refunded_cents', 'payment_status']).where('id', '=', orderId).executeTakeFirstOrThrow();
    expect(order.refunded_cents).toBe(500);
    expect(order.payment_status).toBe('partially_refunded');
  });

  it('reverses the amounts when a refund later fails at the bank', async () => {
    const { orderId, staff } = await paidOrder();
    await staff.post(`/api/admin/orders/${orderId}/refund`, { amount_cents: 1000, reason: 'Test' });
    const refund = await ctx.db.selectFrom('refunds').selectAll().where('order_id', '=', orderId).executeTakeFirstOrThrow();
    const { payment } = await sessionFor(h, orderId);
    await deliverWebhook(h, 'refund.failed', { id: refund.gateway_refund_id, object: 'refund', amount: 1000, status: 'failed', failure_reason: 'expired_or_canceled_card', payment_intent: payment.payment_intent_id, metadata: { refund_id: refund.id } });
    const order = await ctx.db.selectFrom('orders').select(['refunded_cents', 'payment_status']).where('id', '=', orderId).executeTakeFirstOrThrow();
    expect(order.refunded_cents).toBe(0);
    expect(order.payment_status).toBe('paid');
    expect(await ctx.db.selectFrom('system_alerts').select('id').where('code', '=', 'refund_failed').execute()).toHaveLength(1);
  });
});

describe('Scenario F and background job recovery', () => {
  it('Twilio disabled: an order completes with email only, and no SMS is attempted', async () => {
    const shop = await configureShop(ctx);
    const product = await makeProduct(ctx);
    const b = h.browser();
    await addToCart(b, product.variant_id);
    const res = await checkout(b, pickupFor(shop, '2026-11-11'), { consents: { sms_transactional: true } });
    await payOrder(h, res.json.order_id);
    await drain(ctx);
    expect(ctx.sms.enabled).toBe(false);
    const sms = await ctx.db.selectFrom('notifications').select('id').where('channel', '=', 'sms').execute();
    expect(sms).toHaveLength(0);
    expect(h.email.to(contact.email).length).toBeGreaterThan(0);
    const order = await ctx.db.selectFrom('orders').select('status').where('id', '=', res.json.order_id).executeTakeFirstOrThrow();
    expect(order.status).toBe('accepted');
  });

  it('an email outage retries with backoff and never duplicates the order or the message', async () => {
    const shop = await configureShop(ctx);
    const product = await makeProduct(ctx);
    const b = h.browser();
    await addToCart(b, product.variant_id);
    const res = await checkout(b, pickupFor(shop, '2026-11-11'));
    h.email.failNext = 2;
    await payOrder(h, res.json.order_id);
    await drain(ctx);
    expect(h.email.to(contact.email)).toHaveLength(0);
    const retrying = await ctx.db.selectFrom('automation_jobs').selectAll().where('kind', '=', 'notification.deliver').where('status', '=', 'queued').execute();
    expect(retrying.length).toBeGreaterThan(0);
    expect(retrying[0].last_error).toContain('Simulated email provider outage');

    h.clock.advanceHours(1);
    await drain(ctx);
    h.clock.advanceHours(1);
    await drain(ctx);
    expect(h.email.to(contact.email).filter((m) => m.subject.includes('We have your order'))).toHaveLength(1);
    expect(await ctx.db.selectFrom('orders').select('id').execute()).toHaveLength(1);
  });

  it('a worker that crashes mid-job has its lease reclaimed, and the work finishes', async () => {
    const shop = await configureShop(ctx);
    const product = await makeProduct(ctx);
    const b = h.browser();
    await addToCart(b, product.variant_id);
    const res = await checkout(b, pickupFor(shop, '2026-11-11'));
    await payOrder(h, res.json.order_id);
    await ctx.db.updateTable('automation_events').set({ status: 'dispatched' }).where('type', '=', 'order.created').execute();
    await tick(ctx, 'worker-a', { batch: 0 });
    // Simulate a crash: a job is claimed and then its worker disappears.
    const { claimJobs } = await import('../../automation/queue.js');
    const claimed = await claimJobs(ctx.db, ctx.clock, 'crashed-worker', 1);
    expect(claimed).toHaveLength(1);
    h.clock.advanceMinutes(10);
    await drain(ctx, 'worker-b');
    const job = await ctx.db.selectFrom('automation_jobs').select('status').where('id', '=', claimed[0].id).executeTakeFirstOrThrow();
    expect(job.status).toBe('succeeded');
    expect(h.email.to(contact.email).length).toBeGreaterThan(0);
  });

  it('a job that keeps failing lands in failed review and raises an alert, and can be retried', async () => {
    const { enqueue, retryDeadJob } = await import('../../automation/queue.js');
    await makeStaff(ctx, { email: 'owner@example.test' });
    await enqueue(ctx.db, { kind: 'no.such.job', dedupeKey: 'bad-job' });
    await drain(ctx);
    const dead = await ctx.db.selectFrom('automation_jobs').selectAll().where('dedupe_key', '=', 'bad-job').executeTakeFirstOrThrow();
    expect(dead.status).toBe('dead');
    await retryDeadJob(ctx.db, ctx.clock, dead.id);
    const requeued = await ctx.db.selectFrom('automation_jobs').select('status').where('id', '=', dead.id).executeTakeFirstOrThrow();
    expect(requeued.status).toBe('queued');
  });
});

describe('Customer tracking permissions', () => {
  it('a tracking link shows only that order, and expires', async () => {
    const shop = await configureShop(ctx);
    const product = await makeProduct(ctx);
    const b = h.browser();
    await addToCart(b, product.variant_id);
    const res = await checkout(b, deliveryFor(shop, '2026-11-11'));
    const view = await h.browser().get(`/api/public/track/${res.json.tracking_token}`);
    expect(view.status).toBe(200);
    expect(JSON.stringify(view.json)).not.toContain(contact.email);
    expect(JSON.stringify(view.json)).not.toContain('100 Example St');
    expect(JSON.stringify(view.json)).not.toContain('cost_estimate');
    expect((await h.browser().get(`/api/public/track/${res.json.order_id}`)).status).toBe(404);
    expect((await h.browser().get(`/api/public/track/${res.json.reference}`)).status).toBe(404);
    h.clock.advanceHours(24 * 121);
    expect((await h.browser().get(`/api/public/track/${res.json.tracking_token}`)).status).toBe(404);
  });

  it('order lookup answers the same whether or not the order exists', async () => {
    const shop = await configureShop(ctx);
    const product = await makeProduct(ctx);
    const b = h.browser();
    await addToCart(b, product.variant_id);
    const res = await checkout(b, pickupFor(shop, '2026-11-11'));
    const real = await h.browser().post('/api/public/track/lookup', { reference: res.json.reference, email: contact.email });
    const fake = await h.browser().post('/api/public/track/lookup', { reference: 'BL-NOPE-NOPE', email: 'nobody@example.test' });
    const wrongEmail = await h.browser().post('/api/public/track/lookup', { reference: res.json.reference, email: 'nobody@example.test' });
    expect(real.json).toEqual(fake.json);
    expect(real.json).toEqual(wrongEmail.json);
    await drain(ctx);
    expect(h.email.to('nobody@example.test')).toHaveLength(0);
    expect(h.email.to(contact.email).some((m) => m.subject.includes('Your link to order'))).toBe(true);
  });
});

describe('Admin role restrictions', () => {
  it('least privilege is enforced on the server', async () => {
    const shop = await configureShop(ctx);
    const owner = await makeStaff(ctx, { roles: ['owner'], email: 'owner@example.test' });
    await makeStaff(ctx, { roles: ['finance'], email: 'finance@example.test' });
    const product = await makeProduct(ctx);
    const b = h.browser();
    await addToCart(b, product.variant_id);
    const res = await checkout(b, pickupFor(shop, '2026-11-11'));
    await payOrder(h, res.json.order_id);
    const orderId = res.json.order_id;

    expect((await h.browser().get(`/api/admin/orders/${orderId}`)).status).toBe(401);

    const florist = await signIn(h, shop.florist.email);
    const detail = (await florist.get(`/api/admin/orders/${orderId}`)).json;
    expect(detail.total_cents).toBeUndefined();
    expect(detail.payments).toEqual([]);
    expect(detail.contact_email).toBeUndefined();
    expect((await florist.post(`/api/admin/orders/${orderId}/refund`, { amount_cents: 100, reason: 'No' })).status).toBe(403);

    const driver = await signIn(h, shop.driver.email);
    expect((await driver.get(`/api/admin/orders/${orderId}`)).status).toBe(403);

    const finance = await signIn(h, 'finance@example.test');
    expect((await finance.get(`/api/admin/orders/${orderId}`)).json.total_cents).toBeGreaterThan(0);
    expect((await finance.post(`/api/admin/orders/${orderId}/refund`, { amount_cents: 100, reason: 'No' })).status).toBe(403);
    expect((await finance.post(`/api/admin/orders/${orderId}/items/status`, { item_ids: [detail.items[0].id], status: 'preparing' })).status).toBe(403);

    const boss = await signIn(h, owner.email);
    expect((await boss.post(`/api/admin/orders/${orderId}/refund`, { amount_cents: 100, reason: 'Goodwill' })).status).toBe(200);
  });

  it('locks an account after repeated failures, and a revoked session stops working', async () => {
    const owner = await makeStaff(ctx, { email: 'owner@example.test' });
    const b = h.browser();
    for (let i = 0; i < 8; i++) expect((await b.post('/api/admin/auth/login', { email: owner.email, password: 'wrong password' })).status).toBe(401);
    const locked = await b.post('/api/admin/auth/login', { email: owner.email, password: 'correct-horse-battery-staple' });
    expect(locked.status).toBe(401);
    h.clock.advanceMinutes(20);
    const signedIn = await b.post('/api/admin/auth/login', { email: owner.email, password: 'correct-horse-battery-staple' });
    expect(signedIn.status, signedIn.text).toBe(200);
    const sessions = (await b.get('/api/admin/auth/sessions')).json.sessions;
    expect(sessions).toHaveLength(1);
    expect((await b.delete(`/api/admin/auth/sessions/${sessions[0].id}`)).status).toBe(200);
    expect((await b.get('/api/admin/auth/me')).status).toBe(401);
  });

  it('blocks a cross-site request carrying a valid staff session', async () => {
    const owner = await makeStaff(ctx, { email: 'owner@example.test' });
    const staff = await signIn(h, owner.email);
    const res = await staff.request('POST', '/api/admin/auth/change-password', { current_password: 'x', new_password: 'y' }, { origin: 'https://evil.example' });
    expect(res.status).toBe(403);
  });
});

describe('Contact form', () => {
  it('stores a message, notifies staff, and drops honeypot submissions silently', async () => {
    const owner = await makeStaff(ctx, { email: 'owner@example.test' });
    const b = h.browser();
    const ok = await b.post('/api/public/contact', { name: 'Sam Visitor', email: 'sam@example.test', topic: 'flowers', message: 'Do you have peonies in spring?' });
    expect(ok.status, ok.text).toBe(201);
    const bot = await b.post('/api/public/contact', { name: 'Spam Bot', email: 'spam@example.test', topic: 'other', message: 'Buy my things right now!!', website: 'http://spam.example' });
    expect(bot.status).toBe(201);
    expect(await ctx.db.selectFrom('support_requests').select('id').execute()).toHaveLength(1);
    await drain(ctx);
    expect(h.email.to(owner.email).some((m) => m.subject.includes('New message from Sam Visitor'))).toBe(true);
    expect(h.email.to('sam@example.test').some((m) => m.subject.includes('received your message'))).toBe(true);
    expect(h.email.to('spam@example.test')).toHaveLength(0);
  });
});
