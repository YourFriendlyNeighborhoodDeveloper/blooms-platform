import type { Db } from '../../db/client.js';
import { effectivePrice } from '../catalog/public.js';
import type { DemandLine, Method } from '../availability/engine.js';

export type OptionChoice = { value: string; label?: string; price_delta_cents?: number };
export type OptionDef = {
  code: string;
  label: string;
  input_type: string;
  required: boolean;
  max_length: number | null;
  choices: unknown;
};

export type SelectedOptions = Record<string, string | string[]>;

export type CartLine = DemandLine & {
  id: string;
  variant_id: string;
  sku: string;
  slug: string;
  name: string;
  variant_name: string;
  division_code: string;
  unit_price_cents: number;
  list_price_cents: number;
  options_price_cents: number;
  line_subtotal_cents: number;
  tax_category: string;
  cost_estimate_cents: number | null;
  options: SelectedOptions;
  options_display: Array<{ label: string; value: string }>;
  image_url: string | null;
  out_of_stock_behavior: string | null;
  problems: string[];
  methods: Method[];
};

const choiceList = (def: OptionDef): OptionChoice[] => (Array.isArray(def.choices) ? (def.choices as OptionChoice[]) : []);

/**
 * Checks submitted options against the product's definitions and prices them. Prices always come from
 * the definition, so a client cannot choose its own price delta.
 */
export function resolveOptions(defs: OptionDef[], submitted: SelectedOptions) {
  const options: SelectedOptions = {};
  const display: Array<{ label: string; value: string }> = [];
  let price = 0;
  const errors: string[] = [];

  for (const key of Object.keys(submitted)) {
    if (!defs.some((d) => d.code === key)) errors.push(`Unknown option: ${key}`);
  }
  for (const def of defs) {
    const value = submitted[def.code];
    const empty = value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
    if (empty) {
      if (def.required) errors.push(`Please choose ${def.label.toLowerCase()}.`);
      continue;
    }
    if (def.input_type === 'select' || def.input_type === 'multiselect') {
      const values = Array.isArray(value) ? value : [value];
      if (def.input_type === 'select' && values.length > 1) {
        errors.push(`Please choose one ${def.label.toLowerCase()}.`);
        continue;
      }
      const labels: string[] = [];
      for (const v of values) {
        const choice = choiceList(def).find((c) => c.value === v);
        if (!choice) {
          errors.push(`That is not a valid choice for ${def.label.toLowerCase()}.`);
          continue;
        }
        price += choice.price_delta_cents ?? 0;
        labels.push(choice.label ?? choice.value);
      }
      options[def.code] = def.input_type === 'select' ? values[0] : values;
      display.push({ label: def.label, value: labels.join(', ') });
    } else {
      const text = String(value).trim();
      const max = def.max_length ?? 500;
      if (text.length > max) {
        errors.push(`${def.label} must be ${max} characters or fewer.`);
        continue;
      }
      if (text) {
        options[def.code] = text;
        display.push({ label: def.label, value: text });
      }
    }
  }
  return { options, display, price_cents: price, errors };
}

export const optionsKey = (options: SelectedOptions) =>
  JSON.stringify(Object.keys(options).sort().map((k) => [k, options[k]]));

/** Reads current product data for the given variants. Nothing about price or policy comes from the client. */
export async function loadVariants(db: Db, variantIds: string[]) {
  if (!variantIds.length) return [];
  return db
    .selectFrom('product_variants as v')
    .innerJoin('products as p', 'p.id', 'v.product_id')
    .innerJoin('business_divisions as d', 'd.id', 'p.division_id')
    .select([
      'v.id as variant_id',
      'v.sku',
      'v.name as variant_name',
      'v.price_cents',
      'v.sale_price_cents',
      'v.cost_estimate_cents',
      'v.active as variant_active',
      'v.prep_minutes as variant_prep',
      'v.complexity_points as variant_points',
      'p.id as product_id',
      'p.slug',
      'p.name',
      'p.status as product_status',
      'p.division_id',
      'p.tax_category',
      'p.prep_minutes',
      'p.complexity_points',
      'p.min_lead_hours',
      'p.allow_pickup',
      'p.allow_delivery',
      'p.allow_shipping',
      'p.restricted_zone_ids',
      'p.season_start_md',
      'p.season_end_md',
      'p.available_from',
      'p.available_until',
      'p.requires_approval',
      'p.is_custom',
      'p.out_of_stock_behavior',
      'd.code as division_code',
      'd.active as division_active',
    ])
    .where('v.id', 'in', variantIds)
    .execute();
}

