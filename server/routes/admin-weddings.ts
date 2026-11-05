import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { sql } from 'kysely';
import type { AppEnv, C } from '../http/types.js';
import { staffActor } from '../http/types.js';
import { can, readJson, requirePermission } from '../http/helpers.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { addHours } from '../lib/time.js';
import { emit } from '../automation/events.js';
import { loadSettings } from '../modules/settings/service.js';
import { checkEventAvailability, eventTimes, releaseBookingResources, reserveBookingResources } from '../modules/weddings/availability.js';
import { moveToStage } from '../modules/weddings/pipeline.js';
import { createQuote, quoteSchema, sendQuote, updateDraftQuote } from '../modules/weddings/quotes.js';
import { createInvoice, markContractSigned, tryConfirmBooking } from '../modules/weddings/billing.js';
import { bookConsultation, cancelConsultation, consultationSlots } from '../modules/weddings/consultations.js';
import { issueRefund, recordManualPayment } from '../modules/payments/service.js';
import { privateKey, processDocument, processImage, safeFilename, MAX_DOCUMENT_BYTES } from '../modules/uploads.js';

export const adminWeddingRoutes = new Hono<AppEnv>();

const money = (o: Record<string, unknown>, financial: boolean) => (financial ? o : Object.fromEntries(Object.entries(o).filter(([k]) => !k.endsWith('_cents') && k !== 'budget_range' && k !== 'estimate')));

adminWeddingRoutes.get('/stages', async (c) => {
  requirePermission(c, 'weddings.view');
  return c.json({ stages: await c.get('ctx').db.selectFrom('pipeline_stages').selectAll().orderBy('sort_order').execute() });
});

const stageSchema = z.object({ name: z.string().trim().min(1).max(60), kind: z.enum(['open', 'won', 'lost']).default('open'), sort_order: z.number().int().optional(), active: z.boolean().optional() });

adminWeddingRoutes.post('/stages', async (c) => {
  requirePermission(c, 'settings.manage');
  const ctx = c.get('ctx');
  const body = await readJson(c, stageSchema);
  const code = `${body.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${Date.now().toString(36)}`;
  const row = await ctx.db.insertInto('pipeline_stages').values({ code, name: body.name, kind: body.kind, sort_order: body.sort_order ?? 50 }).returningAll().executeTakeFirstOrThrow();
  await audit(ctx.db, staffActor(c), 'pipeline.stage_create', { type: 'stage', id: row.id }, { name: body.name });
  return c.json(row, 201);
});

adminWeddingRoutes.patch('/stages/:id', async (c) => {
  requirePermission(c, 'settings.manage');
  const ctx = c.get('ctx');
  const body = await readJson(c, stageSchema.partial());
  const row = await ctx.db.updateTable('pipeline_stages').set(body).where('id', '=', c.req.param('id')).returningAll().executeTakeFirst();
  if (!row) throw notFound('Stage not found.');
  return c.json(row);
});

adminWeddingRoutes.get('/board', async (c) => {
  requirePermission(c, 'weddings.view');
  const ctx = c.get('ctx');
  const financial = can(c, 'weddings.financials');
  const stages = await ctx.db.selectFrom('pipeline_stages').selectAll().where('active', '=', true).orderBy('sort_order').execute();
  const cards = await ctx.db
    .selectFrom('wedding_inquiries as i')
    .innerJoin('customers as u', 'u.id', 'i.customer_id')
    .leftJoin('staff_profiles as s', 's.id', 'i.assigned_to')
    .select([
      'i.id', 'i.reference', 'i.event_type', 'i.event_date', 'i.guest_count', 'i.budget_range', 'i.status', 'i.stage_id', 'i.availability', 'i.is_test', 'i.created_at', 'u.name as customer_name', 's.display_name as assigned_name',
      sql<number>`(SELECT count(*)::int FROM staff_tasks t WHERE t.subject_type = 'inquiry' AND t.subject_id = i.id AND t.status IN ('open','in_progress'))`.as('open_tasks'),
    ])
    .orderBy('i.event_date')
    .limit(500)
    .execute();
  return c.json({
    stages,
    cards: cards.map((x) => ({ ...x, budget_range: financial ? x.budget_range : undefined, availability_status: (x.availability as { status?: string })?.status, availability: undefined })),
  });
});

