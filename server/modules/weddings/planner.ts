import { z } from 'zod';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import type { AppContext } from '../../context.js';
import type { Db } from '../../db/client.js';
import { audit, type Actor } from '../../lib/audit.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { generateReference, hashToken, mintAccessToken } from '../../lib/tokens.js';
import { toE164 } from '../../lib/phone.js';
import { localDate, type Clock } from '../../lib/time.js';
import { emit } from '../../automation/events.js';
import { loadSettings } from '../settings/service.js';
import { recordConsents, upsertCustomer } from '../orders/checkout.js';
import { checkEventAvailability, eventTimes } from './availability.js';
import { computeEstimate, type SelectedItem } from './estimate.js';

export const selectionSchema = z.object({
  service_id: z.string().uuid().optional().nullable(),
  rental_item_id: z.string().uuid().optional().nullable(),
  quantity: z.number().int().min(1).max(5000),
  notes: z.string().trim().max(500).optional().nullable(),
});

const timeField = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .optional()
  .nullable()
  .or(z.literal('').transform(() => null));

export const eventInfoSchema = z.object({
  event_type: z.string().trim().min(1, 'Please choose the type of event.').max(80),
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Please choose a date.'),
  ceremony_time: timeField,
  reception_time: timeField,
  venue_name: z.string().trim().max(160).optional().nullable(),
  venue_address: z.string().trim().max(240).optional().nullable(),
  guest_count: z.number().int().min(0).max(5000).optional().nullable(),
  budget_range: z.string().trim().max(60).optional().nullable(),
  consultation_format: z.string().trim().max(60).optional().nullable(),
});

export const planSchema = eventInfoSchema.extend({
  idempotency_key: z.string().min(8).max(100),
  contact: z.object({
    name: z.string().trim().min(2, 'Please share your name.').max(120),
    email: z.string().trim().toLowerCase().email('Please check your email address.').max(200),
    phone: z
      .string()
      .trim()
      .max(30)
      .optional()
      .nullable()
      .refine((v) => !v || toE164(v), 'Please enter a 10-digit US phone number.'),
  }),
  style: z
    .object({
      colors: z.string().trim().max(300).optional().nullable(),
      theme: z.string().trim().max(200).optional().nullable(),
      floral_styles: z.array(z.string().max(60)).max(20).optional(),
      preferences: z.string().trim().max(4000).optional().nullable(),
      must_haves: z.string().trim().max(2000).optional().nullable(),
      optional_services: z.string().trim().max(2000).optional().nullable(),
    })
    .default({}),
  selections: z.array(selectionSchema).max(100).default([]),
  draft_token: z.string().max(200).optional().nullable(),
  consents: z
    .object({ sms_transactional: z.boolean().default(false), sms_marketing: z.boolean().default(false), email_marketing: z.boolean().default(false) })
    .default({ sms_transactional: false, sms_marketing: false, email_marketing: false }),
  website: z.string().max(200).optional(),
  attribution: z.record(z.string(), z.string().max(100)).optional(),
});

export type PlanInput = z.output<typeof planSchema>;

