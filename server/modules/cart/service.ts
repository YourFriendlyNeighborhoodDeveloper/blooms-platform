import { z } from 'zod';
import type { AppContext } from '../../context.js';
import type { Db } from '../../db/client.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { hashToken, randomToken } from '../../lib/tokens.js';
import { addHours } from '../../lib/time.js';
import { loadSettings } from '../settings/service.js';
import { computeTotals, checkPromotion, findPromotion } from './pricing.js';
import { groupForFulfillment, loadCartLines, loadOptionDefs, loadVariants, optionsKey, resolveOptions, type SelectedOptions } from './lines.js';
import { sellableQuantities } from '../inventory/requirements.js';

export const CART_TTL_HOURS = 24 * 30;

export const addItemSchema = z.object({
  variant_id: z.string().uuid(),
  quantity: z.number().int().min(1).max(999).default(1),
  options: z.record(z.string(), z.union([z.string().max(2000), z.array(z.string().max(200)).max(50)])).default({}),
});

export type CartRow = { id: string; status: string; promotion_code: string | null; saved_details: unknown; customer_id: string | null };

export async function findCart(db: Db, token: string | undefined): Promise<CartRow | null> {
  if (!token || token.length > 200) return null;
  const row = await db
    .selectFrom('carts')
    .select(['id', 'status', 'promotion_code', 'saved_details', 'customer_id', 'expires_at'])
    .where('token_hash', '=', hashToken(token))
    .executeTakeFirst();
  if (!row || row.expires_at <= new Date()) return null;
  return row;
}

export async function createCart(ctx: AppContext, attribution: Record<string, string> = {}): Promise<{ token: string; cart: CartRow }> {
  const token = randomToken();
  const cart = await ctx.db
    .insertInto('carts')
    .values({ token_hash: hashToken(token), expires_at: addHours(ctx.clock.now(), CART_TTL_HOURS), attribution: JSON.stringify(attribution) })
    .returning(['id', 'status', 'promotion_code', 'saved_details', 'customer_id'])
    .executeTakeFirstOrThrow();
  return { token, cart };
}

/** A cart reopens automatically if the customer comes back from an abandoned payment. */
function assertEditable(cart: CartRow) {
  if (cart.status === 'converted') throw conflict('cart_closed', 'This order has already been placed. Your cart is empty.');
  if (cart.status !== 'active' && cart.status !== 'pending_payment') throw conflict('cart_closed', 'This cart has closed.');
}

export async function addItem(ctx: AppContext, cart: CartRow, input: z.output<typeof addItemSchema>) {
  assertEditable(cart);
  const [variant] = await loadVariants(ctx.db, [input.variant_id]);
  if (!variant || variant.product_status !== 'active' || !variant.variant_active) throw notFound('That item is not available.');
  const defs = (await loadOptionDefs(ctx.db, [variant.product_id])).get(variant.product_id) ?? [];
  const resolved = resolveOptions(defs, input.options);
  if (resolved.errors.length) throw badRequest(resolved.errors[0], { errors: resolved.errors });

  const key = optionsKey(resolved.options);
  const existing = await ctx.db
    .selectFrom('cart_items')
    .select(['id', 'quantity'])
    .where('cart_id', '=', cart.id)
    .where('variant_id', '=', input.variant_id)
    .where('options_key', '=', key)
    .executeTakeFirst();
  const nextQuantity = (existing?.quantity ?? 0) + input.quantity;
  await assertSellable(ctx.db, variant, nextQuantity);

  if (existing) {
    await ctx.db.updateTable('cart_items').set({ quantity: nextQuantity }).where('id', '=', existing.id).execute();
  } else {
    await ctx.db
      .insertInto('cart_items')
      .values({ cart_id: cart.id, variant_id: input.variant_id, quantity: input.quantity, options: JSON.stringify(resolved.options), options_key: key })
      .execute();
  }
}

/** Friendly early check only. The binding check is the reservation made at checkout. */
async function assertSellable(db: Db, variant: { variant_id: string; out_of_stock_behavior: string | null }, quantity: number) {
  const settings = await loadSettings(db);
  const behavior = variant.out_of_stock_behavior ?? settings.ordering.out_of_stock_behavior;
  if (behavior !== 'reject') return;
  const available = (await sellableQuantities(db, [variant.variant_id])).get(variant.variant_id);
  if (available === null || available === undefined) return;
  if (quantity > available) {
    throw conflict('insufficient_stock', available === 0 ? 'That item is sold out.' : `Only ${available} left.`, { available });
  }
}

