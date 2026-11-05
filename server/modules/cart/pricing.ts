import { sql } from 'kysely';
import type { Db } from '../../db/client.js';
import { allocate, applyBps } from '../../lib/money.js';
import type { Settings } from '../settings/schema.js';
import type { Method } from '../availability/engine.js';

export type PromotionRow = {
  id: string;
  code: string;
  kind: string;
  value: number;
  min_subtotal_cents: number;
  division_ids: string[];
  starts_at: Date | null;
  ends_at: Date | null;
  max_redemptions: number | null;
  per_customer_limit: number | null;
  redemption_count: number;
  active: boolean;
};

export type PromoCheck = { ok: true; promotion: PromotionRow } | { ok: false; message: string };

export async function findPromotion(db: Db, code: string): Promise<PromotionRow | null> {
  const row = await db
    .selectFrom('promotions')
    .select(['id', 'code', 'kind', 'value', 'min_subtotal_cents', 'division_ids', 'starts_at', 'ends_at', 'max_redemptions', 'per_customer_limit', 'redemption_count', 'active'])
    .where('code', '=', code.trim())
    .executeTakeFirst();
  return row ?? null;
}

export function checkPromotion(promotion: PromotionRow | null, now: Date, lines: Array<{ division_id: string; line_subtotal_cents: number }>): PromoCheck {
  const invalid = (message: string): PromoCheck => ({ ok: false, message });
  if (!promotion || !promotion.active) return invalid('That code is not valid.');
  if (promotion.starts_at && promotion.starts_at > now) return invalid('That code is not active yet.');
  if (promotion.ends_at && promotion.ends_at < now) return invalid('That code has expired.');
  if (promotion.max_redemptions !== null && promotion.redemption_count >= promotion.max_redemptions) return invalid('That code has been fully used.');
  const eligible = lines.filter((l) => !promotion.division_ids.length || promotion.division_ids.includes(l.division_id));
  if (!eligible.length) return invalid('That code does not apply to these items.');
  const eligibleTotal = eligible.reduce((s, l) => s + l.line_subtotal_cents, 0);
  if (eligibleTotal < promotion.min_subtotal_cents) {
    return invalid(`That code needs a minimum of $${(promotion.min_subtotal_cents / 100).toFixed(2)} in eligible items.`);
  }
  return { ok: true, promotion };
}

/** Claims one use. The conditional UPDATE means a limited code cannot be over-redeemed under load. */
export async function redeemPromotion(trx: Db, promotion: PromotionRow, orderId: string, customerId: string, amount: number): Promise<boolean> {
  if (promotion.per_customer_limit !== null) {
    const used = await trx
      .selectFrom('promotion_redemptions')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('promotion_id', '=', promotion.id)
      .where('customer_id', '=', customerId)
      .where('released_at', 'is', null)
      .executeTakeFirstOrThrow();
    if (Number(used.n) >= promotion.per_customer_limit) return false;
  }
  const res = await sql`
    UPDATE promotions SET redemption_count = redemption_count + 1
    WHERE id = ${promotion.id} AND (max_redemptions IS NULL OR redemption_count < max_redemptions)
  `.execute(trx);
  if (Number(res.numAffectedRows ?? 0) !== 1) return false;
  await trx.insertInto('promotion_redemptions').values({ promotion_id: promotion.id, order_id: orderId, customer_id: customerId, amount_cents: amount }).execute();
  return true;
}

export async function releasePromotion(trx: Db, orderId: string) {
  const row = await trx.selectFrom('promotion_redemptions').select(['id', 'promotion_id']).where('order_id', '=', orderId).where('released_at', 'is', null).executeTakeFirst();
  if (!row) return;
  await trx.updateTable('promotion_redemptions').set({ released_at: new Date() }).where('id', '=', row.id).execute();
  await sql`UPDATE promotions SET redemption_count = GREATEST(redemption_count - 1, 0) WHERE id = ${row.promotion_id}`.execute(trx);
}

export type PricingLine = { id: string; division_id: string; quantity: number; line_subtotal_cents: number; tax_category: string };
export type PricingFee = { method: Method; fee_cents: number };

export type PricedLine = { id: string; discount_cents: number; tax_cents: number };

export type Totals = {
  subtotal_cents: number;
  discount_cents: number;
  delivery_cents: number;
  shipping_cents: number;
  tax_cents: number;
  total_cents: number;
  lines: PricedLine[];
  tax_missing: string[];
};

/**
 * All money arithmetic for an order. Pure, so it can be tested exhaustively. Tax is calculated per
 * line after discounts. A category with no configured rate is reported rather than assumed to be
 * zero, and checkout refuses to proceed until the owner sets it.
 */
export function computeTotals(lines: PricingLine[], fees: PricingFee[], promotion: Pick<PromotionRow, 'kind' | 'value' | 'division_ids'> | null, tax: Settings['tax']): Totals {
  const subtotal = lines.reduce((s, l) => s + l.line_subtotal_cents, 0);
  const eligible = lines.filter((l) => promotion && (!promotion.division_ids.length || promotion.division_ids.includes(l.division_id)));
  const eligibleTotal = eligible.reduce((s, l) => s + l.line_subtotal_cents, 0);

  let discount = 0;
  if (promotion?.kind === 'percent') discount = applyBps(eligibleTotal, promotion.value * 100);
  if (promotion?.kind === 'fixed') discount = Math.min(promotion.value, eligibleTotal);

  const shares = allocate(discount, eligible.map((l) => l.line_subtotal_cents));
  const discounts = new Map(eligible.map((l, i) => [l.id, shares[i]]));

  const delivery = promotion?.kind === 'free_delivery' ? 0 : fees.filter((f) => f.method === 'delivery').reduce((s, f) => s + f.fee_cents, 0);
  const shipping = fees.filter((f) => f.method === 'shipping').reduce((s, f) => s + f.fee_cents, 0);

  const missing = new Set<string>();
  const priced: PricedLine[] = lines.map((l) => {
    const lineDiscount = discounts.get(l.id) ?? 0;
    const rate = tax.rates_bps[l.tax_category];
    if (rate === undefined) missing.add(l.tax_category);
    return { id: l.id, discount_cents: lineDiscount, tax_cents: applyBps(l.line_subtotal_cents - lineDiscount, rate ?? 0) };
  });

  const standard = tax.rates_bps.standard;
  let feeTax = 0;
  if (delivery > 0 && tax.delivery_taxable) {
    if (standard === undefined) missing.add('standard');
    else feeTax += applyBps(delivery, standard);
  }
  if (shipping > 0 && tax.shipping_taxable) {
    if (standard === undefined) missing.add('standard');
    else feeTax += applyBps(shipping, standard);
  }

  const taxTotal = priced.reduce((s, l) => s + l.tax_cents, 0) + feeTax;
  return {
    subtotal_cents: subtotal,
    discount_cents: discount,
    delivery_cents: delivery,
    shipping_cents: shipping,
    tax_cents: taxTotal,
    total_cents: subtotal - discount + delivery + shipping + taxTotal,
    lines: priced,
    tax_missing: [...missing],
  };
}