adminWeddingRoutes.get('/:id{[0-9a-f-]{36}}', async (c) => {
  requirePermission(c, 'weddings.view');
  const ctx = c.get('ctx');
  const id = c.req.param('id');
  const financial = can(c, 'weddings.financials');
  const inquiry = await ctx.db
    .selectFrom('wedding_inquiries as i')
    .innerJoin('customers as u', 'u.id', 'i.customer_id')
    .innerJoin('pipeline_stages as s', 's.id', 'i.stage_id')
    .select(['i.id', 'i.reference', 'i.customer_id', 'i.event_type', 'i.event_date', 'i.ceremony_time', 'i.reception_time', 'i.venue_name', 'i.venue_address', 'i.guest_count', 'i.budget_range', 'i.consultation_format', 'i.status', 'i.stage_id', 'i.availability', 'i.estimate', 'i.suggested_date', 'i.clarification_request', 'i.decline_reason', 'i.assigned_to', 'i.is_test', 'i.created_at', 'u.name as customer_name', 'u.email as customer_email', 'u.phone_e164 as customer_phone', 's.name as stage_name'])
    .where('i.id', '=', id)
    .executeTakeFirst();
  if (!inquiry) throw notFound('Inquiry not found.');
  const questionnaire = await ctx.db.selectFrom('wedding_questionnaires').select('answers').where('inquiry_id', '=', id).executeTakeFirst();
  const items = await ctx.db.selectFrom('wedding_inquiry_items').selectAll().where('inquiry_id', '=', id).execute();
  const documents = await ctx.db.selectFrom('wedding_documents').select(['id', 'kind', 'filename', 'mime_type', 'size_bytes', 'customer_visible', 'created_at']).where('inquiry_id', '=', id).orderBy('created_at').execute();
  const consultations = await ctx.db.selectFrom('consultations as k').innerJoin('staff_profiles as s', 's.id', 'k.staff_id').select(['k.id', 'k.starts_at', 'k.ends_at', 'k.format', 'k.status', 'k.notes', 's.display_name as staff_name']).where('k.inquiry_id', '=', id).orderBy('k.starts_at', 'desc').execute();
  const quotes = financial ? await ctx.db.selectFrom('quotes').selectAll().where('inquiry_id', '=', id).orderBy('version', 'desc').execute() : [];
  const quoteLines = quotes.length ? await ctx.db.selectFrom('quote_line_items').selectAll().where('quote_id', 'in', quotes.map((q) => q.id)).orderBy('sort_order').execute() : [];
  const booking = await ctx.db.selectFrom('event_bookings').selectAll().where('inquiry_id', '=', id).where('status', '!=', 'cancelled').executeTakeFirst();
  const project = await ctx.db.selectFrom('wedding_projects').select(['id', 'reference', 'status', 'contract_status']).where('inquiry_id', '=', id).executeTakeFirst();
  const notes = await ctx.db.selectFrom('customer_communications as m').leftJoin('users as u', 'u.id', 'm.staff_user_id').select(['m.id', 'm.direction', 'm.channel', 'm.subject', 'm.body', 'm.created_at', 'u.email as author']).where('m.subject_type', '=', 'inquiry').where('m.subject_id', '=', id).orderBy('m.created_at', 'desc').execute();
  const live = await checkEventAvailability(ctx.db, ctx.clock, { event_date: inquiry.event_date, ceremony_time: inquiry.ceremony_time, reception_time: inquiry.reception_time, rentals: items.filter((x) => x.rental_item_id).map((x) => ({ rental_item_id: x.rental_item_id as string, quantity: x.quantity })), exclude_booking_id: booking?.id });
  const settings = await loadSettings(ctx.db);
  return c.json({
    ...money(inquiry as Record<string, unknown>, financial),
    quote_defaults: { requires_contract: settings.events.requires_contract },
    answers: questionnaire?.answers ?? {},
    items: items.map((i) => money(i as Record<string, unknown>, financial)),
    documents,
    consultations,
    quotes: quotes.map((q) => ({ ...q, lines: quoteLines.filter((l) => l.quote_id === q.id) })),
    booking,
    project,
    notes,
    live_availability: live,
  });
});

