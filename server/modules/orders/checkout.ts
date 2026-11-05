import { z } from 'zod';
import type { AppContext } from '../../context.js';
import type { Db, Trx } from '../../db/client.js';
import { sql } from 'kysely';
import { audit, type Actor } from '../../lib/audit.js';
import { AppError, badRequest, conflict, unavailable } from '../../lib/errors.js';
import { generateReference, mintAccessToken } from '../../lib/tokens.js';
import { addDays, addHours, addMinutes, localDate } from '../../lib/time.js';
import { toE164 } from '../../lib/phone.js';
import { businessTimezone } from '../settings/service.js';
import { emit, raiseAlert } from '../../automation/events.js';
import {
  evaluateSlot,
  findZone,
  listSlots,
  loadPolicyContext,
  type Demand,
  type PolicyContext,
  type Reason,
  type Slot,
} from '../availability/engine.js';
import { checkPromotion, computeTotals, findPromotion, redeemPromotion, type PromotionRow, type Totals } from '../cart/pricing.js';
import { loadCartLines, type CartLine } from '../cart/lines.js';
import { requirementsForVariants } from '../inventory/requirements.js';
import { availabilityOf, recordBackorder, reserveStock } from '../inventory/service.js';
import { createOrderTasks, releaseOrderHolds, transitionOrder, writeHistory } from './workflow.js';
import { ensureCheckoutSession } from '../payments/service.js';
import type { CartRow } from '../cart/service.js';

const addressSchema = z.object({
  line1: z.string().trim().min(3, 'Please enter the street address.').max(200),
  line2: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().min(2, 'Please enter the city.').max(100),
  region: z.string().trim().length(2, 'Please use the two-letter state.').transform((s) => s.toUpperCase()),
  postal_code: z.string().trim().regex(/^\d{5}(-\d{4})?$/, 'Please enter a 5-digit ZIP code.'),
});

export const fulfillmentInput = z.object({
  line_ids: z.array(z.string().uuid()).min(1),
  method: z.enum(['pickup', 'delivery', 'shipping']),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  window_id: z.string().uuid().optional().nullable(),
  recipient_name: z.string().trim().max(120).optional().nullable(),
  recipient_phone: z.string().trim().max(30).optional().nullable(),
  address: addressSchema.optional().nullable(),
  instructions: z.string().trim().max(1000).optional().nullable(),
  card_message: z.string().trim().max(500).optional().nullable(),
});

export const contactSchema = z.object({
  name: z.string().trim().min(2, 'Please enter your name.').max(120),
  email: z.string().trim().toLowerCase().email('Please check your email address.').max(200),
  phone: z
    .string()
    .trim()
    .max(30)
    .optional()
    .nullable()
    .refine((v) => !v || toE164(v), 'Please enter a 10-digit US phone number.'),
});

export const consentsSchema = z
  .object({
    sms_transactional: z.boolean().default(false),
    sms_marketing: z.boolean().default(false),
    email_marketing: z.boolean().default(false),
  })
  .default({ sms_transactional: false, sms_marketing: false, email_marketing: false });

export const quoteSchema = z.object({ fulfillments: z.array(fulfillmentInput).min(1).max(10) });

export const checkoutSchema = quoteSchema.extend({
  idempotency_key: z.string().min(8).max(100),
  contact: contactSchema,
  note: z.string().trim().max(1000).optional().nullable(),
  consents: consentsSchema,
  expected_total_cents: z.number().int().min(0).optional(),
});

export type FulfillmentInput = z.output<typeof fulfillmentInput>;
export type CheckoutInput = z.output<typeof checkoutSchema>;

type EvaluatedFulfillment = {
  input: FulfillmentInput;
  lines: CartLine[];
  fee_cents: number;
  zone_id: string | null;
  slot: Slot | null;
  status: 'open' | 'review' | 'blocked';
  reasons: Reason[];
  alternatives: Array<Pick<Slot, 'date' | 'window_id' | 'start' | 'end' | 'status'>>;
};

const demandFor = (lines: CartLine[]): Demand => ({
  lines,
  subtotal_cents: lines.reduce((s, l) => s + l.line_subtotal_cents, 0),
});

