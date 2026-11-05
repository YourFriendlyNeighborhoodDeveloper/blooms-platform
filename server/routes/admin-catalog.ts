import { Hono } from 'hono';
import { importProducts, templateCsv } from '../modules/catalog/import.js';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { sql } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import type { AppEnv } from '../http/types.js';
import { staffActor } from '../http/types.js';
import { readJson, requirePermission } from '../http/helpers.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { catalogKey, MAX_IMAGE_BYTES, processImage } from '../modules/uploads.js';
import { sellableQuantities } from '../modules/inventory/requirements.js';
import { defaultLocationId } from '../modules/inventory/service.js';

export const adminCatalogRoutes = new Hono<AppEnv>();

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'item';
const md = z.string().regex(/^[0-1][0-9]-[0-3][0-9]$/, 'Use MM-DD').nullable().optional();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();

const productSchema = z.object({
  name: z.string().trim().min(1, 'Please name the product.').max(160),
  division_id: z.string().uuid(),
  slug: z.string().trim().max(100).optional().nullable(),
  short_description: z.string().trim().max(300).nullable().optional(),
  description: z.string().trim().max(10_000).nullable().optional(),
  status: z.enum(['draft', 'active', 'archived']).default('draft'),
  is_custom: z.boolean().default(false),
  tax_category: z.string().trim().min(1).max(40).default('standard'),
  prep_minutes: z.number().int().min(0).default(0),
  complexity_points: z.number().int().min(0).default(0),
  min_lead_hours: z.number().int().min(0).default(0),
  allow_pickup: z.boolean().default(false),
  allow_delivery: z.boolean().default(false),
  allow_shipping: z.boolean().default(false),
  delivery_restriction: z.string().trim().max(500).nullable().optional(),
  restricted_zone_ids: z.array(z.string().uuid()).default([]),
  season_start_md: md,
  season_end_md: md,
  available_from: date,
  available_until: date,
  requires_approval: z.boolean().nullable().optional(),
  out_of_stock_behavior: z.enum(['reject', 'review', 'backorder']).nullable().optional(),
  return_policy: z.string().trim().max(2000).nullable().optional(),
  featured: z.boolean().default(false),
  sort_order: z.number().int().default(0),
  category_ids: z.array(z.string().uuid()).default([]),
});

const warningsFor = (p: { status: string; allow_pickup: boolean; allow_delivery: boolean; allow_shipping: boolean; variants?: unknown[] }) => {
  const out: string[] = [];
  if (p.status === 'active' && !p.allow_pickup && !p.allow_delivery && !p.allow_shipping) out.push('This product is active but has no way to be received, so customers cannot buy it.');
  if (p.status === 'active' && p.variants && p.variants.length === 0) out.push('This product is active but has no variant with a price, so it will not appear in the shop.');
  return out;
};

adminCatalogRoutes.get('/products', async (c) => {
  requirePermission(c, 'catalog.manage');
  const ctx = c.get('ctx');
  const rows = await ctx.db
    .selectFrom('products as p')
    .innerJoin('business_divisions as d', 'd.id', 'p.division_id')
    .select((eb) => [
      'p.id', 'p.name', 'p.slug', 'p.status', 'p.is_demo', 'p.is_custom', 'p.featured', 'p.allow_pickup', 'p.allow_delivery', 'p.allow_shipping', 'p.updated_at', 'd.name as division_name',
      jsonArrayFrom(eb.selectFrom('product_variants as v').select(['v.id', 'v.name', 'v.sku', 'v.price_cents', 'v.sale_price_cents', 'v.active']).whereRef('v.product_id', '=', 'p.id').orderBy('v.sort_order')).as('variants'),
      jsonArrayFrom(eb.selectFrom('product_images as i').select(['i.url']).whereRef('i.product_id', '=', 'p.id').orderBy('i.sort_order').limit(1)).as('images'),
    ])
    .orderBy('p.status')
    .orderBy('p.name')
    .limit(1000)
    .execute();
  const stock = await sellableQuantities(ctx.db, rows.flatMap((r) => r.variants.map((v) => v.id)));
  return c.json({ products: rows.map((r) => ({ ...r, variants: r.variants.map((v) => ({ ...v, available: stock.get(v.id) ?? null })), warnings: warningsFor(r) })) });
});

