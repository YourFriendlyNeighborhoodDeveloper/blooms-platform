import { sql } from 'kysely';
import type { Db } from '../../db/client.js';
import type { Actor } from '../../lib/audit.js';
import { audit } from '../../lib/audit.js';
import { conflict, notFound } from '../../lib/errors.js';
import { emit, raiseAlert } from '../../automation/events.js';
import { consumeItemReservations, releaseOrderReservations } from '../inventory/service.js';
import { releasePromotion } from '../cart/pricing.js';

export type OrderStatus =
  | 'awaiting_payment' | 'payment_processing' | 'payment_failed' | 'awaiting_review' | 'needs_customer'
  | 'accepted' | 'preparing' | 'ready' | 'out_for_delivery' | 'shipped' | 'partially_fulfilled' | 'fulfilled'
  | 'completed' | 'rescheduling' | 'delivery_failed' | 'inventory_shortage' | 'rejected' | 'cancelled' | 'expired' | 'returned';

export type ItemStatus =
  | 'pending' | 'preparing' | 'ready' | 'out_for_delivery' | 'shipped' | 'fulfilled'
  | 'backordered' | 'shortage' | 'delivery_failed' | 'cancelled' | 'refunded' | 'returned';

/** Once work has begun the order status is derived from its items, so these freely move among themselves. */
const WORKING: OrderStatus[] = ['accepted', 'preparing', 'ready', 'out_for_delivery', 'shipped', 'partially_fulfilled', 'delivery_failed', 'inventory_shortage', 'needs_customer', 'rescheduling'];

const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  awaiting_payment: ['payment_processing', 'payment_failed', 'awaiting_review', 'accepted', 'inventory_shortage', 'cancelled', 'expired'],
  payment_processing: ['awaiting_payment', 'payment_failed', 'awaiting_review', 'accepted', 'inventory_shortage', 'cancelled', 'expired'],
  payment_failed: ['awaiting_payment', 'payment_processing', 'awaiting_review', 'accepted', 'inventory_shortage', 'cancelled', 'expired'],
  awaiting_review: ['awaiting_payment', 'accepted', 'rejected', 'needs_customer', 'inventory_shortage', 'cancelled', 'expired'],
  needs_customer: [...WORKING, 'awaiting_review', 'awaiting_payment', 'rejected', 'cancelled', 'fulfilled'],
  accepted: [...WORKING, 'fulfilled', 'cancelled'],
  preparing: [...WORKING, 'fulfilled', 'cancelled'],
  ready: [...WORKING, 'fulfilled', 'cancelled'],
  out_for_delivery: [...WORKING, 'fulfilled', 'cancelled'],
  shipped: [...WORKING, 'fulfilled', 'returned'],
  partially_fulfilled: [...WORKING, 'fulfilled', 'cancelled'],
  delivery_failed: [...WORKING, 'fulfilled', 'cancelled'],
  inventory_shortage: [...WORKING, 'awaiting_review', 'rejected', 'fulfilled', 'cancelled'],
  rescheduling: [...WORKING, 'fulfilled', 'cancelled'],
  fulfilled: ['completed', 'returned', 'partially_fulfilled'],
  completed: ['returned'],
  // A late payment can arrive for an order the system already gave up on. It is parked for a person.
  expired: ['inventory_shortage', 'awaiting_review'],
  cancelled: ['inventory_shortage'],
  rejected: [],
  returned: [],
};

const ITEM_TRANSITIONS: Record<ItemStatus, ItemStatus[]> = {
  pending: ['preparing', 'ready', 'out_for_delivery', 'shipped', 'fulfilled', 'backordered', 'shortage', 'cancelled'],
  backordered: ['pending', 'preparing', 'ready', 'shortage', 'cancelled'],
  shortage: ['pending', 'preparing', 'ready', 'backordered', 'cancelled'],
  preparing: ['pending', 'ready', 'out_for_delivery', 'shipped', 'fulfilled', 'shortage', 'cancelled'],
  ready: ['preparing', 'out_for_delivery', 'shipped', 'fulfilled', 'cancelled'],
  out_for_delivery: ['ready', 'fulfilled', 'delivery_failed', 'cancelled'],
  delivery_failed: ['ready', 'out_for_delivery', 'fulfilled', 'cancelled'],
  shipped: ['fulfilled', 'delivery_failed', 'returned'],
  fulfilled: ['returned'],
  returned: [],
  cancelled: [],
  refunded: [],
};

export const canTransitionOrder = (from: OrderStatus, to: OrderStatus) => ORDER_TRANSITIONS[from]?.includes(to) ?? false;
export const canTransitionItem = (from: ItemStatus, to: ItemStatus) => ITEM_TRANSITIONS[from]?.includes(to) ?? false;

