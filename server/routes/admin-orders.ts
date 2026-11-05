import { Hono } from 'hono';
import { z } from 'zod';
import { sql } from 'kysely';
import type { Db } from '../db/client.js';
import type { AppEnv } from '../http/types.js';
import { staffActor } from '../http/types.js';
import { can, csvResponse, readJson, readQuery, requirePermission } from '../http/helpers.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { toCsv } from '../lib/csv.js';
import { adminOrderView } from '../modules/orders/views.js';
import { approveOrder, cancelOrder, rejectOrder, requestCustomerInfo, rescheduleFulfillment } from '../modules/orders/actions.js';
import { canTransitionItem, lockOrder, updateItemStatuses, type ItemStatus } from '../modules/orders/workflow.js';
import { issueRefund, recordManualPayment } from '../modules/payments/service.js';
import { getSetting } from '../modules/settings/service.js';
import { changeStock } from '../modules/inventory/service.js';

export const adminOrderRoutes = new Hono<AppEnv>();

const listSchema = z.object({
  status: z.string().max(40).optional(),
  division: z.string().max(40).optional(),
  q: z.string().max(100).optional(),
  attention: z.enum(['true', 'false']).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  method: z.enum(['pickup', 'delivery', 'shipping']).optional(),
  scheduled: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const listQuery = (db: Db, q: z.output<typeof listSchema>) => {
  let query = db.selectFrom('orders as o');
  if (q.status === 'open') {
    query = query.where('o.status', 'in', ['awaiting_review', 'needs_customer', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'shipped', 'partially_fulfilled', 'rescheduling', 'delivery_failed', 'inventory_shortage']);
  } else if (q.status) {
    query = query.where('o.status', '=', q.status as 'accepted');
  } else {
    query = query.where('o.status', 'not in', ['expired']);
  }
  if (q.attention === 'true') query = query.where('o.needs_attention', '=', true);
  if (q.from) query = query.where('o.placed_at', '>=', new Date(q.from));
  if (q.to) query = query.where('o.placed_at', '<=', new Date(q.to));
  if (q.q) {
    const term = `%${q.q.trim().replace(/[%_\\]/g, '\\$&')}%`;
    query = query.where((eb) => eb.or([eb('o.reference', 'ilike', term), eb('o.contact_name', 'ilike', term), sql<boolean>`o.contact_email::text ILIKE ${term}`]));
  }
  if (q.division) {
    query = query.where((eb) =>
      eb.exists(
        eb
          .selectFrom('order_items as i')
          .innerJoin('business_divisions as d', 'd.id', 'i.division_id')
          .select(sql`1`.as('x'))
          .whereRef('i.order_id', '=', 'o.id')
          .where('d.code', '=', q.division as string),
      ),
    );
  }
  if (q.method || q.scheduled) {
    query = query.where((eb) => {
      let sub = eb.selectFrom('fulfillments as f').select(sql`1`.as('x')).whereRef('f.order_id', '=', 'o.id');
      if (q.method) sub = sub.where('f.method', '=', q.method);
      if (q.scheduled) sub = sub.where('f.scheduled_date', '=', q.scheduled);
      return eb.exists(sub);
    });
  }
  return query;
};

adminOrderRoutes.get('/', async (c) => {
  requirePermission(c, 'orders.view');
  const ctx = c.get('ctx');
  const q = readQuery(c, listSchema);
  const financial = can(c, 'orders.financials');
  const rows = await listQuery(ctx.db, q)
    .select([
      'o.id', 'o.reference', 'o.status', 'o.payment_status', 'o.contact_name', 'o.placed_at', 'o.total_cents', 'o.needs_attention', 'o.attention_reason', 'o.is_test', 'o.acceptance_mode',
      sql<string>`(SELECT string_agg(i.quantity || ' × ' || i.name, ', ' ORDER BY i.sort_order) FROM order_items i WHERE i.order_id = o.id)`.as('items_text'),
      sql<string>`(SELECT string_agg(DISTINCT f.method, ', ') FROM fulfillments f WHERE f.order_id = o.id)`.as('methods'),
      sql<Date | null>`(SELECT min(f.window_start) FROM fulfillments f WHERE f.order_id = o.id)`.as('next_window'),
    ])
    .orderBy('o.placed_at', 'desc')
    .limit(q.limit)
    .offset(q.offset)
    .execute();
  const total = await listQuery(ctx.db, q).select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
  return c.json({ orders: rows.map((r) => (financial ? r : { ...r, total_cents: undefined, payment_status: undefined })), total: Number(total.n) });
});

adminOrderRoutes.get('/export.csv', async (c) => {
  requirePermission(c, 'orders.export');
  const ctx = c.get('ctx');
  const q = readQuery(c, listSchema);
  const rows = await listQuery(ctx.db, q)
    .select(['o.reference', 'o.status', 'o.payment_status', 'o.placed_at', 'o.contact_name', 'o.contact_email', 'o.subtotal_cents', 'o.discount_cents', 'o.delivery_cents', 'o.shipping_cents', 'o.tax_cents', 'o.total_cents', 'o.paid_cents', 'o.refunded_cents', 'o.is_test'])
    .orderBy('o.placed_at', 'desc')
    .limit(10_000)
    .execute();
  const dollars = (n: number) => (n / 100).toFixed(2);
  const out = rows.map((r) => ({
    reference: r.reference,
    status: r.status,
    payment_status: r.payment_status,
    placed_at: r.placed_at,
    customer: r.contact_name,
    email: r.contact_email,
    subtotal: dollars(r.subtotal_cents),
    discount: dollars(r.discount_cents),
    delivery: dollars(r.delivery_cents),
    shipping: dollars(r.shipping_cents),
    tax: dollars(r.tax_cents),
    total: dollars(r.total_cents),
    paid: dollars(r.paid_cents),
    refunded: dollars(r.refunded_cents),
    test_data: r.is_test,
  }));
  await audit(ctx.db, staffActor(c), 'orders.export', null, { rows: out.length });
  return csvResponse(c, 'orders.csv', toCsv(out));
});

adminOrderRoutes.get('/:id', async (c) => {
  requirePermission(c, 'orders.view');
  return c.json(await adminOrderView(c.get('ctx').db, c.req.param('id'), { financials: can(c, 'orders.financials'), customers: can(c, 'customers.view') }));
});

adminOrderRoutes.post('/:id/approve', async (c) => {
  requirePermission(c, 'orders.manage');
  const { note } = await readJson(c, z.object({ note: z.string().max(1000).optional().nullable() }));
  await approveOrder(c.get('ctx'), c.req.param('id'), staffActor(c), note);
  return c.json({ ok: true });
});

adminOrderRoutes.post('/:id/reject', async (c) => {
  requirePermission(c, 'orders.manage');
  const { reason } = await readJson(c, z.object({ reason: z.string().trim().min(1, 'Please give a reason.').max(1000) }));
  const ctx = c.get('ctx');
  const paid = await ctx.db.selectFrom('orders').select('paid_cents').where('id', '=', c.req.param('id')).executeTakeFirst();
  if (paid && paid.paid_cents > 0) requirePermission(c, 'orders.refund');
  await rejectOrder(ctx, c.req.param('id'), reason, staffActor(c));
  return c.json({ ok: true });
});

adminOrderRoutes.post('/:id/cancel', async (c) => {
  requirePermission(c, 'orders.manage');
  const body = await readJson(c, z.object({ reason: z.string().trim().min(1, 'Please give a reason.').max(1000), refund: z.boolean().default(true) }));
  if (body.refund) {
    const paid = await c.get('ctx').db.selectFrom('orders').select('paid_cents').where('id', '=', c.req.param('id')).executeTakeFirst();
    if (paid && paid.paid_cents > 0) requirePermission(c, 'orders.refund');
  }
  await cancelOrder(c.get('ctx'), c.req.param('id'), body, staffActor(c));
  return c.json({ ok: true });
});

adminOrderRoutes.post('/:id/request-info', async (c) => {
  requirePermission(c, 'orders.manage');
  const { question } = await readJson(c, z.object({ question: z.string().trim().min(1).max(2000) }));
  await requestCustomerInfo(c.get('ctx'), c.req.param('id'), question, staffActor(c));
  return c.json({ ok: true });
});

const ITEM_STATUSES = ['pending', 'preparing', 'ready', 'out_for_delivery', 'shipped', 'fulfilled', 'backordered', 'shortage', 'delivery_failed', 'cancelled', 'returned'] as const;

adminOrderRoutes.post('/:id/items/status', async (c) => {
  const staff = requirePermission(c, 'orders.view');
  if (!staff.permissions.has('orders.manage') && !staff.permissions.has('deliveries.manage')) throw forbidden();
  const body = await readJson(
    c,
    z.object({
      item_ids: z.array(z.string().uuid()).min(1),
      status: z.enum(ITEM_STATUSES),
      note: z.string().max(1000).optional().nullable(),
      reason: z.string().max(1000).optional().nullable(),
      tracking: z.object({ carrier: z.string().max(60).optional().nullable(), tracking_number: z.string().max(100).optional().nullable(), tracking_url: z.string().url().max(500).optional().nullable() }).optional(),
    }),
  );
  // Delivery staff may only record delivery progress, not change production.
  if (!staff.permissions.has('orders.manage') && !['out_for_delivery', 'fulfilled', 'delivery_failed'].includes(body.status)) throw forbidden();
  const ctx = c.get('ctx');
  if (body.status === 'fulfilled') {
    const settings = await getSetting(ctx.db, 'delivery');
    if (settings.proof_of_delivery_required) {
      const missing = await ctx.db
        .selectFrom('fulfillment_items as fi')
        .innerJoin('deliveries as d', 'd.fulfillment_id', 'fi.fulfillment_id')
        .select('d.id')
        .where('fi.order_item_id', 'in', body.item_ids)
        .where('d.proof_note', 'is', null)
        .where('d.proof_storage_key', 'is', null)
        .executeTakeFirst();
      if (missing) throw conflict('proof_required', 'Record proof of delivery first.');
    }
  }
  const result = await ctx.db.transaction().execute((trx) => updateItemStatuses(trx, c.req.param('id'), body.item_ids, body.status as ItemStatus, staffActor(c), { note: body.note, reason: body.reason, tracking: body.tracking }));
  return c.json(result);
});

adminOrderRoutes.post('/:id/notes', async (c) => {
  requirePermission(c, 'orders.view');
  const { body } = await readJson(c, z.object({ body: z.string().trim().min(1).max(4000) }));
  const ctx = c.get('ctx');
  const staff = c.get('staff');
  const note = await ctx.db.insertInto('order_notes').values({ order_id: c.req.param('id'), staff_user_id: staff.userId, body }).returning(['id', 'body', 'created_at']).executeTakeFirstOrThrow();
  await audit(ctx.db, staffActor(c), 'order.note', { type: 'order', id: c.req.param('id') });
  return c.json(note, 201);
});

adminOrderRoutes.post('/:id/refund', async (c) => {
  const staff = requirePermission(c, 'orders.refund', 'orders.financials');
  const ctx = c.get('ctx');
  const body = await readJson(
    c,
    z.object({
      payment_id: z.string().uuid().optional(),
      amount_cents: z.number().int().positive(),
      reason: z.string().trim().min(1, 'Please give a reason.').max(1000),
      item_ids: z.array(z.string().uuid()).optional(),
    }),
  );
  const policy = await getSetting(ctx.db, 'refunds');
  if (policy.staff_limit_cents !== null && body.amount_cents > policy.staff_limit_cents && !staff.roles.includes('owner')) {
    throw forbidden(`Refunds above $${(policy.staff_limit_cents / 100).toFixed(2)} need the owner.`);
  }
  const orderId = c.req.param('id');
  const payments = await ctx.db.selectFrom('payments').select(['id', 'amount_cents', 'refunded_cents']).where('order_id', '=', orderId).where('status', '=', 'succeeded').orderBy('created_at').execute();
  if (body.payment_id && !payments.some((p) => p.id === body.payment_id)) throw notFound('That payment is not on this order.');
  const target = body.payment_id ? payments.find((p) => p.id === body.payment_id) : payments.find((p) => p.amount_cents - p.refunded_cents >= body.amount_cents);
  if (!target) throw conflict('refund_too_large', 'No single payment on this order has that much left to refund.');
  const result = await issueRefund(ctx, { payment_id: target.id, amount_cents: body.amount_cents, reason: body.reason, actor: staffActor(c) });
  if (body.item_ids?.length) {
    await ctx.db.updateTable('order_items').set({ status: 'refunded' }).where('id', 'in', body.item_ids).where('order_id', '=', orderId).where('status', 'in', ['pending', 'backordered', 'shortage', 'preparing', 'ready', 'fulfilled', 'delivery_failed', 'returned']).execute();
  }
  return c.json(result);
});

adminOrderRoutes.post('/:id/manual-payment', async (c) => {
  requirePermission(c, 'orders.manage', 'orders.financials');
  const body = await readJson(c, z.object({ amount_cents: z.number().int().positive(), reference: z.string().trim().max(200).optional().nullable() }));
  await recordManualPayment(c.get('ctx'), { order_id: c.req.param('id'), amount_cents: body.amount_cents, reference: body.reference, actor: staffActor(c) });
  return c.json({ ok: true });
});

adminOrderRoutes.post('/:id/resolve-attention', async (c) => {
  requirePermission(c, 'orders.manage');
  const ctx = c.get('ctx');
  const { note } = await readJson(c, z.object({ note: z.string().trim().min(1, 'Please note what was decided.').max(1000) }));
  await ctx.db.transaction().execute(async (trx) => {
    const order = await lockOrder(trx, c.req.param('id'));
    await trx.updateTable('orders').set({ needs_attention: false, attention_reason: null }).where('id', '=', order.id).execute();
    await trx.insertInto('order_notes').values({ order_id: order.id, staff_user_id: c.get('staff').userId, body: `Resolved: ${note}` }).execute();
    await trx.updateTable('system_alerts').set({ status: 'resolved', resolved_at: ctx.clock.now(), resolved_by: c.get('staff').userId }).where('subject_type', '=', 'order').where('subject_id', '=', order.id).where('status', '!=', 'resolved').execute();
    await audit(trx, staffActor(c), 'order.attention_resolved', { type: 'order', id: order.id }, { note });
  });
  return c.json({ ok: true });
});

adminOrderRoutes.post('/:id/returns', async (c) => {
  requirePermission(c, 'orders.manage');
  const ctx = c.get('ctx');
  const body = await readJson(
    c,
    z.object({ order_item_id: z.string().uuid(), quantity: z.number().int().positive(), reason: z.string().trim().max(1000).optional().nullable(), restock: z.boolean().default(false) }),
  );
  const orderId = c.req.param('id');
  const row = await ctx.db.transaction().execute(async (trx) => {
    const order = await lockOrder(trx, orderId);
    const item = await trx.selectFrom('order_items').select(['id', 'variant_id', 'quantity', 'status', 'name']).where('id', '=', body.order_item_id).where('order_id', '=', order.id).executeTakeFirst();
    if (!item) throw notFound('That item is not on this order.');
    if (body.quantity > item.quantity) throw badRequest('That is more than was ordered.');
    const created = await trx
      .insertInto('returns')
      .values({ order_id: orderId, order_item_id: item.id, quantity: body.quantity, reason: body.reason ?? null, restock: body.restock, status: 'received', created_by: c.get('staff').userId })
      .returning('id')
      .executeTakeFirstOrThrow();
    if (body.restock && item.variant_id) {
      const stock = await trx.selectFrom('inventory_items').select('id').where('variant_id', '=', item.variant_id).executeTakeFirst();
      if (stock) await changeStock(trx, { item_id: stock.id, delta: body.quantity, reason: 'return', note: `Return from order ${order.reference}` }, staffActor(c));
    }
    if (body.quantity === item.quantity && canTransitionItem(item.status as ItemStatus, 'returned')) {
      await updateItemStatuses(trx, orderId, [item.id], 'returned', staffActor(c), { note: body.reason ?? null });
    }
    await audit(trx, staffActor(c), 'order.return', { type: 'order', id: orderId }, { item: item.name, quantity: body.quantity, restock: body.restock });
    return created;
  });
  return c.json(row, 201);
});

export const adminFulfillmentRoutes = new Hono<AppEnv>();

/** The windows a fulfilment could move to. The rules that decide whether a move is allowed run when it is requested. */
adminFulfillmentRoutes.get('/:id/windows', async (c) => {
  requirePermission(c, 'orders.manage');
  const ctx = c.get('ctx');
  const f = await ctx.db
    .selectFrom('fulfillments as f')
    .leftJoin('deliveries as d', 'd.fulfillment_id', 'f.id')
    .select(['f.method', 'd.zone_id'])
    .where('f.id', '=', c.req.param('id'))
    .executeTakeFirst();
  if (!f) throw notFound('Fulfilment not found.');
  let query = ctx.db.selectFrom('delivery_windows').select(['id', 'weekday', 'start_time', 'end_time']).where('kind', '=', f.method === 'delivery' ? 'delivery' : 'pickup').where('active', '=', true).orderBy('start_time');
  if (f.method === 'delivery' && f.zone_id) query = query.where((eb) => eb.or([eb('zone_id', '=', f.zone_id), eb('zone_id', 'is', null)]));
  return c.json({ windows: await query.execute() });
});

adminFulfillmentRoutes.post('/:id/reschedule', async (c) => {
  const staff = requirePermission(c, 'orders.manage');
  const body = await readJson(
    c,
    z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), window_id: z.string().uuid(), override: z.boolean().default(false), note: z.string().max(1000).optional().nullable() }),
  );
  if (body.override && !staff.permissions.has('settings.manage')) throw forbidden('Only a manager can override capacity.');
  return c.json(await rescheduleFulfillment(c.get('ctx'), c.req.param('id'), body, staffActor(c)));
});

adminFulfillmentRoutes.patch('/:id', async (c) => {
  requirePermission(c, 'orders.manage');
  const ctx = c.get('ctx');
  const body = await readJson(
    c,
    z.object({
      assigned_staff_id: z.string().uuid().nullable().optional(),
      instructions: z.string().max(1000).nullable().optional(),
      carrier: z.string().max(60).nullable().optional(),
      tracking_number: z.string().max(100).nullable().optional(),
      tracking_url: z.string().url().max(500).nullable().optional(),
    }),
  );
  const res = await ctx.db.updateTable('fulfillments').set(body).where('id', '=', c.req.param('id')).returning('order_id').executeTakeFirst();
  if (!res) throw notFound('Fulfilment not found.');
  await audit(ctx.db, staffActor(c), 'fulfillment.update', { type: 'fulfillment', id: c.req.param('id') }, body);
  return c.json({ ok: true });
});