/** A spreadsheet template for importing products, with three clearly fictional example rows. */
adminCatalogRoutes.get('/import/template.csv', (c) => {
  requirePermission(c, 'catalog.manage');
  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', 'attachment; filename="product-import-template.csv"');
  return c.body(templateCsv());
});

/** Checks, and then imports, a product spreadsheet. Nothing is written unless every row is valid. */
adminCatalogRoutes.post('/import', async (c) => {
  requirePermission(c, 'catalog.manage');
  const body = await readJson(c, z.object({ csv: z.string().min(1).max(900_000), dry_run: z.boolean().default(true) }));
  const result = await importProducts(c.get('ctx').db, body.csv, { dryRun: body.dry_run, actor: staffActor(c) });
  // A file with problems is a normal answer, not a failed request: the list of problems is the result.
  return c.json(result);
});

adminCatalogRoutes.get('/meta', async (c) => {
  requirePermission(c, 'catalog.manage');
  const db = c.get('ctx').db;
  return c.json({
    divisions: await db.selectFrom('business_divisions').selectAll().orderBy('sort_order').execute(),
    categories: await db.selectFrom('product_categories').selectAll().orderBy('sort_order').execute(),
    zones: await db.selectFrom('delivery_zones').select(['id', 'name']).execute(),
    service_categories: await db.selectFrom('service_categories').selectAll().orderBy('sort_order').execute(),
  });
});

adminCatalogRoutes.post('/products', async (c) => {
  requirePermission(c, 'catalog.manage');
  const ctx = c.get('ctx');
  const { category_ids, ...body } = await readJson(c, productSchema);
  const row = await ctx.db.transaction().execute(async (trx) => {
    let slug = slugify(body.slug || body.name);
    const clash = await trx.selectFrom('products').select('id').where('slug', '=', slug).executeTakeFirst();
    if (clash) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
    const p = await trx.insertInto('products').values({ ...body, slug, restricted_zone_ids: body.restricted_zone_ids }).returning(['id', 'slug']).executeTakeFirstOrThrow();
    if (category_ids.length) await trx.insertInto('product_category_links').values(category_ids.map((category_id) => ({ product_id: p.id, category_id }))).execute();
    await audit(trx, staffActor(c), 'product.create', { type: 'product', id: p.id }, { name: body.name });
    return p;
  });
  return c.json(row, 201);
});

adminCatalogRoutes.get('/products/:id', async (c) => {
  requirePermission(c, 'catalog.manage');
  const db = c.get('ctx').db;
  const id = c.req.param('id');
  const p = await db.selectFrom('products').selectAll().where('id', '=', id).executeTakeFirst();
  if (!p) throw notFound('Product not found.');
  const variants = await db
    .selectFrom('product_variants as v')
    .leftJoin('inventory_items as i', 'i.variant_id', 'v.id')
    .select(['v.id', 'v.sku', 'v.name', 'v.price_cents', 'v.sale_price_cents', 'v.cost_estimate_cents', 'v.prep_minutes', 'v.complexity_points', 'v.weight_grams', 'v.track_inventory', 'v.active', 'v.sort_order', 'i.id as inventory_item_id'])
    .where('v.product_id', '=', id)
    .orderBy('v.sort_order')
    .execute();
  const stock = await sellableQuantities(db, variants.map((v) => v.id));
  const options = await db.selectFrom('product_options').selectAll().where('product_id', '=', id).orderBy('sort_order').execute();
  const images = await db.selectFrom('product_images').selectAll().where('product_id', '=', id).orderBy('sort_order').execute();
  const categories = await db.selectFrom('product_category_links').select('category_id').where('product_id', '=', id).execute();
  const recipe = await db.selectFrom('product_recipes').select(['id', 'notes']).where('product_id', '=', id).where('active', '=', true).executeTakeFirst();
  const components = recipe
    ? await db.selectFrom('recipe_components as c').innerJoin('inventory_items as i', 'i.id', 'c.item_id').select((eb) => ['c.id', 'c.item_id', 'c.quantity', 'c.notes', 'i.name', 'i.unit', jsonArrayFrom(eb.selectFrom('recipe_substitutes as s').innerJoin('inventory_items as si', 'si.id', 's.item_id').select(['s.id', 's.item_id', 's.quantity', 'si.name']).whereRef('s.component_id', '=', 'c.id')).as('substitutes')]).where('c.recipe_id', '=', recipe.id).execute()
    : [];
  return c.json({ ...p, variants: variants.map((v) => ({ ...v, available: stock.get(v.id) ?? null })), options, images, category_ids: categories.map((x) => x.category_id), recipe: recipe ? { ...recipe, components } : null, warnings: warningsFor({ ...p, variants }) });
});

