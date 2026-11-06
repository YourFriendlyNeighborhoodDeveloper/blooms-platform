import { randomInt } from 'node:crypto';
import { sql } from 'kysely';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import type { Db } from '../../db/client.js';
import { audit, type Actor } from '../../lib/audit.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { generateReference, hashToken, mintAccessToken, resolveAccessToken } from '../../lib/tokens.js';
import { addMinutes, localDate } from '../../lib/time.js';
import { isPgError } from '../../lib/errors.js';
import { hitRateLimit } from '../../lib/ratelimit.js';
import { loadSettings } from '../settings/service.js';
import { planSchema, submitPlan, type PlanInput } from '../weddings/planner.js';
import { checkEventAvailability } from '../weddings/availability.js';
import { computeEstimate } from '../weddings/estimate.js';
import { bookConsultation } from '../weddings/consultations.js';
import type { Conversation } from './conversations.js';

const DRAFT_DAYS = 30;
const LINK_DAYS = 14;
const CODE_HOURS = 24;

/** What Flora can save as she learns it. Every field is optional until the customer submits. */
export const draftPatchSchema = z.object({
  contact_name: z.string().trim().min(2).max(120).nullable().optional(),
  contact_email: z.string().trim().toLowerCase().email().max(200).nullable().optional(),
  event_type: z.string().trim().min(1).max(80).nullable().optional(),
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  ceremony_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  reception_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  venue_name: z.string().trim().max(160).nullable().optional(),
  venue_address: z.string().trim().max(240).nullable().optional(),
  guest_count: z.number().int().min(0).max(5000).nullable().optional(),
  budget_range: z.string().trim().max(60).nullable().optional(),
  consultation_format: z.string().trim().max(60).nullable().optional(),
  colors: z.string().trim().max(300).nullable().optional(),
  theme: z.string().trim().max(200).nullable().optional(),
  floral_styles: z.array(z.string().max(60)).max(20).nullable().optional(),
  preferences: z.string().trim().max(4000).nullable().optional(),
  must_haves: z.string().trim().max(2000).nullable().optional(),
  selections: z
    .array(z.object({ service_id: z.string().uuid().nullable().optional(), rental_item_id: z.string().uuid().nullable().optional(), quantity: z.number().int().min(1).max(5000), notes: z.string().trim().max(500).nullable().optional() }))
    .max(50)
    .nullable()
    .optional(),
});
export type DraftPatch = z.output<typeof draftPatchSchema>;

type DraftData = Omit<DraftPatch, 'contact_name' | 'contact_email'>;

const CONTACT_KEYS = ['contact_name', 'contact_email'] as const;

/** The fields the website needs before a plan can be sent. */
export function missingForSubmission(d: { data: DraftData; contact_name: string | null; contact_email: string | null }) {
  const missing: string[] = [];
  if (!d.contact_name) missing.push('name');
  if (!d.contact_email) missing.push('email');
  if (!d.data.event_date) missing.push('event date');
  if (!d.data.event_type) missing.push('type of event');
  return missing;
}

export async function draftForConversation(db: Db, conversationId: string) {
  return db.selectFrom('concierge_drafts').selectAll().where('conversation_id', '=', conversationId).orderBy('created_at', 'desc').executeTakeFirst();
}

/**
 * Saves what Flora has learned. Selections must be services and rentals the shop actually offers,
 * a date must be in the future, and a budget must be one of the shop's own ranges.
 */
