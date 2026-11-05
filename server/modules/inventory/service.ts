import { sql } from 'kysely';
import type { Db } from '../../db/client.js';
import type { Actor } from '../../lib/audit.js';
import { audit } from '../../lib/audit.js';
import { emit } from '../../automation/events.js';
import { badRequest, notFound } from '../../lib/errors.js';

export async function defaultLocationId(db: Db): Promise<string> {
  const row = await db
    .selectFrom('inventory_locations')
    .select('id')
    .where('active', '=', true)
    .orderBy('is_default', 'desc')
    .orderBy('created_at')
    .executeTakeFirst();
  if (!row) throw new Error('No inventory location exists.');
  return row.id;
}

export type Availability = { on_hand: number; reserved: number; available: number };

export async function availabilityOf(db: Db, itemIds: string[]): Promise<Map<string, Availability>> {
  const out = new Map<string, Availability>(itemIds.map((id) => [id, { on_hand: 0, reserved: 0, available: 0 }]));
  if (!itemIds.length) return out;
  const rows = await db
    .selectFrom('inventory_levels')
    .select(['item_id', (eb) => eb.fn.sum<number>('on_hand').as('on_hand'), (eb) => eb.fn.sum<number>('reserved').as('reserved')])
    .where('item_id', 'in', itemIds)
    .groupBy('item_id')
    .execute();
  for (const r of rows) {
    const on_hand = Number(r.on_hand);
    const reserved = Number(r.reserved);
    out.set(r.item_id, { on_hand, reserved, available: on_hand - reserved });
  }
  return out;
}

export type ReserveInput = {
  item_id: string;
  quantity: number;
  expires_at: Date;
  order_id?: string | null;
  order_item_id?: string | null;
  project_id?: string | null;
};

/**
 * Reserves stock with one conditional UPDATE. Two concurrent buyers of the last unit cannot both
 * succeed: the second statement waits for the first's row lock, re-evaluates the condition against
 * the committed value, and updates nothing. Returns false when stock is short.
 */
export async function reserveStock(trx: Db, input: ReserveInput): Promise<boolean> {
  const levels = await trx
    .selectFrom('inventory_levels')
    .innerJoin('inventory_locations', 'inventory_locations.id', 'inventory_levels.location_id')
    .select(['inventory_levels.location_id'])
    .where('inventory_levels.item_id', '=', input.item_id)
    .where('inventory_locations.active', '=', true)
    .orderBy('inventory_locations.is_default', 'desc')
    .execute();
  for (const { location_id } of levels) {
    const res = await sql`
      UPDATE inventory_levels SET reserved = reserved + ${input.quantity}, updated_at = now()
      WHERE item_id = ${input.item_id} AND location_id = ${location_id} AND on_hand - reserved >= ${input.quantity}
    `.execute(trx);
    if (Number(res.numAffectedRows ?? 0) === 1) {
      await trx
        .insertInto('inventory_reservations')
        .values({
          item_id: input.item_id,
          location_id,
          quantity: input.quantity,
          status: 'held',
          expires_at: input.expires_at,
          order_id: input.order_id ?? null,
          order_item_id: input.order_item_id ?? null,
          project_id: input.project_id ?? null,
        })
        .execute();
      await trx
        .insertInto('inventory_movements')
        .values({
          item_id: input.item_id,
          location_id,
          delta_reserved: input.quantity,
          reason: 'reserve',
          ref_type: input.order_id ? 'order' : input.project_id ? 'project' : null,
          ref_id: input.order_id ?? input.project_id ?? null,
          order_id: input.order_id ?? null,
        })
        .execute();
      return true;
    }
  }
  return false;
}

export async function recordBackorder(trx: Db, input: Omit<ReserveInput, 'expires_at'>) {
  const location_id = await defaultLocationId(trx);
  await trx
    .insertInto('inventory_reservations')
    .values({
      item_id: input.item_id,
      location_id,
      quantity: input.quantity,
      status: 'backorder',
      order_id: input.order_id ?? null,
      order_item_id: input.order_item_id ?? null,
      project_id: input.project_id ?? null,
    })
    .execute();
}

