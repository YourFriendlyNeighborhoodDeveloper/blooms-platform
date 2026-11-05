import { Hono } from 'hono';
import { z } from 'zod';
import { sql } from 'kysely';
import type { AppEnv } from '../http/types.js';
import { staffActor } from '../http/types.js';
import { readJson, readQuery, requirePermission } from '../http/helpers.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { generateReference } from '../lib/tokens.js';
import { addDays, localDate } from '../lib/time.js';
import { availabilityOf, changeStock, defaultLocationId, releaseOrderReservations, reserveStock } from '../modules/inventory/service.js';
import { getSetting } from '../modules/settings/service.js';

export const adminInventoryRoutes = new Hono<AppEnv>();

adminInventoryRoutes.get('/items', async (c) => {
  requirePermission(c, 'inventory.view');
  const ctx = c.get('ctx');
  const q = readQuery(c, z.object({ q: z.string().max(100).optional(), kind: z.string().max(30).optional(), low: z.enum(['true']).optional(), division: z.string().optional() }));
  let query = ctx.db
    .selectFrom('inventory_items as i')
    .leftJoin('suppliers as s', 's.id', 'i.default_supplier_id')
    .select([
      'i.id', 'i.sku', 'i.name', 'i.kind', 'i.unit', 'i.low_stock_threshold', 'i.reorder_quantity', 'i.perishable', 'i.active', 'i.variant_id', 'i.cost_cents', 's.name as supplier_name',
      sql<number>`COALESCE((SELECT sum(on_hand) FROM inventory_levels l WHERE l.item_id = i.id), 0)::int`.as('on_hand'),
      sql<number>`COALESCE((SELECT sum(reserved) FROM inventory_levels l WHERE l.item_id = i.id), 0)::int`.as('reserved'),
    ])
    .orderBy('i.name')
    .limit(1000);
  if (q.kind) query = query.where('i.kind', '=', q.kind as 'material');
  if (q.q) query = query.where((eb) => eb.or([eb('i.name', 'ilike', `%${q.q}%`), eb('i.sku', 'ilike', `%${q.q}%`)]));
  if (q.low) query = query.where(sql<boolean>`i.low_stock_threshold IS NOT NULL AND COALESCE((SELECT sum(on_hand - reserved) FROM inventory_levels l WHERE l.item_id = i.id), 0) <= i.low_stock_threshold`);
  const rows = await query.execute();
  return c.json({ items: rows.map((r) => ({ ...r, available: r.on_hand - r.reserved })) });
});

const itemSchema = z.object({
  sku: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(160),
  division_id: z.string().uuid().nullable().optional(),
  kind: z.enum(['finished_good', 'material', 'packaging', 'other']).default('material'),
  unit: z.string().trim().min(1).max(30).default('each'),
  variant_id: z.string().uuid().nullable().optional(),
  low_stock_threshold: z.number().int().min(0).nullable().optional(),
  reorder_quantity: z.number().int().min(0).nullable().optional(),
  perishable: z.boolean().default(false),
  shelf_life_days: z.number().int().min(0).nullable().optional(),
  default_supplier_id: z.string().uuid().nullable().optional(),
  cost_cents: z.number().int().min(0).nullable().optional(),
  active: z.boolean().default(true),
});

adminInventoryRoutes.post('/items', async (c) => {
  requirePermission(c, 'inventory.manage');
  const ctx = c.get('ctx');
  const body = await readJson(c, itemSchema);
  const row = await ctx.db.transaction().execute(async (trx) => {
    const item = await trx.insertInto('inventory_items').values(body).returning('id').executeTakeFirstOrThrow();
    await trx.insertInto('inventory_levels').values({ item_id: item.id, location_id: await defaultLocationId(trx) }).execute();
    await audit(trx, staffActor(c), 'inventory.item_create', { type: 'inventory_item', id: item.id }, { name: body.name });
    return item;
  });
  return c.json(row, 201);
});

