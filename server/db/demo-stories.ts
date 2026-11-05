import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import { createApp } from '../app.js';
import type { AppContext } from '../context.js';
import { drain } from '../automation/worker.js';
import { mockEvent, mockSignature } from '../integrations/payments/mock.js';
import { mintAccessToken } from '../lib/tokens.js';
import { businessTimezone } from '../modules/settings/service.js';

/**
 * Fictional activity for a demonstration environment, created through the real HTTP handlers, the
 * same way a customer and the team would: carts, checkouts, simulated payments with signed webhooks,
 * staff updates, wedding plans, quotes, deposits and consultations. Nothing is inserted behind the
 * application's back, so every record passes the same rules and record checks as real ones.
 *
 * It gives the dashboard a realistic day, and sets up the scenarios the demonstration guide uses:
 * a fully booked wedding date, a full Saturday delivery window, a driver's day off, and an order
 * waiting for review.
 */

type Result = { status: number; json: any; text: string };

class Client {
  private cookies = new Map<string, string>();
  constructor(private app: ReturnType<typeof createApp>) {}
  async request(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Result> {
    const res = await this.app.request(path, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(this.cookies.size ? { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
        ...headers,
      },
      body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i);
      const value = pair.slice(i + 1);
      if (value) this.cookies.set(name, value);
      else this.cookies.delete(name);
    }
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, json, text };
  }
  get = (p: string) => this.request('GET', p);
  post = (p: string, b: unknown = {}) => this.request('POST', p, b);
}

const must = (res: Result, what: string, expected = [200, 201]) => {
  if (!expected.includes(res.status)) throw new Error(`Demo story failed at "${what}" (${res.status}): ${res.text.slice(0, 300)}`);
  return res.json;
};

