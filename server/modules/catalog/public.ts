import { sql } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import type { Db } from '../../db/client.js';
import { notFound } from '../../lib/errors.js';
import { sellableQuantities } from '../inventory/requirements.js';
import { getSetting } from '../settings/service.js';

export type ListFilters = { division?: string; category?: string; q?: string; sort?: 'featured' | 'price_asc' | 'price_desc' | 'newest'; limit?: number; offset?: number };

export const effectivePrice = (v: { price_cents: number; sale_price_cents: number | null }) =>
  v.sale_price_cents !== null && v.sale_price_cents < v.price_cents ? v.sale_price_cents : v.price_cents;

/** Only active products with at least one active variant are ever exposed. Costs are never exposed. */
export async function listProducts(db: Db, filters: ListFilters) {
  let q = db
    .selectFrom('products as p')
    .innerJoin('business_divisions as d', 'd.id', 'p.division_id')
    .select((eb) => [
      'p.id',
      'p.slug',
      'p.out_of_stock_behavior',
      'p.name',
      'p.short_description',
      'p.featured',
      'p.is_custom',
      'p.allow_pickup',
      'p.allow_delivery',
      'p.allow_shipping',
      'p.created_at',
      'd.code as division_code',
      'd.name as division_name',
      jsonArrayFrom(
        eb
          .selectFrom('product_variants as v')
          .select(['v.id', 'v.name', 'v.price_cents', 'v.sale_price_cents'])
          .whereRef('v.product_id', '=', 'p.id')
          .where('v.active', '=', true)
          .orderBy('v.sort_order'),
      ).as('variants'),
      jsonArrayFrom(eb.selectFrom('product_images as i').select(['i.url', 'i.alt']).whereRef('i.product_id', '=', 'p.id').orderBy('i.sort_order').limit(2)).as('images'),
    ])
    .where('p.status', '=', 'active')
    .where('d.active', '=', true)
    .where((eb) =>
      eb.exists(eb.selectFrom('product_variants as v2').select(sql`1`.as('x')).whereRef('v2.product_id', '=', 'p.id').where('v2.active', '=', true)),
    );
  if (filters.division) q = q.where('d.code', '=', filters.division);
  if (filters.category) {
    q = q.where((eb) =>
      eb.exists(
        eb
          .selectFrom('product_category_links as l')
          .innerJoin('product_categories as c', 'c.id', 'l.category_id')
          .select(sql`1`.as('x'))
          .whereRef('l.product_id', '=', 'p.id')
          .where('c.slug', '=', filters.category as string),
      ),
    );
  }
  if (filters.q) {
    const term = filters.q.trim();
    q = q.where(
      sql<boolean>`(to_tsvector('english', p.name || ' ' || coalesce(p.short_description, '') || ' ' || coalesce(p.description, '')) @@ websearch_to_tsquery('english', ${term}) OR p.name ILIKE ${`%${term.replace(/[%_\\]/g, '\\$&')}%`})`,
    );
  }
  const rows = await q
    .orderBy('p.featured', 'desc')
    .orderBy('p.sort_order')
    .orderBy('p.created_at', 'desc')
    .limit(Math.min(filters.limit ?? 48, 100))
    .offset(filters.offset ?? 0)
    .execute();

  const stock = await sellableQuantities(db, rows.flatMap((r) => r.variants.map((v) => v.id)));
  const ordering = await getSetting(db, 'ordering');
  const out = rows.map((r) => {
    const prices = r.variants.map(effectivePrice);
    const listPrices = r.variants.map((v) => v.price_cents);
    const quantities = r.variants.map((v) => stock.get(v.id));
    return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      short_description: r.short_description,
      featured: r.featured,
      is_custom: r.is_custom,
      division: { code: r.division_code, name: r.division_name },
      image: r.images[0] ?? null,
      image_alt: r.images[1] ?? null,
      from_price_cents: Math.min(...prices),
      from_list_price_cents: Math.min(...listPrices),
      has_price_range: new Set(prices).size > 1,
      on_sale: prices.some((p, i) => p < listPrices[i]),
      // Out of stock only reads as sold out when the owner's rule stops the sale. Under review or backorder, it can still be requested.
      sold_out: (r.out_of_stock_behavior ?? ordering.out_of_stock_behavior) === 'reject' && quantities.every((q) => q === 0),
      fulfillment: { pickup: r.allow_pickup, delivery: r.allow_delivery, shipping: r.allow_shipping },
      created_at: r.created_at,
    };
  });
  if (filters.sort === 'price_asc') out.sort((a, b) => a.from_price_cents - b.from_price_cents);
  if (filters.sort === 'price_desc') out.sort((a, b) => b.from_price_cents - a.from_price_cents);
  if (filters.sort === 'newest') out.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
  return out;
}

