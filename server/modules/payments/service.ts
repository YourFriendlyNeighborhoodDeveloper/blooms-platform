import type { AppContext } from '../../context.js';
import type { Db, Trx } from '../../db/client.js';
import { conflict, notFound, badRequest, AppError } from '../../lib/errors.js';
import { audit, SYSTEM_ACTOR, type Actor } from '../../lib/audit.js';
import { addMinutes } from '../../lib/time.js';
import { emit, raiseAlert } from '../../automation/events.js';
import type { CheckoutLine, GatewayEvent, GatewaySession } from '../../integrations/payments/gateway.js';
import { commitOrderReservations } from '../inventory/service.js';
import { requirementsForVariants } from '../inventory/requirements.js';
import { reserveStock } from '../inventory/service.js';
import { createOrderTasks, lockOrder, transitionOrder, writeHistory, type OrderStatus } from '../orders/workflow.js';
import { applyInvoicePayment, invoiceCheckoutDetails, revertInvoicePayment } from '../weddings/billing.js';
import { mapRefundStatus } from '../../integrations/payments/stripe.js';

const STRIPE_MIN_SESSION_MINUTES = 31;

async function orderCheckoutDetails(db: Db, orderId: string) {
  const order = await db
    .selectFrom('orders')
    .select(['id', 'reference', 'contact_email', 'delivery_cents', 'shipping_cents', 'tax_cents', 'total_cents', 'currency'])
    .where('id', '=', orderId)
    .executeTakeFirstOrThrow();
  const items = await db
    .selectFrom('order_items')
    .select(['name', 'variant_name', 'quantity', 'line_subtotal_cents', 'discount_cents'])
    .where('order_id', '=', orderId)
    .orderBy('sort_order')
    .execute();
  // Lines carry the final after-discount amount, so they always sum exactly to the order total.
  const lines: CheckoutLine[] = items.map((i) => ({
    name: `${i.quantity} × ${i.name}${i.variant_name && i.variant_name !== 'Standard' ? ` (${i.variant_name})` : ''}`,
    amount_cents: i.line_subtotal_cents - i.discount_cents,
  }));
  if (order.delivery_cents) lines.push({ name: 'Delivery', amount_cents: order.delivery_cents });
  if (order.shipping_cents) lines.push({ name: 'Shipping', amount_cents: order.shipping_cents });
  if (order.tax_cents) lines.push({ name: 'Sales tax', amount_cents: order.tax_cents });
  return { email: order.contact_email, description: `Order ${order.reference}`, reference: order.reference, currency: order.currency, lines: lines.filter((l) => l.amount_cents > 0) };
}

/** Returns a usable hosted payment page for this payment, creating the gateway session if needed. */
export async function ensureCheckoutSession(ctx: AppContext, paymentId: string, returnToken: string): Promise<{ url: string }> {
  const payment = await ctx.db.selectFrom('payments').selectAll().where('id', '=', paymentId).executeTakeFirst();
  if (!payment) throw notFound('Payment not found.');
  if (payment.status === 'succeeded') throw new AppError(409, 'payment_already_settled', 'This has already been paid.');
  if (payment.status !== 'pending') throw conflict('payment_closed', 'This payment attempt has closed. Please start again.');
  if (payment.checkout_url && payment.session_expires_at && payment.session_expires_at > ctx.clock.now()) {
    return { url: payment.checkout_url };
  }

  const now = ctx.clock.now();
  const earliest = addMinutes(now, STRIPE_MIN_SESSION_MINUTES);
  const expires = payment.session_expires_at && payment.session_expires_at > earliest ? payment.session_expires_at : earliest;
  const details = payment.order_id ? await orderCheckoutDetails(ctx.db, payment.order_id) : await invoiceCheckoutDetails(ctx.db, payment.invoice_id as string, payment.amount_cents);
  const base = ctx.env.PUBLIC_BASE_URL;
  const successPath = payment.order_id ? `/track/${returnToken}?from=checkout` : `/pay/${returnToken}?from=checkout`;
  const session = await ctx.payments.createCheckoutSession({
    payment_id: payment.id,
    amount_cents: payment.amount_cents,
    currency: payment.currency,
    description: details.description,
    customer_email: details.email,
    lines: details.lines,
    success_url: `${base}${successPath}`,
    cancel_url: `${base}${payment.order_id ? `/checkout?cancelled=1&token=${returnToken}` : `/pay/${returnToken}?cancelled=1`}`,
    expires_at: expires,
    metadata: { payment_id: payment.id, reference: details.reference, kind: payment.kind },
  });
  await ctx.db
    .updateTable('payments')
    .set({
      checkout_session_id: session.id,
      checkout_url: session.url,
      payment_intent_id: session.payment_intent,
      session_expires_at: session.expires_at ?? expires,
    })
    .where('id', '=', payment.id)
    .execute();
  if (payment.order_id) {
    // Holds outlast the session by a few minutes, so a payment finishing at the deadline still has its stock.
    const holdUntil = addMinutes(session.expires_at ?? expires, 5);
    await ctx.db.updateTable('orders').set({ hold_expires_at: holdUntil }).where('id', '=', payment.order_id).execute();
    await ctx.db.updateTable('inventory_reservations').set({ expires_at: holdUntil }).where('order_id', '=', payment.order_id).where('status', '=', 'held').execute();
  }
  if (!session.url) throw new Error('Gateway returned no payment URL.');
  return { url: session.url };
}