export async function runDemoStories(ctx: AppContext, opts: { password: string; log: (m: string) => void }) {
  const { log } = opts;
  if (ctx.payments.name !== 'mock') {
    log('Demo stories need PAYMENTS_MODE=mock, so no fictional payments are taken. Skipped.');
    return;
  }
  const app = createApp(ctx);
  const tz = await businessTimezone(ctx.db);
  const now = DateTime.fromJSDate(ctx.clock.now(), { zone: tz });
  const today = now.toISODate() as string;
  // Weekday numbers here follow JavaScript: 0 is Sunday and 6 is Saturday.
  const next = (weekday: number, minDays: number) => {
    let d = now.plus({ days: minDays });
    while (d.weekday % 7 !== weekday) d = d.plus({ days: 1 });
    return d.toISODate() as string;
  };
  const saturdaySoon = next(6, 2);
  const driverDayOff = next(2, 3);
  const bookedEventDate = next(6, 70);
  const plannedEventDate = next(6, 200);

  const staff = new Client(app);
  must(await staff.post('/api/admin/auth/login', { email: 'owner@demo.example', password: opts.password }), 'owner sign-in');
  const team = must(await staff.get('/api/admin/team'), 'team').staff as Array<{ id: string; display_name: string; email: string }>;
  const person = (email: string) => team.find((t) => t.email === email)?.id as string;

  const product = async (slug: string) => must(await new Client(app).get(`/api/public/products/${slug}`), `product ${slug}`) as { variants: Array<{ id: string; name: string }> };

  async function order(input: {
    who: string;
    email: string;
    items: Array<{ slug: string; variant?: string; quantity?: number; options?: Record<string, string> }>;
    method: 'pickup' | 'delivery';
    pick: (slots: Array<{ date: string; window_id: string; start: string; status: string }>) => { date: string; window_id: string } | undefined;
    pay?: boolean;
  }) {
    const shopper = new Client(app);
    for (const item of input.items) {
      const p = await product(item.slug);
      const variant = item.variant ? p.variants.find((v) => v.name === item.variant) : p.variants[0];
      must(await shopper.post('/api/public/cart/items', { variant_id: variant?.id, quantity: item.quantity ?? 1, options: item.options ?? {} }), `add ${item.slug}`);
    }
    const cart = must(await shopper.get('/api/public/cart'), 'cart');
    const lineIds = cart.lines.map((l: { id: string }) => l.id);
    const slots = must(await shopper.post('/api/public/availability/slots', { method: input.method, postal_code: input.method === 'delivery' ? '48609' : null, line_ids: lineIds }), 'slots');
    // Custom work is offered as "the shop confirms first" rather than open, and that is what the customer would pick.
    const slot = input.pick(slots.slots.filter((s: { status: string }) => s.status === (input.pay === false ? 'review' : 'open')));
    if (!slot) throw new Error(`Demo story found no open ${input.method} time for ${input.who}.`);
    const placed = must(
      await shopper.post('/api/public/checkout', {
        idempotency_key: `demo-${randomUUID()}`,
        contact: { name: input.who, email: input.email, phone: null },
        consents: {},
        fulfillments: [
          {
            line_ids: lineIds,
            method: input.method,
            date: slot.date,
            window_id: slot.window_id,
            ...(input.method === 'delivery' ? { address: { line1: '100 Example Avenue', line2: null, city: 'Saginaw', region: 'MI', postal_code: '48609' }, recipient_name: input.who } : {}),
          },
        ],
      }),
      `checkout for ${input.who}`,
    );
    if (input.pay !== false && placed.next?.type === 'redirect') await pay(placed.order_id, null);
    const ref = await ctx.db.selectFrom('orders').select(['reference', 'status']).where('id', '=', placed.order_id).executeTakeFirstOrThrow();
    return { id: placed.order_id as string, reference: ref.reference, status: ref.status, tracking: placed.tracking_token as string, date: slot.date };
  }

  /** Completes the simulated payment exactly as the gateway would: a signed webhook to the real endpoint. */
  async function pay(orderId: string | null, invoiceId: string | null) {
    let query = ctx.db.selectFrom('payments').select('id').orderBy('created_at', 'desc');
    query = orderId ? query.where('order_id', '=', orderId) : query.where('invoice_id', '=', invoiceId as string);
    const payment = await query.executeTakeFirstOrThrow();
    const session = await ctx.db.selectFrom('mock_gateway_sessions').selectAll().where('payment_id', '=', payment.id).executeTakeFirstOrThrow();
    const event = mockEvent('checkout.session.completed', {
      id: session.id,
      object: 'checkout.session',
      status: 'complete',
      payment_status: 'paid',
      amount_total: session.amount_cents,
      payment_intent: session.payment_intent_id,
      metadata: session.metadata,
      expires_at: Math.floor(session.expires_at.getTime() / 1000),
      livemode: false,
    });
    const body = JSON.stringify(event);
    must(await new Client(app).request('POST', '/api/webhooks/stripe', body, { 'stripe-signature': mockSignature(body) }), 'simulated payment webhook');
    await ctx.db.updateTable('mock_gateway_sessions').set({ status: 'paid' }).where('id', '=', session.id).execute();
  }

  const items = async (orderId: string) => (await ctx.db.selectFrom('order_items').select('id').where('order_id', '=', orderId).execute()).map((i) => i.id);
  const move = async (orderId: string, status: string) => must(await staff.post(`/api/admin/orders/${orderId}/items/status`, { item_ids: await items(orderId), status }), `move to ${status}`);

  const firstAfterToday = (start?: string) => (slots: Array<{ date: string; window_id: string; start: string }>) =>
    slots.find((s) => s.date > today && (!start || DateTime.fromISO(s.start, { zone: tz }).toFormat('HH:mm') === start));

  // A normal day of orders, at different stages.
  const jordan = await order({ who: 'Jordan Example', email: 'jordan@demo.example', items: [{ slug: 'demo-classic-roses', variant: 'A dozen', options: { rose_color: 'Red', card_message: 'Happy anniversary. Love, J.' } }], method: 'pickup', pick: firstAfterToday() });
  must(await staff.post('/api/admin/assignments', { subject_type: 'order', subject_id: jordan.id, staff_id: person('florist@demo.example'), role: 'Lead florist' }), 'assign florist');
  await move(jordan.id, 'preparing');

  const taylor = await order({ who: 'Taylor Example', email: 'taylor@demo.example', items: [{ slug: 'demo-soy-candle' }], method: 'pickup', pick: firstAfterToday() });
  await move(taylor.id, 'ready');

  const avery = await order({ who: 'Avery Example', email: 'avery@demo.example', items: [{ slug: 'demo-white-bouquet', options: { card_message: 'Thinking of you.' } }], method: 'delivery', pick: firstAfterToday('14:00') });
  for (const status of ['preparing', 'ready', 'out_for_delivery', 'fulfilled']) await move(avery.id, status);

  // Saturday morning deliveries fill up, so the guide can show a full window.
  const saturday = [] as Array<{ reference: string }>;
  for (const [who, email] of [['Morgan Example', 'morgan@demo.example'], ['Reese Example', 'reese@demo.example'], ['Drew Example', 'drew@demo.example']]) {
    saturday.push(
      await order({ who, email, items: [{ slug: 'demo-premium-mixed', variant: 'Standard' }], method: 'delivery', pick: (slots) => slots.find((s) => s.date === saturdaySoon && DateTime.fromISO(s.start, { zone: tz }).toFormat('HH:mm') === '10:00') }),
    );
  }

  // A custom request that waits for the shop's decision before any payment.
  const casey = await order({ who: 'Casey Example', email: 'casey@demo.example', items: [{ slug: 'demo-custom-design', options: { occasion: 'Retirement party', colors: 'Gold and deep red, nothing too tall' } }], method: 'pickup', pick: (slots) => slots[slots.length - 1], pay: false });

  // The only driver is away one day, so delivery is not offered then.
  must(await staff.post(`/api/admin/team/${person('driver@demo.example')}/time-off`, { starts_on: driverDayOff, ends_on: driverDayOff, kind: 'day_off' }), 'driver day off');

  // Two confirmed weddings on one date use both crews and both arches.
  const options = must(await new Client(app).get('/api/public/planner/options'), 'planner options');
  const service = (code: string) => options.categories.flatMap((c: { services: Array<{ id: string; name: string }> }) => c.services).find((s: { name: string }) => s.name.startsWith(code))?.id as string;
  const rental = (name: string) => options.rentals.find((r: { name: string }) => r.name.startsWith(name))?.id as string;

  async function plan(who: string, email: string, date: string, extra: Record<string, unknown> = {}) {
    const customer = new Client(app);
    const res = must(
      await customer.post('/api/public/planner/submit', {
        idempotency_key: `demo-${randomUUID()}`,
        contact: { name: who, email, phone: null },
        event_type: 'Wedding',
        event_date: date,
        ceremony_time: '15:00',
        reception_time: '17:00',
        venue_name: 'Fictional Orchard Barn',
        venue_address: '1 Orchard Lane, Saginaw, MI',
        guest_count: 120,
        budget_range: '$5,000 – $10,000',
        consultation_format: 'In the shop',
        style: { colors: 'Blush, ivory and sage', theme: 'Garden', floral_styles: ['Garden', 'Romantic'], preferences: 'Soft and loose, with lots of greenery.', must_haves: 'Peonies if in season' },
        selections: [
          { service_id: service('Bridal bouquet'), quantity: 1 },
          { service_id: service('Bridesmaid bouquets'), quantity: 4 },
          { service_id: service('Reception centerpiece package'), quantity: 1 },
          { rental_item_id: rental('Birch ceremony arch'), quantity: 1 },
          { rental_item_id: rental('Decorative vases'), quantity: 20 },
        ],
        ...extra,
      }),
      `wedding plan for ${who}`,
    );
    const inquiry = await ctx.db.selectFrom('wedding_inquiries').select('id').where('reference', '=', res.reference).executeTakeFirstOrThrow();
    return { id: inquiry.id, reference: res.reference as string, portal: res.portal_token as string, customer };
  }

  async function book(who: string, email: string, deposit: number) {
    const p = await plan(who, email, bookedEventDate);
    must(await staff.post(`/api/admin/weddings/${p.id}/accept`, {}), 'accept inquiry');
    const quote = must(
      await staff.post(`/api/admin/weddings/${p.id}/quotes`, {
        lines: [
          { description: 'Bridal bouquet', quantity: 1, unit_price_cents: 22000, service_id: service('Bridal bouquet') },
          { description: 'Bridesmaid bouquets', quantity: 4, unit_price_cents: 8500, service_id: service('Bridesmaid bouquets') },
          { description: 'Reception centerpiece package', quantity: 1, unit_price_cents: 95000, service_id: service('Reception centerpiece package') },
          { description: 'Birch ceremony arch rental', quantity: 1, unit_price_cents: 15000, rental_item_id: rental('Birch ceremony arch'), taxable: false },
        ],
        deposit_cents: deposit,
      }),
      'quote',
    );
    must(await staff.post(`/api/admin/weddings/quotes/${quote.id}/send`, {}), 'send quote');
    const token = await mintAccessToken(ctx.db, ctx.clock, { purpose: 'quote_access', subjectId: quote.id, ttlMinutes: 60 * 24 * 14 });
    const accepted = must(await p.customer.post(`/api/public/quotes/${token}/accept`, { name: who, agree: true }), 'accept quote');
    if (deposit > 0 && accepted.pay_token) {
      must(await p.customer.post(`/api/public/pay/${accepted.pay_token}`, {}), 'start deposit payment');
      const invoice = await ctx.db.selectFrom('invoices').select('id').where('quote_id', '=', quote.id).where('kind', '=', 'deposit').executeTakeFirstOrThrow();
      await pay(null, invoice.id);
    }
    return p;
  }
  const harper = await book('Harper Example', 'harper@demo.example', 50000);
  const quinn = await book('Quinn Example', 'quinn@demo.example', 0);

  // A new inquiry, as if sent late at night, with a consultation booked from the times offered.
  const riley = await plan('Riley Example', 'riley@demo.example', plannedEventDate);
  const slots = must(await riley.customer.get(`/api/public/plan/${riley.portal}/consultation-slots`), 'consultation times');
  if (slots.slots?.length) must(await riley.customer.post(`/api/public/plan/${riley.portal}/consultation`, { starts_at: new Date(slots.slots[0].start).toISOString(), format: 'In the shop' }), 'book consultation');

  await drain(ctx);

  const bookings = await ctx.db.selectFrom('event_bookings').select('status').where('event_date', '=', bookedEventDate).where('status', '=', 'confirmed').execute();
  log('');
  log('Demo stories created through the application:');
  log(`  Orders: ${jordan.reference} preparing, ${taylor.reference} ready for pickup, ${avery.reference} delivered, ${casey.reference} awaiting review`);
  log(`  Saturday ${saturdaySoon} morning delivery window filled by ${saturday.map((o) => o.reference).join(', ')}`);
  log(`  Driver away on ${driverDayOff}`);
  log(`  ${bookings.length} confirmed weddings on ${bookedEventDate} (${harper.reference}, ${quinn.reference}), using both crews and both arches`);
  log(`  New inquiry ${riley.reference} for ${plannedEventDate}${slots.slots?.length ? ', with a consultation booked' : ''}`);
}