adminCatalogRoutes.put('/products/:id', async (c) => {
  requirePermission(c, 'catalog.manage');
  const ctx = c.get('ctx');
  const id = c.req.param('id');
  const { category_ids, ...body } = await readJson(c, productSchema);
  await ctx.db.transaction().execute(async (trx) => {
    const res = await trx.updateTable('products').set({ ...body, slug: body.slug ? slugify(body.slug) : undefined }).where('id', '=', id).executeTakeFirst();
    if (!Number(res.numUpdatedRows)) throw notFound('Product not found.');
    await trx.deleteFrom('product_category_links').where('product_id', '=', id).execute();
    if (category_ids.length) await trx.insertInto('product_category_links').values(category_ids.map((category_id) => ({ product_id: id, category_id }))).execute();
    await audit(trx, staffActor(c), 'product.update', { type: 'product', id }, { status: body.status });
  });
  return c.json({ ok: true });
});

const variantSchema = z.object({
  sku: z.string().trim().min(1, 'Please enter a SKU.').max(60),
  name: z.string().trim().min(1).max(120).default('Standard'),
  price_cents: z.number().int().min(0),
  sale_price_cents: z.number().int().min(0).nullable().optional(),
  cost_estimate_cents: z.number().int().min(0).nullable().optional(),
  prep_minutes: z.number().int().min(0).nullable().optional(),
  complexity_points: z.number().int().min(0).nullable().optional(),
  weight_grams: z.number().int().min(0).nullable().optional(),
  track_inventory: z.boolean().default(true),
  active: z.boolean().default(true),
  sort_order: z.number().int().default(0),
  create_stock_item: z.boolean().default(false),
});

adminCatalogRoutes.post('/products/:id/variants', async (c) => {
  requirePermission(c, 'catalog.manage');
  const ctx = c.get('ctx');
  const { create_stock_item, ...body } = await readJson(c, variantSchema);
  const productId = c.req.param('id');
  const row = await ctx.db.transaction().execute(async (trx) => {
    const product = await trx.selectFrom('products').select(['name', 'division_id']).where('id', '=', productId).executeTakeFirst();
    if (!product) throw notFound('Product not found.');
    const v = await trx.insertInto('product_variants').values({ ...body, product_id: productId }).returning('id').executeTakeFirstOrThrow();
    if (create_stock_item) {
      const item = await trx.insertInto('inventory_items').values({ sku: body.sku, name: body.name === 'Standard' ? product.name : `${product.name} (${body.name})`, variant_id: v.id, division_id: product.division_id, kind: 'finished_good' }).returning('id').executeTakeFirstOrThrow();
      await trx.insertInto('inventory_levels').values({ item_id: item.id, location_id: await defaultLocationId(trx) }).execute();
    }
    await audit(trx, staffActor(c), 'variant.create', { type: 'variant', id: v.id }, { price_cents: body.price_cents });
    return v;
  });
  return c.json(row, 201);
});