/** For pay links and retries: find an open attempt or start a new one. */
export async function startOrderPayment(ctx: AppContext, orderId: string, token: string) {
  const payment = await ctx.db.transaction().execute(async (trx) => {
    const order = await lockOrder(trx, orderId);
    const payable: OrderStatus[] = ['awaiting_payment', 'payment_failed'];
    if (!payable.includes(order.status as OrderStatus)) {
      throw conflict('not_payable', order.payment_status === 'paid' ? 'This order is already paid.' : 'This order cannot be paid right now.');
    }
    const open = await trx
      .selectFrom('payments')
      .select(['id', 'session_expires_at'])
      .where('order_id', '=', orderId)
      .where('status', '=', 'pending')
      .orderBy('created_at', 'desc')
      .executeTakeFirst();
    if (open && open.session_expires_at && open.session_expires_at > addMinutes(ctx.clock.now(), 5)) return open;
    if (open) await trx.updateTable('payments').set({ status: 'expired' }).where('id', '=', open.id).execute();
    if (order.status === 'payment_failed') await transitionOrder(trx, order, 'awaiting_payment', SYSTEM_ACTOR, { customer_visible: false });
    return trx
      .insertInto('payments')
      .values({
        order_id: orderId,
        gateway: ctx.payments.name === 'stripe' ? 'stripe' : 'mock',
        kind: 'order',
        amount_cents: order.total_cents - order.paid_cents,
        session_expires_at: addMinutes(ctx.clock.now(), STRIPE_MIN_SESSION_MINUTES + 30),
        livemode: ctx.payments.livemode,
      })
      .returning(['id', 'session_expires_at'])
      .executeTakeFirstOrThrow();
  });
  return ensureCheckoutSession(ctx, payment.id, token);
}

type PaymentRow = {
  id: string;
  order_id: string | null;
  invoice_id: string | null;
  amount_cents: number;
  status: string;
  kind: string;
  refunded_cents: number;
};

/** Makes the database match what the gateway says about a session. Every branch is idempotent. */
export async function applySessionState(ctx: AppContext, trx: Trx, session: GatewaySession, source: string) {
  const payment = await trx
    .selectFrom('payments')
    .select(['id', 'order_id', 'invoice_id', 'amount_cents', 'status', 'kind', 'refunded_cents'])
    .where((eb) => eb.or([eb('checkout_session_id', '=', session.id), eb('id', '=', session.metadata.payment_id ?? '00000000-0000-0000-0000-000000000000')]))
    .forUpdate()
    .executeTakeFirst();
  if (!payment) return 'unknown_session' as const;

  await trx
    .updateTable('payments')
    .set({
      checkout_session_id: session.id,
      ...(session.payment_intent ? { payment_intent_id: session.payment_intent } : {}),
      last_reconciled_at: ctx.clock.now(),
    })
    .where('id', '=', payment.id)
    .execute();

  if (session.payment_status === 'paid' || session.payment_status === 'no_payment_required') {
    await markSucceeded(ctx, trx, payment, session.amount_total, source);
    return 'paid' as const;
  }
  if (session.status === 'complete') {
    await markProcessing(trx, payment);
    return 'processing' as const;
  }
  if (session.status === 'expired') {
    await markExpired(ctx, trx, payment);
    return 'expired' as const;
  }
  return 'open' as const;
}

