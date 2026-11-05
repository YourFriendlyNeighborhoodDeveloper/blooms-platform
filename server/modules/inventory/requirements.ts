import type { Db } from '../../db/client.js';
import { availabilityOf } from './service.js';

export type Requirement = { item_id: string; name: string; unit: string; sku: string; per_unit: number; kind: 'finished_good' | 'component' };

/**
 * What one unit of each variant takes from stock. A variant linked to a stock item uses that item.
 * Otherwise an active recipe applies (variant recipe first, then product recipe). With neither, the
 * variant has no stock limit, which is what made-to-order services want.
 */
export async function requirementsForVariants(db: Db, variantIds: string[]): Promise<Map<string, Requirement[]>> {
  const out = new Map<string, Requirement[]>(variantIds.map((id) => [id, []]));
  if (!variantIds.length) return out;

  const variants = await db.selectFrom('product_variants').select(['id', 'product_id', 'track_inventory']).where('id', 'in', variantIds).execute();
  const linked = await db
    .selectFrom('inventory_items')
    .select(['id', 'name', 'unit', 'sku', 'variant_id'])
    .where('variant_id', 'in', variantIds)
    .where('active', '=', true)
    .execute();
  const recipes = await db
    .selectFrom('product_recipes')
    .innerJoin('recipe_components', 'recipe_components.recipe_id', 'product_recipes.id')
    .innerJoin('inventory_items', 'inventory_items.id', 'recipe_components.item_id')
    .select(['product_recipes.variant_id', 'product_recipes.product_id', 'recipe_components.item_id', 'recipe_components.quantity', 'inventory_items.name', 'inventory_items.unit', 'inventory_items.sku'])
    .where('product_recipes.active', '=', true)
    .where((eb) =>
      eb.or([
        eb('product_recipes.variant_id', 'in', variantIds),
        eb('product_recipes.product_id', 'in', variants.map((v) => v.product_id)),
      ]),
    )
    .execute();

  for (const v of variants) {
    const item = linked.find((l) => l.variant_id === v.id);
    if (v.track_inventory && item) {
      out.set(v.id, [{ item_id: item.id, name: item.name, unit: item.unit, sku: item.sku, per_unit: 1, kind: 'finished_good' }]);
      continue;
    }
    const own = recipes.filter((r) => r.variant_id === v.id);
    const comps = own.length ? own : recipes.filter((r) => r.product_id === v.product_id && !r.variant_id);
    out.set(
      v.id,
      comps.map((c) => ({ item_id: c.item_id, name: c.name, unit: c.unit, sku: c.sku, per_unit: c.quantity, kind: 'component' as const })),
    );
  }
  return out;
}

/** How many units of each variant could be sold now, or null when stock does not limit it. */
export async function sellableQuantities(db: Db, variantIds: string[]): Promise<Map<string, number | null>> {
  const reqs = await requirementsForVariants(db, variantIds);
  const itemIds = [...new Set([...reqs.values()].flat().map((r) => r.item_id))];
  const avail = await availabilityOf(db, itemIds);
  const out = new Map<string, number | null>();
  for (const id of variantIds) {
    const list = reqs.get(id) ?? [];
    if (!list.length) {
      out.set(id, null);
      continue;
    }
    out.set(id, Math.max(0, Math.min(...list.map((r) => Math.floor((avail.get(r.item_id)?.available ?? 0) / r.per_unit)))));
  }
  return out;
}