adminCatalogRoutes.put('/variants/:id', async (c) => {
  requirePermission(c, 'catalog.manage');
  const ctx = c.get('ctx');
  const { create_stock_item: _ignored, ...body } = await readJson(c, variantSchema);
  const res = await ctx.db.updateTable('product_variants').set(body).where('id', '=', c.req.param('id')).executeTakeFirst();
  if (!Number(res.numUpdatedRows)) throw notFound('Variant not found.');
  await audit(ctx.db, staffActor(c), 'variant.update', { type: 'variant', id: c.req.param('id') }, { price_cents: body.price_cents, sale_price_cents: body.sale_price_cents ?? null });
  return c.json({ ok: true });
});

adminCatalogRoutes.delete('/variants/:id', async (c) => {
  requirePermission(c, 'catalog.manage');
  const ctx = c.get('ctx');
  await ctx.db.updateTable('product_variants').set({ active: false }).where('id', '=', c.req.param('id')).execute();
  return c.json({ ok: true });
});

const optionSchema = z.object({
  code: z.string().trim().regex(/^[a-z0-9_]{1,40}$/, 'Use lowercase letters, numbers and underscores.'),
  label: z.string().trim().min(1).max(100),
  input_type: z.enum(['select', 'multiselect', 'text', 'textarea']),
  required: z.boolean().default(false),
  max_length: z.number().int().min(1).max(4000).nullable().optional(),
  help_text: z.string().max(300).nullable().optional(),
  choices: z.array(z.object({ value: z.string().trim().min(1).max(100), label: z.string().trim().max(100).optional(), price_delta_cents: z.number().int().optional() })).default([]),
  sort_order: z.number().int().default(0),
});

adminCatalogRoutes.post('/products/:id/options', async (c) => {
  requirePermission(c, 'catalog.manage');
  const ctx = c.get('ctx');
  const body = await readJson(c, optionSchema);
  if ((body.input_type === 'select' || body.input_type === 'multiselect') && !body.choices.length) throw badRequest('Add at least one choice.');
  const row = await ctx.db.insertInto('product_options').values({ ...body, product_id: c.req.param('id'), choices: JSON.stringify(body.choices) }).returning('id').executeTakeFirstOrThrow();
  return c.json(row, 201);
});

adminCatalogRoutes.put('/options/:id', async (c) => {
  requirePermission(c, 'catalog.manage');
  const body = await readJson(c, optionSchema);
  await c.get('ctx').db.updateTable('product_options').set({ ...body, choices: JSON.stringify(body.choices) }).where('id', '=', c.req.param('id')).execute();
  return c.json({ ok: true });
});

adminCatalogRoutes.delete('/options/:id', async (c) => {
  requirePermission(c, 'catalog.manage');
  await c.get('ctx').db.deleteFrom('product_options').where('id', '=', c.req.param('id')).execute();
  return c.json({ ok: true });
});

adminCatalogRoutes.post('/products/:id/images', bodyLimit({ maxSize: MAX_IMAGE_BYTES + 512 * 1024, onError: () => { throw badRequest('Images must be 10 MB or smaller.'); } }), async (c) => {
  requirePermission(c, 'catalog.manage');
  const ctx = c.get('ctx');
  const form = await c.req.parseBody();
  const file = form.file;
  if (!(file instanceof File)) throw badRequest('Please choose an image.');
  const processed = await processImage(Buffer.from(await file.arrayBuffer()), { maxWidth: 1800 });
  const key = catalogKey(processed.extension);
  await ctx.storage.put(key, processed.body, processed.mime);
  const count = await ctx.db.selectFrom('product_images').select((eb) => eb.fn.countAll<number>().as('n')).where('product_id', '=', c.req.param('id')).executeTakeFirstOrThrow();
  const row = await ctx.db
    .insertInto('product_images')
    .values({ product_id: c.req.param('id'), url: `/media/${key}`, storage_key: key, alt: typeof form.alt === 'string' ? form.alt.slice(0, 200) : '', sort_order: Number(count.n) })
    .returning(['id', 'url', 'alt'])
    .executeTakeFirstOrThrow();
  return c.json(row, 201);
});

