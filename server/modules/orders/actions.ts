import { sql } from 'kysely';
import type { AppContext } from '../../context.js';
import type { Trx } from '../../db/client.js';
import { audit, SYSTEM_ACTOR, type Actor } from '../../lib/audit.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { addHours, addMinutes } from '../../lib/time.js';
import { emit } from '../../automation/events.js';
import { evaluateSlot, findZone, loadPolicyContext } from '../availability/engine.js';
import { extendOrderHolds, releaseOrderReservations } from '../inventory/service.js';
import { getSetting } from '../settings/service.js';
import { issueRefund } from '../payments/service.js';
import { closeOrderTasks, createOrderTasks, lockOrder, releaseOrderHolds, transitionOrder } from './workflow.js';
import { commitOrderReservations } from '../inventory/service.js';

/** Staff approval of an order that was held for review. */
export async function approveOrder(ctx: AppContext, orderId: string, actor: Actor, note?: string | null) {
  await ctx.db.transaction().execute(async (trx) => {
    const order = await lockOrder(trx, orderId);
    if (order.status !== 'awaiting_review' && order.status !== 'needs_customer') throw conflict('not_reviewable', 'This order is not waiting for review.');
    const row = { id: order.id, status: order.status };
    const due = order.total_cents - order.paid_cents;
    if (order.payment_status === 'paid' || order.payment_status === 'not_required' || due <= 0) {
      await commitOrderReservations(trx, order.id);
      await transitionOrder(trx, row, 'accepted', actor, { note });
      await trx.updateTable('orders').set({ needs_attention: false, attention_reason: null, hold_expires_at: null }).where('id', '=', order.id).execute();
      await createOrderTasks(trx, order.id);
      await emit(trx, 'order.accepted', { type: 'order', id: order.id }, {}, `order-accepted:${order.id}`);
    } else {
      // Approved but unpaid: hold it, and let the customer pay from their link.
      const holdUntil = addHours(ctx.clock.now(), 24);
      await extendOrderHolds(trx, order.id, holdUntil);
      await trx.updateTable('orders').set({ hold_expires_at: holdUntil, needs_attention: false, attention_reason: null }).where('id', '=', order.id).execute();
      await transitionOrder(trx, row, 'awaiting_payment', actor, { note: note ?? 'The shop approved your request. Payment confirms it.' });
      await emit(trx, 'order.approved_awaiting_payment', { type: 'order', id: order.id }, {}, `order-approved:${order.id}`);
    }
    await audit(trx, actor, 'order.approve', { type: 'order', id: order.id }, { note: note ?? null });
  });
}

async function refundAllPaid(ctx: AppContext, orderId: string, reason: string, actor: Actor) {
  const payments = await ctx.db
    .selectFrom('payments')
    .select(['id', 'amount_cents', 'refunded_cents'])
    .where('order_id', '=', orderId)
    .where('status', '=', 'succeeded')
    .execute();
  let total = 0;
  for (const p of payments) {
    const left = p.amount_cents - p.refunded_cents;
    if (left > 0) {
      await issueRefund(ctx, { payment_id: p.id, amount_cents: left, reason, actor });
      total += left;
    }
  }
  return total;
}

/** Declines an order. Any money taken goes back automatically, and everything held is released. */
export async function rejectOrder(ctx: AppContext, orderId: string, reason: string, actor: Actor) {
  if (!reason.trim()) throw badRequest('Please give a reason. The customer sees it.');
  const order = await ctx.db.selectFrom('orders').select(['status']).where('id', '=', orderId).executeTakeFirst();
  if (!order) throw notFound('Order not found.');
  if (!['awaiting_review', 'needs_customer', 'inventory_shortage'].includes(order.status)) {
    throw conflict('not_reviewable', 'Only an order waiting for review can be declined. Use cancel for accepted orders.');
  }
  const refunded = await refundAllPaid(ctx, orderId, `Order declined: ${reason}`, actor);
  await ctx.db.transaction().execute(async (trx) => {
    const locked = await lockOrder(trx, orderId);
    await trx.updateTable('payments').set({ status: 'cancelled' }).where('order_id', '=', orderId).where('status', '=', 'pending').execute();
    await releaseOrderHolds(trx, orderId, 'Order declined');
    await transitionOrder(trx, { id: locked.id, status: locked.status }, 'rejected', actor, { note: reason });
    await trx.updateTable('orders').set({ needs_attention: false, attention_reason: null }).where('id', '=', orderId).execute();
    await closeOrderTasks(trx, orderId);
    await emit(trx, 'order.rejected', { type: 'order', id: orderId }, { reason, refunded_cents: refunded }, `order-rejected:${orderId}`);
    await audit(trx, actor, 'order.reject', { type: 'order', id: orderId }, { reason, refunded_cents: refunded });
  });
}

