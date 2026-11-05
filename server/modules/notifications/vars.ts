import type { AppContext } from '../../context.js';
import type { Db } from '../../db/client.js';
import { formatCents } from '../../lib/money.js';
import { formatDate, formatDateTime, formatTimeRange } from '../../lib/time.js';
import { formatPhone } from '../../lib/phone.js';
import { mintAccessToken } from '../../lib/tokens.js';
import type { SettingsState } from '../settings/service.js';

const LINK_DAYS = 120;
const days = (n: number) => 60 * 24 * n;

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

type Base = { customer_id?: string | null; vars: Record<string, unknown> };

async function customerVars(db: Db, customerId: string) {
  const c = await db.selectFrom('customers').select(['id', 'name', 'email', 'phone_e164']).where('id', '=', customerId).executeTakeFirst();
  if (!c) return null;
  return { id: c.id, name: c.name, first_name: firstName(c.name), email: c.email, phone: formatPhone(c.phone_e164), phone_e164: c.phone_e164 };
}

export async function orderVars(ctx: AppContext, settings: SettingsState, orderId: string, mintLink = true) {
  const tz = settings.general.timezone;
  const order = await ctx.db.selectFrom('orders').selectAll().where('id', '=', orderId).executeTakeFirst();
  if (!order) return null;
  const items = await ctx.db.selectFrom('order_items').select(['name', 'variant_name', 'quantity', 'options']).where('order_id', '=', orderId).orderBy('sort_order').execute();
  const fulfillments = await ctx.db.selectFrom('fulfillments').select(['method', 'window_start', 'window_end', 'scheduled_date', 'address', 'status']).where('order_id', '=', orderId).execute();
  const itemsText = items.map((i) => `${i.quantity} × ${i.name}${i.variant_name && i.variant_name !== 'Standard' ? ` (${i.variant_name})` : ''}`).join('\n');
  const fulfillmentText = fulfillments
    .map((f) => {
      const when = f.window_start && f.window_end ? formatTimeRange(f.window_start, f.window_end, tz) : '';
      if (f.method === 'pickup') return `Pickup: ${when}`;
      if (f.method === 'delivery') return `Delivery: ${when}`;
      return 'Shipping: sent to your address';
    })
    .join('\n');
  const reasons = Array.isArray(order.acceptance_reasons) ? (order.acceptance_reasons as Array<{ message?: string }>).map((r) => r.message).filter(Boolean) : [];
  const trackingToken = mintLink ? await mintAccessToken(ctx.db, ctx.clock, { purpose: 'order_access', subjectId: orderId, ttlMinutes: days(LINK_DAYS) }) : '';
  return {
    customer_id: order.customer_id,
    order: {
      id: order.id,
      reference: order.reference,
      status: order.status,
      total: formatCents(order.total_cents),
      items_text: itemsText,
      fulfillment_text: fulfillmentText,
      tracking_url: `${ctx.env.PUBLIC_BASE_URL}/track/${trackingToken}`,
      admin_url: `${ctx.env.PUBLIC_BASE_URL}/admin/orders/${order.id}`,
      review_reasons: reasons.join(' '),
      hold_until: order.hold_expires_at ? formatDateTime(order.hold_expires_at, tz) : '',
      payment_note:
        order.review_timing === 'approve_first' && order.payment_status !== 'paid'
          ? 'You have not been charged. If the shop can do it, we will send a link to pay.'
          : 'If the shop cannot take this order, your payment will be refunded in full.',
      refund_note: '',
      reason: '',
    },
  };
}

async function paymentVars(ctx: AppContext, settings: SettingsState, paymentId: string) {
  const p = await ctx.db.selectFrom('payments').selectAll().where('id', '=', paymentId).executeTakeFirst();
  if (!p) return null;
  if (p.order_id) {
    const base = await orderVars(ctx, settings, p.order_id);
    if (!base) return null;
    return {
      customer_id: base.customer_id,
      order: base.order,
      payment: {
        amount: formatCents(p.amount_cents),
        for: `order ${base.order.reference}`,
        link: base.order.tracking_url,
        admin_url: base.order.admin_url,
        reason: p.failure_reason ?? '',
      },
    };
  }
  const invoice = await ctx.db.selectFrom('invoices').selectAll().where('id', '=', p.invoice_id as string).executeTakeFirst();
  if (!invoice) return null;
  const token = await mintAccessToken(ctx.db, ctx.clock, { purpose: 'invoice_access', subjectId: invoice.id, ttlMinutes: days(LINK_DAYS) });
  return {
    customer_id: invoice.customer_id,
    payment: {
      amount: formatCents(p.amount_cents),
      for: `invoice ${invoice.number}`,
      link: `${ctx.env.PUBLIC_BASE_URL}/pay/${token}`,
      admin_url: invoice.project_id ? `${ctx.env.PUBLIC_BASE_URL}/admin/weddings/projects/${invoice.project_id}` : `${ctx.env.PUBLIC_BASE_URL}/admin/customers/${invoice.customer_id}`,
      reason: p.failure_reason ?? '',
    },
  };
}