const alternativesFor = (ctx: PolicyContext, demand: Demand, method: 'pickup' | 'delivery', zone: ReturnType<typeof findZone>, from: string) =>
  listSlots(ctx, demand, method, zone, from, ctx.settings.ordering.slot_horizon_days)
    .filter((s) => s.status !== 'blocked')
    .slice(0, 5)
    .map((s) => ({ date: s.date, window_id: s.window_id, start: s.start, end: s.end, status: s.status }));

function evaluateFulfillment(ctx: PolicyContext, input: FulfillmentInput, lines: CartLine[]): EvaluatedFulfillment {
  const demand = demandFor(lines);
  const today = localDate(ctx.now, ctx.tz);
  const fail = (code: string, message: string, alternatives: EvaluatedFulfillment['alternatives'] = []): EvaluatedFulfillment => ({
    input,
    lines,
    fee_cents: 0,
    zone_id: null,
    slot: null,
    status: 'blocked',
    reasons: [{ code, message }],
    alternatives,
  });

  for (const line of lines) {
    if (!line.methods.includes(input.method)) return fail('method_not_allowed', `${line.name} cannot be sent by ${input.method}.`);
  }

  if (input.method === 'shipping') {
    const s = ctx.settings.delivery;
    if (!s.shipping_enabled || s.shipping_flat_cents === null) return fail('shipping_unavailable', 'Shipping is not available right now.');
    if (!input.address) return fail('address_required', 'Please enter a shipping address.');
    if (!s.shipping_allowed_states.includes(input.address.region)) return fail('shipping_region', `The shop does not ship to ${input.address.region}.`);
    const free = s.shipping_free_over_cents !== null && demand.subtotal_cents >= s.shipping_free_over_cents;
    const reviews: Reason[] = ctx.settings.approved.delivery ? [] : [{ code: 'policy_unapproved', message: 'Delivery rules are not approved yet, so the shop confirms each order by hand.' }];
    if (!ctx.settings.approved.ordering) reviews.push({ code: 'policy_unapproved', message: 'Ordering rules are not approved yet, so the shop confirms each order by hand.' });
    return { input, lines, fee_cents: free ? 0 : s.shipping_flat_cents, zone_id: null, slot: null, status: reviews.length ? 'review' : 'open', reasons: reviews, alternatives: [] };
  }

  const zone = input.method === 'delivery' ? findZone(ctx, input.address?.postal_code) : null;
  if (input.method === 'delivery') {
    if (!input.address) return fail('address_required', 'Please enter a delivery address.');
    if (!zone) {
      return fail('no_zone', 'That address is outside the delivery area. You can choose pickup instead, or call the shop to ask.', alternativesFor(ctx, demand, 'pickup', null, today));
    }
  }
  if (!input.date || !input.window_id) {
    return fail('slot_required', 'Please choose a date and time.', alternativesFor(ctx, demand, input.method, zone, today));
  }
  const window = ctx.windows.find((w) => w.id === input.window_id && w.kind === input.method);
  if (!window) return fail('slot_unavailable', 'That time is no longer offered.', alternativesFor(ctx, demand, input.method, zone, today));

  const slot = evaluateSlot(ctx, demand, input.method, input.date, window, zone);
  const reviews: Reason[] = [];
  if (slot.status !== 'blocked' && input.method === 'delivery' && !ctx.settings.approved.delivery) {
    reviews.push({ code: 'policy_unapproved', message: 'Delivery rules are not approved yet, so the shop confirms each order by hand.' });
  }
  const status = slot.status === 'open' && reviews.length ? 'review' : slot.status;
  return {
    input,
    lines,
    fee_cents: zone?.fee_cents ?? 0,
    zone_id: zone?.id ?? null,
    slot,
    status,
    reasons: [...slot.reasons, ...reviews],
    alternatives: status === 'blocked' ? alternativesFor(ctx, demand, input.method, zone, today) : [],
  };
}

function matchLines(all: CartLine[], fulfillments: FulfillmentInput[]) {
  const seen = new Set<string>();
  const matched = fulfillments.map((f) => {
    const lines = f.line_ids.map((id) => {
      const line = all.find((l) => l.id === id);
      if (!line) throw conflict('cart_changed', 'Your cart changed. Please review it and try again.');
      if (seen.has(id)) throw badRequest('An item cannot be in two fulfilments.');
      seen.add(id);
      return line;
    });
    return { input: f, lines };
  });
  if (seen.size !== all.length) throw badRequest('Please choose how to receive every item.');
  return matched;
}