export async function cancelOrder(ctx: AppContext, orderId: string, input: { reason: string; refund: boolean }, actor: Actor) {
  if (!input.reason.trim()) throw badRequest('Please give a reason.');
  const order = await ctx.db.selectFrom('orders').select(['status', 'payment_status']).where('id', '=', orderId).executeTakeFirst();
  if (!order) throw notFound('Order not found.');
  if (['fulfilled', 'completed', 'cancelled', 'rejected', 'expired', 'returned'].includes(order.status)) {
    throw conflict('not_cancellable', `This order is ${order.status.replace(/_/g, ' ')} and cannot be cancelled.`);
  }
  const refunded = input.refund ? await refundAllPaid(ctx, orderId, `Order cancelled: ${input.reason}`, actor) : 0;
  const sessions = await ctx.db.transaction().execute(async (trx) => {
    const locked = await lockOrder(trx, orderId);
    const open = await trx.selectFrom('payments').select(['checkout_session_id']).where('order_id', '=', orderId).where('status', '=', 'pending').execute();
    await trx.updateTable('payments').set({ status: 'cancelled' }).where('order_id', '=', orderId).where('status', '=', 'pending').execute();
    await releaseOrderHolds(trx, orderId, 'Order cancelled');
    await trx.updateTable('order_items').set({ status: 'cancelled' }).where('order_id', '=', orderId).where('status', 'not in', ['fulfilled', 'returned', 'refunded']).execute();
    await trx.updateTable('fulfillments').set({ status: 'cancelled' }).where('order_id', '=', orderId).where('status', 'not in', ['fulfilled', 'returned']).execute();
    await trx.updateTable('deliveries').set({ status: 'cancelled' }).where('fulfillment_id', 'in', (eb) => eb.selectFrom('fulfillments').select('id').where('order_id', '=', orderId)).where('status', 'not in', ['delivered']).execute();
    await transitionOrder(trx, { id: locked.id, status: locked.status }, 'cancelled', actor, { note: input.reason, force: true });
    await trx.updateTable('orders').set({ needs_attention: false, attention_reason: null }).where('id', '=', orderId).execute();
    await closeOrderTasks(trx, orderId);
    await emit(trx, 'order.cancelled', { type: 'order', id: orderId }, { reason: input.reason, refunded_cents: refunded }, `order-cancelled:${orderId}`);
    await audit(trx, actor, 'order.cancel', { type: 'order', id: orderId }, { reason: input.reason, refunded_cents: refunded });
    return open.map((o) => o.checkout_session_id).filter(Boolean) as string[];
  });
  for (const id of sessions) await ctx.payments.expireCheckoutSession(id).catch(() => {});
}

export async function expireOrder(ctx: AppContext, trx: Trx, orderId: string, note: string) {
  const order = await lockOrder(trx, orderId);
  if (!['awaiting_payment', 'payment_failed', 'payment_processing', 'awaiting_review'].includes(order.status)) return;
  await releaseOrderHolds(trx, orderId, note);
  await transitionOrder(trx, { id: order.id, status: order.status }, 'expired', SYSTEM_ACTOR, { note, customer_visible: order.status === 'awaiting_review' });
  await trx.updateTable('payments').set({ status: 'expired' }).where('order_id', '=', orderId).where('status', '=', 'pending').execute();
  if (order.cart_id) {
    await trx.updateTable('carts').set({ status: 'active' }).where('id', '=', order.cart_id).where('status', '=', 'pending_payment').execute();
  }
  void ctx;
}