export async function loadOptionDefs(db: Db, productIds: string[]): Promise<Map<string, OptionDef[]>> {
  const out = new Map<string, OptionDef[]>();
  if (!productIds.length) return out;
  const rows = await db
    .selectFrom('product_options')
    .select(['product_id', 'code', 'label', 'input_type', 'required', 'max_length', 'choices'])
    .where('product_id', 'in', productIds)
    .orderBy('sort_order')
    .execute();
  for (const r of rows) out.set(r.product_id, [...(out.get(r.product_id) ?? []), r]);
  return out;
}

export async function loadCartLines(db: Db, cartId: string): Promise<CartLine[]> {
  const items = await db.selectFrom('cart_items').select(['id', 'variant_id', 'quantity', 'options']).where('cart_id', '=', cartId).orderBy('created_at').execute();
  if (!items.length) return [];
  const variants = await loadVariants(db, items.map((i) => i.variant_id));
  const defs = await loadOptionDefs(db, [...new Set(variants.map((v) => v.product_id))]);
  const images = await db
    .selectFrom('product_images')
    .select(['product_id', 'url'])
    .where('product_id', 'in', variants.map((v) => v.product_id))
    .orderBy('sort_order')
    .execute();

  return items.flatMap((item) => {
    const v = variants.find((x) => x.variant_id === item.variant_id);
    if (!v) return [];
    const resolved = resolveOptions(defs.get(v.product_id) ?? [], (item.options ?? {}) as SelectedOptions);
    const problems: string[] = [...resolved.errors];
    if (v.product_status !== 'active' || !v.variant_active || !v.division_active) problems.push('This item is no longer available.');
    const methods: Method[] = [];
    if (v.allow_pickup) methods.push('pickup');
    if (v.allow_delivery) methods.push('delivery');
    if (v.allow_shipping) methods.push('shipping');
    if (!methods.length) problems.push('This item cannot be ordered online right now.');
    const unit = effectivePrice(v);
    const perUnitPrep = v.variant_prep ?? v.prep_minutes;
    const perUnitPoints = v.variant_points ?? v.complexity_points;
    return [
      {
        id: item.id,
        variant_id: v.variant_id,
        sku: v.sku,
        slug: v.slug,
        product_id: v.product_id,
        name: v.name,
        variant_name: v.variant_name,
        division_id: v.division_id,
        division_code: v.division_code,
        quantity: item.quantity,
        unit_price_cents: unit,
        list_price_cents: v.price_cents,
        options_price_cents: resolved.price_cents,
        line_subtotal_cents: (unit + resolved.price_cents) * item.quantity,
        tax_category: v.tax_category,
        cost_estimate_cents: v.cost_estimate_cents,
        options: resolved.options,
        options_display: resolved.display,
        image_url: images.find((i) => i.product_id === v.product_id)?.url ?? null,
        out_of_stock_behavior: v.out_of_stock_behavior,
        prep_minutes: perUnitPrep * item.quantity,
        complexity_points: perUnitPoints * item.quantity,
        min_lead_hours: v.min_lead_hours,
        allow_pickup: v.allow_pickup,
        allow_delivery: v.allow_delivery,
        allow_shipping: v.allow_shipping,
        restricted_zone_ids: v.restricted_zone_ids,
        season_start_md: v.season_start_md,
        season_end_md: v.season_end_md,
        available_from: v.available_from,
        available_until: v.available_until,
        requires_approval: v.requires_approval,
        is_custom: v.is_custom,
        problems,
        methods,
      },
    ];
  });
}

export type FulfillmentGroup = { key: string; line_ids: string[]; methods: Method[]; note: string | null };

const METHOD_LABEL: Record<Method, string> = { pickup: 'pickup', delivery: 'local delivery', shipping: 'shipping' };

/**
 * Packs the cart into as few fulfilments as its items allow. A line joins the first group sharing at
 * least one method. Items with nothing in common land in separate groups, and the note explains why.
 */
export function groupForFulfillment(lines: Array<Pick<CartLine, 'id' | 'name' | 'methods'>>): FulfillmentGroup[] {
  const groups: Array<{ line_ids: string[]; names: string[]; methods: Method[] }> = [];
  for (const line of lines) {
    if (!line.methods.length) continue;
    const group = groups.find((g) => g.methods.some((m) => line.methods.includes(m)));
    if (group) {
      group.line_ids.push(line.id);
      group.names.push(line.name);
      group.methods = group.methods.filter((m) => line.methods.includes(m));
    } else {
      groups.push({ line_ids: [line.id], names: [line.name], methods: [...line.methods] });
    }
  }
  return groups.map((g, i) => ({
    key: `group-${i + 1}`,
    line_ids: g.line_ids,
    methods: g.methods,
    note:
      groups.length > 1
        ? `${g.names.join(', ')} ${g.names.length > 1 ? 'are' : 'is'} available by ${g.methods.map((m) => METHOD_LABEL[m]).join(' or ')}, so ${g.names.length > 1 ? 'they need' : 'it needs'} a separate arrangement from the rest of your order. It all stays on one order and one payment.`
        : null,
  }));
}