adminInventoryRoutes.put('/items/:id', async (c) => {
  requirePermission(c, 'inventory.manage');
  const ctx = c.get('ctx');
  const body = await readJson(c, itemSchema);
  const res = await ctx.db.updateTable('inventory_items').set(body).where('id', '=', c.req.param('id')).executeTakeFirst();
  if (!Number(res.numUpdatedRows)) throw notFound('Item not found.');
  await audit(ctx.db, staffActor(c), 'inventory.item_update', { type: 'inventory_item', id: c.req.param('id') });
  return c.json({ ok: true });
});

adminInventoryRoutes.get('/items/:id', async (c) => {
  requirePermission(c, 'inventory.view');
  const db = c.get('ctx').db;
  const id = c.req.param('id');
  const item = await db.selectFrom('inventory_items').selectAll().where('id', '=', id).executeTakeFirst();
  if (!item) throw notFound('Item not found.');
  const levels = await db.selectFrom('inventory_levels as l').innerJoin('inventory_locations as x', 'x.id', 'l.location_id').select(['l.location_id', 'x.name as location', 'l.on_hand', 'l.reserved']).where('l.item_id', '=', id).execute();
  const movements = await db.selectFrom('inventory_movements as m').leftJoin('users as u', 'u.id', 'm.actor_user_id').leftJoin('orders as o', 'o.id', 'm.order_id').select(['m.id', 'm.delta_on_hand', 'm.delta_reserved', 'm.reason', 'm.note', 'm.created_at', 'u.email as actor', 'o.reference as order_reference', 'm.order_id']).where('m.item_id', '=', id).orderBy('m.created_at', 'desc').limit(200).execute();
  const lots = await db.selectFrom('inventory_lots').selectAll().where('item_id', '=', id).where('quantity_remaining', '>', 0).orderBy('best_by').execute();
  const reservations = await db.selectFrom('inventory_reservations as r').leftJoin('orders as o', 'o.id', 'r.order_id').select(['r.id', 'r.quantity', 'r.status', 'r.expires_at', 'o.reference as order_reference', 'r.order_id', 'r.created_at']).where('r.item_id', '=', id).where('r.status', 'in', ['held', 'committed', 'backorder']).orderBy('r.created_at', 'desc').execute();
  return c.json({ ...item, levels, movements, lots, reservations });
});

adminInventoryRoutes.post('/items/:id/adjust', async (c) => {
  requirePermission(c, 'inventory.manage');
  const ctx = c.get('ctx');
  const body = await readJson(
    c,
    z.object({
      delta: z.number().int(),
      reason: z.enum(['receive', 'adjust', 'count', 'waste', 'spoilage', 'return']),
      note: z.string().trim().max(500).optional().nullable(),
      location_id: z.string().uuid().optional(),
      best_by: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
      lot_id: z.string().uuid().optional().nullable(),
    }),
  );
  if ((body.reason === 'waste' || body.reason === 'spoilage') && body.delta >= 0) throw badRequest('Waste must reduce stock. Enter a negative number.');
  const result = await ctx.db.transaction().execute((trx) => changeStock(trx, { item_id: c.req.param('id'), ...body }, staffActor(c)));
  return c.json(result);
});

adminInventoryRoutes.get('/locations', async (c) => {
  requirePermission(c, 'inventory.view');
  return c.json({ locations: await c.get('ctx').db.selectFrom('inventory_locations').selectAll().orderBy('name').execute() });
});

adminInventoryRoutes.post('/locations', async (c) => {
  requirePermission(c, 'inventory.manage');
  const body = await readJson(c, z.object({ name: z.string().trim().min(1).max(100) }));
  return c.json(await c.get('ctx').db.insertInto('inventory_locations').values(body).returning('id').executeTakeFirstOrThrow(), 201);
});