export async function inquiryVars(ctx: AppContext, settings: SettingsState, inquiryId: string) {
  const tz = settings.general.timezone;
  const i = await ctx.db.selectFrom('wedding_inquiries').selectAll().where('id', '=', inquiryId).executeTakeFirst();
  if (!i) return null;
  const token = await mintAccessToken(ctx.db, ctx.clock, { purpose: 'inquiry_access', subjectId: i.id, ttlMinutes: days(365) });
  const availability = (i.availability ?? {}) as { summary?: string };
  return {
    customer_id: i.customer_id,
    inquiry: {
      id: i.id,
      reference: i.reference,
      event_type: i.event_type,
      event_date: formatDate(i.event_date, tz),
      guest_count: i.guest_count ?? 'not given',
      venue: [i.venue_name, i.venue_address].filter(Boolean).join(', ') || 'not given',
      budget: i.budget_range ?? 'not given',
      availability_text: availability.summary ?? 'The team will confirm availability.',
      portal_url: `${ctx.env.PUBLIC_BASE_URL}/plan/${token}`,
      admin_url: `${ctx.env.PUBLIC_BASE_URL}/admin/weddings/${i.id}`,
      clarification: i.clarification_request ?? '',
      suggested_date: i.suggested_date ? formatDate(i.suggested_date, tz) : '',
      decline_reason: i.decline_reason ?? '',
    },
  };
}

async function projectFor(ctx: AppContext, inquiryId: string) {
  const project = await ctx.db.selectFrom('wedding_projects').select(['id', 'reference']).where('inquiry_id', '=', inquiryId).executeTakeFirst();
  if (!project) return { url: '' };
  const token = await mintAccessToken(ctx.db, ctx.clock, { purpose: 'project_access', subjectId: project.id, ttlMinutes: days(730) });
  return { reference: project.reference, url: `${ctx.env.PUBLIC_BASE_URL}/project/${token}` };
}

/**
 * Builds the variables for one event's messages from the current database state. Links are minted
 * here, so a message always carries a fresh, scoped, expiring token. Returns null when the subject
 * no longer exists, in which case there is nothing to say.
 */
