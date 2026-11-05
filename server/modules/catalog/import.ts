import { z } from 'zod';
import type { Db } from '../../db/client.js';
import type { Actor } from '../../lib/audit.js';
import { audit } from '../../lib/audit.js';
import { changeStock, defaultLocationId } from '../inventory/service.js';

/**
 * Loads a catalog from a spreadsheet saved as CSV: one row per size or variant, with rows that share
 * a product name grouped into one product. Every row is checked first, and nothing is written unless
 * the whole file is valid. Products arrive as drafts unless the file says otherwise, so the owner can
 * add photos and review them before anything goes on sale.
 */

export const IMPORT_COLUMNS: Array<{ key: string; required: boolean; help: string }> = [
  { key: 'name', required: true, help: 'Product name. Rows with the same name become sizes of one product.' },
  { key: 'department', required: true, help: 'Floral, Boutique, or another department you have set up.' },
  { key: 'category', required: false, help: 'Created if it does not exist yet.' },
  { key: 'variant', required: true, help: 'Size or option name, such as Standard, Small, or A dozen.' },
  { key: 'sku', required: true, help: 'Your stock code. Must be unique.' },
  { key: 'price', required: true, help: 'In dollars, such as 65 or 65.00.' },
  { key: 'sale_price', required: false, help: 'Optional, in dollars.' },
  { key: 'cost', required: false, help: 'Optional estimate of your cost, in dollars. Never shown to customers.' },
  { key: 'stock', required: false, help: 'How many you have. Leave blank for made-to-order items.' },
  { key: 'low_stock_alert', required: false, help: 'Warn when stock falls to this number.' },
  { key: 'prep_minutes', required: false, help: 'Minutes of work to prepare one.' },
  { key: 'workload_points', required: false, help: 'How much of a day it uses. A small bouquet might be 1, a large piece 5.' },
  { key: 'min_notice_hours', required: false, help: 'Hours of notice needed before it can be picked up or delivered.' },
  { key: 'pickup', required: false, help: 'yes or no.' },
  { key: 'delivery', required: false, help: 'yes or no.' },
  { key: 'shipping', required: false, help: 'yes or no.' },
  { key: 'tax_category', required: false, help: 'A category from your sales tax settings. Blank means standard.' },
  { key: 'short_description', required: false, help: 'One line for the shop listing.' },
  { key: 'description', required: false, help: 'The full description.' },
  { key: 'status', required: false, help: 'draft or active. Blank means draft.' },
];

const EXAMPLE_ROWS = [
  ['Example Rose Bouquet', 'Floral', 'Bouquets', 'A dozen', 'EX-ROSE-12', '75.00', '', '26.00', '', '', '25', '2', '0', 'yes', 'yes', 'no', 'standard', 'Long-stem roses, hand-tied.', '', 'draft'],
  ['Example Rose Bouquet', 'Floral', 'Bouquets', 'Two dozen', 'EX-ROSE-24', '135.00', '', '48.00', '', '', '35', '3', '0', 'yes', 'yes', 'no', 'standard', '', '', 'draft'],
  ['Example Candle', 'Boutique', 'Home', '8 oz', 'EX-CANDLE-8', '28.00', '24.00', '11.00', '12', '4', '5', '0', '0', 'yes', 'yes', 'yes', 'standard', 'Hand-poured soy.', '', 'draft'],
];

const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function templateCsv(): string {
  return [IMPORT_COLUMNS.map((c) => c.key), ...EXAMPLE_ROWS].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** A strict CSV reader: quoted fields, doubled quotes, commas and line breaks inside quotes, CRLF, and a leading byte-order mark. */
const BOM = String.fromCharCode(0xfeff);

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const input = text.startsWith(BOM) ? text.slice(1) : text;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (quoted) throw new Error('The file has an unclosed quotation mark.');
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const money = (label: string) =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === '') return null;
      const n = Number(v.replace(/[$,]/g, ''));
      if (!Number.isFinite(n) || n < 0) {
        ctx.addIssue({ code: 'custom', message: `${label} must be an amount in dollars, such as 12.50.` });
        return z.NEVER;
      }
      return Math.round(n * 100);
    });
const whole = (label: string) =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === '') return null;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0) {
        ctx.addIssue({ code: 'custom', message: `${label} must be a whole number.` });
        return z.NEVER;
      }
      return n;
    });
const yesNo = (label: string) =>
  z
    .string()
    .trim()
    .toLowerCase()
    .transform((v, ctx) => {
      if (['', 'no', 'n', 'false', '0'].includes(v)) return false;
      if (['yes', 'y', 'true', '1'].includes(v)) return true;
      ctx.addIssue({ code: 'custom', message: `${label} must be yes or no.` });
      return z.NEVER;
    });

const rowSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(160),
  department: z.string().trim().min(1, 'Department is required.'),
  category: z.string().trim().max(100),
  variant: z.string().trim().min(1, 'Variant is required, for example Standard.').max(120),
  sku: z.string().trim().min(1, 'SKU is required.').max(60),
  price: money('Price').refine((v) => v !== null, 'Price is required.'),
  sale_price: money('Sale price'),
  cost: money('Cost'),
  stock: whole('Stock'),
  low_stock_alert: whole('Low stock alert'),
  prep_minutes: whole('Prep minutes'),
  workload_points: whole('Workload points'),
  min_notice_hours: whole('Minimum notice hours'),
  pickup: yesNo('Pickup'),
  delivery: yesNo('Delivery'),
  shipping: yesNo('Shipping'),
  tax_category: z.string().trim().max(40),
  short_description: z.string().trim().max(300),
  description: z.string().trim().max(10_000),
  status: z
    .string()
    .trim()
    .toLowerCase()
    .transform((v, ctx) => {
      if (v === '' || v === 'draft') return 'draft' as const;
      if (v === 'active') return 'active' as const;
      ctx.addIssue({ code: 'custom', message: 'Status must be draft or active.' });
      return z.NEVER;
    }),
});

type Row = z.output<typeof rowSchema> & { line: number };
export type ImportResult = { ok: boolean; products: number; variants: number; stocked: number; categories_created: string[]; errors: Array<{ line: number; message: string }>; dry_run: boolean };

const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'product';