export async function saveDraftDetails(ctx: AppContext, conversation: Conversation, patch: DraftPatch) {
  const settings = await loadSettings(ctx.db);
  const today = localDate(ctx.clock.now(), settings.general.timezone);
  if (patch.event_date && patch.event_date <= today) throw badRequest('The event date must be in the future.');
  if (patch.event_type && !settings.events.event_types.includes(patch.event_type)) {
    patch.event_type = settings.events.event_types.find((t) => t.toLowerCase() === patch.event_type!.toLowerCase()) ?? 'Another celebration';
  }
  if (patch.budget_range && !settings.events.budget_ranges.includes(patch.budget_range)) {
    throw badRequest(`The budget must be one of: ${settings.events.budget_ranges.join('; ')}.`);
  }
  if (patch.consultation_format && !settings.consultations.formats.includes(patch.consultation_format)) {
    throw badRequest(`The consultation format must be one of: ${settings.consultations.formats.join('; ')}.`);
  }
  for (const s of patch.selections ?? []) {
    if (Boolean(s.service_id) === Boolean(s.rental_item_id)) throw badRequest('Each selection must be exactly one service or one rental.');
    const ok = s.service_id
      ? await ctx.db.selectFrom('wedding_services').select('id').where('id', '=', s.service_id).where('active', '=', true).executeTakeFirst()
      : await ctx.db.selectFrom('rental_items').select('id').where('id', '=', s.rental_item_id!).where('active', '=', true).executeTakeFirst();
    if (!ok) throw badRequest('One of those selections is not something the shop offers. Use get_wedding_services for the current list.');
  }

  let draft = await draftForConversation(ctx.db, conversation.id);
  if (draft && draft.status !== 'draft') throw conflict('draft_submitted', 'This plan has already been sent. Start a new conversation for another event.');
  if (!draft) {
    draft = await ctx.db
      .insertInto('concierge_drafts')
      .values({
        reference: generateReference('FD'),
        conversation_id: conversation.id,
        sandbox: conversation.mode === 'demo',
        data: JSON.stringify({ event_type: 'Wedding' }),
        contact_phone_e164: conversation.channel === 'voice' ? conversation.caller_phone_e164 : null,
        expires_at: addMinutes(ctx.clock.now(), DRAFT_DAYS * 24 * 60),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }
  const data: DraftData = { ...((draft.data ?? {}) as DraftData) };
  for (const [key, value] of Object.entries(patch)) {
    if ((CONTACT_KEYS as readonly string[]).includes(key) || value === undefined) continue;
    (data as Record<string, unknown>)[key] = value;
  }
  const updated = await ctx.db
    .updateTable('concierge_drafts')
    .set({
      data: JSON.stringify(data),
      ...(patch.contact_name !== undefined ? { contact_name: patch.contact_name } : {}),
      ...(patch.contact_email !== undefined ? { contact_email: patch.contact_email } : {}),
      updated_at: sql`now()`,
    })
    .where('id', '=', draft.id)
    .returningAll()
    .executeTakeFirstOrThrow();
  return {
    reference: updated.reference,
    sandbox: updated.sandbox,
    saved: Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] !== undefined),
    still_needed_to_send: missingForSubmission({ data, contact_name: updated.contact_name, contact_email: updated.contact_email }),
  };
}

export async function draftLink(ctx: AppContext, draftId: string) {
  const token = await mintAccessToken(ctx.db, ctx.clock, { purpose: 'concierge_draft', subjectId: draftId, ttlMinutes: LINK_DAYS * 24 * 60 });
  return `${ctx.env.PUBLIC_BASE_URL}/plan/draft/${token}`;
}

const codeHash = (code: string, last4: string) => hashToken(`flora-continue:${code}:${last4}`);

/** A six-digit code for when no text can be sent. It works only with the last four digits of the caller's number. */
export async function issueContinueCode(ctx: AppContext, draftId: string, phone: string) {
  const last4 = phone.replace(/\D/g, '').slice(-4);
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    try {
      await ctx.db
        .updateTable('concierge_drafts')
        .set({ continue_code_hash: codeHash(code, last4), continue_code_expires_at: addMinutes(ctx.clock.now(), CODE_HOURS * 60), continue_failures: 0, link_sent_at: sql`now()`, link_channel: 'code', updated_at: sql`now()` })
        .where('id', '=', draftId)
        .execute();
      return code;
    } catch (err) {
      if (!isPgError(err, '23505')) throw err;
    }
  }
  throw conflict('code_unavailable', 'Could not create a code. Please try again.');
}

/** Trades a code and the last four digits of the phone for a private link. Limited per visitor. */
export async function continueWithCode(ctx: AppContext, input: { code: string; last4: string; ip: string | null }) {
  const allowed = await hitRateLimit(ctx.db, ctx.clock, `flora-continue:${input.ip ?? 'unknown'}`, 8, 3600);
  if (!allowed) throw conflict('rate_limited', 'Too many tries. Please wait an hour, or call the shop.');
  const draft = await ctx.db
    .selectFrom('concierge_drafts')
    .select(['id', 'status', 'continue_code_expires_at'])
    .where('continue_code_hash', '=', codeHash(input.code, input.last4))
    .executeTakeFirst();
  if (!draft || !draft.continue_code_expires_at || draft.continue_code_expires_at <= ctx.clock.now()) throw notFound('That code did not match. Check the six digits and the last four digits of the phone you called from.');
  return { token: await mintAccessToken(ctx.db, ctx.clock, { purpose: 'concierge_draft', subjectId: draft.id, ttlMinutes: LINK_DAYS * 24 * 60 }) };
}

async function draftFromToken(ctx: AppContext, token: string) {
  const t = await resolveAccessToken(ctx.db, ctx.clock, token, ['concierge_draft']);
  if (!t?.subject_id) throw notFound('This link has expired. Ask Flora or the shop for a new one.');
  const draft = await ctx.db.selectFrom('concierge_drafts').selectAll().where('id', '=', t.subject_id).executeTakeFirst();
  if (!draft) throw notFound('This plan could not be found.');
  return draft;
}