const CLOSED_ITEMS: ItemStatus[] = ['cancelled', 'refunded'];

/**
 * The order-level status implied by its items. The order counts as fulfilled only when every item
 * still on the order has been fulfilled or returned; a partly finished order stays open.
 */
export function deriveOrderStatus(items: Array<{ status: string }>): OrderStatus {
  const active = items.filter((i) => !CLOSED_ITEMS.includes(i.status as ItemStatus));
  if (!active.length) return 'cancelled';
  const has = (...s: string[]) => active.some((i) => s.includes(i.status));
  const all = (...s: string[]) => active.every((i) => s.includes(i.status));
  if (all('returned')) return 'returned';
  if (all('fulfilled', 'returned')) return 'fulfilled';
  if (has('delivery_failed')) return 'delivery_failed';
  if (has('shortage')) return 'inventory_shortage';
  if (has('fulfilled')) return 'partially_fulfilled';
  if (has('out_for_delivery')) return 'out_for_delivery';
  if (has('shipped')) return 'shipped';
  if (all('ready')) return 'ready';
  if (has('ready', 'preparing')) return 'preparing';
  return 'accepted';
}

export async function lockOrder(trx: Db, orderId: string) {
  const order = await trx.selectFrom('orders').selectAll().where('id', '=', orderId).forUpdate().executeTakeFirst();
  if (!order) throw notFound('Order not found.');
  return order;
}

export async function writeHistory(
  trx: Db,
  input: { order_id: string; order_item_id?: string | null; from?: string | null; to: string; actor: Actor; note?: string | null; customer_visible?: boolean },
) {
  await trx
    .insertInto('order_status_history')
    .values({
      order_id: input.order_id,
      order_item_id: input.order_item_id ?? null,
      from_status: input.from ?? null,
      to_status: input.to,
      actor_type: input.actor.type,
      actor_id: input.actor.id ?? null,
      note: input.note ?? null,
      customer_visible: input.customer_visible ?? true,
    })
    .execute();
}

export async function transitionOrder(trx: Db, order: { id: string; status: string }, to: OrderStatus, actor: Actor, opts: { note?: string | null; customer_visible?: boolean; force?: boolean } = {}) {
  const from = order.status as OrderStatus;
  if (from === to) return;
  if (!opts.force && !canTransitionOrder(from, to)) {
    throw conflict('invalid_transition', `An order cannot move from ${from.replace(/_/g, ' ')} to ${to.replace(/_/g, ' ')}.`);
  }
  const now = new Date();
  await trx
    .updateTable('orders')
    .set({
      status: to,
      ...(to === 'accepted' ? { accepted_at: now } : {}),
      ...(to === 'fulfilled' ? { fulfilled_at: now } : {}),
      ...(to === 'completed' ? { completed_at: now } : {}),
      ...(to === 'cancelled' || to === 'rejected' ? { cancelled_at: now } : {}),
    })
    .where('id', '=', order.id)
    .execute();
  await writeHistory(trx, { order_id: order.id, from, to, actor, note: opts.note, customer_visible: opts.customer_visible });
  await audit(trx, actor, 'order.status', { type: 'order', id: order.id }, { from, to, note: opts.note ?? null });
  order.status = to;
}

/** Releases everything an order was holding. Safe to call more than once. */
export async function releaseOrderHolds(trx: Db, orderId: string, note: string) {
  await releaseOrderReservations(trx, orderId, note);
  await trx.updateTable('capacity_claims').set({ status: 'released' }).where('order_id', '=', orderId).where('status', '=', 'active').execute();
  await releasePromotion(trx, orderId);
  await trx.updateTable('orders').set({ hold_expires_at: null }).where('id', '=', orderId).execute();
}

const ITEM_EVENT: Partial<Record<ItemStatus, string>> = {
  preparing: 'order.preparing',
  ready: 'order.ready',
  out_for_delivery: 'order.dispatched',
  shipped: 'order.shipped',
  delivery_failed: 'order.delivery_failed',
};

const FULFILLMENT_FOR: Partial<Record<ItemStatus, string>> = {
  preparing: 'preparing',
  ready: 'ready',
  out_for_delivery: 'out_for_delivery',
  shipped: 'shipped',
  fulfilled: 'fulfilled',
  delivery_failed: 'failed',
};

/**
 * Moves specific items forward. Each item keeps its own status, so flowers can be ready while
 * merchandise is still being prepared. The order's overall status, inventory, fulfilment records and
 * customer notifications all follow from this one function.
 */
