import { z } from 'zod';
import type { AppContext } from '../../context.js';
import type { Db } from '../../db/client.js';
import { audit, type Actor } from '../../lib/audit.js';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors.js';
import { applyBps } from '../../lib/money.js';
import { generateReference } from '../../lib/tokens.js';
import { addDays, addHours, localDate } from '../../lib/time.js';
import { emit } from '../../automation/events.js';
import { loadSettings } from '../settings/service.js';
import { eventTimes, reserveBookingResources } from './availability.js';
import { createInvoice, tryConfirmBooking } from './billing.js';
import { moveToStage } from './pipeline.js';

export const quoteLineSchema = z.object({
  service_id: z.string().uuid().optional().nullable(),
  rental_item_id: z.string().uuid().optional().nullable(),
  description: z.string().trim().min(1, 'Each line needs a description.').max(300),
  quantity: z.number().int().min(1).max(100000),
  unit_price_cents: z.number().int().min(0).max(100_000_000),
  taxable: z.boolean().default(true),
});

export const quoteSchema = z.object({
  lines: z.array(quoteLineSchema).min(1, 'Add at least one line.').max(200),
  discount_cents: z.number().int().min(0).default(0),
  deposit_cents: z.number().int().min(0).default(0),
  valid_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  terms: z.string().max(10_000).optional().nullable(),
  customer_message: z.string().max(4000).optional().nullable(),
  internal_notes: z.string().max(4000).optional().nullable(),
  requires_contract: z.boolean().optional(),
});

export type QuoteInput = z.output<typeof quoteSchema>;

function totalsFor(input: QuoteInput, rateBps: number | undefined) {
  const subtotal = input.lines.reduce((s, l) => s + l.quantity * l.unit_price_cents, 0);
  if (input.discount_cents > subtotal) throw badRequest('The discount is larger than the subtotal.');
  const taxableBase = input.lines.filter((l) => l.taxable).reduce((s, l) => s + l.quantity * l.unit_price_cents, 0);
  const discountShare = subtotal > 0 ? Math.round((input.discount_cents * taxableBase) / subtotal) : 0;
  const hasTaxable = input.lines.some((l) => l.taxable) && taxableBase > 0;
  if (hasTaxable && rateBps === undefined) throw conflict('tax_not_configured', 'Set the sales tax rate in Settings before sending a quote with taxable lines.');
  const tax = applyBps(taxableBase - discountShare, rateBps ?? 0);
  const total = subtotal - input.discount_cents + tax;
  if (input.deposit_cents > total) throw badRequest('The deposit is larger than the total.');
  return { subtotal, tax, total };
}

async function writeLines(trx: Db, quoteId: string, input: QuoteInput) {
  await trx.deleteFrom('quote_line_items').where('quote_id', '=', quoteId).execute();
  await trx
    .insertInto('quote_line_items')
    .values(
      input.lines.map((l, i) => ({
        quote_id: quoteId,
        service_id: l.service_id ?? null,
        rental_item_id: l.rental_item_id ?? null,
        description: l.description,
        quantity: l.quantity,
        unit_price_cents: l.unit_price_cents,
        total_cents: l.quantity * l.unit_price_cents,
        taxable: l.taxable,
        sort_order: i,
      })),
    )
    .execute();
}