/** The approved substitutes available for one order item, with what is on the shelf. */
adminInventoryRoutes.get('/substitutes', async (c) => {
  requirePermission(c, 'inventory.manage', 'orders.manage');
  const ctx = c.get('ctx');
  const q = readQuery(c, z.object({ order_item_id: z.string().uuid() }));
  const item = await ctx.db.selectFrom('order_items').select(['product_id', 'variant_id', 'quantity']).where('id', '=', q.order_item_id).executeTakeFirst();
  if (!item) throw notFound('Order item not found.');
  const rows = await ctx.db
    .selectFrom('product_recipes as r')
    .innerJoin('recipe_components as c', 'c.recipe_id', 'r.id')
    .innerJoin('inventory_items as original', 'original.id', 'c.item_id')
    .innerJoin('recipe_substitutes as s', 's.component_id', 'c.id')
    .innerJoin('inventory_items as swap', 'swap.id', 's.item_id')
    .select(['c.id as component_id', 'original.name as original_name', 'c.quantity as original_quantity', 's.item_id as substitute_item_id', 'swap.name as substitute_name', 's.quantity as substitute_quantity', 'swap.unit'])
    .where('r.active', '=', true)
    .where((eb) => eb.or([eb('r.product_id', '=', item.product_id), eb('r.variant_id', '=', item.variant_id)]))
    .execute();
  const stock = await availabilityOf(ctx.db, rows.map((r) => r.substitute_item_id));
  return c.json({ substitutes: rows.map((r) => ({ ...r, needed: r.substitute_quantity * item.quantity, available: stock.get(r.substitute_item_id)?.available ?? 0 })) });
});

/** Swaps one recipe ingredient for an approved substitute on an order. Stock moves atomically with the approval. */
adminInventoryRoutes.post('/substitute', async (c) => {
  requirePermission(c, 'inventory.manage', 'orders.manage');
  const ctx = c.get('ctx');
  const body = await readJson(c, z.object({ order_item_id: z.string().uuid(), component_id: z.string().uuid(), substitute_item_id: z.string().uuid() }));
  await ctx.db.transaction().execute(async (trx) => {
    const item = await trx.selectFrom('order_items').select(['id', 'order_id', 'quantity', 'name']).where('id', '=', body.order_item_id).executeTakeFirst();
    if (!item) throw notFound('Order item not found.');
    const component = await trx.selectFrom('recipe_components').select(['item_id', 'quantity']).where('id', '=', body.component_id).executeTakeFirst();
    if (!component) throw notFound('Recipe component not found.');
    const rule = await trx.selectFrom('recipe_substitutes').select(['quantity']).where('component_id', '=', body.component_id).where('item_id', '=', body.substitute_item_id).executeTakeFirst();
    if (!rule) throw conflict('substitute_not_allowed', 'That substitution has not been approved for this recipe.');
    const held = await trx.selectFrom('inventory_reservations').select(['id', 'status']).where('order_item_id', '=', item.id).where('item_id', '=', component.item_id).where('status', 'in', ['held', 'committed', 'backorder']).execute();
    if (held.length) {
      await releaseOrderReservations(trx, item.order_id, 'Replaced by an approved substitute', item.id);
    }
    const ok = await reserveStock(trx, { item_id: body.substitute_item_id, quantity: rule.quantity * item.quantity, expires_at: new Date(Date.now() + 3600_000), order_id: item.order_id, order_item_id: item.id });
    if (!ok) throw conflict('insufficient_stock', 'There is not enough of the substitute either.');
    await trx.updateTable('inventory_reservations').set({ status: 'committed', expires_at: null }).where('order_item_id', '=', item.id).where('item_id', '=', body.substitute_item_id).where('status', '=', 'held').execute();
    await audit(trx, staffActor(c), 'inventory.substitute', { type: 'order', id: item.order_id }, { item: item.name, from: component.item_id, to: body.substitute_item_id });
  });
  return c.json({ ok: true });
});

const recipeSchema = z.object({
  notes: z.string().max(2000).nullable().optional(),
  components: z.array(z.object({ item_id: z.string().uuid(), quantity: z.number().int().min(1), notes: z.string().max(300).nullable().optional(), substitutes: z.array(z.object({ item_id: z.string().uuid(), quantity: z.number().int().min(1) })).default([]) })).default([]),
});