async function releaseRows(trx: Db, rows: Array<{ id: string; item_id: string; location_id: string; quantity: number; status: string; order_id: string | null }>, note: string) {
  for (const r of rows) {
    if (r.status !== 'backorder') {
      await sql`UPDATE inventory_levels SET reserved = GREATEST(reserved - ${r.quantity}, 0), updated_at = now() WHERE item_id = ${r.item_id} AND location_id = ${r.location_id}`.execute(trx);
      await trx
        .insertInto('inventory_movements')
        .values({ item_id: r.item_id, location_id: r.location_id, delta_reserved: -r.quantity, reason: 'release', ref_type: 'order', ref_id: r.order_id, order_id: r.order_id, note })
        .execute();
    }
    await trx.updateTable('inventory_reservations').set({ status: 'released', expires_at: null }).where('id', '=', r.id).execute();
  }
}

/** Gives held or committed stock back. Calling it twice changes nothing. */
export async function releaseOrderReservations(trx: Db, orderId: string, note: string, orderItemId?: string) {
  let q = trx
    .selectFrom('inventory_reservations')
    .select(['id', 'item_id', 'location_id', 'quantity', 'status', 'order_id'])
    .where('order_id', '=', orderId)
    .where('status', 'in', ['held', 'committed', 'backorder'])
    .forUpdate();
  if (orderItemId) q = q.where('order_item_id', '=', orderItemId);
  await releaseRows(trx, await q.execute(), note);
}

export async function commitOrderReservations(trx: Db, orderId: string) {
  await trx.updateTable('inventory_reservations').set({ status: 'committed', expires_at: null }).where('order_id', '=', orderId).where('status', '=', 'held').execute();
}

export async function extendOrderHolds(trx: Db, orderId: string, expiresAt: Date) {
  await trx.updateTable('inventory_reservations').set({ expires_at: expiresAt }).where('order_id', '=', orderId).where('status', '=', 'held').execute();
}

/** Takes stock off the shelf when an item leaves the shop. Idempotent per reservation. */
export async function consumeItemReservations(trx: Db, orderItemId: string, actor: Actor) {
  const rows = await trx
    .selectFrom('inventory_reservations')
    .select(['id', 'item_id', 'location_id', 'quantity', 'order_id'])
    .where('order_item_id', '=', orderItemId)
    .where('status', 'in', ['held', 'committed'])
    .forUpdate()
    .execute();
  for (const r of rows) {
    await sql`
      UPDATE inventory_levels SET on_hand = GREATEST(on_hand - ${r.quantity}, 0), reserved = GREATEST(reserved - ${r.quantity}, 0), updated_at = now()
      WHERE item_id = ${r.item_id} AND location_id = ${r.location_id}
    `.execute(trx);
    await trx
      .insertInto('inventory_movements')
      .values({
        item_id: r.item_id,
        location_id: r.location_id,
        delta_on_hand: -r.quantity,
        delta_reserved: -r.quantity,
        reason: 'sale',
        ref_type: 'order',
        ref_id: r.order_id,
        order_id: r.order_id,
        actor_user_id: actor.type === 'staff' ? (actor.id ?? null) : null,
      })
      .execute();
    await trx.updateTable('inventory_reservations').set({ status: 'consumed', expires_at: null }).where('id', '=', r.id).execute();
    await checkLowStock(trx, r.item_id);
  }
}

export type StockChange = {
  item_id: string;
  location_id?: string;
  delta: number;
  reason: 'receive' | 'adjust' | 'count' | 'waste' | 'spoilage' | 'return';
  note?: string | null;
  best_by?: string | null;
  lot_id?: string | null;
};