export async function createQuote(ctx: AppContext, inquiryId: string, input: QuoteInput, actor: Actor) {
  const settings = await loadSettings(ctx.db);
  const totals = totalsFor(input, settings.tax.rates_bps.standard);
  return ctx.db.transaction().execute(async (trx) => {
    const inquiry = await trx.selectFrom('wedding_inquiries').select(['id', 'customer_id']).where('id', '=', inquiryId).forUpdate().executeTakeFirst();
    if (!inquiry) throw notFound('Inquiry not found.');
    const last = await trx.selectFrom('quotes').select('version').where('inquiry_id', '=', inquiryId).orderBy('version', 'desc').executeTakeFirst();
    const today = localDate(ctx.clock.now(), settings.general.timezone);
    const quote = await trx
      .insertInto('quotes')
      .values({
        reference: generateReference('QT'),
        inquiry_id: inquiryId,
        customer_id: inquiry.customer_id,
        version: (last?.version ?? 0) + 1,
        subtotal_cents: totals.subtotal,
        discount_cents: input.discount_cents,
        tax_cents: totals.tax,
        total_cents: totals.total,
        deposit_cents: input.deposit_cents,
        valid_until: input.valid_until ?? addDays(today, settings.events.quote_valid_days, settings.general.timezone),
        terms: input.terms ?? settings.events.cancellation_policy,
        customer_message: input.customer_message ?? null,
        internal_notes: input.internal_notes ?? null,
        requires_contract: input.requires_contract ?? settings.events.requires_contract,
        created_by: actor.id ?? null,
      })
      .returning(['id', 'reference'])
      .executeTakeFirstOrThrow();
    await writeLines(trx, quote.id, input);
    await audit(trx, actor, 'quote.create', { type: 'quote', id: quote.id }, { total_cents: totals.total });
    return quote;
  });
}

export async function updateDraftQuote(ctx: AppContext, quoteId: string, input: QuoteInput, actor: Actor) {
  const settings = await loadSettings(ctx.db);
  const totals = totalsFor(input, settings.tax.rates_bps.standard);
  await ctx.db.transaction().execute(async (trx) => {
    const q = await trx.selectFrom('quotes').select(['status']).where('id', '=', quoteId).forUpdate().executeTakeFirst();
    if (!q) throw notFound('Quote not found.');
    if (q.status !== 'draft') throw conflict('quote_locked', 'A sent quote cannot be edited. Create a new version instead.');
    await trx
      .updateTable('quotes')
      .set({
        subtotal_cents: totals.subtotal,
        discount_cents: input.discount_cents,
        tax_cents: totals.tax,
        total_cents: totals.total,
        deposit_cents: input.deposit_cents,
        valid_until: input.valid_until ?? null,
        terms: input.terms ?? null,
        customer_message: input.customer_message ?? null,
        internal_notes: input.internal_notes ?? null,
        ...(input.requires_contract !== undefined ? { requires_contract: input.requires_contract } : {}),
      })
      .where('id', '=', quoteId)
      .execute();
    await writeLines(trx, quoteId, input);
    await audit(trx, actor, 'quote.update', { type: 'quote', id: quoteId }, { total_cents: totals.total });
  });
}

export async function sendQuote(ctx: AppContext, quoteId: string, actor: Actor) {
  await ctx.db.transaction().execute(async (trx) => {
    const q = await trx.selectFrom('quotes').select(['id', 'status', 'inquiry_id', 'total_cents']).where('id', '=', quoteId).forUpdate().executeTakeFirst();
    if (!q) throw notFound('Quote not found.');
    if (q.status !== 'draft') throw conflict('quote_locked', 'This quote has already been sent.');
    if (q.total_cents <= 0) throw badRequest('This quote has no total yet.');
    await trx.updateTable('quotes').set({ status: 'superseded' }).where('inquiry_id', '=', q.inquiry_id).where('status', '=', 'sent').execute();
    await trx.updateTable('quotes').set({ status: 'sent', sent_at: ctx.clock.now() }).where('id', '=', quoteId).execute();
    await moveToStage(trx, q.inquiry_id, 'quote_sent', { onlyFrom: ['new_inquiry', 'consultation_scheduled', 'planning', 'quote_sent'] });
    await emit(trx, 'quote.sent', { type: 'quote', id: quoteId });
    await audit(trx, actor, 'quote.send', { type: 'quote', id: quoteId });
  });
}