/** Sweep: ends unpaid orders whose holds have run out, returning their stock and capacity. */
export async function expireStaleOrders(ctx: AppContext, limit = 100) {
  const now = ctx.clock.now();
  const due = await ctx.db
    .selectFrom('orders')
    .select(['id'])
    .where('hold_expires_at', '<', now)
    .where('status', 'in', ['awaiting_payment', 'payment_failed', 'awaiting_review'])
    .limit(limit)
    .execute();
  let expired = 0;
  for (const { id } of due) {
    // Ask the gateway first, so an order is never expired while its payment is succeeding.
    const open = await ctx.db.selectFrom('payments').select(['checkout_session_id']).where('order_id', '=', id).where('status', 'in', ['pending', 'processing']).execute();
    let stillOpen = false;
    for (const p of open) {
      if (!p.checkout_session_id) continue;
      try {
        const session = await ctx.payments.retrieveCheckoutSession(p.checkout_session_id);
        const { applySessionState } = await import('../payments/service.js');
        const state = await ctx.db.transaction().execute((trx) => applySessionState(ctx, trx, session, 'hold-expiry'));
        if (state === 'paid' || state === 'processing') stillOpen = true;
        if (state === 'open') {
          await ctx.payments.expireCheckoutSession(p.checkout_session_id);
        }
      } catch (err) {
        ctx.log.warn('could not check session before expiring order', { order: id, error: err });
        stillOpen = true;
      }
    }
    if (stillOpen) continue;
    await ctx.db.transaction().execute((trx) => expireOrder(ctx, trx, id, 'The hold on this order ended before it was completed.'));
    expired++;
  }

  // A safety net: a hold left behind on an order that no longer needs it goes back on the shelf.
  const orphans = await sql<{ order_id: string }>`
    SELECT DISTINCT r.order_id FROM inventory_reservations r
    JOIN orders o ON o.id = r.order_id
    WHERE r.status = 'held' AND r.expires_at < ${now} AND o.status IN ('cancelled', 'rejected', 'expired')
    LIMIT 200
  `.execute(ctx.db);
  for (const { order_id } of orphans.rows) {
    await ctx.db.transaction().execute((trx) => releaseOrderReservations(trx, order_id, 'Released a hold left on a closed order.'));
  }
  return { expired, released_orphans: orphans.rows.length };
}

export async function requestCustomerInfo(ctx: AppContext, orderId: string, question: string, actor: Actor) {
  if (!question.trim()) throw badRequest('Please write the question for the customer.');
  await ctx.db.transaction().execute(async (trx) => {
    const order = await lockOrder(trx, orderId);
    await transitionOrder(trx, { id: order.id, status: order.status }, 'needs_customer', actor, { note: question });
    await emit(trx, 'order.needs_customer', { type: 'order', id: orderId }, { note: question });
  });
}

