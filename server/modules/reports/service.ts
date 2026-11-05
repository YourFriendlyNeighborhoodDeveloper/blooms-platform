import { sql } from 'kysely';
import type { Db } from '../../db/client.js';

export type ReportRange = { from: Date; to: Date; division?: string | null; includeTest?: boolean };

/**
 * Every figure comes straight from the database, and the definitions are stated here on purpose.
 * Gross sales: money collected on orders, before refunds. Net sales: gross minus refunds. Neither is
 * profit: sales tax and fees are not subtracted, and cost figures are the owner's estimates.
 */
export async function salesReport(db: Db, range: ReportRange) {
  const testFilter = range.includeTest ? sql`` : sql`AND o.is_test = false`;
  const divisionFilter = range.division
    ? sql`AND EXISTS (SELECT 1 FROM order_items i JOIN business_divisions d ON d.id = i.division_id WHERE i.order_id = o.id AND d.code = ${range.division})`
    : sql``;
  const totals = await sql<{ orders: number; gross: number; refunds: number; tax: number; delivery: number; shipping: number; discounts: number; items_value: number }>`
    SELECT count(*)::int AS orders,
      COALESCE(sum(o.paid_cents), 0)::int AS gross,
      COALESCE(sum(o.refunded_cents), 0)::int AS refunds,
      COALESCE(sum(o.tax_cents), 0)::int AS tax,
      COALESCE(sum(o.delivery_cents), 0)::int AS delivery,
      COALESCE(sum(o.shipping_cents), 0)::int AS shipping,
      COALESCE(sum(o.discount_cents), 0)::int AS discounts,
      COALESCE(sum(o.subtotal_cents), 0)::int AS items_value
    FROM orders o
    WHERE o.paid_cents > 0 AND o.placed_at >= ${range.from} AND o.placed_at < ${range.to} ${testFilter} ${divisionFilter}
  `.execute(db);
  const byDivision = await sql<{ division: string; orders: number; item_sales: number }>`
    SELECT d.name AS division, count(DISTINCT o.id)::int AS orders, COALESCE(sum(i.line_subtotal_cents - i.discount_cents), 0)::int AS item_sales
    FROM order_items i JOIN orders o ON o.id = i.order_id JOIN business_divisions d ON d.id = i.division_id
    WHERE o.paid_cents > 0 AND o.placed_at >= ${range.from} AND o.placed_at < ${range.to} ${testFilter}
    GROUP BY d.name ORDER BY item_sales DESC
  `.execute(db);
  const best = await sql<{ name: string; units: number; sales: number; est_cost: number | null }>`
    SELECT i.name, sum(i.quantity)::int AS units, sum(i.line_subtotal_cents - i.discount_cents)::int AS sales,
      sum(i.cost_estimate_cents * i.quantity)::int AS est_cost
    FROM order_items i JOIN orders o ON o.id = i.order_id
    WHERE o.paid_cents > 0 AND o.placed_at >= ${range.from} AND o.placed_at < ${range.to} ${testFilter} ${divisionFilter}
    GROUP BY i.name ORDER BY sales DESC LIMIT 15
  `.execute(db);
  const repeat = await sql<{ customers: number; repeat_customers: number }>`
    WITH c AS (
      SELECT o.customer_id, count(*) AS n FROM orders o WHERE o.paid_cents > 0 ${testFilter} GROUP BY o.customer_id
    ),
    active AS (
      SELECT DISTINCT o.customer_id FROM orders o WHERE o.paid_cents > 0 AND o.placed_at >= ${range.from} AND o.placed_at < ${range.to} ${testFilter}
    )
    SELECT count(*)::int AS customers, count(*) FILTER (WHERE c.n > 1)::int AS repeat_customers FROM active a JOIN c ON c.customer_id = a.customer_id
  `.execute(db);
  const sources = await sql<{ source: string; orders: number; sales: number }>`
    SELECT COALESCE(NULLIF(o.attribution->>'utm_source', ''), 'direct or unknown') AS source, count(*)::int AS orders, COALESCE(sum(o.paid_cents), 0)::int AS sales
    FROM orders o WHERE o.paid_cents > 0 AND o.placed_at >= ${range.from} AND o.placed_at < ${range.to} ${testFilter}
    GROUP BY 1 ORDER BY sales DESC
  `.execute(db);
  const t = totals.rows[0];
  return {
    orders: t.orders,
    gross_cents: t.gross,
    refunds_cents: t.refunds,
    net_cents: t.gross - t.refunds,
    average_order_cents: t.orders ? Math.round(t.gross / t.orders) : null,
    tax_collected_cents: t.tax,
    delivery_cents: t.delivery,
    shipping_cents: t.shipping,
    discounts_cents: t.discounts,
    by_division: byDivision.rows,
    best_sellers: best.rows,
    customers: repeat.rows[0].customers,
    repeat_customers: repeat.rows[0].repeat_customers,
    sources: sources.rows,
    definitions: {
      gross: 'Money collected on orders placed in this period, before refunds. Includes sales tax and delivery fees.',
      net: 'Gross sales minus refunds.',
      profit: 'Not shown. Cost figures are estimates entered by the owner, and processing fees, labor and overheads are not recorded here.',
    },
  };
}