export async function publicQuoteView(ctx: AppContext, quoteId: string) {
  const q = await ctx.db
    .selectFrom('quotes as q')
    .innerJoin('wedding_inquiries as i', 'i.id', 'q.inquiry_id')
    .select(['q.id', 'q.reference', 'q.status', 'q.subtotal_cents', 'q.discount_cents', 'q.tax_cents', 'q.total_cents', 'q.deposit_cents', 'q.valid_until', 'q.terms', 'q.customer_message', 'q.requires_contract', 'q.accepted_at', 'q.accepted_name', 'i.event_date', 'i.event_type', 'i.venue_name', 'i.reference as inquiry_reference'])
    .where('q.id', '=', quoteId)
    .executeTakeFirst();
  if (!q) throw notFound('Quote not found.');
  if (q.status === 'draft') throw notFound('Quote not found.');
  const lines = await ctx.db.selectFrom('quote_line_items').select(['id', 'description', 'quantity', 'unit_price_cents', 'total_cents', 'taxable']).where('quote_id', '=', quoteId).orderBy('sort_order').execute();
  const settings = await loadSettings(ctx.db);
  const today = localDate(ctx.clock.now(), settings.general.timezone);
  const expired = q.status === 'sent' && Boolean(q.valid_until && q.valid_until < today);
  return { ...q, id: undefined, status: expired ? 'expired' : q.status, lines, can_accept: q.status === 'sent' && !expired, tax_label: settings.tax.label };
}

/**
 * The customer says yes. This is the moment real resources are taken, so availability is rechecked
 * inside the transaction. If the date has since gone, nothing is charged, the quote stays open, and a
 * person gets an alert. Accepting does not confirm the booking: that needs the deposit and any contract.
 */