export async function updateItemStatuses(
  trx: Db,
  orderId: string,
  itemIds: string[],
  to: ItemStatus,
  actor: Actor,
  opts: { note?: string | null; tracking?: { carrier?: string | null; tracking_number?: string | null; tracking_url?: string | null }; reason?: string | null } = {},
) {
  const order = await lockOrder(trx, orderId);
  const allowed = ['accepted', 'preparing', 'ready', 'out_for_delivery', 'shipped', 'partially_fulfilled', 'delivery_failed', 'inventory_shortage', 'needs_customer', 'rescheduling'];
  const returningFinishedItem = to === 'returned' && ['fulfilled', 'completed'].includes(order.status);
  if (!allowed.includes(order.status) && !returningFinishedItem) {
    throw conflict('order_not_active', `This order is ${order.status.replace(/_/g, ' ')}, so its items cannot be updated yet.`);
  }
  const items = await trx.selectFrom('order_items').select(['id', 'status', 'name', 'quantity']).where('order_id', '=', orderId).execute();
  const targets = items.filter((i) => itemIds.includes(i.id));
  if (targets.length !== itemIds.length) throw notFound('One of those items is not on this order.');

  const changed: typeof targets = [];
  for (const item of targets) {
    if (item.status === to) continue;
    if (!canTransitionItem(item.status as ItemStatus, to)) {
      throw conflict('invalid_transition', `${item.name} cannot move from ${item.status.replace(/_/g, ' ')} to ${to.replace(/_/g, ' ')}.`);
    }
    changed.push(item);
  }
  if (!changed.length) return { changed: 0, order_status: order.status };

  for (const item of changed) {
    await trx.updateTable('order_items').set({ status: to }).where('id', '=', item.id).execute();
    await writeHistory(trx, { order_id: orderId, order_item_id: item.id, from: item.status, to, actor, note: opts.note ?? null });
    // Stock leaves the shelf when the item leaves the shop.
    if (to === 'fulfilled' || to === 'shipped' || to === 'out_for_delivery') await consumeItemReservations(trx, item.id, actor);
    if (to === 'cancelled') await releaseOrderReservations(trx, orderId, 'Item cancelled', item.id);
  }

  // Keep each fulfilment's own status in step with the items it carries.
  const links = await trx
    .selectFrom('fulfillment_items')
    .innerJoin('fulfillments', 'fulfillments.id', 'fulfillment_items.fulfillment_id')
    .innerJoin('order_items', 'order_items.id', 'fulfillment_items.order_item_id')
    .select(['fulfillments.id as fulfillment_id', 'fulfillments.method', 'order_items.id as item_id', 'order_items.status as item_status'])
    .where('fulfillments.order_id', '=', orderId)
    .execute();
  const touched = new Set(links.filter((l) => itemIds.includes(l.item_id)).map((l) => l.fulfillment_id));
  const now = new Date();
  const methodsTouched = new Set<string>();
  for (const fid of touched) {
    const own = links.filter((l) => l.fulfillment_id === fid);
    methodsTouched.add(own[0].method);
    const statuses = own.map((l) => l.item_status).filter((s) => !CLOSED_ITEMS.includes(s as ItemStatus));
    const next = !statuses.length
      ? 'cancelled'
      : statuses.every((s) => s === to)
        ? (FULFILLMENT_FOR[to] ?? 'pending')
        : statuses.some((s) => s === 'preparing' || s === 'ready')
          ? 'preparing'
          : 'pending';
    await trx
      .updateTable('fulfillments')
      .set({
        status: next as 'pending',
        ...(next === 'ready' ? { ready_at: now } : {}),
        ...(next === 'shipped' ? { shipped_at: now, ...opts.tracking } : {}),
        ...(next === 'fulfilled' ? { fulfilled_at: now } : {}),
      })
      .where('id', '=', fid)
      .execute();
    if (own[0].method === 'delivery') {
      const deliveryStatus = to === 'out_for_delivery' ? 'out_for_delivery' : to === 'fulfilled' ? 'delivered' : to === 'delivery_failed' ? 'failed' : null;
      if (deliveryStatus && next === FULFILLMENT_FOR[to]) {
        await trx
          .updateTable('deliveries')
          .set({
            status: deliveryStatus as 'delivered',
            ...(deliveryStatus === 'out_for_delivery' ? { dispatched_at: now } : {}),
            ...(deliveryStatus === 'delivered' ? { delivered_at: now } : {}),
            ...(deliveryStatus === 'failed' ? { failure_reason: opts.reason ?? opts.note ?? null } : {}),
          })
          .where('fulfillment_id', '=', fid)
          .execute();
      }
    }
  }

  const fresh = await trx.selectFrom('order_items').select('status').where('order_id', '=', orderId).execute();
  const derived = deriveOrderStatus(fresh);
  const orderRow = { id: order.id, status: order.status };
  // A return on a finished order leaves it finished, unless everything came back.
  const keepCompleted = order.status === 'completed' && derived === 'fulfilled';
  if (derived !== order.status && !keepCompleted) await transitionOrder(trx, orderRow, derived, actor, { force: true, customer_visible: true });

  const batch = changed.map((i) => `${i.quantity} × ${i.name}`).join('\n');
  const batchKey = `${orderId}:${to}:${[...changed.map((c) => c.id)].sort().join(',')}`;
  const payload = {
    items_text: batch,
    note: opts.note ?? null,
    reason: opts.reason ?? opts.note ?? null,
    tracking_text: opts.tracking?.tracking_number ? `${opts.tracking.carrier ?? 'Carrier'} tracking: ${opts.tracking.tracking_number} ${opts.tracking.tracking_url ?? ''}`.trim() : '',
  };
  const eventType = ITEM_EVENT[to];
  if (eventType === 'order.ready') {
    // Pickup items get "ready for pickup". Delivery and shipped items wait for their own message.
    const pickupLinks = links.filter((l) => l.method === 'pickup' && changed.some((c) => c.id === l.item_id));
    if (pickupLinks.length) await emit(trx, 'order.ready', { type: 'order', id: orderId }, payload, batchKey);
  } else if (eventType === 'order.preparing') {
    await emit(trx, 'order.preparing', { type: 'order', id: orderId }, payload, `${orderId}:preparing`);
  } else if (eventType) {
    await emit(trx, eventType, { type: 'order', id: orderId }, payload, batchKey);
  }
  if (to === 'fulfilled' && methodsTouched.has('delivery')) await emit(trx, 'order.delivered', { type: 'order', id: orderId }, payload, batchKey);
  if (derived === 'fulfilled') await emit(trx, 'order.fulfilled', { type: 'order', id: orderId }, {}, `${orderId}:fulfilled`);
  if (to === 'shortage') {
    await raiseAlert(trx, {
      code: 'order_shortage',
      severity: 'warning',
      title: `Shortage on order ${order.reference}`,
      detail: batch,
      subject: { type: 'order', id: orderId },
      link: `/admin/orders/${orderId}`,
      dedupeKey: `shortage:${orderId}`,
    });
  }
  return { changed: changed.length, order_status: derived };
}