/** What the planner offers. The owner controls all of it; none of it is hardcoded. */
export async function plannerOptions(db: Db, clock: Clock) {
  const settings = await loadSettings(db);
  const categories = await db
    .selectFrom('service_categories as c')
    .select((eb) => [
      'c.id',
      'c.name',
      'c.slug',
      'c.description',
      jsonArrayFrom(
        eb
          .selectFrom('wedding_services as s')
          .select(['s.id', 's.code', 's.name', 's.description', 's.image_url', 's.pricing_mode', 's.unit', 's.unit_price_cents', 's.est_low_cents', 's.est_high_cents'])
          .whereRef('s.category_id', '=', 'c.id')
          .where('s.active', '=', true)
          .orderBy('s.sort_order'),
      ).as('services'),
    ])
    .where('c.active', '=', true)
    .orderBy('c.sort_order')
    .execute();
  const rentals = await db
    .selectFrom('rental_items')
    .select(['id', 'name', 'category', 'description', 'image_url', 'price_cents', 'quantity'])
    .where('active', '=', true)
    .orderBy('sort_order')
    .execute();
  return {
    categories: categories.filter((c) => c.services.length),
    rentals: rentals.map((r) => ({ ...r, quantity: undefined, max_quantity: r.quantity })),
    event_types: settings.events.event_types,
    budget_ranges: settings.events.budget_ranges,
    style_options: settings.events.style_options,
    consultation_formats: settings.consultations.formats,
    min_notice_days: settings.events.min_notice_days,
    timezone: settings.general.timezone,
    today: localDate(clock.now(), settings.general.timezone),
    sms_available: false,
    sms_consent_text: { transactional: settings.sms.consent_text_transactional, marketing: settings.sms.consent_text_marketing },
    cancellation_policy: settings.events.cancellation_policy,
  };
}

const rentalsOf = (selected: SelectedItem[]) => selected.flatMap((s) => (s.rental_item_id ? [{ rental_item_id: s.rental_item_id, quantity: s.quantity }] : []));

/**
 * Saves a wedding inquiry permanently. This works at 11:30 p.m. with everyone asleep. It deliberately
 * reserves nothing: a booking row records the requested date, but holds and crews come only after a
 * person approves. An inquiry can never guarantee a date.
 */