export async function setItemQuantity(ctx: AppContext, cart: CartRow, itemId: string, quantity: number) {
  assertEditable(cart);
  const item = await ctx.db.selectFrom('cart_items').select(['id', 'variant_id']).where('id', '=', itemId).where('cart_id', '=', cart.id).executeTakeFirst();
  if (!item) throw notFound('That item is not in your cart.');
  if (quantity <= 0) {
    await ctx.db.deleteFrom('cart_items').where('id', '=', itemId).execute();
    return;
  }
  const [variant] = await loadVariants(ctx.db, [item.variant_id]);
  if (variant) await assertSellable(ctx.db, variant, quantity);
  await ctx.db.updateTable('cart_items').set({ quantity }).where('id', '=', itemId).execute();
}

export async function removeItem(ctx: AppContext, cart: CartRow, itemId: string) {
  assertEditable(cart);
  await ctx.db.deleteFrom('cart_items').where('id', '=', itemId).where('cart_id', '=', cart.id).execute();
}

export async function applyPromoCode(ctx: AppContext, cart: CartRow, code: string) {
  const lines = await loadCartLines(ctx.db, cart.id);
  const check = checkPromotion(await findPromotion(ctx.db, code), ctx.clock.now(), lines);
  if (!check.ok) throw badRequest(check.message);
  await ctx.db.updateTable('carts').set({ promotion_code: check.promotion.code }).where('id', '=', cart.id).execute();
}

export async function clearPromoCode(ctx: AppContext, cart: CartRow) {
  await ctx.db.updateTable('carts').set({ promotion_code: null }).where('id', '=', cart.id).execute();
}

export async function cartView(ctx: AppContext, cart: CartRow | null) {
  if (!cart || cart.status === 'converted') {
    return { id: null, lines: [], groups: [], item_count: 0, promotion: null, totals: emptyTotals, saved_details: {}, tax_ready: true };
  }
  const lines = await loadCartLines(ctx.db, cart.id);
  const settings = await loadSettings(ctx.db);
  const now = ctx.clock.now();
  let promotion: { code: string; kind: string; value: number } | null = null;
  let promoError: string | null = null;
  let promoRow = null;
  if (cart.promotion_code) {
    const check = checkPromotion(await findPromotion(ctx.db, cart.promotion_code), now, lines);
    if (check.ok) {
      promoRow = check.promotion;
      promotion = { code: check.promotion.code, kind: check.promotion.kind, value: check.promotion.value };
    } else {
      promoError = check.message;
    }
  }
  const stock = await sellableQuantities(ctx.db, lines.map((l) => l.variant_id));
  const totals = computeTotals(lines, [], promoRow, settings.tax);
  return {
    id: cart.id,
    item_count: lines.reduce((s, l) => s + l.quantity, 0),
    lines: lines.map((l) => ({
      id: l.id,
      variant_id: l.variant_id,
      product_id: l.product_id,
      slug: l.slug,
      name: l.name,
      variant_name: l.variant_name,
      division_code: l.division_code,
      sku: l.sku,
      quantity: l.quantity,
      unit_price_cents: l.unit_price_cents,
      list_price_cents: l.list_price_cents,
      options_price_cents: l.options_price_cents,
      line_subtotal_cents: l.line_subtotal_cents,
      options: l.options as SelectedOptions,
      options_display: l.options_display,
      image_url: l.image_url,
      methods: l.methods,
      available_quantity: stock.get(l.variant_id) ?? null,
      problems: l.problems,
    })),
    groups: groupForFulfillment(lines),
    promotion,
    promotion_error: promoError,
    totals: {
      subtotal_cents: totals.subtotal_cents,
      discount_cents: totals.discount_cents,
      delivery_cents: 0,
      shipping_cents: 0,
      tax_cents: totals.tax_cents,
      total_cents: totals.total_cents,
    },
    tax_ready: totals.tax_missing.length === 0,
    saved_details: cart.saved_details ?? {},
  };
}

const emptyTotals = { subtotal_cents: 0, discount_cents: 0, delivery_cents: 0, shipping_cents: 0, tax_cents: 0, total_cents: 0 };
