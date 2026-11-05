import { sql } from 'kysely';
import type { AppContext } from '../../context.js';
import type { Db, Trx } from '../../db/client.js';
import { audit, SYSTEM_ACTOR, type Actor } from '../../lib/audit.js';
import { conflict, notFound, badRequest } from '../../lib/errors.js';
import { addDays, addHours, atLocal, localDate } from '../../lib/time.js';
import { emit, raiseAlert } from '../../automation/events.js';
import { loadSettings } from '../settings/service.js';
import { reserveBookingResources, eventTimes } from './availability.js';
import { moveToStage } from './pipeline.js';

export async function nextInvoiceNumber(trx: Db, clock: { now(): Date }) {
  const year = clock.now().getUTCFullYear();
  const prefix = `INV-${year}-`;
  await sql`SELECT pg_advisory_xact_lock(hashtext(${`invoice-number:${year}`}))`.execute(trx);
  const last = await trx.selectFrom('invoices').select('number').where('number', 'like', `${prefix}%`).orderBy('number', 'desc').executeTakeFirst();
  const next = last ? Number(last.number.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(next).padStart(4, '0')}`;
}

export async function createInvoice(
  trx: Db,
  ctx: Pick<AppContext, 'clock' | 'payments'>,
  input: {
    customer_id: string;
    project_id?: string | null;
    quote_id?: string | null;
    order_id?: string | null;
    kind: 'deposit' | 'balance' | 'custom';
    lines: Array<{ description: string; quantity: number; unit_price_cents: number }>;
    tax_cents?: number;
    due_on?: string | null;
    notes?: string | null;
    status?: 'draft' | 'sent';
    actor: Actor;
  },
) {
  const subtotal = input.lines.reduce((s, l) => s + l.quantity * l.unit_price_cents, 0);
  const tax = input.tax_cents ?? 0;
  const number = await nextInvoiceNumber(trx, ctx.clock);
  const invoice = await trx
    .insertInto('invoices')
    .values({
      number,
      customer_id: input.customer_id,
      project_id: input.project_id ?? null,
      quote_id: input.quote_id ?? null,
      order_id: input.order_id ?? null,
      kind: input.kind,
      status: input.status ?? 'draft',
      subtotal_cents: subtotal,
      tax_cents: tax,
      total_cents: subtotal + tax,
      due_on: input.due_on ?? null,
      notes: input.notes ?? null,
      sent_at: input.status === 'sent' ? ctx.clock.now() : null,
      created_by: input.actor.id ?? null,
      is_test: !ctx.payments.livemode,
    })
    .returning(['id', 'number', 'total_cents'])
    .executeTakeFirstOrThrow();
  await trx
    .insertInto('invoice_line_items')
    .values(input.lines.map((l, i) => ({ invoice_id: invoice.id, description: l.description, quantity: l.quantity, unit_price_cents: l.unit_price_cents, total_cents: l.quantity * l.unit_price_cents, sort_order: i })))
    .execute();
  await audit(trx, input.actor, 'invoice.create', { type: 'invoice', id: invoice.id }, { total_cents: invoice.total_cents, kind: input.kind });
  return invoice;
}

export async function invoiceCheckoutDetails(db: Db, invoiceId: string, amount: number) {
  const inv = await db
    .selectFrom('invoices as i')
    .innerJoin('customers as c', 'c.id', 'i.customer_id')
    .select(['i.number', 'i.kind', 'c.email'])
    .where('i.id', '=', invoiceId)
    .executeTakeFirstOrThrow();
  const label = inv.kind === 'deposit' ? 'Event deposit' : inv.kind === 'balance' ? 'Event balance' : 'Invoice';
  return {
    email: inv.email,
    description: `${label} ${inv.number}`,
    reference: inv.number,
    currency: 'usd',
    lines: [{ name: `${label}, invoice ${inv.number}`, amount_cents: amount }],
  };
}

/** Called from the payment path. Paying a deposit is what can move a booking to confirmed. */
export async function applyInvoicePayment(ctx: AppContext, trx: Trx, invoiceId: string, amount: number, paymentId: string) {
  const invoice = await trx.selectFrom('invoices').selectAll().where('id', '=', invoiceId).forUpdate().executeTakeFirst();
  if (!invoice) return;
  const paid = invoice.paid_cents + amount;
  const full = paid >= invoice.total_cents;
  await trx
    .updateTable('invoices')
    .set({ paid_cents: paid, status: full ? 'paid' : 'partially_paid', paid_at: full ? ctx.clock.now() : null })
    .where('id', '=', invoiceId)
    .execute();
  if (paid > invoice.total_cents) {
    await raiseAlert(trx, { code: 'invoice_overpaid', title: `Invoice ${invoice.number} was overpaid`, detail: `Paid ${paid} of ${invoice.total_cents} cents.`, subject: { type: 'invoice', id: invoiceId }, dedupeKey: `overpaid:${invoiceId}` });
  }
  await emit(trx, 'payment.succeeded', { type: 'payment', id: paymentId }, { amount_cents: amount }, `payment-succeeded:${paymentId}`);
  if (full) await trx.updateTable('payment_schedule_items').set({ status: 'paid' }).where('invoice_id', '=', invoiceId).execute();

  if (invoice.project_id) {
    const project = await trx
      .selectFrom('wedding_projects')
      .select(['id', 'booking_id', 'contract_status', 'status'])
      .where('id', '=', invoice.project_id)
      .executeTakeFirst();
    if (project && invoice.kind === 'deposit' && full) {
      const pending = project.status === 'pending' && project.contract_status !== 'not_required' && project.contract_status !== 'signed';
      if (project.booking_id) {
        await emit(trx, 'booking.deposit_received', { type: 'booking', id: project.booking_id }, {
          amount_cents: amount,
          next_step: pending ? 'Your date is held. The last step is your signed contract, and then your booking is confirmed.' : 'Your booking is now being confirmed.',
        }, `deposit-received:${invoiceId}`);
      }
      await tryConfirmBooking(ctx, trx, project.id, SYSTEM_ACTOR);
    }
  }
}

/** A refund lowers what counts as paid. A confirmed booking is never undone automatically: a person decides. */
export async function revertInvoicePayment(ctx: AppContext, trx: Db, invoiceId: string, delta: number) {
  const invoice = await trx.selectFrom('invoices').selectAll().where('id', '=', invoiceId).forUpdate().executeTakeFirst();
  if (!invoice) return;
  const paid = Math.max(0, invoice.paid_cents - delta);
  await trx
    .updateTable('invoices')
    .set({ paid_cents: paid, status: paid >= invoice.total_cents ? 'paid' : paid > 0 ? 'partially_paid' : 'sent', paid_at: paid >= invoice.total_cents ? invoice.paid_at : null })
    .where('id', '=', invoiceId)
    .execute();
  if (invoice.project_id && delta > 0) {
    await raiseAlert(trx, {
      code: 'project_payment_refunded',
      title: `A payment on invoice ${invoice.number} was refunded`,
      detail: 'Check whether this booking should stay confirmed.',
      link: `/admin/weddings/projects/${invoice.project_id}`,
      dedupeKey: `project-refund:${invoiceId}:${ctx.clock.now().getTime()}`,
    });
  }
}

/**
 * The single gate to "confirmed": the quote is accepted, the deposit is fully paid, and any required
 * contract is signed. Resources are converted from a hold to a firm reservation here, and if the hold
 * lapsed, they are rechecked rather than assumed. Project records are generated exactly once.
 */
export async function tryConfirmBooking(ctx: AppContext, trx: Trx, projectId: string, actor: Actor): Promise<'confirmed' | 'waiting' | 'conflict'> {
  const project = await trx.selectFrom('wedding_projects').selectAll().where('id', '=', projectId).forUpdate().executeTakeFirst();
  if (!project) throw notFound('Project not found.');
  if (project.status !== 'pending') return 'confirmed';
  const contractOk = project.contract_status === 'not_required' || project.contract_status === 'signed';
  if (!contractOk) return 'waiting';
  const deposits = await trx.selectFrom('invoices').select(['total_cents', 'paid_cents']).where('project_id', '=', projectId).where('kind', '=', 'deposit').where('status', '!=', 'void').execute();
  if (deposits.some((d) => d.paid_cents < d.total_cents)) return 'waiting';
  if (!project.booking_id) return 'waiting';

  const booking = await trx.selectFrom('event_bookings').selectAll().where('id', '=', project.booking_id).forUpdate().executeTakeFirstOrThrow();
  const inquiry = await trx.selectFrom('wedding_inquiries').selectAll().where('id', '=', project.inquiry_id).executeTakeFirstOrThrow();
  const settings = await loadSettings(trx);
  const now = ctx.clock.now();

  const lapsed = booking.status !== 'hold' || (booking.hold_expires_at && booking.hold_expires_at <= now);
  if (lapsed && booking.status !== 'approved') {
    // Money has arrived but the hold has gone. Try again, and hand it to a person if the date is taken.
    const lines = await trx.selectFrom('quote_line_items').select(['rental_item_id', 'quantity']).where('quote_id', '=', project.quote_id as string).execute();
    const rentals = lines.filter((l) => l.rental_item_id).map((l) => ({ rental_item_id: l.rental_item_id as string, quantity: l.quantity }));
    const times = eventTimes(settings, inquiry.event_date, inquiry.ceremony_time, inquiry.reception_time);
    await trx.executeQuery(sql`SAVEPOINT rehold`.compile(trx));
    try {
      await reserveBookingResources(trx, ctx.clock, booking, { status: 'confirmed', holdExpiresAt: null, times, rentals });
      await trx.executeQuery(sql`RELEASE SAVEPOINT rehold`.compile(trx));
    } catch {
      await trx.executeQuery(sql`ROLLBACK TO SAVEPOINT rehold`.compile(trx));
      await emit(trx, 'booking.conflict', { type: 'booking', id: booking.id }, { note: 'A deposit was paid after the hold expired, and the date is no longer free. Please contact the customer: offer another date or refund the deposit.' }, `booking-conflict:${booking.id}`);
      await raiseAlert(trx, {
        code: 'booking_conflict',
        severity: 'critical',
        title: 'Deposit paid but the date is no longer free',
        detail: `Event on ${inquiry.event_date}. Contact the customer: offer another date or refund the deposit.`,
        subject: { type: 'project', id: projectId },
        link: `/admin/weddings/projects/${projectId}`,
        dedupeKey: `booking-conflict:${booking.id}`,
      });
      return 'conflict';
    }
  } else {
    await trx.updateTable('resource_reservations').set({ status: 'confirmed', hold_expires_at: null }).where('booking_id', '=', booking.id).where('status', 'in', ['hold', 'approved']).execute();
    await trx.updateTable('rental_reservations').set({ status: 'confirmed', hold_expires_at: null }).where('booking_id', '=', booking.id).where('status', 'in', ['hold', 'approved']).execute();
  }

  await trx.updateTable('event_bookings').set({ status: 'confirmed', hold_expires_at: null }).where('id', '=', booking.id).execute();
  await trx.updateTable('wedding_projects').set({ status: 'confirmed', confirmed_at: now }).where('id', '=', projectId).execute();
  await trx.updateTable('wedding_inquiries').set({ status: 'converted' }).where('id', '=', project.inquiry_id).execute();
  await moveToStage(trx, project.inquiry_id, 'confirmed');
  await generateProjectRecords(ctx, trx, { projectId, inquiry, bookingStart: booking.event_start, bookingEnd: booking.event_end, quoteId: project.quote_id, customerId: project.customer_id }, actor);
  await emit(trx, 'booking.confirmed', { type: 'booking', id: booking.id }, {}, `booking-confirmed:${booking.id}`);
  await audit(trx, actor, 'booking.confirm', { type: 'project', id: projectId });
  return 'confirmed';
}

async function generateProjectRecords(
  ctx: AppContext,
  trx: Trx,
  input: { projectId: string; inquiry: { id: string; event_date: string; reference: string }; bookingStart: Date; bookingEnd: Date; quoteId: string | null; customerId: string },
  actor: Actor,
) {
  const settings = await loadSettings(trx);
  const tz = settings.general.timezone;
  const division = await trx.selectFrom('business_divisions').select('id').where('code', '=', 'events').executeTakeFirst();
  const templates = await trx.selectFrom('task_templates').selectAll().where('scope', '=', 'wedding_project').where('active', '=', true).orderBy('sort_order').execute();
  for (const t of templates) {
    const due = addDays(input.inquiry.event_date, t.offset_days, tz);
    let dueAt = atLocal(due, '09:00', tz);
    if (t.code === 'project.setup') dueAt = input.bookingStart;
    if (t.code === 'project.teardown') dueAt = input.bookingEnd;
    await trx
      .insertInto('staff_tasks')
      .values({
        title: t.title,
        description: `Event ${input.inquiry.reference} on ${input.inquiry.event_date}`,
        division_id: division?.id ?? null,
        required_capability: t.required_capability,
        due_at: dueAt,
        est_minutes: t.est_minutes,
        subject_type: 'project',
        subject_id: input.projectId,
        source_key: `project:${input.projectId}:${t.code}`,
      })
      .onConflict((oc) => oc.column('source_key').doNothing())
      .execute();
    if (t.customer_visible_milestone && due >= localDate(ctx.clock.now(), tz)) {
      await trx
        .insertInto('project_milestones')
        .values({ project_id: input.projectId, title: t.description ?? t.title, description: t.title, due_on: due, sort_order: t.sort_order, source_key: t.code })
        .onConflict((oc) => oc.columns(['project_id', 'source_key']).doNothing())
        .execute();
    }
  }
  await trx
    .insertInto('project_milestones')
    .values({ project_id: input.projectId, title: 'Your event', due_on: input.inquiry.event_date, sort_order: 1000, source_key: 'event' })
    .onConflict((oc) => oc.columns(['project_id', 'source_key']).doNothing())
    .execute();

  // Materials: services with a recipe add up across the whole event and feed the purchasing list.
  if (input.quoteId) {
    const rows = await trx
      .selectFrom('quote_line_items as l')
      .innerJoin('wedding_services as s', 's.id', 'l.service_id')
      .innerJoin('recipe_components as c', 'c.recipe_id', 's.recipe_id')
      .select(['c.item_id', 'c.quantity as per_unit', 'l.quantity'])
      .where('l.quote_id', '=', input.quoteId)
      .execute();
    const totals = new Map<string, number>();
    for (const r of rows) totals.set(r.item_id, (totals.get(r.item_id) ?? 0) + r.per_unit * r.quantity);
    const neededBy = addDays(input.inquiry.event_date, -settings.events.prep_days, tz);
    for (const [item_id, quantity] of totals) {
      await trx
        .insertInto('project_materials')
        .values({ project_id: input.projectId, item_id, quantity, needed_by: neededBy })
        .onConflict((oc) => oc.columns(['project_id', 'item_id']).doUpdateSet({ quantity, needed_by: neededBy }))
        .execute();
    }
  }

  // Balance invoice exists from now on, so the customer can pay early. The reminder sweep emails it later.
  const quote = input.quoteId ? await trx.selectFrom('quotes').select(['total_cents', 'deposit_cents']).where('id', '=', input.quoteId).executeTakeFirst() : null;
  const balance = quote ? quote.total_cents - quote.deposit_cents : 0;
  const scheduled = await trx.selectFrom('payment_schedule_items').select(['id', 'due_on']).where('project_id', '=', input.projectId).where('label', '=', 'Balance').where('status', '=', 'scheduled').executeTakeFirst();
  if (balance > 0 && scheduled) {
    const invoice = await createInvoice(trx, ctx, {
      customer_id: input.customerId,
      project_id: input.projectId,
      quote_id: input.quoteId,
      kind: 'balance',
      lines: [{ description: `Balance for your event on ${input.inquiry.event_date}`, quantity: 1, unit_price_cents: balance }],
      due_on: scheduled.due_on,
      status: 'sent',
      actor,
    });
    await trx.updateTable('payment_schedule_items').set({ invoice_id: invoice.id, status: 'invoiced' }).where('id', '=', scheduled.id).execute();
  }
}

export async function markContractSigned(ctx: AppContext, projectId: string, actor: Actor) {
  return ctx.db.transaction().execute(async (trx) => {
    const project = await trx.selectFrom('wedding_projects').select(['id', 'contract_status']).where('id', '=', projectId).forUpdate().executeTakeFirst();
    if (!project) throw notFound('Project not found.');
    await trx.updateTable('wedding_projects').set({ contract_status: 'signed', contract_signed_at: ctx.clock.now() }).where('id', '=', projectId).execute();
    await audit(trx, actor, 'contract.signed', { type: 'project', id: projectId });
    return tryConfirmBooking(ctx, trx, projectId, actor);
  });
}

/** Sweep: lapsed holds give their crews and rentals back. The inquiry stays open for the team. */
export async function expireBookingHolds(ctx: AppContext) {
  const now = ctx.clock.now();
  const due = await ctx.db.selectFrom('event_bookings').select(['id', 'inquiry_id']).where('status', '=', 'hold').where('hold_expires_at', '<', now).limit(100).execute();
  for (const b of due) {
    await ctx.db.transaction().execute(async (trx) => {
      const locked = await trx.selectFrom('event_bookings').select(['status', 'hold_expires_at']).where('id', '=', b.id).forUpdate().executeTakeFirstOrThrow();
      if (locked.status !== 'hold' || !locked.hold_expires_at || locked.hold_expires_at >= now) return;
      await trx.updateTable('resource_reservations').set({ status: 'released' }).where('booking_id', '=', b.id).where('status', '=', 'hold').execute();
      await trx.updateTable('rental_reservations').set({ status: 'cancelled' }).where('booking_id', '=', b.id).where('status', '=', 'hold').execute();
      await trx.updateTable('event_bookings').set({ status: 'inquiry', hold_expires_at: null }).where('id', '=', b.id).execute();
      await raiseAlert(trx, {
        code: 'booking_hold_expired',
        title: 'A date hold expired without a deposit',
        detail: 'The crews and rentals were released. Follow up with the customer.',
        subject: { type: 'inquiry', id: b.inquiry_id },
        link: `/admin/weddings/${b.inquiry_id}`,
        dedupeKey: `hold-expired:${b.id}:${now.toISOString().slice(0, 10)}`,
      });
      await audit(trx, SYSTEM_ACTOR, 'booking.hold_expired', { type: 'booking', id: b.id });
    });
  }
  return { expired: due.length };
}

export async function publicInvoiceView(ctx: AppContext, invoiceId: string) {
  const inv = await ctx.db.selectFrom('invoices').select(['number', 'kind', 'status', 'subtotal_cents', 'tax_cents', 'total_cents', 'paid_cents', 'due_on', 'notes', 'is_test', 'project_id']).where('id', '=', invoiceId).executeTakeFirst();
  if (!inv || inv.status === 'draft') throw notFound('This invoice could not be found.');
  const lines = await ctx.db.selectFrom('invoice_line_items').select(['id', 'description', 'quantity', 'unit_price_cents', 'total_cents']).where('invoice_id', '=', invoiceId).orderBy('sort_order').execute();
  return { ...inv, project_id: undefined, amount_due_cents: Math.max(0, inv.total_cents - inv.paid_cents), lines, can_pay: inv.status !== 'void' && inv.paid_cents < inv.total_cents, payments_enabled: ctx.payments.name !== 'disabled' };
}

/** Starts payment for an invoice. Partial payment is allowed, but a deposit must be paid in full to confirm a booking. */
export async function startInvoicePayment(ctx: AppContext, invoiceId: string, token: string, amountCents?: number | null) {
  const { ensureCheckoutSession } = await import('../payments/service.js');
  const payment = await ctx.db.transaction().execute(async (trx) => {
    const inv = await trx.selectFrom('invoices').selectAll().where('id', '=', invoiceId).forUpdate().executeTakeFirst();
    if (!inv || inv.status === 'draft') throw notFound('This invoice could not be found.');
    if (inv.status === 'void') throw conflict('invoice_void', 'This invoice has been cancelled.');
    const due = inv.total_cents - inv.paid_cents;
    if (due <= 0) throw conflict('already_paid', 'This invoice is already paid.');
    const amount = amountCents ?? due;
    if (amount <= 0 || amount > due) throw badRequest(`Please enter an amount up to $${(due / 100).toFixed(2)}.`);
    const open = await trx
      .selectFrom('payments')
      .select(['id', 'amount_cents', 'session_expires_at'])
      .where('invoice_id', '=', invoiceId)
      .where('status', '=', 'pending')
      .orderBy('created_at', 'desc')
      .executeTakeFirst();
    if (open && open.amount_cents === amount && open.session_expires_at && open.session_expires_at > addHours(ctx.clock.now(), 0.1)) return open;
    if (open) await trx.updateTable('payments').set({ status: 'cancelled' }).where('id', '=', open.id).execute();
    return trx
      .insertInto('payments')
      .values({
        invoice_id: invoiceId,
        gateway: ctx.payments.name === 'stripe' ? 'stripe' : 'mock',
        kind: inv.kind === 'deposit' ? 'deposit' : inv.kind === 'balance' ? 'balance' : 'invoice',
        amount_cents: amount,
        session_expires_at: addHours(ctx.clock.now(), 2),
        livemode: ctx.payments.livemode,
      })
      .returning(['id', 'amount_cents', 'session_expires_at'])
      .executeTakeFirstOrThrow();
  });
  return ensureCheckoutSession(ctx, payment.id, token);
}

export async function publicProjectView(ctx: AppContext, projectId: string) {
  const p = await ctx.db
    .selectFrom('wedding_projects as p')
    .innerJoin('wedding_inquiries as i', 'i.id', 'p.inquiry_id')
    .leftJoin('event_bookings as b', 'b.id', 'p.booking_id')
    .select(['p.id', 'p.reference', 'p.status', 'p.contract_status', 'p.confirmed_at', 'i.event_date', 'i.event_type', 'i.venue_name', 'i.venue_address', 'i.guest_count', 'b.status as booking_status', 'b.hold_expires_at', 'b.event_start'])
    .where('p.id', '=', projectId)
    .executeTakeFirst();
  if (!p) throw notFound('This project could not be found.');
  const milestones = await ctx.db.selectFrom('project_milestones').select(['id', 'title', 'description', 'due_on', 'status']).where('project_id', '=', projectId).where('customer_visible', '=', true).orderBy('due_on').execute();
  const invoices = await ctx.db.selectFrom('invoices').select(['id', 'number', 'kind', 'status', 'total_cents', 'paid_cents', 'due_on']).where('project_id', '=', projectId).where('status', '!=', 'draft').orderBy('created_at').execute();
  const schedule = await ctx.db.selectFrom('payment_schedule_items').select(['id', 'label', 'amount_cents', 'due_on', 'status', 'invoice_id']).where('project_id', '=', projectId).orderBy('sort_order').execute();
  const documents = await ctx.db.selectFrom('wedding_documents').select(['id', 'filename', 'kind', 'mime_type']).where('project_id', '=', projectId).where('customer_visible', '=', true).execute();
  const { mintAccessToken } = await import('../../lib/tokens.js');
  const payable = [];
  for (const inv of invoices) {
    const due = inv.total_cents - inv.paid_cents;
    payable.push({
      number: inv.number,
      kind: inv.kind,
      status: inv.status,
      total_cents: inv.total_cents,
      paid_cents: inv.paid_cents,
      amount_due_cents: Math.max(0, due),
      due_on: inv.due_on,
      pay_token: due > 0 && inv.status !== 'void' ? await mintAccessToken(ctx.db, ctx.clock, { purpose: 'invoice_access', subjectId: inv.id, ttlMinutes: 60 * 24 * 30 }) : null,
    });
  }
  return {
    reference: p.reference,
    status: p.status,
    contract_status: p.contract_status,
    event_date: p.event_date,
    event_type: p.event_type,
    venue_name: p.venue_name,
    venue_address: p.venue_address,
    guest_count: p.guest_count,
    booking_status: p.booking_status,
    hold_expires_at: p.hold_expires_at,
    event_start: p.event_start,
    milestones,
    invoices: payable,
    schedule: schedule.map((s) => ({ ...s, invoice_id: undefined })),
    documents,
  };
}