adminWeddingRoutes.patch('/:id{[0-9a-f-]{36}}', async (c) => {
  requirePermission(c, 'weddings.manage');
  const ctx = c.get('ctx');
  const body = await readJson(
    c,
    z.object({
      event_type: z.string().trim().max(80).optional(),
      event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      ceremony_time: z.string().regex(/^\d{2}:\d{2}/).nullable().optional(),
      reception_time: z.string().regex(/^\d{2}:\d{2}/).nullable().optional(),
      venue_name: z.string().trim().max(160).nullable().optional(),
      venue_address: z.string().trim().max(240).nullable().optional(),
      guest_count: z.number().int().min(0).nullable().optional(),
      assigned_to: z.string().uuid().nullable().optional(),
      status: z.enum(['in_review', 'closed']).optional(),
    }),
  );
  const id = c.req.param('id');
  await ctx.db.transaction().execute(async (trx) => {
    const inquiry = await trx.selectFrom('wedding_inquiries').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
    if (!inquiry) throw notFound('Inquiry not found.');
    await trx.updateTable('wedding_inquiries').set(body).where('id', '=', id).execute();
    const dateChanged = (body.event_date && body.event_date !== inquiry.event_date) || body.ceremony_time !== undefined || body.reception_time !== undefined;
    if (dateChanged) {
      const settings = await loadSettings(trx);
      const nextDate = body.event_date ?? inquiry.event_date;
      const times = eventTimes(settings, nextDate, body.ceremony_time !== undefined ? body.ceremony_time : inquiry.ceremony_time, body.reception_time !== undefined ? body.reception_time : inquiry.reception_time);
      const booking = await trx.selectFrom('event_bookings').selectAll().where('inquiry_id', '=', id).where('status', '!=', 'cancelled').forUpdate().executeTakeFirst();
      if (booking && booking.status === 'inquiry') {
        await trx.updateTable('event_bookings').set({ event_date: nextDate, event_start: times.event_start, event_end: times.event_end }).where('id', '=', booking.id).execute();
      } else if (booking) {
        // A held or confirmed booking only moves if the resources exist at the new time.
        const rentals = await trx.selectFrom('rental_reservations').select(['rental_item_id', 'quantity']).where('booking_id', '=', booking.id).where('status', 'in', ['hold', 'approved', 'confirmed']).execute();
        await reserveBookingResources(trx, ctx.clock, { ...booking, event_date: nextDate }, { status: booking.status === 'hold' ? 'hold' : booking.status === 'approved' ? 'approved' : 'confirmed', holdExpiresAt: booking.hold_expires_at, times, rentals });
        await trx.updateTable('event_bookings').set({ event_date: nextDate, event_start: times.event_start, event_end: times.event_end }).where('id', '=', booking.id).execute();
        await emit(trx, 'booking.modified', { type: 'booking', id: booking.id }, { note: `Your event is now on ${nextDate}.` });
      }
    }
    await audit(trx, staffActor(c), 'inquiry.update', { type: 'inquiry', id }, body);
  });
  return c.json({ ok: true });
});

adminWeddingRoutes.post('/:id{[0-9a-f-]{36}}/stage', async (c) => {
  requirePermission(c, 'weddings.manage');
  const ctx = c.get('ctx');
  const { stage_id } = await readJson(c, z.object({ stage_id: z.string().uuid() }));
  const res = await ctx.db.updateTable('wedding_inquiries').set({ stage_id }).where('id', '=', c.req.param('id')).executeTakeFirst();
  if (!Number(res.numUpdatedRows)) throw notFound('Inquiry not found.');
  await audit(ctx.db, staffActor(c), 'inquiry.stage', { type: 'inquiry', id: c.req.param('id') }, { stage_id });
  return c.json({ ok: true });
});

adminWeddingRoutes.post('/:id{[0-9a-f-]{36}}/accept', async (c) => {
  requirePermission(c, 'weddings.manage');
  const ctx = c.get('ctx');
  const id = c.req.param('id');
  await ctx.db.transaction().execute(async (trx) => {
    await trx.updateTable('wedding_inquiries').set({ status: 'in_review' }).where('id', '=', id).execute();
    await moveToStage(trx, id, 'planning', { onlyFrom: ['new_inquiry', 'consultation_scheduled'] });
    await audit(trx, staffActor(c), 'inquiry.accept', { type: 'inquiry', id });
  });
  return c.json({ ok: true });
});

adminWeddingRoutes.post('/:id{[0-9a-f-]{36}}/decline', async (c) => {
  requirePermission(c, 'weddings.manage');
  const ctx = c.get('ctx');
  const id = c.req.param('id');
  const { reason } = await readJson(c, z.object({ reason: z.string().trim().min(1, 'Please give a reason. The customer sees it.').max(2000) }));
  await ctx.db.transaction().execute(async (trx) => {
    const inquiry = await trx.selectFrom('wedding_inquiries').select(['customer_id']).where('id', '=', id).forUpdate().executeTakeFirst();
    if (!inquiry) throw notFound('Inquiry not found.');
    await trx.updateTable('wedding_inquiries').set({ status: 'declined', decline_reason: reason }).where('id', '=', id).execute();
    await moveToStage(trx, id, 'closed');
    const booking = await trx.selectFrom('event_bookings').select('id').where('inquiry_id', '=', id).where('status', '!=', 'cancelled').executeTakeFirst();
    if (booking) {
      await releaseBookingResources(trx, booking.id);
      await trx.updateTable('event_bookings').set({ status: 'cancelled', hold_expires_at: null }).where('id', '=', booking.id).execute();
    }
    await trx.updateTable('consultations').set({ status: 'cancelled', cancelled_reason: 'Inquiry declined' }).where('inquiry_id', '=', id).where('status', '=', 'booked').execute();
    await emit(trx, 'inquiry.declined', { type: 'inquiry', id });
    await audit(trx, staffActor(c), 'inquiry.decline', { type: 'inquiry', id }, { reason });
  });
  return c.json({ ok: true });
});