export async function importProducts(db: Db, csv: string, opts: { dryRun: boolean; actor: Actor }): Promise<ImportResult> {
  const errors: ImportResult['errors'] = [];
  const fail = (line: number, message: string) => errors.push({ line, message });
  const result = (extra: Partial<ImportResult> = {}): ImportResult => ({ ok: errors.length === 0, products: 0, variants: 0, stocked: 0, categories_created: [], errors, dry_run: opts.dryRun, ...extra });

  let table: string[][];
  try {
    table = parseCsv(csv);
  } catch (err) {
    fail(1, (err as Error).message);
    return result();
  }
  if (table.length < 2) {
    fail(1, 'The file needs a header row and at least one product row.');
    return result();
  }
  const header = table[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const unknown = header.filter((h) => h && !IMPORT_COLUMNS.some((c) => c.key === h));
  if (unknown.length) fail(1, `Unknown columns: ${unknown.join(', ')}. Use the template's column names.`);
  for (const c of IMPORT_COLUMNS.filter((x) => x.required)) if (!header.includes(c.key)) fail(1, `The column "${c.key}" is missing.`);
  if (table.length - 1 > 2000) fail(1, 'Please import at most 2,000 rows at a time.');
  if (errors.length) return result();

  const divisions = await db.selectFrom('business_divisions').select(['id', 'code', 'name']).execute();
  const categories = await db.selectFrom('product_categories').select(['id', 'name', 'division_id']).execute();
  const taxRates = ((await db.selectFrom('business_settings').select('value').where('key', '=', 'tax').executeTakeFirst())?.value as { rates_bps?: Record<string, number> } | undefined)?.rates_bps ?? {};

  const rows: Row[] = [];
  for (const [i, cells] of table.slice(1).entries()) {
    const line = i + 2;
    const raw = Object.fromEntries(IMPORT_COLUMNS.map((c) => [c.key, cells[header.indexOf(c.key)] ?? '']));
    const parsed = rowSchema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) fail(line, issue.message);
      continue;
    }
    rows.push({ ...parsed.data, line });
  }

  const skus = new Map<string, number>();
  for (const r of rows) {
    const key = r.sku.toLowerCase();
    if (skus.has(key)) fail(r.line, `SKU ${r.sku} is also on line ${skus.get(key)}.`);
    else skus.set(key, r.line);
    const division = divisions.find((d) => d.code === r.department.toLowerCase() || d.name.toLowerCase() === r.department.toLowerCase());
    if (!division) fail(r.line, `Unknown department "${r.department}". Use one of: ${divisions.map((d) => d.name).join(', ')}.`);
    const tax = r.tax_category || 'standard';
    if (Object.keys(taxRates).length && taxRates[tax] === undefined) fail(r.line, `Tax category "${tax}" is not in your sales tax settings.`);
    if (r.sale_price !== null && r.price !== null && r.sale_price >= r.price) fail(r.line, 'Sale price must be lower than the price.');
    if (r.status === 'active' && !r.pickup && !r.delivery && !r.shipping) fail(r.line, 'An active product needs at least one of pickup, delivery or shipping.');
  }
  if (rows.length) {
    const existingSkus = await db.selectFrom('product_variants').select('sku').where('sku', 'in', rows.map((r) => r.sku)).execute();
    for (const e of existingSkus) fail(skus.get(e.sku.toLowerCase()) ?? 0, `SKU ${e.sku} already exists in your catalog.`);
    const names = [...new Set(rows.map((r) => r.name))];
    const existingNames = await db.selectFrom('products').select('name').where('name', 'in', names).where('status', '!=', 'archived').execute();
    for (const e of existingNames) fail(rows.find((r) => r.name === e.name)?.line ?? 0, `A product named "${e.name}" already exists. Edit it in the dashboard instead.`);
  }

  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = `${r.name.toLowerCase()}|${r.department.toLowerCase()}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const wanted = new Set(rows.filter((r) => r.category).map((r) => `${r.department.toLowerCase()}|${r.category}`));
  const newCategories = [...wanted].filter((k) => {
    const [dept, name] = k.split('|');
    const division = divisions.find((d) => d.code === dept || d.name.toLowerCase() === dept);
    return division && !categories.some((c) => c.division_id === division.id && c.name.toLowerCase() === name.toLowerCase());
  });
  const summary = { products: groups.size, variants: rows.length, stocked: rows.filter((r) => r.stock !== null).length, categories_created: newCategories.map((k) => k.split('|')[1]) };
  if (errors.length || opts.dryRun) return result(errors.length ? {} : summary);

  await db.transaction().execute(async (trx) => {
    const location = await defaultLocationId(trx);
    const categoryId = new Map(categories.map((c) => [`${c.division_id}|${c.name.toLowerCase()}`, c.id]));
    const usedSlugs = new Set((await trx.selectFrom('products').select('slug').execute()).map((p) => p.slug));
    for (const group of groups.values()) {
      const first = group[0];
      const division = divisions.find((d) => d.code === first.department.toLowerCase() || d.name.toLowerCase() === first.department.toLowerCase()) as { id: string };
      let slug = slugify(first.name);
      for (let n = 2; usedSlugs.has(slug); n++) slug = `${slugify(first.name)}-${n}`;
      usedSlugs.add(slug);
      const product = await trx
        .insertInto('products')
        .values({
          division_id: division.id,
          slug,
          name: first.name,
          short_description: first.short_description || null,
          description: first.description || null,
          status: first.status,
          tax_category: first.tax_category || 'standard',
          prep_minutes: first.prep_minutes ?? 0,
          complexity_points: first.workload_points ?? 1,
          min_lead_hours: first.min_notice_hours ?? 0,
          allow_pickup: first.pickup,
          allow_delivery: first.delivery,
          allow_shipping: first.shipping,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      if (first.category) {
        const key = `${division.id}|${first.category.toLowerCase()}`;
        let id = categoryId.get(key);
        if (!id) {
          let catSlug = slugify(first.category);
          const clash = await trx.selectFrom('product_categories').select('id').where('slug', '=', catSlug).executeTakeFirst();
          if (clash) catSlug = `${catSlug}-${slugify(first.department)}`;
          id = (await trx.insertInto('product_categories').values({ division_id: division.id, name: first.category, slug: catSlug }).returning('id').executeTakeFirstOrThrow()).id;
          categoryId.set(key, id);
        }
        await trx.insertInto('product_category_links').values({ product_id: product.id, category_id: id }).execute();
      }
      for (const [sort, r] of group.entries()) {
        const variant = await trx
          .insertInto('product_variants')
          .values({ product_id: product.id, sku: r.sku, name: r.variant, price_cents: r.price as number, sale_price_cents: r.sale_price, cost_estimate_cents: r.cost, prep_minutes: r.prep_minutes, complexity_points: r.workload_points, sort_order: sort })
          .returning('id')
          .executeTakeFirstOrThrow();
        if (r.stock !== null) {
          const item = await trx.insertInto('inventory_items').values({ sku: `INV-${r.sku}`, name: `${first.name}, ${r.variant}`, division_id: division.id, kind: 'finished_good', variant_id: variant.id, low_stock_threshold: r.low_stock_alert, cost_cents: r.cost }).returning('id').executeTakeFirstOrThrow();
          await trx.insertInto('inventory_levels').values({ item_id: item.id, location_id: location }).execute();
          if (r.stock > 0) await changeStock(trx, { item_id: item.id, delta: r.stock, reason: 'receive', note: 'Imported from a spreadsheet' }, opts.actor);
        }
      }
    }
    await audit(trx, opts.actor, 'catalog.import', { type: 'catalog' }, summary);
  });
  return result(summary);
}
