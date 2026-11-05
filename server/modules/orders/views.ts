import { jsonArrayFrom } from 'kysely/helpers/postgres';
import type { Db } from '../../db/client.js';
import { notFound } from '../../lib/errors.js';
import { firstName } from '../notifications/vars.js';

type OptionsBlob = { display?: Array<{ label: string; value: string }> };

/**
 * What a customer may see about their order. Deliberately limited: first name only, no staff notes,
 * no cost data, and a partial address, because the link can end up forwarded.
 */
export async function publicOrderView(db: Db, orderId: string) {
  const order = await db
    .selectFrom('orders')
    .select([
      'id', 'reference', 'status', 'payment_status', 'placed_at', 'contact_name', 'subtotal_cents', 'discount_cents', 'delivery_cents',
      'shipping_cents', 'tax_cents', 'total_cents', 'paid_cents', 'refunded_cents', 'hold_expires_at', 'acceptance_mode', 'review_timing', 'is_test',
    ])
    .where('id', '=', orderId)
    .executeTakeFirst();
  if (!order) throw notFound('Order not found.');
  const items = await db
    .selectFrom('order_items')
    .select(['id', 'name', 'variant_name', 'quantity', 'status', 'options', 'line_subtotal_cents', 'discount_cents', 'tax_cents', 'product_id'])
    .where('order_id', '=', orderId)
    .orderBy('sort_order')
    .execute();
  const fulfillments = await db
    .selectFrom('fulfillments as f')
    .leftJoin('deliveries as d', 'd.fulfillment_id', 'f.id')
    .leftJoin('staff_profiles as s', 's.id', 'd.driver_staff_id')
    .select((eb) => [
      'f.id', 'f.method', 'f.status', 'f.scheduled_date', 'f.window_start', 'f.window_end', 'f.address', 'f.carrier', 'f.tracking_number', 'f.tracking_url',
      'f.ready_at', 'f.shipped_at', 'f.fulfilled_at', 'd.status as delivery_status', 'd.dispatched_at', 'd.delivered_at', 's.display_name as driver_name',
      jsonArrayFrom(eb.selectFrom('fulfillment_items as fi').select(['fi.order_item_id']).whereRef('fi.fulfillment_id', '=', 'f.id')).as('items'),
    ])
    .where('f.order_id', '=', orderId)
    .execute();
  const history = await db
    .selectFrom('order_status_history as h')
    .leftJoin('order_items as i', 'i.id', 'h.order_item_id')
    .select(['h.id', 'h.to_status', 'h.note', 'h.created_at', 'i.name as item_name'])
    .where('h.order_id', '=', orderId)
    .where('h.customer_visible', '=', true)
    .orderBy('h.created_at', 'desc')
    .execute();
  return {
    reference: order.reference,
    status: order.status,
    payment_status: order.payment_status,
    placed_at: order.placed_at,
    customer_first_name: firstName(order.contact_name),
    is_test: order.is_test,
    totals: {
      subtotal_cents: order.subtotal_cents,
      discount_cents: order.discount_cents,
      delivery_cents: order.delivery_cents,
      shipping_cents: order.shipping_cents,
      tax_cents: order.tax_cents,
      total_cents: order.total_cents,
      paid_cents: order.paid_cents,
      refunded_cents: order.refunded_cents,
    },
    can_pay: ['awaiting_payment', 'payment_failed'].includes(order.status) && order.total_cents > order.paid_cents,
    hold_expires_at: order.hold_expires_at,
    items: items.map((i) => ({
      id: i.id,
      name: i.name,
      variant_name: i.variant_name,
      quantity: i.quantity,
      status: i.status,
      options: (i.options as OptionsBlob)?.display ?? [],
      line_total_cents: i.line_subtotal_cents - i.discount_cents,
    })),
    fulfillments: fulfillments.map((f) => {
      const address = f.address as { city?: string; region?: string; postal_code?: string } | null;
      return {
        id: f.id,
        method: f.method,
        status: f.status,
        scheduled_date: f.scheduled_date,
        window_start: f.window_start,
        window_end: f.window_end,
        destination: address ? `${address.city ?? ''}, ${address.region ?? ''}`.trim() : null,
        carrier: f.carrier,
        tracking_number: f.tracking_number,
        tracking_url: f.tracking_url,
        ready_at: f.ready_at,
        shipped_at: f.shipped_at,
        fulfilled_at: f.fulfilled_at,
        delivery_status: f.delivery_status,
        dispatched_at: f.dispatched_at,
        delivered_at: f.delivered_at,
        driver_name: f.driver_name ? firstName(f.driver_name) : null,
        item_ids: f.items.map((x) => x.order_item_id),
      };
    }),
    timeline: history.map((h) => ({ id: h.id, status: h.to_status, note: h.note, at: h.created_at, item: h.item_name })),
  };
}