adminWeddingRoutes.post('/:id{[0-9a-f-]{36}}/request-clarification', async (c) => {
  requirePermission(c, 'weddings.manage');
  const ctx = c.get('ctx');
  const id = c.req.param('id');
  const { question } = await readJson(c, z.object({ question: z.string().trim().min(1).max(2000) }));
  await ctx.db.transaction().execute(async (trx) => {
    await trx.updateTable('wedding_inquiries').set({ status: 'clarification_requested', clarification_request: question }).where('id', '=', id).execute();
    await emit(trx, 'inquiry.clarification_requested', { type: 'inquiry', id });
    await audit(trx, staffActor(c), 'inquiry.clarify', { type: 'inquiry', id });
  });
  return c.json({ ok: true });
});

adminWeddingRoutes.post('/:id{[0-9a-f-]{36}}/suggest-date', async (c) => {
  requirePermission(c, 'weddings.manage');
  const ctx = c.get('ctx');
  const id = c.req.param('id');
  const { date } = await readJson(c, z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }));
  await ctx.db.transaction().execute(async (trx) => {
    await trx.updateTable('wedding_inquiries').set({ status: 'date_suggested', suggested_date: date }).where('id', '=', id).execute();
    await emit(trx, 'inquiry.date_suggested', { type: 'inquiry', id });
    await audit(trx, staffActor(c), 'inquiry.suggest_date', { type: 'inquiry', id }, { date });
  });
  return c.json({ ok: true });
});

adminWeddingRoutes.post('/:id{[0-9a-f-]{36}}/notes', async (c) => {
  requirePermission(c, 'weddings.view');
  const ctx = c.get('ctx');
  const id = c.req.param('id');
  const { body } = await readJson(c, z.object({ body: z.string().trim().min(1).max(4000) }));
  const inquiry = await ctx.db.selectFrom('wedding_inquiries').select('customer_id').where('id', '=', id).executeTakeFirst();
  if (!inquiry) throw notFound('Inquiry not found.');
  await ctx.db.insertInto('customer_communications').values({ customer_id: inquiry.customer_id, direction: 'note', channel: 'note', body, staff_user_id: c.get('staff').userId, subject_type: 'inquiry', subject_id: id }).execute();
  return c.json({ ok: true }, 201);
});

adminWeddingRoutes.post('/:id{[0-9a-f-]{36}}/hold', async (c) => {
  requirePermission(c, 'weddings.manage');
  const ctx = c.get('ctx');
  const id = c.req.param('id');
  const { days } = await readJson(c, z.object({ days: z.number().int().min(1).max(60).default(7) }));
  await ctx.db.transaction().execute(async (trx) => {
    const inquiry = await trx.selectFrom('wedding_inquiries').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
    if (!inquiry) throw notFound('Inquiry not found.');
    const booking = await trx.selectFrom('event_bookings').selectAll().where('inquiry_id', '=', id).where('status', '!=', 'cancelled').forUpdate().executeTakeFirst();
    if (!booking) throw conflict('booking_missing', 'This inquiry has no booking.');
    if (booking.status === 'confirmed') throw conflict('already_confirmed', 'This booking is already confirmed.');
    const settings = await loadSettings(trx);
    const items = await trx.selectFrom('wedding_inquiry_items').select(['rental_item_id', 'quantity']).where('inquiry_id', '=', id).where('rental_item_id', 'is not', null).execute();
    const until = addHours(ctx.clock.now(), days * 24);
    await reserveBookingResources(trx, ctx.clock, booking, { status: 'hold', holdExpiresAt: until, times: eventTimes(settings, inquiry.event_date, inquiry.ceremony_time, inquiry.reception_time), rentals: items.map((i) => ({ rental_item_id: i.rental_item_id as string, quantity: i.quantity })) });
    await trx.updateTable('event_bookings').set({ status: 'hold', hold_expires_at: until }).where('id', '=', booking.id).execute();
    await audit(trx, staffActor(c), 'booking.hold', { type: 'booking', id: booking.id }, { days });
  });
  return c.json({ ok: true });
});

adminWeddingRoutes.post('/:id{[0-9a-f-]{36}}/release-hold', async (c) => {
  requirePermission(c, 'weddings.manage');
  const ctx = c.get('ctx');
  await ctx.db.transaction().execute(async (trx) => {
    const booking = await trx.selectFrom('event_bookings').select(['id', 'status']).where('inquiry_id', '=', c.req.param('id')).where('status', '!=', 'cancelled').forUpdate().executeTakeFirst();
    if (!booking) throw conflict('booking_missing', 'This inquiry has no booking.');
    if (booking.status === 'confirmed') throw conflict('already_confirmed', 'A confirmed booking is cancelled from its project page.');
    await releaseBookingResources(trx, booking.id);
    await trx.updateTable('event_bookings').set({ status: 'inquiry', hold_expires_at: null }).where('id', '=', booking.id).execute();
    await audit(trx, staffActor(c), 'booking.release', { type: 'booking', id: booking.id });
  });
  return c.json({ ok: true });
});