async function markProcessing(trx: Trx, payment: PaymentRow) {
  if (payment.status !== 'pending') return;
  await trx.updateTable('payments').set({ status: 'processing' }).where('id', '=', payment.id).execute();
  if (payment.order_id) {
    const order = await lockOrder(trx, payment.order_id);
    await trx.updateTable('orders').set({ payment_status: 'processing' }).where('id', '=', order.id).execute();
    if (order.status === 'awaiting_payment' || order.status === 'payment_failed') {
      await transitionOrder(trx, order, 'payment_processing', SYSTEM_ACTOR, { note: 'Waiting for your bank to confirm the payment.' });
    }
  }
}

/** The only path to "paid". Reaching a success page never gets here; only verified gateway state does. */
async function markSucceeded(ctx: AppContext, trx: Trx, payment: PaymentRow, amountTotal: number | null, source: string) {
  if (payment.status === 'succeeded') return;
  const mismatch = amountTotal !== null && amountTotal !== payment.amount_cents;
  await trx
    .updateTable('payments')
    .set({ status: 'succeeded', paid_at: ctx.clock.now(), amount_mismatch: mismatch, failure_reason: null })
    .where('id', '=', payment.id)
    .execute();
  await audit(trx, { type: 'webhook', label: source }, 'payment.succeeded', { type: 'payment', id: payment.id }, { amount_cents: payment.amount_cents, gateway_amount: amountTotal });

  if (mismatch) {
    await raiseAlert(trx, {
      code: 'payment_amount_mismatch',
      severity: 'critical',
      title: 'A payment did not match the expected amount',
      detail: `Expected ${payment.amount_cents} cents, gateway reported ${amountTotal} cents. Review before fulfilling.`,
      subject: { type: 'payment', id: payment.id },
      link: payment.order_id ? `/admin/orders/${payment.order_id}` : null,
      dedupeKey: `amount-mismatch:${payment.id}`,
    });
  }
  if (payment.order_id) await onOrderPaid(trx, payment, mismatch);
  if (payment.invoice_id) await applyInvoicePayment(ctx, trx, payment.invoice_id, payment.amount_cents, payment.id);
}

async function onOrderPaid(trx: Trx, payment: PaymentRow, mismatch: boolean) {
  const order = await lockOrder(trx, payment.order_id as string);
  const paid = order.paid_cents + payment.amount_cents;
  const fully = paid >= order.total_cents;
  await trx
    .updateTable('orders')
    .set({ paid_cents: paid, payment_status: fully ? 'paid' : 'unpaid', hold_expires_at: null })
    .where('id', '=', order.id)
    .execute();
  await writeHistory(trx, { order_id: order.id, from: order.payment_status, to: 'payment_confirmed', actor: SYSTEM_ACTOR, note: null });
  if (order.cart_id) {
    await trx.deleteFrom('cart_items').where('cart_id', '=', order.cart_id).execute();
    await trx.updateTable('carts').set({ status: 'converted', promotion_code: null }).where('id', '=', order.cart_id).execute();
  }

  const attention = async (reason: string) => {
    await trx.updateTable('orders').set({ needs_attention: true, attention_reason: reason }).where('id', '=', order.id).execute();
    await raiseAlert(trx, {
      code: 'order_payment_attention',
      severity: 'critical',
      title: `Order ${order.reference} was paid but needs a decision`,
      detail: reason,
      subject: { type: 'order', id: order.id },
      link: `/admin/orders/${order.id}`,
      dedupeKey: `paid-attention:${order.id}`,
    });
    await emit(trx, 'payment.problem', { type: 'payment', id: payment.id }, { reason });
  };

  // Payment arrived after the order was given up on, for example a delayed bank transfer.
  if (['cancelled', 'expired', 'rejected'].includes(order.status)) {
    const restored = order.status === 'rejected' ? false : await reacquireHolds(trx, order.id);
    const held = { id: order.id, status: order.status };
    if (order.status !== 'rejected') await transitionOrder(trx, held, restored ? 'awaiting_review' : 'inventory_shortage', SYSTEM_ACTOR, { note: 'Payment arrived late. The shop is reviewing it.' });
    await attention(`Payment arrived after this order was ${order.status}. ${restored ? 'Stock was re-reserved, ' : 'Stock could not be re-reserved, '}so please decide whether to fulfil or refund.`);
    return;
  }
  if (!fully) {
    await attention(`Partial payment: ${paid} of ${order.total_cents} cents received.`);
    return;
  }

  await commitOrderReservations(trx, order.id);
  await reacquireHolds(trx, order.id);
  if (mismatch) await attention('The amount paid did not match the order total.');

  const held = { id: order.id, status: order.status };
  await emit(trx, 'order.paid', { type: 'order', id: order.id }, {}, `order-paid:${order.id}`);
  if (order.acceptance_mode === 'review' && order.review_timing === 'pay_first') {
    await transitionOrder(trx, held, 'awaiting_review', SYSTEM_ACTOR);
    await emit(trx, 'order.review_requested', { type: 'order', id: order.id }, {}, `order-review:${order.id}`);
    return;
  }
  // Review already happened, or was not needed. Fulfilment can begin.
  await transitionOrder(trx, held, 'accepted', SYSTEM_ACTOR);
  await createOrderTasks(trx, order.id);
}