export type StaffAccess = { financials: boolean; customers: boolean };

export async function adminOrderView(db: Db, orderId: string, access: StaffAccess) {
  const order = await db.selectFrom('orders').selectAll().where('id', '=', orderId).executeTakeFirst();
  if (!order) throw notFound('Order not found.');
  const items = await db.selectFrom('order_items').selectAll().where('order_id', '=', orderId).orderBy('sort_order').execute();
  const fulfillments = await db
    .selectFrom('fulfillments as f')
    .leftJoin('deliveries as d', 'd.fulfillment_id', 'f.id')
    .leftJoin('delivery_zones as z', 'z.id', 'd.zone_id')
    .select((eb) => [
      'f.id', 'f.method', 'f.status', 'f.scheduled_date', 'f.window_start', 'f.window_end', 'f.window_id', 'f.fee_cents', 'f.recipient_name', 'f.recipient_phone', 'f.address',
      'f.instructions', 'f.card_message', 'f.carrier', 'f.tracking_number', 'f.tracking_url', 'f.assigned_staff_id', 'f.ready_at', 'f.shipped_at', 'f.fulfilled_at',
      'd.id as delivery_id', 'd.status as delivery_status', 'd.driver_staff_id', 'd.vehicle_id', 'd.route_id', 'd.attempt', 'd.proof_note', 'd.failure_reason', 'd.dispatched_at', 'd.delivered_at', 'z.name as zone_name',
      jsonArrayFrom(eb.selectFrom('fulfillment_items as fi').select(['fi.order_item_id', 'fi.quantity']).whereRef('fi.fulfillment_id', '=', 'f.id')).as('items'),
    ])
    .where('f.order_id', '=', orderId)
    .execute();
  const history = await db
    .selectFrom('order_status_history as h')
    .leftJoin('order_items as i', 'i.id', 'h.order_item_id')
    .leftJoin('users as u', 'u.id', 'h.actor_id')
    .select(['h.id', 'h.from_status', 'h.to_status', 'h.note', 'h.created_at', 'h.actor_type', 'h.customer_visible', 'i.name as item_name', 'u.email as actor_email'])
    .where('h.order_id', '=', orderId)
    .orderBy('h.created_at', 'desc')
    .execute();
  const notes = await db
    .selectFrom('order_notes as n')
    .leftJoin('users as u', 'u.id', 'n.staff_user_id')
    .select(['n.id', 'n.body', 'n.created_at', 'u.email as author'])
    .where('n.order_id', '=', orderId)
    .orderBy('n.created_at', 'desc')
    .execute();
  const tasks = await db.selectFrom('staff_tasks').select(['id', 'title', 'status', 'due_at', 'assigned_to', 'est_minutes']).where('subject_type', '=', 'order').where('subject_id', '=', orderId).orderBy('due_at').execute();
  const payments = access.financials
    ? await db.selectFrom('payments').select(['id', 'gateway', 'kind', 'amount_cents', 'status', 'refunded_cents', 'failure_reason', 'manual_reference', 'paid_at', 'created_at', 'amount_mismatch', 'checkout_session_id']).where('order_id', '=', orderId).orderBy('created_at').execute()
    : [];
  const refunds = access.financials
    ? await db.selectFrom('refunds').select(['id', 'payment_id', 'amount_cents', 'reason', 'status', 'created_at', 'failure_reason']).where('order_id', '=', orderId).orderBy('created_at').execute()
    : [];
  const stripMoney = <T extends Record<string, unknown>>(row: T): Partial<T> => {
    if (access.financials) return row;
    return Object.fromEntries(Object.entries(row).filter(([k]) => !k.endsWith('_cents'))) as Partial<T>;
  };
  const communications = access.customers
    ? await db.selectFrom('customer_communications').select(['id', 'direction', 'channel', 'subject', 'created_at']).where('subject_type', '=', 'order').where('subject_id', '=', orderId).orderBy('created_at', 'desc').limit(50).execute()
    : [];
  return {
    ...stripMoney(order),
    contact_email: access.customers ? order.contact_email : undefined,
    contact_phone: order.contact_phone,
    items: items.map(stripMoney),
    fulfillments: fulfillments.map((f) => ({ ...stripMoney(f), items: f.items })),
    history,
    notes,
    tasks,
    payments,
    refunds,
    communications,
    access,
  };
}