adminCatalogRoutes.patch('/images/:id', async (c) => {
  requirePermission(c, 'catalog.manage');
  const body = await readJson(c, z.object({ alt: z.string().max(200).optional(), sort_order: z.number().int().optional() }));
  await c.get('ctx').db.updateTable('product_images').set(body).where('id', '=', c.req.param('id')).execute();
  return c.json({ ok: true });
});

adminCatalogRoutes.delete('/images/:id', async (c) => {
  requirePermission(c, 'catalog.manage');
  const ctx = c.get('ctx');
  const row = await ctx.db.deleteFrom('product_images').where('id', '=', c.req.param('id')).returning('storage_key').executeTakeFirst();
  if (row?.storage_key) await ctx.storage.delete(row.storage_key).catch(() => {});
  return c.json({ ok: true });
});

const categorySchema = z.object({ division_id: z.string().uuid(), name: z.string().trim().min(1).max(100), slug: z.string().trim().max(100).optional().nullable(), description: z.string().max(500).nullable().optional(), active: z.boolean().default(true), sort_order: z.number().int().default(0) });

adminCatalogRoutes.post('/categories', async (c) => {
  requirePermission(c, 'catalog.manage');
  const body = await readJson(c, categorySchema);
  const row = await c.get('ctx').db.insertInto('product_categories').values({ ...body, slug: slugify(body.slug || body.name) }).returning('id').executeTakeFirstOrThrow();
  return c.json(row, 201);
});

adminCatalogRoutes.put('/categories/:id', async (c) => {
  requirePermission(c, 'catalog.manage');
  const body = await readJson(c, categorySchema);
  await c.get('ctx').db.updateTable('product_categories').set({ ...body, slug: slugify(body.slug || body.name) }).where('id', '=', c.req.param('id')).execute();
  return c.json({ ok: true });
});

adminCatalogRoutes.post('/divisions', async (c) => {
  requirePermission(c, 'settings.manage');
  const body = await readJson(c, z.object({ name: z.string().trim().min(1).max(80), description: z.string().max(300).nullable().optional() }));
  const row = await c.get('ctx').db.insertInto('business_divisions').values({ name: body.name, description: body.description ?? null, code: slugify(body.name).replace(/-/g, '_'), sort_order: 50 }).returning('id').executeTakeFirstOrThrow();
  return c.json(row, 201);
});

adminCatalogRoutes.patch('/divisions/:id', async (c) => {
  requirePermission(c, 'settings.manage');
  const body = await readJson(c, z.object({ name: z.string().trim().min(1).max(80).optional(), description: z.string().max(300).nullable().optional(), active: z.boolean().optional() }));
  await c.get('ctx').db.updateTable('business_divisions').set(body).where('id', '=', c.req.param('id')).execute();
  return c.json({ ok: true });
});

const serviceSchema = z.object({
  category_id: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
  description: z.string().max(2000).nullable().optional(),
  image_url: z.string().max(500).nullable().optional(),
  pricing_mode: z.enum(['package', 'estimate', 'custom_quote']).default('custom_quote'),
  unit: z.string().trim().min(1).max(30).default('each'),
  unit_price_cents: z.number().int().min(0).nullable().optional(),
  est_low_cents: z.number().int().min(0).nullable().optional(),
  est_high_cents: z.number().int().min(0).nullable().optional(),
  taxable: z.boolean().default(true),
  workload_points: z.number().int().min(0).default(0),
  setup_minutes: z.number().int().min(0).default(0),
  requires_crew: z.boolean().default(false),
  recipe_id: z.string().uuid().nullable().optional(),
  active: z.boolean().default(true),
  sort_order: z.number().int().default(0),
});

adminCatalogRoutes.get('/services', async (c) => {
  requirePermission(c, 'catalog.manage');
  const db = c.get('ctx').db;
  return c.json({ categories: await db.selectFrom('service_categories').selectAll().orderBy('sort_order').execute(), services: await db.selectFrom('wedding_services').selectAll().orderBy('sort_order').execute() });
});