adminWeddingRoutes.post('/:id{[0-9a-f-]{36}}/quotes', async (c) => {
  requirePermission(c, 'quotes.manage');
  const body = await readJson(c, quoteSchema);
  return c.json(await createQuote(c.get('ctx'), c.req.param('id'), body, staffActor(c)), 201);
});

adminWeddingRoutes.put('/quotes/:quoteId', async (c) => {
  requirePermission(c, 'quotes.manage');
  const body = await readJson(c, quoteSchema);
  await updateDraftQuote(c.get('ctx'), c.req.param('quoteId'), body, staffActor(c));
  return c.json({ ok: true });
});

adminWeddingRoutes.post('/quotes/:quoteId/send', async (c) => {
  requirePermission(c, 'quotes.manage');
  await sendQuote(c.get('ctx'), c.req.param('quoteId'), staffActor(c));
  return c.json({ ok: true });
});

adminWeddingRoutes.get('/consultation-slots', async (c) => {
  requirePermission(c, 'weddings.view');
  const ctx = c.get('ctx');
  const r = await consultationSlots(ctx.db, ctx);
  return c.json({ ...r, slots: r.slots.map((s) => ({ start: s.start, end: s.end })) });
});

adminWeddingRoutes.post('/:id{[0-9a-f-]{36}}/consultations', async (c) => {
  requirePermission(c, 'weddings.manage');
  const body = await readJson(c, z.object({ starts_at: z.string().datetime(), format: z.string().min(1).max(60), reschedule: z.boolean().default(false) }));
  return c.json(await bookConsultation(c.get('ctx'), { inquiry_id: c.req.param('id'), starts_at: new Date(body.starts_at), format: body.format, actor: staffActor(c), replace_existing: body.reschedule }), 201);
});

adminWeddingRoutes.post('/consultations/:cid/cancel', async (c) => {
  requirePermission(c, 'weddings.manage');
  const { reason } = await readJson(c, z.object({ reason: z.string().trim().max(500).optional().nullable() }));
  await cancelConsultation(c.get('ctx'), c.req.param('cid'), reason ?? null, staffActor(c));
  return c.json({ ok: true });
});

adminWeddingRoutes.post('/consultations/:cid/complete', async (c) => {
  requirePermission(c, 'weddings.manage');
  const ctx = c.get('ctx');
  const { status, notes } = await readJson(c, z.object({ status: z.enum(['completed', 'no_show']).default('completed'), notes: z.string().max(4000).optional().nullable() }));
  await ctx.db.updateTable('consultations').set({ status, notes: notes ?? null }).where('id', '=', c.req.param('cid')).where('status', '=', 'booked').execute();
  await audit(ctx.db, staffActor(c), 'consultation.complete', { type: 'consultation', id: c.req.param('cid') }, { status });
  return c.json({ ok: true });
});

const documentRoute = async (c: C, target: { inquiry_id?: string | null; project_id?: string | null }) => {
  const ctx = c.get('ctx');
  const form = await c.req.parseBody();
  const file = form.file;
  if (!(file instanceof File)) throw badRequest('Please choose a file.');
  const buffer = Buffer.from(await file.arrayBuffer());
  const kind = z.enum(['inspiration', 'contract', 'proposal', 'other']).parse(form.kind ?? 'other');
  const isPdf = buffer.subarray(0, 4).toString() === '%PDF';
  const processed = isPdf ? processDocument(buffer) : await processImage(buffer);
  const key = privateKey(kind, processed.extension);
  await ctx.storage.put(key, processed.body, processed.mime);
  const row = await ctx.db
    .insertInto('wedding_documents')
    .values({ ...target, kind, storage_key: key, filename: safeFilename(file.name), mime_type: processed.mime, size_bytes: processed.size, sha256: processed.sha256, customer_visible: form.customer_visible === 'true', uploaded_by_user_id: c.get('staff').userId })
    .returning(['id', 'filename', 'kind'])
    .executeTakeFirstOrThrow();
  if (target.project_id && kind === 'contract') {
    await ctx.db.updateTable('wedding_projects').set({ contract_status: 'sent' }).where('id', '=', target.project_id).where('contract_status', '=', 'pending').execute();
  }
  await audit(ctx.db, staffActor(c), 'document.upload', { type: 'document', id: row.id }, { kind, ...target });
  return c.json(row, 201);
};