export async function buildVariables(ctx: AppContext, settings: SettingsState, event: { type: string; subject_type: string | null; subject_id: string | null; payload: unknown }): Promise<Base | null> {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const business = {
    name: settings.contact.business_name,
    phone: formatPhone(settings.contact.phone_e164),
    address: settings.contact.address_line ?? '',
    email: settings.contact.public_email ?? '',
  };
  const base: Record<string, unknown> = { business, event: payload };
  const id = event.subject_id;
  let customerId: string | null | undefined = (payload.customer_id as string) ?? null;
  const tz = settings.general.timezone;

  const merge = (extra: Record<string, unknown> | null | undefined) => {
    if (!extra) return false;
    const { customer_id, ...rest } = extra;
    if (customer_id) customerId = customer_id as string;
    Object.assign(base, rest);
    return true;
  };

  switch (event.subject_type) {
    case 'order': {
      const v = await orderVars(ctx, settings, id as string);
      if (!merge(v)) return null;
      const order = base.order as Record<string, unknown>;
      order.reason = (payload.reason as string) ?? '';
      const refunded = (payload.refunded_cents as number) ?? 0;
      order.refund_note = refunded > 0 ? `Your payment of ${formatCents(refunded)} is being refunded.` : 'You were not charged.';
      if (event.type === 'order.approved_awaiting_payment') base.payment = { link: order.tracking_url };
      break;
    }
    case 'payment': {
      if (!merge(await paymentVars(ctx, settings, id as string))) return null;
      const payment = base.payment as Record<string, unknown>;
      if (payload.reason) payment.reason = payload.reason as string;
      break;
    }
    case 'refund': {
      const r = await ctx.db
        .selectFrom('refunds')
        .innerJoin('payments', 'payments.id', 'refunds.payment_id')
        .select(['refunds.amount_cents', 'refunds.reason', 'refunds.order_id', 'payments.invoice_id'])
        .where('refunds.id', '=', id as string)
        .executeTakeFirst();
      if (!r) return null;
      if (r.order_id) {
        const o = await ctx.db.selectFrom('orders').select(['reference', 'customer_id']).where('id', '=', r.order_id).executeTakeFirstOrThrow();
        customerId = o.customer_id;
        base.refund = { amount: formatCents(r.amount_cents), for: `order ${o.reference}`, reason: r.reason ?? '' };
      } else {
        const inv = await ctx.db.selectFrom('invoices').select(['number', 'customer_id']).where('id', '=', r.invoice_id as string).executeTakeFirstOrThrow();
        customerId = inv.customer_id;
        base.refund = { amount: formatCents(r.amount_cents), for: `invoice ${inv.number}`, reason: r.reason ?? '' };
      }
      break;
    }
    case 'inquiry': {
      if (!merge(await inquiryVars(ctx, settings, id as string))) return null;
      break;
    }
    case 'consultation': {
      const row = await ctx.db
        .selectFrom('consultations as c')
        .innerJoin('staff_profiles as s', 's.id', 'c.staff_id')
        .select(['c.inquiry_id', 'c.customer_id', 'c.starts_at', 'c.format', 's.display_name'])
        .where('c.id', '=', id as string)
        .executeTakeFirst();
      if (!row) return null;
      customerId = row.customer_id;
      base.consultation = { when: formatDateTime(row.starts_at, tz), format: row.format, staff_name: row.display_name };
      if (row.inquiry_id) merge(await inquiryVars(ctx, settings, row.inquiry_id));
      break;
    }
    case 'quote': {
      const q = await ctx.db.selectFrom('quotes').selectAll().where('id', '=', id as string).executeTakeFirst();
      if (!q) return null;
      customerId = q.customer_id;
      const token = await mintAccessToken(ctx.db, ctx.clock, { purpose: 'quote_access', subjectId: q.id, ttlMinutes: days(180) });
      base.quote = {
        reference: q.reference,
        total: formatCents(q.total_cents),
        deposit: q.deposit_cents ? formatCents(q.deposit_cents) : 'none',
        valid_until: q.valid_until ? formatDate(q.valid_until, tz) : 'until further notice',
        url: `${ctx.env.PUBLIC_BASE_URL}/quote/${token}`,
      };
      merge(await inquiryVars(ctx, settings, q.inquiry_id));
      if (event.type === 'quote.accepted') {
        const invoice = await ctx.db.selectFrom('invoices').selectAll().where('quote_id', '=', q.id).where('kind', '=', 'deposit').executeTakeFirst();
        if (invoice) {
          const payToken = await mintAccessToken(ctx.db, ctx.clock, { purpose: 'invoice_access', subjectId: invoice.id, ttlMinutes: days(LINK_DAYS) });
          base.invoice = { number: invoice.number, amount_due: formatCents(invoice.total_cents - invoice.paid_cents), due_on: invoice.due_on ? formatDate(invoice.due_on, tz) : '', url: `${ctx.env.PUBLIC_BASE_URL}/pay/${payToken}` };
        }
        const booking = await ctx.db.selectFrom('event_bookings').select('hold_expires_at').where('inquiry_id', '=', q.inquiry_id).where('status', '!=', 'cancelled').executeTakeFirst();
        base.booking = { hold_until: booking?.hold_expires_at ? formatDateTime(booking.hold_expires_at, tz) : '' };
      }
      break;
    }
    case 'booking': {
      const b = await ctx.db.selectFrom('event_bookings').select(['inquiry_id', 'event_date']).where('id', '=', id as string).executeTakeFirst();
      if (!b) return null;
      merge(await inquiryVars(ctx, settings, b.inquiry_id));
      base.project = await projectFor(ctx, b.inquiry_id);
      base.booking = { next_step: (payload.next_step as string) ?? '' };
      if (payload.amount_cents) base.payment = { amount: formatCents(payload.amount_cents as number) };
      base.event = { ...payload, days_until: payload.days_until ?? '' };
      break;
    }
    case 'milestone': {
      const m = await ctx.db
        .selectFrom('project_milestones as m')
        .innerJoin('wedding_projects as p', 'p.id', 'm.project_id')
        .select(['m.title', 'm.description', 'm.due_on', 'p.inquiry_id'])
        .where('m.id', '=', id as string)
        .executeTakeFirst();
      if (!m) return null;
      base.milestone = { title: m.title, description: m.description ?? '', due: m.due_on ? formatDate(m.due_on, tz) : '' };
      merge(await inquiryVars(ctx, settings, m.inquiry_id));
      base.project = await projectFor(ctx, m.inquiry_id);
      break;
    }
    case 'invoice': {
      const inv = await ctx.db.selectFrom('invoices').selectAll().where('id', '=', id as string).executeTakeFirst();
      if (!inv) return null;
      customerId = inv.customer_id;
      const token = await mintAccessToken(ctx.db, ctx.clock, { purpose: 'invoice_access', subjectId: inv.id, ttlMinutes: days(LINK_DAYS) });
      base.invoice = {
        number: inv.number,
        amount_due: formatCents(inv.total_cents - inv.paid_cents),
        due_on: inv.due_on ? formatDate(inv.due_on, tz) : 'on receipt',
        url: `${ctx.env.PUBLIC_BASE_URL}/pay/${token}`,
        admin_url: inv.project_id ? `${ctx.env.PUBLIC_BASE_URL}/admin/weddings/projects/${inv.project_id}` : `${ctx.env.PUBLIC_BASE_URL}/admin/customers/${inv.customer_id}`,
      };
      break;
    }
    case 'inventory_item': {
      const item = await ctx.db.selectFrom('inventory_items').select(['id', 'name', 'sku', 'unit', 'low_stock_threshold']).where('id', '=', id as string).executeTakeFirst();
      if (!item) return null;
      base.item = {
        name: item.name,
        sku: item.sku,
        unit: item.unit,
        available: payload.available ?? '',
        threshold: item.low_stock_threshold ?? '',
        admin_url: `${ctx.env.PUBLIC_BASE_URL}/admin/inventory/items/${item.id}`,
      };
      break;
    }
    case 'support': {
      const s = await ctx.db.selectFrom('support_requests').selectAll().where('id', '=', id as string).executeTakeFirst();
      if (!s) return null;
      customerId = s.customer_id;
      base.support = {
        reference: s.reference,
        name: s.name,
        email: s.email,
        topic: s.topic,
        message: s.message,
        admin_url: `${ctx.env.PUBLIC_BASE_URL}/admin/customers/messages/${s.id}`,
      };
      break;
    }
    case 'rental_reservation': {
      const r = await ctx.db
        .selectFrom('rental_reservations as r')
        .innerJoin('rental_items as i', 'i.id', 'r.rental_item_id')
        .select(['r.quantity', 'r.ends_at', 'i.name'])
        .where('r.id', '=', id as string)
        .executeTakeFirst();
      if (!r) return null;
      base.rental = { name: r.name, quantity: r.quantity, due: formatDateTime(r.ends_at, tz), admin_url: `${ctx.env.PUBLIC_BASE_URL}/admin/rentals` };
      break;
    }
    case 'job': {
      base.job = { kind: payload.kind ?? '', attempts: payload.attempts ?? '', error: payload.error ?? '', admin_url: `${ctx.env.PUBLIC_BASE_URL}/admin/system/jobs` };
      break;
    }
    case 'customer': {
      customerId = id;
      break;
    }
    case 'cart': {
      customerId = (payload.customer_id as string) ?? null;
      base.cart = { url: `${ctx.env.PUBLIC_BASE_URL}/cart` };
      break;
    }
  }

  if (customerId) {
    const customer = await customerVars(ctx.db, customerId);
    if (customer) {
      base.customer = customer;
      if (event.subject_type === 'customer' || event.subject_type === 'cart') {
        const token = await mintAccessToken(ctx.db, ctx.clock, { purpose: 'preferences', subjectId: customerId, ttlMinutes: days(365) });
        base.preferences = { url: `${ctx.env.PUBLIC_BASE_URL}/preferences/${token}` };
      }
    }
  }
  return { customer_id: customerId, vars: base };
}