export async function fulfillmentReport(db: Db, range: ReportRange) {
  const testFilter = range.includeTest ? sql`` : sql`AND o.is_test = false`;
  const timing = await sql<{ fulfilled: number; avg_minutes: number | null; on_time: number; late: number }>`
    SELECT count(*)::int AS fulfilled,
      avg(EXTRACT(EPOCH FROM (f.fulfilled_at - o.placed_at)) / 60)::int AS avg_minutes,
      count(*) FILTER (WHERE f.window_end IS NOT NULL AND f.fulfilled_at <= f.window_end)::int AS on_time,
      count(*) FILTER (WHERE f.window_end IS NOT NULL AND f.fulfilled_at > f.window_end)::int AS late
    FROM fulfillments f JOIN orders o ON o.id = f.order_id
    WHERE f.fulfilled_at >= ${range.from} AND f.fulfilled_at < ${range.to} ${testFilter}
  `.execute(db);
  const failures = await sql<{ n: number }>`
    SELECT count(*)::int AS n FROM deliveries d JOIN fulfillments f ON f.id = d.fulfillment_id JOIN orders o ON o.id = f.order_id
    WHERE d.status = 'failed' AND d.updated_at >= ${range.from} AND d.updated_at < ${range.to} ${testFilter}
  `.execute(db);
  const workload = await sql<{ est_prep_minutes: number; complexity_points: number }>`
    SELECT COALESCE(sum(i.prep_minutes), 0)::int AS est_prep_minutes, COALESCE(sum(i.complexity_points), 0)::int AS complexity_points
    FROM order_items i JOIN orders o ON o.id = i.order_id
    WHERE o.placed_at >= ${range.from} AND o.placed_at < ${range.to} AND o.status NOT IN ('cancelled', 'rejected', 'expired') ${testFilter}
  `.execute(db);
  const inventory = await sql<{ item: string; sold: number; on_hand: number }>`
    SELECT i.name AS item, COALESCE(sum(-m.delta_on_hand) FILTER (WHERE m.reason = 'sale'), 0)::int AS sold,
      COALESCE((SELECT sum(l.on_hand) FROM inventory_levels l WHERE l.item_id = i.id), 0)::int AS on_hand
    FROM inventory_items i LEFT JOIN inventory_movements m ON m.item_id = i.id AND m.created_at >= ${range.from} AND m.created_at < ${range.to}
    GROUP BY i.id, i.name HAVING COALESCE(sum(-m.delta_on_hand) FILTER (WHERE m.reason = 'sale'), 0) > 0 ORDER BY sold DESC LIMIT 15
  `.execute(db);
  const lowStock = await sql<{ day: string; n: number }>`
    SELECT created_at::date::text AS day, count(*)::int AS n FROM low_stock_events WHERE created_at >= ${range.from} AND created_at < ${range.to} GROUP BY 1 ORDER BY 1
  `.execute(db);
  const waste = await sql<{ item: string; lost: number }>`
    SELECT i.name AS item, sum(-m.delta_on_hand)::int AS lost FROM inventory_movements m JOIN inventory_items i ON i.id = m.item_id
    WHERE m.reason IN ('waste', 'spoilage') AND m.created_at >= ${range.from} AND m.created_at < ${range.to} GROUP BY i.name ORDER BY lost DESC LIMIT 15
  `.execute(db);
  const t = timing.rows[0];
  return {
    fulfilled: t.fulfilled,
    average_minutes_to_fulfil: t.avg_minutes,
    on_time: t.on_time,
    late: t.late,
    failed_deliveries: failures.rows[0].n,
    estimated_prep_minutes: workload.rows[0].est_prep_minutes,
    complexity_points: workload.rows[0].complexity_points,
    inventory_turnover: inventory.rows,
    low_stock_by_day: lowStock.rows,
    waste: waste.rows,
    definitions: { workload: 'Estimated from the preparation minutes and complexity points set on each product. These are planning figures, not measured time.', late: 'Fulfilled after the end of the promised window.' },
  };
}