const uploadLimit = bodyLimit({ maxSize: MAX_DOCUMENT_BYTES + 1024 * 1024, onError: () => { throw badRequest('That file is too large.'); } });

adminWeddingRoutes.post('/:id{[0-9a-f-]{36}}/documents', uploadLimit, async (c) => {
  requirePermission(c, 'weddings.manage');
  return documentRoute(c as unknown as C, { inquiry_id: c.req.param('id') });
});

adminWeddingRoutes.post('/projects/:pid/documents', uploadLimit, async (c) => {
  requirePermission(c, 'weddings.manage');
  return documentRoute(c as unknown as C, { project_id: c.req.param('pid') });
});

/** Customer uploads are only reachable through this authorized route, never by a public URL. */
adminWeddingRoutes.get('/documents/:docId/file', async (c) => {
  requirePermission(c, 'weddings.view');
  const ctx = c.get('ctx');
  const doc = await ctx.db.selectFrom('wedding_documents').select(['storage_key', 'mime_type', 'filename']).where('id', '=', c.req.param('docId')).executeTakeFirst();
  if (!doc) throw notFound('Document not found.');
  const object = await ctx.storage.get(doc.storage_key);
  if (!object) throw notFound('Document not found.');
  c.header('Content-Type', doc.mime_type);
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Content-Disposition', doc.mime_type === 'application/pdf' ? `attachment; filename="${doc.filename.replace(/"/g, '')}"` : 'inline');
  c.header('Cache-Control', 'private, no-store');
  return c.body(new Uint8Array(object.body));
});

adminWeddingRoutes.get('/projects', async (c) => {
  requirePermission(c, 'weddings.view');
  const rows = await c
    .get('ctx')
    .db.selectFrom('wedding_projects as p')
    .innerJoin('wedding_inquiries as i', 'i.id', 'p.inquiry_id')
    .innerJoin('customers as u', 'u.id', 'p.customer_id')
    .select(['p.id', 'p.reference', 'p.status', 'p.contract_status', 'i.event_date', 'i.event_type', 'i.venue_name', 'u.name as customer_name'])
    .orderBy('i.event_date')
    .limit(500)
    .execute();
  return c.json({ projects: rows });
});

adminWeddingRoutes.get('/projects/:pid', async (c) => {
  requirePermission(c, 'weddings.view');
  const ctx = c.get('ctx');
  const id = c.req.param('pid');
  const financial = can(c, 'weddings.financials');
  const p = await ctx.db
    .selectFrom('wedding_projects as p')
    .innerJoin('wedding_inquiries as i', 'i.id', 'p.inquiry_id')
    .innerJoin('customers as u', 'u.id', 'p.customer_id')
    .select(['p.id', 'p.reference', 'p.status', 'p.contract_status', 'p.contract_signed_at', 'p.booking_id', 'p.lead_staff_id', 'p.notes', 'p.confirmed_at', 'p.inquiry_id', 'p.customer_id', 'i.event_date', 'i.event_type', 'i.venue_name', 'i.venue_address', 'i.guest_count', 'u.name as customer_name', 'u.email as customer_email', 'u.phone_e164 as customer_phone'])
    .where('p.id', '=', id)
    .executeTakeFirst();
  if (!p) throw notFound('Project not found.');
  const booking = p.booking_id ? await ctx.db.selectFrom('event_bookings').selectAll().where('id', '=', p.booking_id).executeTakeFirst() : null;
  const crews = p.booking_id ? await ctx.db.selectFrom('resource_reservations as r').innerJoin('resources as x', 'x.id', 'r.resource_id').select(['r.id', 'r.phase', 'r.starts_at', 'r.ends_at', 'r.status', 'x.name']).where('r.booking_id', '=', p.booking_id).where('r.status', '!=', 'released').orderBy('r.starts_at').execute() : [];
  const rentals = p.booking_id ? await ctx.db.selectFrom('rental_reservations as r').innerJoin('rental_items as x', 'x.id', 'r.rental_item_id').select(['r.id', 'r.quantity', 'r.starts_at', 'r.ends_at', 'r.status', 'x.name', 'r.damage_notes', 'r.condition_notes']).where('r.booking_id', '=', p.booking_id).where('r.status', '!=', 'cancelled').execute() : [];
  const tasks = await ctx.db.selectFrom('staff_tasks as t').leftJoin('staff_profiles as s', 's.id', 't.assigned_to').select(['t.id', 't.title', 't.status', 't.due_at', 't.required_capability', 't.assigned_to', 's.display_name as assignee']).where('t.subject_type', '=', 'project').where('t.subject_id', '=', id).orderBy('t.due_at').execute();
  const milestones = await ctx.db.selectFrom('project_milestones').selectAll().where('project_id', '=', id).orderBy('due_on').execute();
  const materials = await ctx.db.selectFrom('project_materials as m').innerJoin('inventory_items as i', 'i.id', 'm.item_id').select(['m.id', 'm.quantity', 'm.needed_by', 'i.name', 'i.unit', 'i.sku']).where('m.project_id', '=', id).execute();
  const documents = await ctx.db.selectFrom('wedding_documents').select(['id', 'kind', 'filename', 'mime_type', 'customer_visible', 'created_at']).where((eb) => eb.or([eb('project_id', '=', id), eb('inquiry_id', '=', p.inquiry_id)])).orderBy('created_at').execute();
  const invoices = financial ? await ctx.db.selectFrom('invoices').selectAll().where('project_id', '=', id).orderBy('created_at').execute() : [];
  const schedule = financial ? await ctx.db.selectFrom('payment_schedule_items').selectAll().where('project_id', '=', id).orderBy('sort_order').execute() : [];
  const payments = financial && invoices.length ? await ctx.db.selectFrom('payments').select(['id', 'invoice_id', 'amount_cents', 'refunded_cents', 'status', 'gateway', 'paid_at', 'kind', 'created_at']).where('invoice_id', 'in', invoices.map((i) => i.id)).orderBy('created_at').execute() : [];
  return c.json({ ...p, booking, crews, rentals, tasks, milestones, materials, documents, invoices, schedule, payments, access: { financials: financial } });
});