/** Records a physical stock change. Physical truth wins: stock can be written off below what is promised, and that raises a shortage alert. */
export async function changeStock(trx: Db, change: StockChange, actor: Actor) {
  if (change.delta === 0) throw badRequest('Enter a quantity other than zero.');
  const item = await trx.selectFrom('inventory_items').select(['id', 'name', 'perishable', 'shelf_life_days']).where('id', '=', change.item_id).executeTakeFirst();
  if (!item) throw notFound('Inventory item not found.');
  const location_id = change.location_id ?? (await defaultLocationId(trx));
  await trx.insertInto('inventory_levels').values({ item_id: change.item_id, location_id }).onConflict((oc) => oc.columns(['item_id', 'location_id']).doNothing()).execute();
  const level = await trx
    .selectFrom('inventory_levels')
    .select(['on_hand', 'reserved'])
    .where('item_id', '=', change.item_id)
    .where('location_id', '=', location_id)
    .forUpdate()
    .executeTakeFirstOrThrow();
  if (level.on_hand + change.delta < 0) throw badRequest(`Only ${level.on_hand} on hand at this location.`);
  await trx
    .updateTable('inventory_levels')
    .set({ on_hand: level.on_hand + change.delta })
    .where('item_id', '=', change.item_id)
    .where('location_id', '=', location_id)
    .execute();

  let lotId = change.lot_id ?? null;
  if (change.delta > 0 && change.reason === 'receive' && item.perishable) {
    const lot = await trx
      .insertInto('inventory_lots')
      .values({
        item_id: change.item_id,
        location_id,
        quantity_received: change.delta,
        quantity_remaining: change.delta,
        best_by: change.best_by ?? null,
        note: change.note ?? null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    lotId = lot.id;
  }
  if (change.delta < 0 && change.lot_id) {
    await sql`UPDATE inventory_lots SET quantity_remaining = GREATEST(quantity_remaining + ${change.delta}, 0) WHERE id = ${change.lot_id}`.execute(trx);
  }

  await trx
    .insertInto('inventory_movements')
    .values({
      item_id: change.item_id,
      location_id,
      delta_on_hand: change.delta,
      reason: change.reason,
      note: change.note ?? null,
      lot_id: lotId,
      actor_user_id: actor.type === 'staff' ? (actor.id ?? null) : null,
    })
    .execute();
  await audit(trx, actor, `inventory.${change.reason}`, { type: 'inventory_item', id: change.item_id }, { delta: change.delta, location_id, note: change.note ?? null });

  const after = level.on_hand + change.delta;
  if (after < level.reserved) {
    await emit(trx, 'inventory.shortage', { type: 'inventory_item', id: change.item_id }, { note: `${level.reserved} promised but only ${after} on hand after a stock change.` });
  }
  await checkLowStock(trx, change.item_id);
  return { on_hand: after, reserved: level.reserved };
}

/** Raises one low-stock alert per dip; it clears when stock recovers. */
export async function checkLowStock(trx: Db, itemId: string) {
  const item = await trx.selectFrom('inventory_items').select(['id', 'low_stock_threshold', 'active']).where('id', '=', itemId).executeTakeFirst();
  if (!item || item.low_stock_threshold === null || !item.active) return;
  const available = (await availabilityOf(trx, [itemId])).get(itemId)?.available ?? 0;
  if (available <= item.low_stock_threshold) {
    const res = await trx
      .insertInto('low_stock_events')
      .values({ item_id: itemId, available, threshold: item.low_stock_threshold })
      .onConflict((oc) => oc.column('item_id').where('resolved_at', 'is', null).doNothing())
      .executeTakeFirst();
    if (Number(res.numInsertedOrUpdatedRows ?? 0) > 0) {
      await emit(trx, 'inventory.low', { type: 'inventory_item', id: itemId }, { available, threshold: item.low_stock_threshold });
    }
  } else {
    await trx.updateTable('low_stock_events').set({ resolved_at: new Date() }).where('item_id', '=', itemId).where('resolved_at', 'is', null).execute();
  }
}