/** Re-reserves stock for an order whose holds lapsed before payment arrived. */
async function reacquireHolds(trx: Trx, orderId: string): Promise<boolean> {
  const items = await trx.selectFrom('order_items').select(['id', 'variant_id', 'quantity']).where('order_id', '=', orderId).execute();
  const reqs = await requirementsForVariants(trx, items.flatMap((i) => (i.variant_id ? [i.variant_id] : [])));
  const reservations = await trx.selectFrom('inventory_reservations').select(['order_item_id', 'item_id', 'status']).where('order_id', '=', orderId).execute();
  let all = true;
  for (const item of items) {
    if (!item.variant_id) continue;
    for (const req of reqs.get(item.variant_id) ?? []) {
      const live = reservations.some((r) => r.order_item_id === item.id && r.item_id === req.item_id && ['held', 'committed', 'consumed', 'backorder'].includes(r.status));
      if (live) continue;
      const ok = await reserveStock(trx, { item_id: req.item_id, quantity: req.per_unit * item.quantity, expires_at: new Date(Date.now() + 3600_000), order_id: orderId, order_item_id: item.id });
      if (!ok) all = false;
    }
  }
  if (all) await commitOrderReservations(trx, orderId);
  else {
    await trx.updateTable('order_items').set({ status: 'shortage' }).where('order_id', '=', orderId).where('status', '=', 'pending').execute();
  }
  await trx.updateTable('capacity_claims').set({ status: 'active' }).where('order_id', '=', orderId).where('status', '=', 'released').execute();
  return all;
}

async function markExpired(ctx: AppContext, trx: Trx, payment: PaymentRow) {
  if (['succeeded', 'expired', 'cancelled'].includes(payment.status)) return;
  await trx.updateTable('payments').set({ status: 'expired' }).where('id', '=', payment.id).execute();
  if (!payment.order_id) return;
  const order = await lockOrder(trx, payment.order_id);
  // Only abandon the order if no other attempt is live. An approved order keeps its own hold window.
  const other = await trx.selectFrom('payments').select('id').where('order_id', '=', order.id).where('status', 'in', ['pending', 'processing', 'succeeded']).executeTakeFirst();
  if (other) return;
  if (['awaiting_payment', 'payment_failed', 'payment_processing'].includes(order.status)) {
    const { expireOrder } = await import('../orders/actions.js');
    await expireOrder(ctx, trx, order.id, 'Checkout expired before payment.');
  }
}

async function markFailed(trx: Trx, session: { id: string; metadata?: Record<string, string> }, reason: string | null) {
  const payment = await trx
    .selectFrom('payments')
    .select(['id', 'order_id', 'invoice_id', 'amount_cents', 'status', 'kind', 'refunded_cents'])
    .where('checkout_session_id', '=', session.id)
    .forUpdate()
    .executeTakeFirst();
  if (!payment || payment.status === 'succeeded') return;
  await trx.updateTable('payments').set({ status: 'failed', failure_reason: reason }).where('id', '=', payment.id).execute();
  if (payment.order_id) {
    const order = await lockOrder(trx, payment.order_id);
    await trx.updateTable('orders').set({ payment_status: 'failed' }).where('id', '=', order.id).execute();
    if (['awaiting_payment', 'payment_processing'].includes(order.status)) {
      await transitionOrder(trx, order, 'payment_failed', SYSTEM_ACTOR, { note: reason ?? 'The payment did not go through.' });
    }
  }
  await emit(trx, 'payment.failed', { type: 'payment', id: payment.id }, { reason }, `payment-failed:${payment.id}`);
}

