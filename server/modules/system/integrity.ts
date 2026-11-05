import { sql, type RawBuilder } from 'kysely';
import type { Db } from '../../db/client.js';

export type IntegrityCheck = { id: string; title: string; explanation: string; violations: number; sample: unknown[] };
export type IntegrityReport = { ok: boolean; checked_at: Date; checks: IntegrityCheck[] };

type Definition = { id: string; title: string; explanation: string; query: RawBuilder<Record<string, unknown>> };

/**
 * Cross-checks that the database constraints cannot express, because they span many rows. A failure
 * means records disagree and someone should look. Nothing here changes data.
 */
const DEFINITIONS: Definition[] = [
  {
    id: 'stock_matches_movements',
    title: 'Stock counts match their movement history',
    explanation: 'Each item\'s on-hand count should equal the sum of everything recorded in its history.',
    query: sql`
      SELECT l.item_id, l.location_id, l.on_hand, COALESCE(m.total, 0)::int AS from_movements
      FROM inventory_levels l
      LEFT JOIN (SELECT item_id, location_id, sum(delta_on_hand) AS total FROM inventory_movements GROUP BY 1, 2) m USING (item_id, location_id)
      WHERE l.on_hand <> COALESCE(m.total, 0)
    `,
  },
  {
    id: 'reserved_matches_reservations',
    title: 'Reserved stock matches open reservations',
    explanation: 'Stock marked reserved should equal what open orders are actually holding.',
    query: sql`
      SELECT l.item_id, l.location_id, l.reserved, COALESCE(r.total, 0)::int AS from_reservations
      FROM inventory_levels l
      LEFT JOIN (SELECT item_id, location_id, sum(quantity) AS total FROM inventory_reservations WHERE status IN ('held', 'committed') GROUP BY 1, 2) r USING (item_id, location_id)
      WHERE l.reserved <> COALESCE(r.total, 0)
    `,
  },
  {
    id: 'order_paid_matches_payments',
    title: 'Paid amounts match payment records',
    explanation: 'What an order shows as paid should equal its successful payments.',
    query: sql`
      SELECT o.id, o.reference, o.paid_cents, COALESCE(p.total, 0)::int AS from_payments
      FROM orders o
      LEFT JOIN (SELECT order_id, sum(amount_cents) AS total FROM payments WHERE status = 'succeeded' AND order_id IS NOT NULL GROUP BY 1) p ON p.order_id = o.id
      WHERE o.paid_cents <> COALESCE(p.total, 0)
    `,
  },
  {
    id: 'refunds_match_payments',
    title: 'Refunded amounts match refund records',
    explanation: 'What a payment shows as refunded should equal its refunds that went through.',
    query: sql`
      SELECT p.id, p.refunded_cents, COALESCE(r.total, 0)::int AS from_refunds
      FROM payments p
      LEFT JOIN (SELECT payment_id, sum(amount_cents) AS total FROM refunds WHERE status IN ('pending', 'succeeded') GROUP BY 1) r ON r.payment_id = p.id
      WHERE p.refunded_cents <> COALESCE(r.total, 0)
    `,
  },
  {
    id: 'invoice_paid_matches_payments',
    title: 'Invoice balances match payment records',
    explanation: 'What an invoice shows as paid should equal its successful payments, less refunds.',
    query: sql`
      SELECT i.id, i.number, i.paid_cents, COALESCE(p.total, 0)::int AS from_payments
      FROM invoices i
      LEFT JOIN (SELECT invoice_id, sum(amount_cents - refunded_cents) AS total FROM payments WHERE status = 'succeeded' AND invoice_id IS NOT NULL GROUP BY 1) p ON p.invoice_id = i.id
      WHERE i.paid_cents <> COALESCE(p.total, 0)
    `,
  },
  {
    id: 'finished_orders_have_finished_items',
    title: 'Finished orders have no unfinished items',
    explanation: 'An order only finishes when every item on it has.',
    query: sql`
      SELECT o.id, o.reference, o.status, i.name, i.status AS item_status
      FROM orders o JOIN order_items i ON i.order_id = o.id
      WHERE o.status IN ('fulfilled', 'completed') AND i.status NOT IN ('fulfilled', 'returned', 'cancelled', 'refunded')
    `,
  },
  {
    id: 'no_tasks_on_unpaid_orders',
    title: 'No work was released for unpaid orders',
    explanation: 'Production tasks should only exist once an order has been paid or accepted by a person.',
    query: sql`
      SELECT o.id, o.reference, o.status
      FROM orders o
      WHERE o.status IN ('awaiting_payment', 'payment_processing', 'payment_failed')
        AND EXISTS (SELECT 1 FROM staff_tasks t WHERE t.subject_type = 'order' AND t.subject_id = o.id)
    `,
  },
  {
    id: 'closed_orders_hold_nothing',
    title: 'Closed orders hold no stock or capacity',
    explanation: 'Cancelled, declined or expired orders should give back what they reserved.',
    query: sql`
      SELECT o.id, o.reference, o.status FROM orders o
      WHERE o.status IN ('cancelled', 'rejected', 'expired')
        AND (EXISTS (SELECT 1 FROM inventory_reservations r WHERE r.order_id = o.id AND r.status IN ('held', 'committed'))
          OR EXISTS (SELECT 1 FROM capacity_claims c WHERE c.order_id = o.id AND c.status = 'active'))
    `,
  },
  {
    id: 'rentals_within_quantity',
    title: 'Rentals never exceed what the shop owns',
    explanation: 'At no moment should more of an item be reserved than exists.',
    query: sql`
      SELECT i.id, i.name, i.quantity, peak.at_time, peak.reserved
      FROM rental_items i
      JOIN LATERAL (
        SELECT a.starts_at AS at_time, sum(b.quantity)::int AS reserved
        FROM rental_reservations a
        JOIN rental_reservations b ON b.rental_item_id = a.rental_item_id
          AND b.status IN ('hold', 'approved', 'confirmed', 'out')
          AND b.starts_at <= a.starts_at AND a.starts_at < b.blocked_until
        WHERE a.rental_item_id = i.id AND a.status IN ('hold', 'approved', 'confirmed', 'out')
        GROUP BY a.starts_at
        ORDER BY reserved DESC
        LIMIT 1
      ) peak ON peak.reserved > i.quantity
    `,
  },
  {
    id: 'confirmed_bookings_are_staffed',
    title: 'Confirmed events have their crews reserved',
    explanation: 'A confirmed event needs a confirmed crew reservation, unless the event was set up to need none.',
    query: sql`
      SELECT b.id, b.event_date, b.status FROM event_bookings b
      WHERE b.status = 'confirmed' AND b.crews_required > 0
        AND NOT EXISTS (SELECT 1 FROM resource_reservations r WHERE r.booking_id = b.id AND r.status = 'confirmed')
    `,
  },
  {
    id: 'stuck_webhooks',
    title: 'Payment events are not stuck',
    explanation: 'A payment event still unprocessed after an hour needs a look.',
    query: sql`
      SELECT id, event_type, status, received_at FROM webhook_events
      WHERE status IN ('received', 'failed') AND received_at < now() - interval '1 hour'
    `,
  },
  {
    id: 'stuck_messages',
    title: 'Messages are not stuck',
    explanation: 'A message still being sent after an hour needs a look.',
    query: sql`SELECT id, template_code, status, updated_at FROM notifications WHERE status = 'sending' AND updated_at < now() - interval '1 hour'`,
  },
];

export async function checkIntegrity(db: Db): Promise<IntegrityReport> {
  const checks: IntegrityCheck[] = [];
  for (const d of DEFINITIONS) {
    const res = await d.query.execute(db);
    checks.push({ id: d.id, title: d.title, explanation: d.explanation, violations: res.rows.length, sample: res.rows.slice(0, 5) });
  }
  return { ok: checks.every((c) => c.violations === 0), checked_at: new Date(), checks };
}