async function resolvePromotion(db: Db, ctx: AppContext, cart: CartRow, lines: CartLine[]): Promise<{ promotion: PromotionRow | null; error: string | null }> {
  if (!cart.promotion_code) return { promotion: null, error: null };
  const check = checkPromotion(await findPromotion(db, cart.promotion_code), ctx.clock.now(), lines);
  return check.ok ? { promotion: check.promotion, error: null } : { promotion: null, error: check.message };
}

async function stockProblems(db: Db, lines: CartLine[], behaviorDefault: string) {
  const reqs = await requirementsForVariants(db, lines.map((l) => l.variant_id));
  const avail = await availabilityOf(db, [...new Set([...reqs.values()].flat().map((r) => r.item_id))]);
  const remaining = new Map([...avail].map(([id, a]) => [id, a.available]));
  const problems: Array<{ line_id: string; name: string; item: string; behavior: string; available: number }> = [];
  for (const line of lines) {
    const behavior = line.out_of_stock_behavior ?? behaviorDefault;
    for (const req of reqs.get(line.variant_id) ?? []) {
      const need = req.per_unit * line.quantity;
      const have = remaining.get(req.item_id) ?? 0;
      if (have < need) problems.push({ line_id: line.id, name: line.name, item: req.name, behavior, available: Math.floor(have / req.per_unit) });
      remaining.set(req.item_id, have - need);
    }
  }
  return problems;
}

/** Summary for the checkout page. Binding checks happen again, under locks, when the order is placed. */
export async function quoteCheckout(ctx: AppContext, cart: CartRow, fulfillments: FulfillmentInput[]) {
  const lines = await loadCartLines(ctx.db, cart.id);
  if (!lines.length) throw conflict('cart_empty', 'Your cart is empty.');
  const matched = matchLines(lines, fulfillments);
  const tz = await businessTimezone(ctx.db);
  const today = localDate(ctx.clock.now(), tz);
  const dates = matched.map((m) => m.input.date).filter(Boolean) as string[];
  const horizon = addDays(today, 100, tz);
  const to = dates.reduce((a, b) => (a > b ? a : b), horizon);
  const policy = await loadPolicyContext(ctx.db, ctx.clock, addDays(today, -1, tz), to);
  const evaluated = matched.map((m) => evaluateFulfillment(policy, m.input, m.lines));
  const { promotion, error: promotionError } = await resolvePromotion(ctx.db, ctx, cart, lines);
  const totals = computeTotals(lines, evaluated.map((e) => ({ method: e.input.method, fee_cents: e.fee_cents })), promotion, policy.settings.tax);
  const stock = await stockProblems(ctx.db, lines, policy.settings.ordering.out_of_stock_behavior);
  const blockers: Reason[] = [];
  for (const line of lines) for (const p of line.problems) blockers.push({ code: 'line_problem', message: `${line.name}: ${p}` });
  if (totals.tax_missing.length) blockers.push({ code: 'tax_not_configured', message: 'Sales tax is not set up yet, so online checkout is closed. Please call the shop to order.' });
  if (ctx.payments.name === 'disabled') blockers.push({ code: 'payments_disabled', message: 'Online payment is not available yet. Please call the shop to place your order.' });
  for (const s of stock.filter((x) => x.behavior === 'reject')) {
    blockers.push({ code: 'out_of_stock', message: s.available > 0 ? `Only ${s.available} of ${s.name} left.` : `${s.name} is out of stock.` });
  }
  const reviewReasons = [
    ...evaluated.flatMap((e) => (e.status === 'review' ? e.reasons : [])),
    ...stock.filter((x) => x.behavior !== 'reject').map((s) => ({ code: s.behavior === 'backorder' ? 'backorder' : 'inventory_review', message: `${s.name} is short on stock, so the shop confirms timing first.` })),
  ];
  const acceptance = reviewReasons.length ? 'review' : 'auto';
  return {
    totals: publicTotals(totals),
    fulfillments: evaluated.map((e) => ({
      line_ids: e.input.line_ids,
      method: e.input.method,
      date: e.input.date ?? null,
      window_id: e.input.window_id ?? null,
      fee_cents: e.fee_cents,
      status: e.status,
      reasons: e.reasons,
      alternatives: e.alternatives,
      window_start: e.slot?.start ?? null,
      window_end: e.slot?.end ?? null,
    })),
    blockers,
    promotion_error: promotionError,
    acceptance,
    review_reasons: dedupeReasons(reviewReasons),
    review_timing: policy.settings.ordering.review_timing,
    can_place: blockers.length === 0 && evaluated.every((e) => e.status !== 'blocked'),
    sms_available: ctx.sms.enabled,
    sms_consent_text: { transactional: policy.settings.sms.consent_text_transactional, marketing: policy.settings.sms.consent_text_marketing },
    refund_policy: policy.settings.refunds.policy_text,
  };
}