const asSession = (o: Record<string, unknown>): GatewaySession => ({
  id: o.id as string,
  url: (o.url as string) ?? null,
  status: (o.status as GatewaySession['status']) ?? 'open',
  payment_status: (o.payment_status as GatewaySession['payment_status']) ?? 'unpaid',
  amount_total: (o.amount_total as number) ?? null,
  payment_intent: typeof o.payment_intent === 'string' ? o.payment_intent : ((o.payment_intent as { id?: string } | null)?.id ?? null),
  expires_at: o.expires_at ? new Date((o.expires_at as number) * 1000) : null,
  livemode: Boolean(o.livemode),
  metadata: (o.metadata as Record<string, string>) ?? {},
});

/** Routes one verified gateway event. Unknown types are stored and ignored rather than rejected. */
export async function processGatewayEvent(ctx: AppContext, trx: Trx, event: GatewayEvent): Promise<'processed' | 'ignored'> {
  const o = event.object;
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
    case 'checkout.session.expired': {
      const result = await applySessionState(ctx, trx, asSession(o), `stripe:${event.type}`);
      return result === 'unknown_session' ? 'ignored' : 'processed';
    }
    case 'checkout.session.async_payment_failed':
      await markFailed(trx, { id: o.id as string }, 'Your bank did not complete the payment.');
      return 'processed';
    case 'payment_intent.payment_failed': {
      // Hosted Checkout lets the customer try another card, so a decline only gets noted here.
      const message = (o.last_payment_error as { message?: string } | null)?.message ?? null;
      await trx.updateTable('payments').set({ failure_reason: message }).where('payment_intent_id', '=', o.id as string).where('status', 'in', ['pending', 'processing']).execute();
      return 'processed';
    }
    case 'refund.created':
    case 'refund.updated':
    case 'refund.failed':
    case 'charge.refund.updated':
      return syncGatewayRefund(ctx, trx, o);
    case 'charge.dispute.created':
      await raiseAlert(trx, {
        code: 'payment_dispute',
        severity: 'critical',
        title: 'A customer disputed a payment',
        detail: `Dispute ${o.id as string}: respond in the Stripe dashboard before the deadline.`,
        dedupeKey: `dispute:${o.id as string}`,
      });
      return 'processed';
    default:
      return 'ignored';
  }
}

/** Handles refunds we started, and refunds someone made directly in the Stripe dashboard. */
async function syncGatewayRefund(ctx: AppContext, trx: Trx, o: Record<string, unknown>): Promise<'processed' | 'ignored'> {
  const gatewayId = o.id as string;
  const status = mapRefundStatus(o.status as string);
  const metaId = (o.metadata as Record<string, string> | null)?.refund_id;
  const amount = o.amount as number;
  const intent = typeof o.payment_intent === 'string' ? o.payment_intent : null;

  let refund = await trx
    .selectFrom('refunds')
    .select(['id', 'status', 'amount_cents', 'payment_id', 'order_id', 'gateway_refund_id'])
    .where((eb) => eb.or([eb('gateway_refund_id', '=', gatewayId), ...(metaId ? [eb('id', '=', metaId)] : [])]))
    .forUpdate()
    .executeTakeFirst();

  if (!refund) {
    if (!intent) return 'ignored';
    const payment = await trx.selectFrom('payments').select(['id', 'order_id', 'invoice_id', 'amount_cents', 'refunded_cents']).where('payment_intent_id', '=', intent).forUpdate().executeTakeFirst();
    if (!payment) return 'ignored';
    refund = await trx
      .insertInto('refunds')
      .values({ payment_id: payment.id, order_id: payment.order_id, amount_cents: amount, status: 'pending', gateway_refund_id: gatewayId, reason: 'Recorded from the Stripe dashboard' })
      .returning(['id', 'status', 'amount_cents', 'payment_id', 'order_id', 'gateway_refund_id'])
      .executeTakeFirstOrThrow();
    if (status !== 'failed' && status !== 'cancelled') await applyRefundAmounts(ctx, trx, refund.payment_id, refund.order_id, amount);
  }

  const wasClosed = refund.status === 'failed' || refund.status === 'cancelled';
  await trx.updateTable('refunds').set({ status, gateway_refund_id: gatewayId, failure_reason: (o.failure_reason as string) ?? null }).where('id', '=', refund.id).execute();
  if ((status === 'failed' || status === 'cancelled') && !wasClosed) {
    await applyRefundAmounts(ctx, trx, refund.payment_id, refund.order_id, -refund.amount_cents);
    await raiseAlert(trx, { code: 'refund_failed', severity: 'critical', title: 'A refund failed', detail: `Refund ${gatewayId} did not go through.`, link: refund.order_id ? `/admin/orders/${refund.order_id}` : null, dedupeKey: `refund-failed:${refund.id}` });
  }
  if (status === 'succeeded' || status === 'pending') {
    await emit(trx, 'refund.issued', { type: 'refund', id: refund.id }, {}, `refund-issued:${refund.id}`);
  }
  return 'processed';
}