export async function acceptQuote(ctx: AppContext, quoteId: string, input: { name: string; ip?: string | null }, actor: Actor) {
  const settings = await loadSettings(ctx.db);
  const tz = settings.general.timezone;
  let inquiryIdForAlert: string | null = null;
  let bookingIdForAlert: string | null = null;
  try {
    return await ctx.db.transaction().execute(async (trx) => {
      const q = await trx.selectFrom('quotes').selectAll().where('id', '=', quoteId).forUpdate().executeTakeFirst();
      if (!q) throw notFound('Quote not found.');
      if (q.status === 'accepted') return { status: 'already_accepted' as const };
      if (q.status !== 'sent') throw conflict('quote_closed', 'This quote is no longer open. Please contact the shop.');
      const today = localDate(ctx.clock.now(), tz);
      if (q.valid_until && q.valid_until < today) throw conflict('quote_expired', 'This quote has expired. Please contact the shop for a new one.');
      inquiryIdForAlert = q.inquiry_id;

      const inquiry = await trx.selectFrom('wedding_inquiries').selectAll().where('id', '=', q.inquiry_id).forUpdate().executeTakeFirstOrThrow();
      const booking = await trx.selectFrom('event_bookings').selectAll().where('inquiry_id', '=', q.inquiry_id).where('status', '!=', 'cancelled').forUpdate().executeTakeFirst();
      if (!booking) throw conflict('booking_missing', 'This event has no booking on file. Please contact the shop.');
      bookingIdForAlert = booking.id;

      const lines = await trx.selectFrom('quote_line_items').select(['rental_item_id', 'quantity']).where('quote_id', '=', quoteId).execute();
      const rentals = lines.filter((l) => l.rental_item_id).map((l) => ({ rental_item_id: l.rental_item_id as string, quantity: l.quantity }));
      const times = eventTimes(settings, inquiry.event_date, inquiry.ceremony_time, inquiry.reception_time);
      const holdUntil = addHours(ctx.clock.now(), settings.events.hold_days_after_acceptance * 24);

      await reserveBookingResources(trx, ctx.clock, { id: booking.id, event_date: booking.event_date, crews_required: booking.crews_required, event_start: booking.event_start, event_end: booking.event_end }, { status: 'hold', holdExpiresAt: holdUntil, times, rentals });
      await trx.updateTable('event_bookings').set({ status: 'hold', hold_expires_at: holdUntil }).where('id', '=', booking.id).execute();
      await trx
        .updateTable('quotes')
        .set({ status: 'accepted', accepted_at: ctx.clock.now(), accepted_name: input.name, accepted_ip: input.ip ?? null })
        .where('id', '=', quoteId)
        .execute();
      await trx.updateTable('wedding_inquiries').set({ status: 'accepted' }).where('id', '=', q.inquiry_id).execute();

      const { generateReference: gen } = await import('../../lib/tokens.js');
      const project = await trx
        .insertInto('wedding_projects')
        .values({
          reference: gen('PR'),
          inquiry_id: q.inquiry_id,
          customer_id: q.customer_id,
          booking_id: booking.id,
          quote_id: q.id,
          status: 'pending',
          contract_status: q.requires_contract ? 'pending' : 'not_required',
        })
        .onConflict((oc) => oc.column('inquiry_id').doUpdateSet({ quote_id: q.id, booking_id: booking.id, status: 'pending', contract_status: q.requires_contract ? 'pending' : 'not_required' }))
        .returning('id')
        .executeTakeFirstOrThrow();

      // Deposit, then balance. Both appear on the customer's payment schedule from here on.
      const balanceDue = addDays(inquiry.event_date, -settings.events.balance_due_days_before, tz);
      const balance = q.total_cents - q.deposit_cents;
      await trx.deleteFrom('payment_schedule_items').where('project_id', '=', project.id).where('status', '=', 'scheduled').execute();
      if (q.deposit_cents > 0) {
        const invoice = await createInvoice(trx, ctx, {
          customer_id: q.customer_id,
          project_id: project.id,
          quote_id: q.id,
          kind: 'deposit',
          lines: [{ description: `Deposit for your event on ${inquiry.event_date}`, quantity: 1, unit_price_cents: q.deposit_cents }],
          due_on: localDate(holdUntil, tz),
          status: 'sent',
          actor,
        });
        await trx.insertInto('payment_schedule_items').values({ project_id: project.id, label: 'Deposit', amount_cents: q.deposit_cents, due_on: localDate(holdUntil, tz), invoice_id: invoice.id, status: 'invoiced', sort_order: 0 }).execute();
      }
      if (balance > 0) {
        await trx.insertInto('payment_schedule_items').values({ project_id: project.id, label: 'Balance', amount_cents: balance, due_on: balanceDue, status: 'scheduled', sort_order: 1 }).execute();
      }

      await moveToStage(trx, q.inquiry_id, 'awaiting_deposit');
      await emit(trx, q.deposit_cents > 0 ? 'quote.accepted' : 'quote.accepted_no_deposit', { type: 'quote', id: quoteId }, {}, `quote-accepted:${quoteId}`);
      await emit(trx, 'booking.approved', { type: 'booking', id: booking.id }, {}, `booking-approved:${quoteId}`);
      await audit(trx, actor, 'quote.accept', { type: 'quote', id: quoteId }, { name: input.name, total_cents: q.total_cents, deposit_cents: q.deposit_cents });

      if (q.deposit_cents === 0) await tryConfirmBooking(ctx, trx, project.id, actor);
      return { status: 'accepted' as const, project_id: project.id };
    });
  } catch (err) {
    if (err instanceof AppError && (err.code === 'capacity_crews' || err.code === 'rental_unavailable' || err.code === 'time_conflict') || (err as { code?: string }).code === 'BL001' || (err as { code?: string }).code === '23P01') {
      if (bookingIdForAlert && inquiryIdForAlert) {
        await emit(ctx.db, 'booking.conflict', { type: 'booking', id: bookingIdForAlert }, { note: 'A customer tried to accept a quote, but the crews or rentals for that date are no longer free.' });
      }
      throw conflict('date_unavailable', 'That date is no longer available, so we could not hold it for you. You have not been charged. The team has been alerted and will contact you.');
    }
    throw err;
  }
}

export async function declineQuote(ctx: AppContext, quoteId: string, reason: string | null, actor: Actor) {
  await ctx.db.transaction().execute(async (trx) => {
    const q = await trx.selectFrom('quotes').select(['status']).where('id', '=', quoteId).forUpdate().executeTakeFirst();
    if (!q) throw notFound('Quote not found.');
    if (q.status !== 'sent') throw conflict('quote_closed', 'This quote is no longer open.');
    await trx.updateTable('quotes').set({ status: 'declined', declined_at: ctx.clock.now(), decline_reason: reason }).where('id', '=', quoteId).execute();
    await audit(trx, actor, 'quote.decline', { type: 'quote', id: quoteId }, { reason });
  });
}