/** Moves a fulfilment to a new slot. Capacity is re-checked; only someone allowed to override can force it. */
export async function rescheduleFulfillment(
  ctx: AppContext,
  fulfillmentId: string,
  input: { date: string; window_id: string; override?: boolean; note?: string | null },
  actor: Actor,
) {
  return ctx.db.transaction().execute(async (trx) => {
    const f = await trx
      .selectFrom('fulfillments')
      .innerJoin('orders', 'orders.id', 'fulfillments.order_id')
      .select(['fulfillments.id', 'fulfillments.order_id', 'fulfillments.method', 'fulfillments.address', 'fulfillments.scheduled_date', 'orders.status as order_status', 'orders.subtotal_cents'])
      .where('fulfillments.id', '=', fulfillmentId)
      .executeTakeFirst();
    if (!f) throw notFound('Fulfilment not found.');
    if (f.method === 'shipping') throw badRequest('Shipped items have no time window.');
    await sql`SELECT pg_advisory_xact_lock(hashtext(${`capacity:${input.date}`}))`.execute(trx);
    const lines = await trx
      .selectFrom('order_items as i')
      .innerJoin('fulfillment_items as fi', 'fi.order_item_id', 'i.id')
      .innerJoin('products as p', 'p.id', 'i.product_id')
      .select(['i.product_id', 'i.name', 'i.quantity', 'i.division_id', 'i.prep_minutes', 'i.complexity_points', 'p.min_lead_hours', 'p.allow_pickup', 'p.allow_delivery', 'p.allow_shipping', 'p.restricted_zone_ids', 'p.season_start_md', 'p.season_end_md', 'p.available_from', 'p.available_until', 'p.requires_approval', 'p.is_custom'])
      .where('fi.fulfillment_id', '=', fulfillmentId)
      .execute();
    // Release this order's own claim while evaluating, so moving within a day does not count it twice.
    await trx.updateTable('capacity_claims').set({ status: 'released' }).where('fulfillment_id', '=', fulfillmentId).where('status', '=', 'active').execute();
    const policy = await loadPolicyContext(trx, ctx.clock, input.date, input.date);
    const window = policy.windows.find((w) => w.id === input.window_id && w.kind === f.method);
    if (!window) throw badRequest('That window is not offered.');
    const zone = f.method === 'delivery' ? findZone(policy, (f.address as { postal_code?: string } | null)?.postal_code) : null;
    const slot = evaluateSlot(
      policy,
      { lines: lines.map((l) => ({ ...l, product_id: l.product_id as string, division_id: l.division_id as string })), subtotal_cents: f.subtotal_cents },
      f.method as 'pickup' | 'delivery',
      input.date,
      window,
      zone,
    );
    if (slot.status === 'blocked' && !input.override) {
      throw conflict('slot_unavailable', slot.reasons[0]?.message ?? 'That time is not available.', { reasons: slot.reasons });
    }
    await trx
      .updateTable('fulfillments')
      .set({ scheduled_date: input.date, window_id: input.window_id, window_start: slot.start, window_end: slot.end })
      .where('id', '=', fulfillmentId)
      .execute();
    await trx.updateTable('capacity_claims').set({ status: 'active', claim_date: input.date, window_id: input.window_id }).where('fulfillment_id', '=', fulfillmentId).execute();
    await trx.updateTable('staff_tasks').set({ due_at: slot.start }).where('subject_type', '=', 'order').where('subject_id', '=', f.order_id).where('status', 'in', ['open', 'in_progress']).execute();
    await audit(trx, actor, 'fulfillment.reschedule', { type: 'fulfillment', id: fulfillmentId }, { from: f.scheduled_date, to: input.date, override: Boolean(input.override), blocked: slot.status === 'blocked' });
    await emit(trx, 'order.rescheduled', { type: 'order', id: f.order_id }, { note: input.note ?? null });
    return { start: slot.start, end: slot.end, override_used: slot.status === 'blocked' };
  });
}

/** Sweep: marks fulfilled orders complete once any waiting period has passed. */
export async function completeFulfilledOrders(ctx: AppContext) {
  const { complete_after_hours } = await getSetting(ctx.db, 'ordering');
  const cutoff = addMinutes(ctx.clock.now(), -complete_after_hours * 60);
  const rows = await ctx.db
    .selectFrom('orders')
    .select(['id'])
    .where('status', '=', 'fulfilled')
    .where('fulfilled_at', '<=', cutoff)
    .where('needs_attention', '=', false)
    .where('payment_status', 'in', ['paid', 'not_required', 'refunded', 'partially_refunded'])
    .limit(200)
    .execute();
  for (const { id } of rows) {
    await ctx.db.transaction().execute(async (trx) => {
      const order = await lockOrder(trx, id);
      if (order.status === 'fulfilled') await transitionOrder(trx, { id: order.id, status: order.status }, 'completed', SYSTEM_ACTOR);
    });
  }
  return { completed: rows.length };
}