export async function getProduct(db: Db, slug: string) {
  const p = await db
    .selectFrom('products as p')
    .innerJoin('business_divisions as d', 'd.id', 'p.division_id')
    .select((eb) => [
      'p.id',
      'p.slug',
      'p.name',
      'p.short_description',
      'p.description',
      'p.is_custom',
      'p.featured',
      'p.allow_pickup',
      'p.allow_delivery',
      'p.allow_shipping',
      'p.delivery_restriction',
      'p.min_lead_hours',
      'p.prep_minutes',
      'p.season_start_md',
      'p.season_end_md',
      'p.available_from',
      'p.available_until',
      'p.return_policy',
      'p.requires_approval',
      'p.out_of_stock_behavior',
      'd.code as division_code',
      'd.name as division_name',
      jsonArrayFrom(
        eb
          .selectFrom('product_variants as v')
          .select(['v.id', 'v.name', 'v.sku', 'v.price_cents', 'v.sale_price_cents', 'v.attributes'])
          .whereRef('v.product_id', '=', 'p.id')
          .where('v.active', '=', true)
          .orderBy('v.sort_order'),
      ).as('variants'),
      jsonArrayFrom(eb.selectFrom('product_images as i').select(['i.id', 'i.url', 'i.alt']).whereRef('i.product_id', '=', 'p.id').orderBy('i.sort_order')).as('images'),
      jsonArrayFrom(
        eb
          .selectFrom('product_options as o')
          .select(['o.code', 'o.label', 'o.input_type', 'o.required', 'o.max_length', 'o.help_text', 'o.choices'])
          .whereRef('o.product_id', '=', 'p.id')
          .orderBy('o.sort_order'),
      ).as('options'),
      jsonArrayFrom(
        eb
          .selectFrom('product_category_links as l')
          .innerJoin('product_categories as c', 'c.id', 'l.category_id')
          .select(['c.slug', 'c.name'])
          .whereRef('l.product_id', '=', 'p.id')
          .where('c.active', '=', true),
      ).as('categories'),
    ])
    .where('p.slug', '=', slug)
    .where('p.status', '=', 'active')
    .executeTakeFirst();
  if (!p || !p.variants.length) throw notFound('That product is not available.');
  const stock = await sellableQuantities(db, p.variants.map((v) => v.id));
  const ordering = await getSetting(db, 'ordering');
  return {
    ...p,
    out_of_stock_behavior: p.out_of_stock_behavior ?? ordering.out_of_stock_behavior,
    division: { code: p.division_code, name: p.division_name },
    variants: p.variants.map((v) => ({
      id: v.id,
      name: v.name,
      sku: v.sku,
      price_cents: v.price_cents,
      sale_price_cents: v.sale_price_cents,
      attributes: v.attributes,
      available_quantity: stock.get(v.id) ?? null,
    })),
  };
}

export async function listCategories(db: Db, divisionCode?: string) {
  let q = db
    .selectFrom('product_categories as c')
    .innerJoin('business_divisions as d', 'd.id', 'c.division_id')
    .select(['c.id', 'c.name', 'c.slug', 'c.description', 'd.code as division_code'])
    .where('c.active', '=', true)
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom('product_category_links as l')
          .innerJoin('products as p', 'p.id', 'l.product_id')
          .select(sql`1`.as('x'))
          .whereRef('l.category_id', '=', 'c.id')
          .where('p.status', '=', 'active'),
      ),
    )
    .orderBy('c.sort_order');
  if (divisionCode) q = q.where('d.code', '=', divisionCode);
  return q.execute();
}