export async function submitPlan(ctx: AppContext, input: PlanInput, actor: Actor, userAgent?: string | null) {
  // A retry returns its own plan. A key used with another email address reveals nothing about that plan.
  const inquiryForKey = () =>
    ctx.db
      .selectFrom('wedding_inquiries as i')
      .innerJoin('customers as u', 'u.id', 'i.customer_id')
      .select(['i.id', 'i.reference', 'u.email'])
      .where('i.idempotency_key', '=', input.idempotency_key)
      .executeTakeFirst();
  const assertSamePerson = (row: { email: string }) => {
    if (row.email.toLowerCase() !== input.contact.email.trim().toLowerCase()) throw conflict('idempotency_conflict', 'That request could not be matched. Please refresh the page and try again.');
  };
  const existing = await inquiryForKey();
  const settings = await loadSettings(ctx.db);
  const tz = settings.general.timezone;
  if (existing) assertSamePerson(existing);
  if (existing) return { id: existing.id, reference: existing.reference, portal_token: await mintAccessToken(ctx.db, ctx.clock, { purpose: 'inquiry_access', subjectId: existing.id, ttlMinutes: 60 * 24 * 365 }), availability: null };

  const today = localDate(ctx.clock.now(), tz);
  if (input.event_date <= today) throw badRequest('Please choose a date in the future.');
  for (const s of input.selections) {
    if (Boolean(s.service_id) === Boolean(s.rental_item_id)) throw badRequest('Each selection must be one service or one rental.');
  }

  const availability = await checkEventAvailability(ctx.db, ctx.clock, {
    event_date: input.event_date,
    ceremony_time: input.ceremony_time,
    reception_time: input.reception_time,
    rentals: rentalsOf(input.selections),
  });
  const estimate = await computeEstimate(ctx.db, settings, input.selections, input.guest_count);

  try {
    const created = await ctx.db.transaction().execute(async (trx) => {
      const customerId = await upsertCustomer(trx, input.contact, 'wedding_planner');
      await recordConsents(trx, customerId, toE164(input.contact.phone), input.consents, {
        source: 'wedding_planner',
        ip: actor.ip,
        userAgent,
        smsTransactionalText: settings.sms.consent_text_transactional,
        smsMarketingText: settings.sms.consent_text_marketing,
      });
      const stage = await trx.selectFrom('pipeline_stages').select('id').where('code', '=', 'new_inquiry').executeTakeFirstOrThrow();
      const reference = generateReference('EV');
      const inquiry = await trx
        .insertInto('wedding_inquiries')
        .values({
          reference,
          customer_id: customerId,
          event_type: input.event_type,
          event_date: input.event_date,
          ceremony_time: input.ceremony_time ?? null,
          reception_time: input.reception_time ?? null,
          venue_name: input.venue_name ?? null,
          venue_address: input.venue_address ?? null,
          guest_count: input.guest_count ?? null,
          budget_range: input.budget_range ?? null,
          consultation_format: input.consultation_format ?? null,
          stage_id: stage.id,
          availability: JSON.stringify({ status: availability.status, summary: availability.summary, reasons: availability.reasons, alternatives: availability.alternatives }),
          estimate: JSON.stringify(estimate),
          idempotency_key: input.idempotency_key,
          source: 'planner',
          attribution: JSON.stringify(input.attribution ?? {}),
          is_test: !ctx.payments.livemode,
        })
        .returning(['id', 'reference'])
        .executeTakeFirstOrThrow();
      await trx.insertInto('wedding_questionnaires').values({ inquiry_id: inquiry.id, answers: JSON.stringify({ contact: { name: input.contact.name }, event: { ...input, contact: undefined, website: undefined, idempotency_key: undefined, draft_token: undefined }, style: input.style }) }).execute();

      for (const line of estimate.lines) {
        await trx
          .insertInto('wedding_inquiry_items')
          .values({
            inquiry_id: inquiry.id,
            service_id: line.service_id,
            rental_item_id: line.rental_item_id,
            name: line.name,
            quantity: line.quantity,
            notes: line.notes,
            pricing_mode: line.pricing_mode,
            unit: line.unit,
            unit_price_cents: line.unit_price_cents,
            est_low_cents: line.est_low_cents,
            est_high_cents: line.est_high_cents,
          })
          .execute();
      }

      const times = eventTimes(settings, input.event_date, input.ceremony_time, input.reception_time);
      await trx
        .insertInto('event_bookings')
        .values({
          inquiry_id: inquiry.id,
          status: 'inquiry',
          event_date: input.event_date,
          event_start: times.event_start,
          event_end: times.event_end,
          setup_minutes: settings.events.setup_minutes,
          teardown_minutes: settings.events.teardown_minutes,
          travel_minutes: settings.events.travel_minutes,
          buffer_minutes: settings.events.buffer_minutes,
          crews_required: settings.events.crews_per_event,
          prep_days: settings.events.prep_days,
        })
        .execute();

      if (input.draft_token) {
        await trx
          .updateTable('wedding_documents')
          .set({ inquiry_id: inquiry.id, draft_token_hash: null })
          .where('draft_token_hash', '=', hashToken(input.draft_token))
          .where('inquiry_id', 'is', null)
          .execute();
      }

      await trx
        .insertInto('customer_communications')
        .values({ customer_id: customerId, direction: 'inbound', channel: 'portal', subject: `${input.event_type} plan for ${input.event_date}`, subject_type: 'inquiry', subject_id: inquiry.id })
        .execute();
      await emit(trx, 'customer.created', { type: 'customer', id: customerId }, {}, `customer-created:${customerId}`);
      await emit(trx, 'inquiry.created', { type: 'inquiry', id: inquiry.id });
      await audit(trx, actor, 'inquiry.create', { type: 'inquiry', id: inquiry.id }, { event_date: input.event_date });
      return inquiry;
    });
    const portal_token = await mintAccessToken(ctx.db, ctx.clock, { purpose: 'inquiry_access', subjectId: created.id, ttlMinutes: 60 * 24 * 365 });
    return { id: created.id, reference: created.reference, portal_token, availability };
  } catch (err) {
    if ((err as { constraint?: string }).constraint === 'wedding_inquiries_idempotency_key_key') {
      const again = await inquiryForKey();
      if (!again) throw err;
      assertSamePerson(again);
      return { id: again.id, reference: again.reference, portal_token: await mintAccessToken(ctx.db, ctx.clock, { purpose: 'inquiry_access', subjectId: again.id, ttlMinutes: 60 * 24 * 365 }), availability: null };
    }
    throw err;
  }
}