export async function weddingsReport(db: Db, range: ReportRange) {
  const testFilter = range.includeTest ? sql`` : sql`AND i.is_test = false`;
  const invoiceTest = range.includeTest ? sql`` : sql`AND inv.is_test = false`;
  const funnel = await sql<{ inquiries: number; with_consultation: number; quoted: number; accepted: number; confirmed: number }>`
    SELECT count(*)::int AS inquiries,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM consultations c WHERE c.inquiry_id = i.id AND c.status IN ('booked', 'completed')))::int AS with_consultation,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM quotes q WHERE q.inquiry_id = i.id AND q.status <> 'draft'))::int AS quoted,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM quotes q WHERE q.inquiry_id = i.id AND q.status = 'accepted'))::int AS accepted,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM wedding_projects p WHERE p.inquiry_id = i.id AND p.status IN ('confirmed', 'in_preparation', 'event_scheduled', 'completed')))::int AS confirmed
    FROM wedding_inquiries i WHERE i.created_at >= ${range.from} AND i.created_at < ${range.to} ${testFilter}
  `.execute(db);
  const revenue = await sql<{ contracted: number }>`
    SELECT COALESCE(sum(q.total_cents), 0)::int AS contracted
    FROM wedding_projects p JOIN quotes q ON q.id = p.quote_id JOIN wedding_inquiries i ON i.id = p.inquiry_id
    WHERE p.status IN ('confirmed', 'in_preparation', 'event_scheduled', 'completed') AND p.confirmed_at >= ${range.from} AND p.confirmed_at < ${range.to} ${testFilter}
  `.execute(db);
  const receivables = await sql<{ outstanding: number; overdue: number; invoices: number }>`
    SELECT COALESCE(sum(inv.total_cents - inv.paid_cents), 0)::int AS outstanding,
      COALESCE(sum(inv.total_cents - inv.paid_cents) FILTER (WHERE inv.due_on < now()::date), 0)::int AS overdue,
      count(*)::int AS invoices
    FROM invoices inv WHERE inv.status IN ('sent', 'partially_paid') ${invoiceTest}
  `.execute(db);
  const f = funnel.rows[0];
  const rate = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);
  return {
    ...f,
    consultation_rate_percent: rate(f.with_consultation, f.inquiries),
    quote_acceptance_percent: rate(f.accepted, f.quoted),
    confirmed_revenue_cents: revenue.rows[0].contracted,
    outstanding_receivables_cents: receivables.rows[0].outstanding,
    overdue_receivables_cents: receivables.rows[0].overdue,
    open_invoices: receivables.rows[0].invoices,
    definitions: { confirmed_revenue: 'Total of accepted quotes on bookings confirmed in this period. This is contracted, not yet all collected.', receivables: 'Unpaid balance on all sent invoices, as of now.' },
  };
}