adminInventoryRoutes.put('/recipes/product/:productId', async (c) => {
  requirePermission(c, 'catalog.manage');
  const ctx = c.get('ctx');
  const body = await readJson(c, recipeSchema);
  const productId = c.req.param('productId');
  const id = await ctx.db.transaction().execute(async (trx) => {
    let recipe = await trx.selectFrom('product_recipes').select('id').where('product_id', '=', productId).where('active', '=', true).executeTakeFirst();
    if (!recipe) recipe = await trx.insertInto('product_recipes').values({ product_id: productId, notes: body.notes ?? null }).returning('id').executeTakeFirstOrThrow();
    else await trx.updateTable('product_recipes').set({ notes: body.notes ?? null }).where('id', '=', recipe.id).execute();
    await trx.deleteFrom('recipe_components').where('recipe_id', '=', recipe.id).execute();
    for (const comp of body.components) {
      const row = await trx.insertInto('recipe_components').values({ recipe_id: recipe.id, item_id: comp.item_id, quantity: comp.quantity, notes: comp.notes ?? null }).returning('id').executeTakeFirstOrThrow();
      for (const s of comp.substitutes) await trx.insertInto('recipe_substitutes').values({ component_id: row.id, item_id: s.item_id, quantity: s.quantity }).execute();
    }
    await audit(trx, staffActor(c), 'recipe.update', { type: 'product', id: productId }, { components: body.components.length });
    return recipe.id;
  });
  return c.json({ id });
});

/** Standalone recipes for wedding services, such as "one centerpiece". */
adminInventoryRoutes.get('/recipes', async (c) => {
  requirePermission(c, 'catalog.manage');
  const rows = await c.get('ctx').db.selectFrom('product_recipes').select(['id', 'name', 'product_id', 'variant_id', 'notes']).where('active', '=', true).execute();
  return c.json({ recipes: rows });
});

const supplierSchema = z.object({ name: z.string().trim().min(1).max(160), contact_name: z.string().max(120).nullable().optional(), email: z.string().email().nullable().optional().or(z.literal('').transform(() => null)), phone: z.string().max(40).nullable().optional(), website: z.string().max(300).nullable().optional(), lead_time_days: z.number().int().min(0).nullable().optional(), notes: z.string().max(2000).nullable().optional(), active: z.boolean().default(true) });

adminInventoryRoutes.get('/suppliers', async (c) => {
  requirePermission(c, 'inventory.view');
  return c.json({ suppliers: await c.get('ctx').db.selectFrom('suppliers').selectAll().orderBy('name').execute() });
});

adminInventoryRoutes.post('/suppliers', async (c) => {
  requirePermission(c, 'purchasing.manage');
  return c.json(await c.get('ctx').db.insertInto('suppliers').values(await readJson(c, supplierSchema)).returning('id').executeTakeFirstOrThrow(), 201);
});

adminInventoryRoutes.put('/suppliers/:id', async (c) => {
  requirePermission(c, 'purchasing.manage');
  await c.get('ctx').db.updateTable('suppliers').set(await readJson(c, supplierSchema)).where('id', '=', c.req.param('id')).execute();
  return c.json({ ok: true });
});

adminInventoryRoutes.get('/purchase-orders', async (c) => {
  requirePermission(c, 'purchasing.manage');
  const db = c.get('ctx').db;
  const orders = await db.selectFrom('purchase_orders as p').innerJoin('suppliers as s', 's.id', 'p.supplier_id').select(['p.id', 'p.reference', 'p.status', 'p.expected_on', 'p.notes', 'p.created_at', 's.name as supplier_name', 'p.supplier_id']).orderBy('p.created_at', 'desc').limit(200).execute();
  const lines = orders.length ? await db.selectFrom('purchase_order_lines as l').innerJoin('inventory_items as i', 'i.id', 'l.item_id').select(['l.id', 'l.purchase_order_id', 'l.item_id', 'l.quantity', 'l.received_quantity', 'l.unit_cost_cents', 'i.name', 'i.unit']).where('l.purchase_order_id', 'in', orders.map((o) => o.id)).execute() : [];
  return c.json({ purchase_orders: orders.map((o) => ({ ...o, lines: lines.filter((l) => l.purchase_order_id === o.id) })) });
});