/** The customer's view of their plan. No staff notes, no internal availability detail. */
export async function publicInquiryView(ctx: AppContext, inquiryId: string) {
  const i = await ctx.db
    .selectFrom('wedding_inquiries as i')
    .innerJoin('pipeline_stages as s', 's.id', 'i.stage_id')
    .select(['i.id', 'i.reference', 'i.event_type', 'i.event_date', 'i.ceremony_time', 'i.reception_time', 'i.venue_name', 'i.venue_address', 'i.guest_count', 'i.budget_range', 'i.consultation_format', 'i.status', 'i.availability', 'i.estimate', 'i.suggested_date', 'i.clarification_request', 'i.decline_reason', 'i.customer_id', 's.name as stage_name'])
    .where('i.id', '=', inquiryId)
    .executeTakeFirst();
  if (!i) throw notFound('This plan could not be found.');
  const consultation = await ctx.db
    .selectFrom('consultations as c')
    .innerJoin('staff_profiles as sp', 'sp.id', 'c.staff_id')
    .select(['c.id', 'c.starts_at', 'c.ends_at', 'c.format', 'c.status', 'sp.display_name as staff_name'])
    .where('c.inquiry_id', '=', inquiryId)
    .where('c.status', '=', 'booked')
    .executeTakeFirst();
  const documents = await ctx.db.selectFrom('wedding_documents').select(['id', 'filename', 'kind', 'mime_type']).where('inquiry_id', '=', inquiryId).where((eb) => eb.or([eb('kind', '=', 'inspiration'), eb('customer_visible', '=', true)])).execute();
  const items = await ctx.db.selectFrom('wedding_inquiry_items').select(['id', 'name', 'quantity', 'pricing_mode', 'notes']).where('inquiry_id', '=', inquiryId).execute();
  const quote = await ctx.db.selectFrom('quotes').select(['id', 'reference', 'status', 'total_cents', 'deposit_cents', 'valid_until']).where('inquiry_id', '=', inquiryId).where('status', 'in', ['sent', 'accepted']).orderBy('version', 'desc').executeTakeFirst();
  const project = await ctx.db.selectFrom('wedding_projects').select(['id', 'status']).where('inquiry_id', '=', inquiryId).executeTakeFirst();
  const settings = await loadSettings(ctx.db);
  let quoteToken: string | null = null;
  let projectToken: string | null = null;
  if (quote) quoteToken = await mintAccessToken(ctx.db, ctx.clock, { purpose: 'quote_access', subjectId: quote.id, ttlMinutes: 60 * 24 * 30 });
  if (project) projectToken = await mintAccessToken(ctx.db, ctx.clock, { purpose: 'project_access', subjectId: project.id, ttlMinutes: 60 * 24 * 30 });
  const avail = (i.availability ?? {}) as { status?: string; summary?: string; alternatives?: string[] };
  return {
    reference: i.reference,
    event_type: i.event_type,
    event_date: i.event_date,
    ceremony_time: i.ceremony_time,
    reception_time: i.reception_time,
    venue_name: i.venue_name,
    venue_address: i.venue_address,
    guest_count: i.guest_count,
    budget_range: i.budget_range,
    status: i.status,
    stage: i.stage_name,
    availability: { status: avail.status, summary: avail.summary, alternatives: avail.alternatives ?? [] },
    estimate: i.estimate,
    suggested_date: i.suggested_date,
    clarification_request: i.clarification_request,
    decline_reason: i.decline_reason,
    consultation,
    consultations_enabled: settings.consultations.enabled,
    consultation_formats: settings.consultations.formats,
    preferred_format: i.consultation_format,
    documents,
    items,
    quote: quote ? { ...quote, token: quoteToken } : null,
    project: project ? { status: project.status, token: projectToken } : null,
  };
}