const dedupeReasons = (reasons: Reason[]) => [...new Map(reasons.map((r) => [r.code + r.message, r])).values()];

const publicTotals = (t: Totals) => ({
  subtotal_cents: t.subtotal_cents,
  discount_cents: t.discount_cents,
  delivery_cents: t.delivery_cents,
  shipping_cents: t.shipping_cents,
  tax_cents: t.tax_cents,
  total_cents: t.total_cents,
});

export async function upsertCustomer(trx: Db, contact: { name: string; email: string; phone?: string | null }, source: string) {
  const phone = toE164(contact.phone);
  // A guest cannot overwrite an existing customer's details: their email is unverified at this point.
  const row = await trx
    .insertInto('customers')
    .values({ email: contact.email, name: contact.name, phone_e164: phone, source })
    .onConflict((oc) =>
      oc.column('email').doUpdateSet({
        phone_e164: sql`COALESCE(customers.phone_e164, excluded.phone_e164)`,
        updated_at: sql`now()`,
      }),
    )
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

export async function recordConsents(
  trx: Db,
  customerId: string,
  phone: string | null,
  consents: { sms_transactional?: boolean; sms_marketing?: boolean; email_marketing?: boolean },
  meta: { source: string; ip?: string | null; userAgent?: string | null; smsTransactionalText?: string; smsMarketingText?: string },
) {
  const rows: Array<{ channel: 'sms' | 'email'; purpose: 'transactional' | 'marketing'; text?: string; phone?: string | null }> = [];
  // Only an explicit, affirmative choice is recorded. An unticked box creates nothing.
  if (consents.sms_transactional && phone) rows.push({ channel: 'sms', purpose: 'transactional', text: meta.smsTransactionalText, phone });
  if (consents.sms_marketing && phone) rows.push({ channel: 'sms', purpose: 'marketing', text: meta.smsMarketingText, phone });
  if (consents.email_marketing) rows.push({ channel: 'email', purpose: 'marketing', text: 'Send me occasional news and offers by email.' });
  for (const r of rows) {
    await trx
      .insertInto('customer_consents')
      .values({
        customer_id: customerId,
        channel: r.channel,
        purpose: r.purpose,
        granted: true,
        source: meta.source,
        phone_e164: r.phone ?? null,
        disclosure_text: r.text ?? null,
        ip: meta.ip ?? null,
        user_agent: meta.userAgent?.slice(0, 300) ?? null,
      })
      .execute();
  }
}

class ShortageError extends Error {
  constructor(
    public line: CartLine,
    public itemId: string,
    public itemName: string,
  ) {
    super('shortage');
  }
}

export type PlacedOrder = {
  order_id: string;
  reference: string;
  status: string;
  tracking_token: string;
  next: { type: 'redirect'; url: string } | { type: 'review'; message: string } | { type: 'complete' } | { type: 'retry'; message: string };
};

/** Consistent lock order so two checkouts for overlapping dates cannot deadlock. */
async function lockCapacityDates(trx: Trx, dates: string[]) {
  for (const date of [...new Set(dates)].sort()) {
    await sql`SELECT pg_advisory_xact_lock(hashtext(${`capacity:${date}`}))`.execute(trx);
  }
}

export async function insertClaims(trx: Db, orderId: string, fulfillmentId: string, date: string | null, windowId: string | null, lines: CartLine[]) {
  if (!date) return;
  const prep = lines.reduce((s, l) => s + l.prep_minutes, 0);
  const points = lines.reduce((s, l) => s + l.complexity_points, 0);
  await trx
    .insertInto('capacity_claims')
    .values({
      claim_date: date,
      division_id: lines[0]?.division_id ?? null,
      points,
      prep_minutes: prep,
      counts_as_order: prep > 0 || points > 0,
      stops: 1,
      window_id: windowId,
      order_id: orderId,
      fulfillment_id: fulfillmentId,
    })
    .execute();
}

/**
 * Turns a cart into an order inside one transaction: revalidate under lock, price on the server,
 * reserve stock, claim capacity, write everything. Payment is started only after commit, so a payment
 * provider outage can never lose an order, and a retry with the same key can never create a second.
 */
export async function placeOrder(ctx: AppContext, cart: CartRow, input: CheckoutInput, actor: Actor, userAgent?: string | null): Promise<PlacedOrder> {
  // A retry resumes its own order. A key seen on another cart reveals nothing about that order.
  const resumeIfOurs = async (order: { id: string; reference: string; status: string; cart_id: string | null }) => {
    if (order.cart_id !== cart.id) throw conflict('idempotency_conflict', 'That request could not be matched to your cart. Please refresh the page and try again.');
    return resumeOrder(ctx, order);
  };
  const existing = await ctx.db.selectFrom('orders').select(['id', 'reference', 'status', 'cart_id']).where('idempotency_key', '=', input.idempotency_key).executeTakeFirst();
  if (existing) return resumeIfOurs(existing);

  if (ctx.payments.name === 'disabled') {
    throw unavailable('payments_disabled', 'Online payment is not available yet. Please call the shop to place your order.');
  }

  let result: { orderId: string; reference: string; status: string; paymentId: string | null; expiresAt: Date | null; supersededSessions: string[] };
  try {
    result = await ctx.db.transaction().execute(async (trx) => placeOrderTx(ctx, trx, cart, input, actor, userAgent));
  } catch (err) {
    if (err instanceof ShortageError) {
      await recordShortage(ctx, err);
      throw conflict('out_of_stock', err.line.name === err.itemName ? `${err.line.name} just sold out.` : `${err.line.name} cannot be made right now because ${err.itemName} is out of stock.`, {
        line_id: err.line.id,
      });
    }
    if ((err as { code?: string; constraint?: string }).code === '23505' && (err as { constraint?: string }).constraint === 'orders_idempotency_key_key') {
      const again = await ctx.db.selectFrom('orders').select(['id', 'reference', 'status', 'cart_id']).where('idempotency_key', '=', input.idempotency_key).executeTakeFirstOrThrow();
      return resumeIfOurs(again);
    }
    throw err;
  }

  for (const id of result.supersededSessions) {
    await ctx.payments.expireCheckoutSession(id).catch((err) => ctx.log.warn('could not expire superseded session', { error: err }));
  }
  return finishPlacement(ctx, result);
}

async function recordShortage(ctx: AppContext, err: ShortageError) {
  const day = localDate(ctx.clock.now(), await businessTimezone(ctx.db));
  await emit(ctx.db, 'inventory.shortage', { type: 'inventory_item', id: err.itemId }, { note: `Blocked an order for ${err.line.name}.` }, `shortage:${err.itemId}:${day}`);
  await raiseAlert(ctx.db, {
    code: 'inventory_shortage',
    title: `Out of stock: ${err.itemName}`,
    detail: `A customer tried to order ${err.line.name}, which needs ${err.itemName}.`,
    subject: { type: 'inventory_item', id: err.itemId },
    link: `/admin/inventory/items/${err.itemId}`,
    dedupeKey: `shortage:${err.itemId}`,
  });
}

async function resumeOrder(ctx: AppContext, order: { id: string; reference: string; status: string }): Promise<PlacedOrder> {
  const payment = await ctx.db
    .selectFrom('payments')
    .select(['id', 'session_expires_at'])
    .where('order_id', '=', order.id)
    .where('status', 'in', ['pending'])
    .orderBy('created_at', 'desc')
    .executeTakeFirst();
  return finishPlacement(ctx, { orderId: order.id, reference: order.reference, status: order.status, paymentId: payment?.id ?? null });
}

async function finishPlacement(ctx: AppContext, r: { orderId: string; reference: string; status: string; paymentId: string | null }): Promise<PlacedOrder> {
  const tracking_token = await mintAccessToken(ctx.db, ctx.clock, { purpose: 'order_access', subjectId: r.orderId, ttlMinutes: 60 * 24 * 120 });
  const base = { order_id: r.orderId, reference: r.reference, status: r.status, tracking_token };
  if (r.status === 'awaiting_review') {
    return { ...base, next: { type: 'review', message: 'Your request is with the shop. You have not been charged.' } };
  }
  if (!r.paymentId) return { ...base, next: { type: 'complete' } };
  try {
    const { url } = await ensureCheckoutSession(ctx, r.paymentId, tracking_token);
    return { ...base, next: { type: 'redirect', url } };
  } catch (err) {
    if (err instanceof AppError && err.code === 'payment_already_settled') return { ...base, next: { type: 'complete' } };
    // The order and its holds are safely stored. The customer can retry without creating a duplicate.
    ctx.log.error('payment provider unavailable at checkout', { error: err, order: r.reference });
    return { ...base, next: { type: 'retry', message: 'We saved your order, but could not reach the payment provider. Please try paying again in a moment.' } };
  }
}

async function placeOrderTx(ctx: AppContext, trx: Trx, cart: CartRow, input: CheckoutInput, actor: Actor, userAgent?: string | null) {
  const now = ctx.clock.now();
  const locked = await trx.selectFrom('carts').select(['id', 'status', 'promotion_code', 'saved_details', 'customer_id', 'attribution']).where('id', '=', cart.id).forUpdate().executeTakeFirst();
  if (!locked || locked.status === 'converted') throw conflict('cart_closed', 'This order has already been placed.');

  // Replacing an unpaid attempt from the same cart releases what it was holding first.
  const previous = await trx.selectFrom('orders').select(['id', 'status']).where('cart_id', '=', cart.id).where('status', 'in', ['awaiting_payment', 'payment_failed']).forUpdate().execute();
  const supersededSessions: string[] = [];
  for (const old of previous) {
    const sessions = await trx.selectFrom('payments').select(['id', 'checkout_session_id']).where('order_id', '=', old.id).where('status', '=', 'pending').execute();
    for (const s of sessions) if (s.checkout_session_id) supersededSessions.push(s.checkout_session_id);
    await trx.updateTable('payments').set({ status: 'cancelled' }).where('order_id', '=', old.id).where('status', '=', 'pending').execute();
    await releaseOrderHolds(trx, old.id, 'Replaced by a newer checkout');
    await transitionOrder(trx, old, 'cancelled', actor, { note: 'Replaced by a newer checkout from the same cart', customer_visible: false });
  }

  const lines = await loadCartLines(trx, cart.id);
  if (!lines.length) throw conflict('cart_empty', 'Your cart is empty.');
  const problem = lines.find((l) => l.problems.length);
  if (problem) throw conflict('line_problem', `${problem.name}: ${problem.problems[0]}`);
  const matched = matchLines(lines, input.fulfillments);

  const dates = matched.map((m) => m.input.date).filter(Boolean) as string[];
  await lockCapacityDates(trx, dates);

  const tz = await businessTimezone(trx);
  const anchor = localDate(now, tz);
  const rangeEnd = [addDays(anchor, 100, tz), ...dates].reduce((a, b) => (a > b ? a : b));
  const policy = await loadPolicyContext(trx, ctx.clock, addDays(anchor, -1, tz), rangeEnd);
  const evaluated = matched.map((m) => evaluateFulfillment(policy, m.input, m.lines));

  const blocked = evaluated.find((e) => e.status === 'blocked');
  if (blocked) {
    throw conflict('slot_unavailable', blocked.reasons[0]?.message ?? 'That time is not available.', {
      reasons: blocked.reasons,
      alternatives: blocked.alternatives,
      method: blocked.input.method,
      line_ids: blocked.input.line_ids,
    });
  }

  // A code that stopped being valid mid-checkout must not silently change what the customer pays.
  const { promotion, error: promotionError } = await resolvePromotion(trx, ctx, cart, lines);
  if (promotionError) throw conflict('promotion_unavailable', `${promotionError} Please remove it to continue.`);
  const totals = computeTotals(lines, evaluated.map((e) => ({ method: e.input.method, fee_cents: e.fee_cents })), promotion, policy.settings.tax);
  if (totals.tax_missing.length) throw unavailable('tax_not_configured', 'Sales tax is not set up yet, so online checkout is closed. Please call the shop to order.');
  if (input.expected_total_cents !== undefined && input.expected_total_cents !== totals.total_cents) {
    throw conflict('price_changed', 'A price changed while you were checking out. Please review the new total.', { totals: publicTotals(totals) });
  }

  const reviewReasons = evaluated.flatMap((e) => (e.status === 'review' ? e.reasons : []));
  const customerId = await upsertCustomer(trx, input.contact, 'checkout');
  const phone = toE164(input.contact.phone);
  await recordConsents(trx, customerId, phone, input.consents, {
    source: 'checkout',
    ip: actor.ip,
    userAgent,
    smsTransactionalText: policy.settings.sms.consent_text_transactional,
    smsMarketingText: policy.settings.sms.consent_text_marketing,
  });

  const isTest = !ctx.payments.livemode;
  let reference = generateReference('BL');
  for (let i = 0; i < 5; i++) {
    const clash = await trx.selectFrom('orders').select('id').where('reference', '=', reference).executeTakeFirst();
    if (!clash) break;
    reference = generateReference('BL');
  }

  const order = await trx
    .insertInto('orders')
    .values({
      reference,
      customer_id: customerId,
      cart_id: cart.id,
      status: 'awaiting_payment',
      payment_status: totals.total_cents === 0 ? 'not_required' : 'unpaid',
      acceptance_mode: 'review',
      review_timing: policy.settings.ordering.review_timing,
      contact_name: input.contact.name,
      contact_email: input.contact.email,
      contact_phone: phone,
      customer_note: input.note ?? null,
      subtotal_cents: totals.subtotal_cents,
      discount_cents: totals.discount_cents,
      delivery_cents: totals.delivery_cents,
      shipping_cents: totals.shipping_cents,
      tax_cents: totals.tax_cents,
      total_cents: totals.total_cents,
      promotion_id: promotion?.id ?? null,
      source: 'web',
      attribution: JSON.stringify(locked.attribution ?? {}),
      idempotency_key: input.idempotency_key,
      is_test: isTest,
      placed_at: now,
    })
    .returning(['id', 'status'])
    .executeTakeFirstOrThrow();

  const itemIds = new Map<string, string>();
  for (const [i, line] of lines.entries()) {
    const priced = totals.lines.find((p) => p.id === line.id);
    const row = await trx
      .insertInto('order_items')
      .values({
        order_id: order.id,
        product_id: line.product_id,
        variant_id: line.variant_id,
        division_id: line.division_id,
        name: line.name,
        variant_name: line.variant_name,
        sku: line.sku,
        quantity: line.quantity,
        unit_price_cents: line.unit_price_cents,
        options_price_cents: line.options_price_cents,
        line_subtotal_cents: line.line_subtotal_cents,
        discount_cents: priced?.discount_cents ?? 0,
        tax_cents: priced?.tax_cents ?? 0,
        tax_category: line.tax_category,
        cost_estimate_cents: line.cost_estimate_cents,
        options: JSON.stringify({ selected: line.options, display: line.options_display }),
        prep_minutes: line.prep_minutes,
        complexity_points: line.complexity_points,
        sort_order: i,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    itemIds.set(line.id, row.id);
  }

  for (const e of evaluated) {
    const f = await trx
      .insertInto('fulfillments')
      .values({
        order_id: order.id,
        method: e.input.method,
        scheduled_date: e.input.date ?? null,
        window_start: e.slot?.start ?? null,
        window_end: e.slot?.end ?? null,
        window_id: e.input.window_id ?? null,
        fee_cents: e.fee_cents,
        recipient_name: e.input.recipient_name ?? input.contact.name,
        recipient_phone: toE164(e.input.recipient_phone) ?? phone,
        address: e.input.address ? JSON.stringify(e.input.address) : null,
        instructions: e.input.instructions ?? null,
        card_message: e.input.card_message ?? null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('fulfillment_items')
      .values(e.lines.map((l) => ({ fulfillment_id: f.id, order_item_id: itemIds.get(l.id) as string, quantity: l.quantity })))
      .execute();
    if (e.input.method === 'delivery') {
      await trx.insertInto('deliveries').values({ fulfillment_id: f.id, zone_id: e.zone_id }).execute();
    }
    await insertClaims(trx, order.id, f.id, e.input.date ?? null, e.input.window_id ?? null, e.lines);
  }

  // Binding stock check. This is what stops two buyers both getting the last one.
  const acceptReasons: Reason[] = [...reviewReasons];
  const holdMinutes = policy.settings.ordering.payment_hold_minutes;
  const provisionalHold = addMinutes(now, Math.max(holdMinutes, policy.settings.ordering.review_hold_hours * 60));
  const requirements = await requirementsForVariants(trx, lines.map((l) => l.variant_id));
  for (const line of lines) {
    const behavior = line.out_of_stock_behavior ?? policy.settings.ordering.out_of_stock_behavior;
    const orderItemId = itemIds.get(line.id) as string;
    for (const req of requirements.get(line.variant_id) ?? []) {
      const quantity = req.per_unit * line.quantity;
      const ok = await reserveStock(trx, { item_id: req.item_id, quantity, expires_at: provisionalHold, order_id: order.id, order_item_id: orderItemId });
      if (ok) continue;
      if (behavior === 'reject') throw new ShortageError(line, req.item_id, req.name);
      await recordBackorder(trx, { item_id: req.item_id, quantity, order_id: order.id, order_item_id: orderItemId });
      await trx.updateTable('order_items').set({ status: behavior === 'backorder' ? 'backordered' : 'shortage' }).where('id', '=', orderItemId).execute();
      acceptReasons.push({
        code: behavior === 'backorder' ? 'backorder' : 'inventory_review',
        message: `${line.name} is short on stock, so the shop confirms timing first.`,
      });
    }
  }

  if (promotion) {
    const redeemed = await redeemPromotion(trx, promotion, order.id, customerId, totals.discount_cents);
    if (!redeemed) throw conflict('promotion_unavailable', 'That promotion code has just been used up. Please remove it to continue.');
  }

  const unique = dedupeReasons(acceptReasons);
  const mode = unique.length ? 'review' : 'auto';
  const reviewFirst = mode === 'review' && policy.settings.ordering.review_timing === 'approve_first';
  const holdUntil = reviewFirst ? addHours(now, policy.settings.ordering.review_hold_hours) : addMinutes(now, holdMinutes);

  await trx.updateTable('inventory_reservations').set({ expires_at: holdUntil }).where('order_id', '=', order.id).where('status', '=', 'held').execute();
  await trx
    .updateTable('orders')
    .set({ acceptance_mode: mode, acceptance_reasons: JSON.stringify(unique), hold_expires_at: holdUntil })
    .where('id', '=', order.id)
    .execute();
  await writeHistory(trx, { order_id: order.id, from: null, to: 'order_placed', actor, note: null });
  await emit(trx, 'order.created', { type: 'order', id: order.id }, { reference });
  await audit(trx, actor, 'order.create', { type: 'order', id: order.id }, { total_cents: totals.total_cents, mode });

  let status: string = order.status;
  let paymentId: string | null = null;
  if (totals.total_cents === 0) {
    if (mode === 'auto') {
      await transitionOrder(trx, order, 'accepted', actor, { note: 'No payment was due.' });
      await createOrderTasks(trx, order.id);
      await emit(trx, 'order.paid', { type: 'order', id: order.id });
      await trx.updateTable('orders').set({ hold_expires_at: null }).where('id', '=', order.id).execute();
      await trx.updateTable('inventory_reservations').set({ status: 'committed', expires_at: null }).where('order_id', '=', order.id).where('status', '=', 'held').execute();
    } else {
      await transitionOrder(trx, order, 'awaiting_review', actor);
      await emit(trx, 'order.review_requested', { type: 'order', id: order.id });
    }
    status = order.status;
  } else if (reviewFirst) {
    await transitionOrder(trx, order, 'awaiting_review', actor);
    await emit(trx, 'order.review_requested', { type: 'order', id: order.id });
    status = order.status;
  } else {
    const payment = await trx
      .insertInto('payments')
      .values({
        order_id: order.id,
        gateway: ctx.payments.name === 'stripe' ? 'stripe' : 'mock',
        kind: 'order',
        amount_cents: totals.total_cents,
        session_expires_at: addMinutes(holdUntil, -1),
        livemode: ctx.payments.livemode,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    paymentId = payment.id;
  }

  await trx.updateTable('carts').set({ status: 'pending_payment', customer_id: customerId }).where('id', '=', cart.id).execute();
  return { orderId: order.id, reference, status, paymentId, expiresAt: holdUntil, supersededSessions };
}