adminWeddingRoutes.post('/projects/:pid/contract', async (c) => {
  requirePermission(c, 'weddings.manage');
  const ctx = c.get('ctx');
  const { status } = await readJson(c, z.object({ status: z.enum(['not_required', 'pending', 'sent', 'signed']) }));
  const id = c.req.param('pid');
  if (status === 'signed') return c.json({ result: await markContractSigned(ctx, id, staffActor(c)) });
  const result = await ctx.db.transaction().execute(async (trx) => {
    await trx.updateTable('wedding_projects').set({ contract_status: status }).where('id', '=', id).execute();
    await audit(trx, staffActor(c), 'contract.status', { type: 'project', id }, { status });
    return status === 'not_required' ? tryConfirmBooking(ctx, trx, id, staffActor(c)) : 'waiting';
  });
  return c.json({ result });
});

adminWeddingRoutes.post('/projects/:pid/status', async (c) => {
  requirePermission(c, 'weddings.manage');
  const ctx = c.get('ctx');
  const { status } = await readJson(c, z.object({ status: z.enum(['in_preparation', 'event_scheduled', 'completed']) }));
  const id = c.req.param('pid');
  await ctx.db.transaction().execute(async (trx) => {
    const p = await trx.selectFrom('wedding_projects').select(['status', 'inquiry_id', 'booking_id']).where('id', '=', id).forUpdate().executeTakeFirst();
    if (!p) throw notFound('Project not found.');
    if (p.status === 'pending' || p.status === 'cancelled') throw conflict('not_confirmed', 'Only a confirmed project can move forward.');
    await trx.updateTable('wedding_projects').set({ status }).where('id', '=', id).execute();
    await moveToStage(trx, p.inquiry_id, status);
    if (status === 'completed' && p.booking_id) await trx.updateTable('event_bookings').set({ status: 'completed' }).where('id', '=', p.booking_id).execute();
    await audit(trx, staffActor(c), 'project.status', { type: 'project', id }, { status });
  });
  return c.json({ ok: true });
});

adminWeddingRoutes.post('/projects/:pid/cancel', async (c) => {
  requirePermission(c, 'weddings.manage');
  const ctx = c.get('ctx');
  const id = c.req.param('pid');
  const { reason } = await readJson(c, z.object({ reason: z.string().trim().min(1, 'Please give a reason.').max(2000) }));
  await ctx.db.transaction().execute(async (trx) => {
    const p = await trx.selectFrom('wedding_projects').select(['inquiry_id', 'booking_id']).where('id', '=', id).forUpdate().executeTakeFirst();
    if (!p) throw notFound('Project not found.');
    await trx.updateTable('wedding_projects').set({ status: 'cancelled' }).where('id', '=', id).execute();
    await trx.updateTable('wedding_inquiries').set({ status: 'closed' }).where('id', '=', p.inquiry_id).execute();
    await moveToStage(trx, p.inquiry_id, 'closed');
    await trx.updateTable('invoices').set({ status: 'void' }).where('project_id', '=', id).where('status', 'in', ['draft', 'sent']).execute();
    await sql`UPDATE staff_tasks SET status = 'cancelled' WHERE subject_type = 'project' AND subject_id = ${id} AND status IN ('open','in_progress','blocked')`.execute(trx);
    if (p.booking_id) {
      await releaseBookingResources(trx, p.booking_id);
      await trx.updateTable('event_bookings').set({ status: 'cancelled', hold_expires_at: null }).where('id', '=', p.booking_id).execute();
      await emit(trx, 'booking.cancelled', { type: 'booking', id: p.booking_id }, { note: reason });
    }
    await audit(trx, staffActor(c), 'project.cancel', { type: 'project', id }, { reason });
  });
  return c.json({ ok: true });
});