/** What the customer sees: only their own plan, never staff notes or anything from another draft. */
export async function publicDraftView(ctx: AppContext, token: string) {
  const d = await draftFromToken(ctx, token);
  const settings = await loadSettings(ctx.db);
  const channel = d.conversation_id ? (await ctx.db.selectFrom('concierge_conversations').select('channel').where('id', '=', d.conversation_id).executeTakeFirst())?.channel : null;
  return {
    reference: d.reference,
    sandbox: d.sandbox,
    status: d.status,
    created_via: channel ?? 'chat',
    assistant_name: settings.concierge.assistant_name,
    contact: { name: d.contact_name, email: d.contact_email, phone: d.contact_phone_e164 },
    data: d.data,
    preferred_consultation_at: d.preferred_consultation_at,
    submitted_at: d.submitted_at,
    sandbox_result: d.status === 'submitted' ? d.sandbox_result : null,
    expires_at: d.expires_at,
  };
}

/**
 * The customer sends the plan they reviewed. In customer mode this becomes a real inquiry through
 * the same path as the website planner. A sandbox draft stays in the sandbox: it is checked and
 * estimated, then stored for the demonstration, and the shop's pipeline never sees it.
 */
export async function submitDraft(ctx: AppContext, token: string, body: unknown, actor: Actor, userAgent: string | null) {
  const draft = await draftFromToken(ctx, token);
  const parsed = planSchema.safeParse({ ...(body as object), idempotency_key: `flora-draft:${draft.id}` });
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'Please check your plan.', parsed.error.issues);
  const input: PlanInput = { ...parsed.data, attribution: { ...(parsed.data.attribution ?? {}), via: 'flora', draft: draft.reference } };

  if (draft.status === 'submitted') {
    if (draft.sandbox) return { sandbox: true as const, reference: draft.reference, already_sent: true };
    const inquiry = draft.inquiry_id ? await ctx.db.selectFrom('wedding_inquiries').select(['id', 'reference']).where('id', '=', draft.inquiry_id).executeTakeFirst() : null;
    if (!inquiry) throw conflict('already_sent', 'This plan was already sent.');
    const portal_token = await mintAccessToken(ctx.db, ctx.clock, { purpose: 'inquiry_access', subjectId: inquiry.id, ttlMinutes: 60 * 24 * 365 });
    return { sandbox: false as const, reference: inquiry.reference, portal_token, already_sent: true };
  }

  const settings = await loadSettings(ctx.db);
  const today = localDate(ctx.clock.now(), settings.general.timezone);
  if (input.event_date <= today) throw badRequest('Please choose a date in the future.');
  const draftData = {
    event_type: input.event_type, event_date: input.event_date, ceremony_time: input.ceremony_time ?? null, reception_time: input.reception_time ?? null,
    venue_name: input.venue_name ?? null, venue_address: input.venue_address ?? null, guest_count: input.guest_count ?? null, budget_range: input.budget_range ?? null,
    consultation_format: input.consultation_format ?? null, ...input.style, selections: input.selections,
  };

  if (draft.sandbox) {
    const availability = await checkEventAvailability(ctx.db, ctx.clock, {
      event_date: input.event_date,
      ceremony_time: input.ceremony_time,
      reception_time: input.reception_time,
      rentals: input.selections.flatMap((s) => (s.rental_item_id ? [{ rental_item_id: s.rental_item_id, quantity: s.quantity }] : [])),
    });
    const estimate = await computeEstimate(ctx.db, settings, input.selections, input.guest_count);
    const updated = await ctx.db
      .updateTable('concierge_drafts')
      .set({
        status: 'submitted',
        submitted_at: sql`now()`,
        data: JSON.stringify(draftData),
        contact_name: input.contact.name,
        contact_email: input.contact.email,
        sandbox_result: JSON.stringify({ availability: { status: availability.status, summary: availability.summary, reasons: availability.reasons, alternatives: availability.alternatives }, estimate }),
        updated_at: sql`now()`,
      })
      .where('id', '=', draft.id)
      .where('status', '=', 'draft')
      .executeTakeFirst();
    if (Number(updated.numUpdatedRows) !== 1) throw conflict('already_sent', 'This plan was already sent.');
    await audit(ctx.db, actor, 'concierge.sandbox_submit', { type: 'concierge_draft', id: draft.id }, { event_date: input.event_date });
    return { sandbox: true as const, reference: draft.reference, already_sent: false };
  }

  const result = await submitPlan(ctx, input, actor, userAgent, 'flora');
  await ctx.db
    .updateTable('concierge_drafts')
    .set({ status: 'submitted', submitted_at: sql`now()`, inquiry_id: result.id, data: JSON.stringify(draftData), contact_name: input.contact.name, contact_email: input.contact.email, updated_at: sql`now()` })
    .where('id', '=', draft.id)
    .execute();
  let consultation: 'booked' | 'unavailable' | null = null;
  if (draft.preferred_consultation_at && settings.consultations.enabled) {
    try {
      await bookConsultation(ctx, { inquiry_id: result.id, starts_at: draft.preferred_consultation_at, format: input.consultation_format && settings.consultations.formats.includes(input.consultation_format) ? input.consultation_format : settings.consultations.formats[0], actor });
      consultation = 'booked';
    } catch {
      consultation = 'unavailable';
    }
  }
  return { sandbox: false as const, reference: result.reference, portal_token: result.portal_token, consultation, already_sent: false };
}