export async function createOrderTasks(trx: Db, orderId: string) {
  const order = await trx.selectFrom('orders').select(['id', 'reference']).where('id', '=', orderId).executeTakeFirstOrThrow();
  const rows = await trx
    .selectFrom('order_items as i')
    .innerJoin('fulfillment_items as fi', 'fi.order_item_id', 'i.id')
    .innerJoin('fulfillments as f', 'f.id', 'fi.fulfillment_id')
    .select(['i.id', 'i.name', 'i.variant_name', 'i.quantity', 'i.prep_minutes', 'i.options', 'i.division_id', 'f.window_start', 'f.method', 'f.id as fulfillment_id'])
    .where('i.order_id', '=', orderId)
    .execute();
  for (const r of rows.filter((x) => x.prep_minutes > 0)) {
    await trx
      .insertInto('staff_tasks')
      .values({
        title: `Prepare ${r.quantity} × ${r.name}${r.variant_name && r.variant_name !== 'Standard' ? ` (${r.variant_name})` : ''}`,
        description: `Order ${order.reference}`,
        division_id: r.division_id,
        required_capability: 'production',
        due_at: r.window_start,
        est_minutes: r.prep_minutes,
        subject_type: 'order',
        subject_id: orderId,
        source_key: `order-item:${r.id}:prepare`,
      })
      .onConflict((oc) => oc.column('source_key').doNothing())
      .execute();
  }
  for (const f of rows.filter((x, i, a) => x.method === 'delivery' && a.findIndex((y) => y.fulfillment_id === x.fulfillment_id) === i)) {
    await trx
      .insertInto('staff_tasks')
      .values({
        title: `Assign and deliver order ${order.reference}`,
        division_id: f.division_id,
        required_capability: 'delivery',
        due_at: f.window_start,
        subject_type: 'order',
        subject_id: orderId,
        source_key: `fulfillment:${f.fulfillment_id}:deliver`,
      })
      .onConflict((oc) => oc.column('source_key').doNothing())
      .execute();
  }
}

export async function closeOrderTasks(trx: Db, orderId: string) {
  await sql`UPDATE staff_tasks SET status = 'cancelled' WHERE subject_type = 'order' AND subject_id = ${orderId} AND status IN ('open', 'in_progress', 'blocked')`.execute(trx);
}