adminInventoryRoutes.post('/purchase-orders', async (c) => {
  requirePermission(c, 'purchasing.manage');
  const ctx = c.get('ctx');
  const body = await readJson(c, z.object({ supplier_id: z.string().uuid(), expected_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), notes: z.string().max(2000).nullable().optional(), lines: z.array(z.object({ item_id: z.string().uuid(), quantity: z.number().int().min(1), unit_cost_cents: z.number().int().min(0).nullable().optional() })).min(1) }));
  const row = await ctx.db.transaction().execute(async (trx) => {
    const po = await trx.insertInto('purchase_orders').values({ reference: generateReference('PO'), supplier_id: body.supplier_id, expected_on: body.expected_on ?? null, notes: body.notes ?? null, created_by: c.get('staff').userId }).returning(['id', 'reference']).executeTakeFirstOrThrow();
    await trx.insertInto('purchase_order_lines').values(body.lines.map((l) => ({ purchase_order_id: po.id, item_id: l.item_id, quantity: l.quantity, unit_cost_cents: l.unit_cost_cents ?? null }))).execute();
    await audit(trx, staffActor(c), 'purchase_order.create', { type: 'purchase_order', id: po.id }, { lines: body.lines.length });
    return po;
  });
  return c.json(row, 201);
});

adminInventoryRoutes.post('/purchase-orders/:id/status', async (c) => {
  requirePermission(c, 'purchasing.manage');
  const ctx = c.get('ctx');
  const { status } = await readJson(c, z.object({ status: z.enum(['sent', 'cancelled']) }));
  const res = await ctx.db.updateTable('purchase_orders').set({ status, sent_at: status === 'sent' ? ctx.clock.now() : undefined }).where('id', '=', c.req.param('id')).where('status', 'in', ['draft', 'sent']).executeTakeFirst();
  if (!Number(res.numUpdatedRows)) throw conflict('po_closed', 'This purchase order is closed.');
  await audit(ctx.db, staffActor(c), 'purchase_order.status', { type: 'purchase_order', id: c.req.param('id') }, { status });
  return c.json({ ok: true });
});

adminInventoryRoutes.post('/purchase-orders/:id/receive', async (c) => {
  requirePermission(c, 'purchasing.manage', 'inventory.manage');
  const ctx = c.get('ctx');
  const body = await readJson(c, z.object({ lines: z.array(z.object({ line_id: z.string().uuid(), quantity: z.number().int().min(1), best_by: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() })).min(1) }));
  const id = c.req.param('id');
  await ctx.db.transaction().execute(async (trx) => {
    const po = await trx.selectFrom('purchase_orders').select(['reference', 'status']).where('id', '=', id).forUpdate().executeTakeFirst();
    if (!po) throw notFound('Purchase order not found.');
    if (po.status === 'cancelled' || po.status === 'received') throw conflict('po_closed', 'This purchase order is closed.');
    for (const l of body.lines) {
      const line = await trx.selectFrom('purchase_order_lines').selectAll().where('id', '=', l.line_id).where('purchase_order_id', '=', id).forUpdate().executeTakeFirst();
      if (!line) throw notFound('Line not found.');
      if (line.received_quantity + l.quantity > line.quantity) throw badRequest('That is more than was ordered.');
      await trx.updateTable('purchase_order_lines').set({ received_quantity: line.received_quantity + l.quantity }).where('id', '=', line.id).execute();
      await changeStock(trx, { item_id: line.item_id, delta: l.quantity, reason: 'receive', note: `Received on ${po.reference}`, best_by: l.best_by ?? null }, staffActor(c));
    }
    const lines = await trx.selectFrom('purchase_order_lines').select(['quantity', 'received_quantity']).where('purchase_order_id', '=', id).execute();
    const done = lines.every((l) => l.received_quantity >= l.quantity);
    await trx.updateTable('purchase_orders').set({ status: done ? 'received' : 'partially_received', received_at: done ? ctx.clock.now() : null }).where('id', '=', id).execute();
  });
  return c.json({ ok: true });
});

/**
 * What needs buying: committed order demand plus planned event materials, minus what is on hand,
 * plus the reorder point. This reads only this system's data; it says nothing about supplier stock.
 */