export async function applyRefundAmounts(ctx: AppContext, trx: Db, paymentId: string, orderId: string | null, delta: number) {
  const payment = await trx
    .updateTable('payments')
    .set((eb) => ({ refunded_cents: eb('refunded_cents', '+', delta) }))
    .where('id', '=', paymentId)
    .returning(['invoice_id'])
    .executeTakeFirstOrThrow();
  if (orderId) {
    const order = await trx
      .updateTable('orders')
      .set((eb) => ({ refunded_cents: eb('refunded_cents', '+', delta) }))
      .where('id', '=', orderId)
      .returning(['refunded_cents', 'paid_cents'])
      .executeTakeFirstOrThrow();
    const status = order.refunded_cents === 0 ? 'paid' : order.refunded_cents >= order.paid_cents ? 'refunded' : 'partially_refunded';
    await trx.updateTable('orders').set({ payment_status: status }).where('id', '=', orderId).execute();
  }
  if (payment.invoice_id) await revertInvoicePayment(ctx, trx, payment.invoice_id, delta);
}

/**
 * Issues a refund. The amount is claimed against the payment under a row lock before the gateway is
 * called, so two staff members cannot refund the same money twice. If the gateway refuses, the claim
 * is rolled back and the failure is reported.
 */
export async function issueRefund(ctx: AppContext, input: { payment_id: string; amount_cents: number; reason?: string | null; actor: Actor; refund_stripe_reason?: string }) {
  if (input.amount_cents <= 0) throw badRequest('Enter a refund amount.');
  const claim = await ctx.db.transaction().execute(async (trx) => {
    const payment = await trx
      .selectFrom('payments')
      .select(['id', 'order_id', 'invoice_id', 'amount_cents', 'refunded_cents', 'status', 'gateway', 'payment_intent_id'])
      .where('id', '=', input.payment_id)
      .forUpdate()
      .executeTakeFirst();
    if (!payment) throw notFound('Payment not found.');
    if (payment.status !== 'succeeded') throw conflict('not_refundable', 'Only a completed payment can be refunded.');
    const left = payment.amount_cents - payment.refunded_cents;
    if (input.amount_cents > left) throw conflict('refund_too_large', `Only $${(left / 100).toFixed(2)} remains refundable on this payment.`);
    if (payment.gateway !== 'manual' && !payment.payment_intent_id) throw conflict('not_refundable', 'The gateway reference for this payment is missing.');
    const refund = await trx
      .insertInto('refunds')
      .values({ payment_id: payment.id, order_id: payment.order_id, amount_cents: input.amount_cents, reason: input.reason ?? null, requested_by: input.actor.id ?? null, status: 'pending' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await applyRefundAmounts(ctx, trx, payment.id, payment.order_id, input.amount_cents);
    await audit(trx, input.actor, 'refund.request', { type: 'refund', id: refund.id }, { payment_id: payment.id, amount_cents: input.amount_cents, reason: input.reason ?? null });
    return { refundId: refund.id, payment };
  });

  if (claim.payment.gateway === 'manual') {
    await ctx.db.transaction().execute(async (trx) => {
      await trx.updateTable('refunds').set({ status: 'succeeded' }).where('id', '=', claim.refundId).execute();
      await emit(trx, 'refund.issued', { type: 'refund', id: claim.refundId }, {}, `refund-issued:${claim.refundId}`);
    });
    return { id: claim.refundId, status: 'succeeded' as const };
  }

  try {
    const result = await ctx.payments.refund({
      payment_intent: claim.payment.payment_intent_id as string,
      amount_cents: input.amount_cents,
      idempotency_key: claim.refundId,
      reason: input.refund_stripe_reason ?? 'requested_by_customer',
      metadata: { refund_id: claim.refundId },
    });
    await ctx.db.transaction().execute(async (trx) => {
      await trx.updateTable('refunds').set({ gateway_refund_id: result.id, status: result.status, failure_reason: result.failure_reason ?? null }).where('id', '=', claim.refundId).execute();
      if (result.status === 'failed' || result.status === 'cancelled') {
        await applyRefundAmounts(ctx, trx, claim.payment.id, claim.payment.order_id, -input.amount_cents);
      } else {
        await emit(trx, 'refund.issued', { type: 'refund', id: claim.refundId }, {}, `refund-issued:${claim.refundId}`);
      }
    });
    return { id: claim.refundId, status: result.status };
  } catch (err) {
    await ctx.db.transaction().execute(async (trx) => {
      await trx.updateTable('refunds').set({ status: 'failed', failure_reason: (err as Error).message.slice(0, 500) }).where('id', '=', claim.refundId).execute();
      await applyRefundAmounts(ctx, trx, claim.payment.id, claim.payment.order_id, -input.amount_cents);
      await raiseAlert(trx, { code: 'refund_failed', severity: 'critical', title: 'A refund failed', detail: (err as Error).message.slice(0, 500), subject: { type: 'refund', id: claim.refundId }, dedupeKey: `refund-failed:${claim.refundId}` });
    });
    throw new AppError(502, 'refund_failed', 'The payment provider did not accept that refund. Nothing was refunded.');
  }
}

/** Pulls truth from the gateway for attempts that have gone quiet. This is what recovers from a lost webhook. */
export async function reconcileOpenPayments(ctx: AppContext, olderThanMinutes = 10, limit = 50) {
  if (ctx.payments.name === 'disabled') return { checked: 0, changed: 0 };
  const cutoff = addMinutes(ctx.clock.now(), -olderThanMinutes);
  const rows = await ctx.db
    .selectFrom('payments')
    .select(['id', 'checkout_session_id'])
    .where('status', 'in', ['pending', 'processing'])
    .where('gateway', '!=', 'manual')
    .where('checkout_session_id', 'is not', null)
    .where('created_at', '<', cutoff)
    .where((eb) => eb.or([eb('last_reconciled_at', 'is', null), eb('last_reconciled_at', '<', cutoff)]))
    .orderBy('created_at')
    .limit(limit)
    .execute();
  let changed = 0;
  for (const row of rows) {
    try {
      const session = await ctx.payments.retrieveCheckoutSession(row.checkout_session_id as string);
      const result = await ctx.db.transaction().execute((trx) => applySessionState(ctx, trx, session, 'reconciliation'));
      if (result === 'paid' || result === 'expired' || result === 'processing') changed++;
    } catch (err) {
      ctx.log.warn('reconciliation could not check a session', { payment: row.id, error: err });
    }
  }
  return { checked: rows.length, changed };
}

export async function recordManualPayment(
  ctx: AppContext,
  input: { order_id?: string | null; invoice_id?: string | null; amount_cents: number; reference?: string | null; actor: Actor },
) {
  if (input.amount_cents <= 0) throw badRequest('Enter the amount received.');
  await ctx.db.transaction().execute(async (trx) => {
    const payment = await trx
      .insertInto('payments')
      .values({
        order_id: input.order_id ?? null,
        invoice_id: input.invoice_id ?? null,
        gateway: 'manual',
        kind: input.order_id ? 'order' : 'invoice',
        amount_cents: input.amount_cents,
        status: 'pending',
        manual_reference: input.reference ?? null,
        recorded_by: input.actor.id ?? null,
        livemode: ctx.payments.livemode,
      })
      .returning(['id', 'order_id', 'invoice_id', 'amount_cents', 'status', 'kind', 'refunded_cents'])
      .executeTakeFirstOrThrow();
    await audit(trx, input.actor, 'payment.manual', { type: 'payment', id: payment.id }, { amount_cents: input.amount_cents, reference: input.reference ?? null });
    await markSucceeded(ctx, trx, payment, input.amount_cents, 'manual');
  });
}