adminWeddingRoutes.post('/projects/:pid/milestones/:mid', async (c) => {
  requirePermission(c, 'weddings.manage');
  const { status } = await readJson(c, z.object({ status: z.enum(['upcoming', 'done', 'skipped']) }));
  const ctx = c.get('ctx');
  await ctx.db.updateTable('project_milestones').set({ status, completed_at: status === 'done' ? ctx.clock.now() : null }).where('id', '=', c.req.param('mid')).where('project_id', '=', c.req.param('pid')).execute();
  return c.json({ ok: true });
});

export const adminInvoiceRoutes = new Hono<AppEnv>();

adminInvoiceRoutes.post('/', async (c) => {
  requirePermission(c, 'quotes.manage');
  const ctx = c.get('ctx');
  const body = await readJson(
    c,
    z.object({
      customer_id: z.string().uuid(),
      project_id: z.string().uuid().optional().nullable(),
      kind: z.enum(['balance', 'custom']).default('custom'),
      lines: z.array(z.object({ description: z.string().trim().min(1).max(300), quantity: z.number().int().min(1), unit_price_cents: z.number().int().min(0) })).min(1),
      tax_cents: z.number().int().min(0).default(0),
      due_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
      notes: z.string().max(2000).optional().nullable(),
      send: z.boolean().default(false),
    }),
  );
  const invoice = await ctx.db.transaction().execute(async (trx) => {
    const created = await createInvoice(trx, ctx, { ...body, status: body.send ? 'sent' : 'draft', actor: staffActor(c) });
    if (body.send) await emit(trx, 'invoice.sent', { type: 'invoice', id: created.id });
    return created;
  });
  return c.json(invoice, 201);
});

adminInvoiceRoutes.post('/:id/send', async (c) => {
  requirePermission(c, 'quotes.manage');
  const ctx = c.get('ctx');
  const id = c.req.param('id');
  await ctx.db.transaction().execute(async (trx) => {
    const inv = await trx.selectFrom('invoices').select(['status']).where('id', '=', id).forUpdate().executeTakeFirst();
    if (!inv) throw notFound('Invoice not found.');
    if (inv.status === 'void' || inv.status === 'paid') throw conflict('invoice_closed', 'This invoice is closed.');
    if (inv.status === 'draft') await trx.updateTable('invoices').set({ status: 'sent', sent_at: ctx.clock.now() }).where('id', '=', id).execute();
    await emit(trx, 'invoice.sent', { type: 'invoice', id });
    await audit(trx, staffActor(c), 'invoice.send', { type: 'invoice', id });
  });
  return c.json({ ok: true });
});

adminInvoiceRoutes.post('/:id/void', async (c) => {
  requirePermission(c, 'quotes.manage');
  const ctx = c.get('ctx');
  const res = await ctx.db.updateTable('invoices').set({ status: 'void' }).where('id', '=', c.req.param('id')).where('paid_cents', '=', 0).where('status', 'in', ['draft', 'sent']).executeTakeFirst();
  if (!Number(res.numUpdatedRows)) throw conflict('invoice_closed', 'An invoice with payments on it cannot be voided. Refund it first.');
  await audit(ctx.db, staffActor(c), 'invoice.void', { type: 'invoice', id: c.req.param('id') });
  return c.json({ ok: true });
});

adminInvoiceRoutes.post('/:id/manual-payment', async (c) => {
  requirePermission(c, 'quotes.manage');
  const body = await readJson(c, z.object({ amount_cents: z.number().int().positive(), reference: z.string().trim().max(200).optional().nullable() }));
  await recordManualPayment(c.get('ctx'), { invoice_id: c.req.param('id'), amount_cents: body.amount_cents, reference: body.reference, actor: staffActor(c) });
  return c.json({ ok: true });
});

export const adminPaymentRoutes = new Hono<AppEnv>();

adminPaymentRoutes.post('/:id/refund', async (c) => {
  const staff = requirePermission(c, 'orders.refund');
  if (!staff.permissions.has('weddings.financials') && !staff.permissions.has('orders.financials')) throw forbidden();
  const body = await readJson(c, z.object({ amount_cents: z.number().int().positive(), reason: z.string().trim().min(1, 'Please give a reason.').max(1000) }));
  return c.json(await issueRefund(c.get('ctx'), { payment_id: c.req.param('id'), amount_cents: body.amount_cents, reason: body.reason, actor: staffActor(c) }));
});