adminInventoryRoutes.get('/purchasing-suggestions', async (c) => {
  requirePermission(c, 'inventory.view');
  const ctx = c.get('ctx');
  const tz = (await getSetting(ctx.db, 'general')).timezone;
  const today = localDate(ctx.clock.now(), tz);
  const q = readQuery(c, z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }));
  const until = addDays(today, q.days, tz);
  const rows = await sql<{ id: string; sku: string; name: string; unit: string; on_hand: number; reserved: number; planned: number; low_stock_threshold: number | null; reorder_quantity: number | null; cost_cents: number | null; supplier_id: string | null; supplier_name: string | null; lead_time_days: number | null }>`
    SELECT i.id, i.sku, i.name, i.unit, i.low_stock_threshold, i.reorder_quantity, i.cost_cents, s.id AS supplier_id, s.name AS supplier_name, s.lead_time_days,
      COALESCE((SELECT sum(l.on_hand) FROM inventory_levels l WHERE l.item_id = i.id), 0)::int AS on_hand,
      COALESCE((SELECT sum(l.reserved) FROM inventory_levels l WHERE l.item_id = i.id), 0)::int AS reserved,
      COALESCE((
        SELECT sum(m.quantity) FROM project_materials m
        JOIN wedding_projects p ON p.id = m.project_id
        WHERE m.item_id = i.id AND p.status IN ('confirmed', 'in_preparation', 'event_scheduled') AND m.needed_by BETWEEN ${today}::date AND ${until}::date
      ), 0)::int AS planned
    FROM inventory_items i
    LEFT JOIN suppliers s ON s.id = i.default_supplier_id
    WHERE i.active
  `.execute(ctx.db);
  const suggestions = rows.rows
    .map((r) => {
      const projected = r.on_hand - r.reserved - r.planned;
      const floor = r.low_stock_threshold ?? 0;
      const shortfall = Math.max(0, floor - projected);
      const quantity = shortfall > 0 ? Math.max(shortfall, r.reorder_quantity ?? 0) : 0;
      return { ...r, projected, suggested_quantity: quantity };
    })
    .filter((r) => r.suggested_quantity > 0)
    .sort((a, b) => a.projected - b.projected);
  return c.json({ days: q.days, suggestions, note: 'Based on this system’s records only. Supplier stock is not visible here.' });
});

adminInventoryRoutes.get('/material-requirements', async (c) => {
  requirePermission(c, 'inventory.view');
  const ctx = c.get('ctx');
  const q = readQuery(c, z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }));
  const tz = (await getSetting(ctx.db, 'general')).timezone;
  const today = localDate(ctx.clock.now(), tz);
  const from = q.from ?? today;
  const to = q.to ?? addDays(today, 30, tz);
  const orders = await sql<{ item_id: string; name: string; unit: string; quantity: number; source: string; ref: string; needed: string }>`
    SELECT r.item_id, i.name, i.unit, r.quantity, 'order' AS source, o.reference AS ref, f.scheduled_date::text AS needed
    FROM inventory_reservations r
    JOIN inventory_items i ON i.id = r.item_id
    JOIN orders o ON o.id = r.order_id
    JOIN fulfillment_items fi ON fi.order_item_id = r.order_item_id
    JOIN fulfillments f ON f.id = fi.fulfillment_id
    WHERE r.status IN ('held', 'committed', 'backorder') AND f.scheduled_date BETWEEN ${from}::date AND ${to}::date
    UNION ALL
    SELECT m.item_id, i.name, i.unit, m.quantity, 'event' AS source, p.reference AS ref, m.needed_by::text AS needed
    FROM project_materials m
    JOIN inventory_items i ON i.id = m.item_id
    JOIN wedding_projects p ON p.id = m.project_id
    WHERE p.status IN ('confirmed', 'in_preparation', 'event_scheduled') AND m.needed_by BETWEEN ${from}::date AND ${to}::date
    ORDER BY needed
  `.execute(ctx.db);
  const totals = new Map<string, { item_id: string; name: string; unit: string; quantity: number }>();
  for (const r of orders.rows) {
    const t = totals.get(r.item_id) ?? { item_id: r.item_id, name: r.name, unit: r.unit, quantity: 0 };
    t.quantity += r.quantity;
    totals.set(r.item_id, t);
  }
  return c.json({ from, to, lines: orders.rows, totals: [...totals.values()].sort((a, b) => a.name.localeCompare(b.name)) });
});