adminCatalogRoutes.post('/services', async (c) => {
  requirePermission(c, 'catalog.manage');
  const ctx = c.get('ctx');
  const body = await readJson(c, serviceSchema);
  const row = await ctx.db.insertInto('wedding_services').values({ ...body, code: `${slugify(body.name)}-${Date.now().toString(36).slice(-4)}` }).returning('id').executeTakeFirstOrThrow();
  await audit(ctx.db, staffActor(c), 'service.create', { type: 'service', id: row.id });
  return c.json(row, 201);
});

adminCatalogRoutes.put('/services/:id', async (c) => {
  requirePermission(c, 'catalog.manage');
  const ctx = c.get('ctx');
  const body = await readJson(c, serviceSchema);
  await ctx.db.updateTable('wedding_services').set(body).where('id', '=', c.req.param('id')).execute();
  await audit(ctx.db, staffActor(c), 'service.update', { type: 'service', id: c.req.param('id') });
  return c.json({ ok: true });
});

adminCatalogRoutes.post('/service-categories', async (c) => {
  requirePermission(c, 'catalog.manage');
  const body = await readJson(c, z.object({ name: z.string().trim().min(1).max(100), description: z.string().max(500).nullable().optional(), sort_order: z.number().int().default(50) }));
  const division = await c.get('ctx').db.selectFrom('business_divisions').select('id').where('code', '=', 'events').executeTakeFirst();
  const row = await c.get('ctx').db.insertInto('service_categories').values({ ...body, slug: `${slugify(body.name)}-${Date.now().toString(36).slice(-4)}`, division_id: division?.id ?? null }).returning('id').executeTakeFirstOrThrow();
  return c.json(row, 201);
});

const promoSchema = z.object({
  code: z.string().trim().min(2).max(40),
  description: z.string().max(300).nullable().optional(),
  kind: z.enum(['percent', 'fixed', 'free_delivery']),
  value: z.number().int().min(0).default(0),
  starts_at: z.string().datetime().nullable().optional(),
  ends_at: z.string().datetime().nullable().optional(),
  max_redemptions: z.number().int().min(1).nullable().optional(),
  per_customer_limit: z.number().int().min(1).nullable().optional(),
  min_subtotal_cents: z.number().int().min(0).default(0),
  division_ids: z.array(z.string().uuid()).default([]),
  active: z.boolean().default(true),
});

adminCatalogRoutes.get('/promotions', async (c) => {
  requirePermission(c, 'marketing.manage');
  return c.json({ promotions: await c.get('ctx').db.selectFrom('promotions').selectAll().orderBy('created_at', 'desc').execute() });
});

adminCatalogRoutes.post('/promotions', async (c) => {
  requirePermission(c, 'marketing.manage');
  const ctx = c.get('ctx');
  const body = await readJson(c, promoSchema);
  if (body.kind === 'percent' && body.value > 100) throw badRequest('A percentage cannot exceed 100.');
  const exists = await ctx.db.selectFrom('promotions').select('id').where(sql`lower(code::text)`, '=', body.code.toLowerCase()).executeTakeFirst();
  if (exists) throw conflict('duplicate', 'That code already exists.');
  const row = await ctx.db.insertInto('promotions').values(body).returning('id').executeTakeFirstOrThrow();
  await audit(ctx.db, staffActor(c), 'promotion.create', { type: 'promotion', id: row.id }, { code: body.code });
  return c.json(row, 201);
});

adminCatalogRoutes.put('/promotions/:id', async (c) => {
  requirePermission(c, 'marketing.manage');
  const ctx = c.get('ctx');
  const body = await readJson(c, promoSchema);
  await ctx.db.updateTable('promotions').set(body).where('id', '=', c.req.param('id')).execute();
  await audit(ctx.db, staffActor(c), 'promotion.update', { type: 'promotion', id: c.req.param('id') });
  return c.json({ ok: true });
});
