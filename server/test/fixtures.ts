import type { AppContext } from '../context.js';
import { updateSetting, setApproval } from '../modules/settings/service.js';
import { changeStock, defaultLocationId } from '../modules/inventory/service.js';
import { SYSTEM_ACTOR } from '../lib/audit.js';
import { makeStaff } from './helpers.js';

export const division = async (ctx: AppContext, code: string) => (await ctx.db.selectFrom('business_divisions').select('id').where('code', '=', code).executeTakeFirstOrThrow()).id;

type ProductInput = {
  name?: string;
  division?: 'floral' | 'boutique';
  price?: number;
  sale?: number | null;
  stock?: number | null;
  prep?: number;
  points?: number;
  lead?: number;
  pickup?: boolean;
  delivery?: boolean;
  shipping?: boolean;
  custom?: boolean;
  outOfStock?: 'reject' | 'review' | 'backorder' | null;
  options?: Array<{ code: string; label: string; input_type: 'select' | 'multiselect' | 'text' | 'textarea'; required?: boolean; choices?: unknown[]; max_length?: number }>;
  season?: [string, string];
  status?: 'active' | 'draft';
  requiresApproval?: boolean | null;
};

let counter = 0;

/** Fictional catalog data for tests only. */
export async function makeProduct(ctx: AppContext, input: ProductInput = {}) {
  counter++;
  const name = input.name ?? `Test Bouquet ${counter}`;
  const product = await ctx.db
    .insertInto('products')
    .values({
      division_id: await division(ctx, input.division ?? 'floral'),
      slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${counter}`,
      name,
      status: input.status ?? 'active',
      is_custom: input.custom ?? false,
      prep_minutes: input.prep ?? 30,
      complexity_points: input.points ?? 2,
      min_lead_hours: input.lead ?? 0,
      allow_pickup: input.pickup ?? true,
      allow_delivery: input.delivery ?? true,
      allow_shipping: input.shipping ?? false,
      out_of_stock_behavior: input.outOfStock ?? null,
      season_start_md: input.season?.[0] ?? null,
      season_end_md: input.season?.[1] ?? null,
      requires_approval: input.requiresApproval ?? null,
    })
    .returning(['id', 'slug', 'name'])
    .executeTakeFirstOrThrow();
  const variant = await ctx.db
    .insertInto('product_variants')
    .values({ product_id: product.id, sku: `SKU-${counter}-${Math.random().toString(36).slice(2, 7)}`, name: 'Standard', price_cents: input.price ?? 5000, sale_price_cents: input.sale ?? null, cost_estimate_cents: 2000 })
    .returning(['id', 'sku'])
    .executeTakeFirstOrThrow();
  for (const [i, o] of (input.options ?? []).entries()) {
    await ctx.db
      .insertInto('product_options')
      .values({ product_id: product.id, code: o.code, label: o.label, input_type: o.input_type, required: o.required ?? false, choices: JSON.stringify(o.choices ?? []), max_length: o.max_length ?? null, sort_order: i })
      .execute();
  }
  let itemId: string | null = null;
  if (input.stock !== null && input.stock !== undefined) {
    const item = await ctx.db.insertInto('inventory_items').values({ sku: `INV-${variant.sku}`, name, variant_id: variant.id, kind: 'finished_good' }).returning('id').executeTakeFirstOrThrow();
    itemId = item.id;
    await ctx.db.insertInto('inventory_levels').values({ item_id: item.id, location_id: await defaultLocationId(ctx.db) }).execute();
    if (input.stock > 0) await changeStock(ctx.db, { item_id: item.id, delta: input.stock, reason: 'receive' }, SYSTEM_ACTOR);
  }
  return { ...product, variant_id: variant.id, sku: variant.sku, item_id: itemId };
}

export type ShopOptions = {
  sameDay?: boolean;
  cutoff?: string | null;
  leadHours?: number;
  dailyOrders?: number | null;
  dailyPoints?: number | null;
  maxStops?: number | null;
  review?: 'approve_first' | 'pay_first';
  outOfStock?: 'reject' | 'review' | 'backorder';
  approved?: boolean;
  bufferMinutes?: number;
};

/** A fully configured, fictional shop: open Mon-Sat, one florist, one driver, and a delivery zone. */
export async function configureShop(ctx: AppContext, opts: ShopOptions = {}) {
  const actor = SYSTEM_ACTOR;
  await updateSetting(ctx.db, 'general', { shop_open: true }, actor);
  await updateSetting(
    ctx.db,
    'ordering',
    {
      same_day_enabled: opts.sameDay ?? true,
      same_day_cutoff: opts.cutoff === undefined ? '14:00' : opts.cutoff,
      min_lead_hours: opts.leadHours ?? 0,
      daily_order_limit: opts.dailyOrders === undefined ? 20 : opts.dailyOrders,
      daily_points_limit: opts.dailyPoints === undefined ? 100 : opts.dailyPoints,
      review_timing: opts.review ?? 'approve_first',
      out_of_stock_behavior: opts.outOfStock ?? 'reject',
    },
    actor,
  );
  await updateSetting(ctx.db, 'delivery', { buffer_minutes: opts.bufferMinutes ?? 60, max_stops_per_driver_window: 5 }, actor);
  await updateSetting(ctx.db, 'tax', { rates_bps: { standard: 600 } }, actor);
  if (opts.approved !== false) {
    for (const g of ['ordering', 'delivery', 'tax', 'refunds'] as const) await setApproval(ctx.db, g, true, actor);
  }

  for (let weekday = 1; weekday <= 6; weekday++) {
    await ctx.db.insertInto('business_hours').values({ weekday, opens_at: '09:00', closes_at: '18:00' }).execute();
  }
  await ctx.db.insertInto('business_hours').values({ weekday: 0, closed: true }).execute();

  const zone = await ctx.db
    .insertInto('delivery_zones')
    .values({ name: 'Test Zone', postal_codes: ['48609', '48603'], fee_cents: 1000, min_order_cents: 0, travel_minutes: 15 })
    .returning('id')
    .executeTakeFirstOrThrow();

  const windows: Record<string, string> = {};
  for (let weekday = 1; weekday <= 6; weekday++) {
    const delivery = await ctx.db
      .insertInto('delivery_windows')
      .values({ kind: 'delivery', zone_id: zone.id, weekday, start_time: '15:00', end_time: '17:00', cutoff_minutes: 60, max_stops: opts.maxStops === undefined ? 5 : opts.maxStops })
      .returning('id')
      .executeTakeFirstOrThrow();
    const morning = await ctx.db
      .insertInto('delivery_windows')
      .values({ kind: 'delivery', zone_id: zone.id, weekday, start_time: '10:00', end_time: '12:00', cutoff_minutes: 60, max_stops: opts.maxStops === undefined ? 5 : opts.maxStops })
      .returning('id')
      .executeTakeFirstOrThrow();
    const pickup = await ctx.db
      .insertInto('delivery_windows')
      .values({ kind: 'pickup', weekday, start_time: '10:00', end_time: '18:00', cutoff_minutes: 0 })
      .returning('id')
      .executeTakeFirstOrThrow();
    windows[`delivery-${weekday}`] = delivery.id;
    windows[`morning-${weekday}`] = morning.id;
    windows[`pickup-${weekday}`] = pickup.id;
  }

  const florist = await makeStaff(ctx, { roles: ['florist'], capabilities: ['production'], name: 'Fiona Florist', email: 'florist@example.test' });
  const driver = await makeStaff(ctx, { roles: ['delivery'], capabilities: ['delivery'], name: 'Drew Driver', email: 'driver@example.test' });
  for (let weekday = 1; weekday <= 6; weekday++) {
    await ctx.db.insertInto('staff_availability').values({ staff_id: florist.staffId, weekday, starts_at: '09:00', ends_at: '18:00' }).execute();
    await ctx.db.insertInto('staff_availability').values({ staff_id: driver.staffId, weekday, starts_at: '09:00', ends_at: '18:00' }).execute();
  }
  return { zoneId: zone.id, windows, florist, driver };
}

/** 2026-11-10 is a Tuesday; these dates anchor the tests. */
export const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
