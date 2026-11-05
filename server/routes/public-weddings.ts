import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { AppEnv, C } from '../http/types.js';
import { customerActor } from '../http/types.js';
import { readJson, readQuery } from '../http/helpers.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { enforceRateLimit } from '../lib/ratelimit.js';
import { hashToken, randomToken, resolveAccessToken, type TokenPurpose } from '../lib/tokens.js';
import { loadSettings } from '../modules/settings/service.js';
import { checkEventAvailability } from '../modules/weddings/availability.js';
import { computeEstimate } from '../modules/weddings/estimate.js';
import { eventInfoSchema, planSchema, plannerOptions, publicInquiryView, selectionSchema, submitPlan } from '../modules/weddings/planner.js';
import { bookConsultation, cancelConsultation, consultationSlots } from '../modules/weddings/consultations.js';
import { acceptQuote, declineQuote, publicQuoteView } from '../modules/weddings/quotes.js';
import { publicInvoiceView, publicProjectView, startInvoicePayment } from '../modules/weddings/billing.js';
import { MAX_IMAGE_BYTES, privateKey, processImage, safeFilename } from '../modules/uploads.js';

export const publicWeddingRoutes = new Hono<AppEnv>();

const tokenSubject = async (c: C, purposes: TokenPurpose[], message = 'This link has expired or is not valid. Please contact the shop for a new one.') => {
  const ctx = c.get('ctx');
  const token = await resolveAccessToken(ctx.db, ctx.clock, c.req.param('token') ?? '', purposes);
  if (!token?.subject_id) throw notFound(message);
  return token.subject_id;
};

publicWeddingRoutes.get('/planner/options', async (c) => {
  const ctx = c.get('ctx');
  const options = await plannerOptions(ctx.db, ctx.clock);
  return c.json({ ...options, sms_available: ctx.sms.enabled });
});

const estimateSchema = z.object({ selections: z.array(selectionSchema).max(100), guest_count: z.number().int().min(0).max(5000).optional().nullable() });

publicWeddingRoutes.post('/planner/estimate', async (c) => {
  const ctx = c.get('ctx');
  await enforceRateLimit(ctx.db, ctx.clock, `estimate:${c.get('ip')}`, 60, 60);
  const body = await readJson(c, estimateSchema);
  return c.json(await computeEstimate(ctx.db, await loadSettings(ctx.db), body.selections, body.guest_count));
});

publicWeddingRoutes.post('/planner/availability', async (c) => {
  const ctx = c.get('ctx');
  await enforceRateLimit(ctx.db, ctx.clock, `event-availability:${c.get('ip')}`, 60, 60);
  const body = await readJson(c, eventInfoSchema.pick({ event_date: true, ceremony_time: true, reception_time: true }).extend({ rentals: z.array(z.object({ rental_item_id: z.string().uuid(), quantity: z.number().int().min(1) })).optional() }));
  return c.json(await checkEventAvailability(ctx.db, ctx.clock, body));
});

/** Inspiration photos, uploaded before the inquiry exists. Scoped by a draft token only this browser holds. */
publicWeddingRoutes.post('/planner/uploads', bodyLimit({ maxSize: MAX_IMAGE_BYTES + 512 * 1024, onError: () => { throw badRequest('Images must be 10 MB or smaller.'); } }), async (c) => {
  const ctx = c.get('ctx');
  await enforceRateLimit(ctx.db, ctx.clock, `upload:${c.get('ip')}`, 30, 600);
  const form = await c.req.parseBody();
  const file = form.file;
  if (!(file instanceof File)) throw badRequest('Please choose a file.');
  const draftToken = typeof form.draft_token === 'string' && form.draft_token.length >= 20 ? form.draft_token : randomToken();
  const existing = await ctx.db
    .selectFrom('wedding_documents')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('draft_token_hash', '=', hashToken(draftToken))
    .executeTakeFirstOrThrow();
  if (Number(existing.n) >= 12) throw badRequest('You can add up to 12 photos.');
  const processed = await processImage(Buffer.from(await file.arrayBuffer()));
  const key = privateKey('inspiration', processed.extension);
  await ctx.storage.put(key, processed.body, processed.mime);
  const row = await ctx.db
    .insertInto('wedding_documents')
    .values({ kind: 'inspiration', storage_key: key, filename: safeFilename(file.name), mime_type: processed.mime, size_bytes: processed.size, sha256: processed.sha256, draft_token_hash: hashToken(draftToken), customer_visible: true })
    .returning(['id', 'filename'])
    .executeTakeFirstOrThrow();
  return c.json({ id: row.id, filename: row.filename, draft_token: draftToken }, 201);
});

publicWeddingRoutes.delete('/planner/uploads/:id', async (c) => {
  const ctx = c.get('ctx');
  const { draft_token } = await readJson(c, z.object({ draft_token: z.string().min(20).max(200) }));
  const doc = await ctx.db.selectFrom('wedding_documents').select(['id', 'storage_key']).where('id', '=', c.req.param('id')).where('draft_token_hash', '=', hashToken(draft_token)).where('inquiry_id', 'is', null).executeTakeFirst();
  if (!doc) throw notFound('Photo not found.');
  await ctx.db.deleteFrom('wedding_documents').where('id', '=', doc.id).execute();
  await ctx.storage.delete(doc.storage_key).catch(() => {});
  return c.json({ deleted: true });
});

publicWeddingRoutes.get('/planner/uploads/:id/file', async (c) => {
  const ctx = c.get('ctx');
  const { token } = readQuery(c, z.object({ token: z.string().min(20).max(200) }));
  const doc = await ctx.db.selectFrom('wedding_documents').select(['storage_key', 'mime_type']).where('id', '=', c.req.param('id')).where('draft_token_hash', '=', hashToken(token)).executeTakeFirst();
  if (!doc) throw notFound('Photo not found.');
  const object = await ctx.storage.get(doc.storage_key);
  if (!object) throw notFound('Photo not found.');
  c.header('Content-Type', doc.mime_type);
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Cache-Control', 'private, no-store');
  return c.body(new Uint8Array(object.body));
});

publicWeddingRoutes.post('/planner/submit', async (c) => {
  const ctx = c.get('ctx');
  await enforceRateLimit(ctx.db, ctx.clock, `plan:${c.get('ip')}`, 8, 600);
  const body = await readJson(c, planSchema);
  if (body.website) return c.json({ reference: 'EV-RECEIVED', portal_token: null, availability: null }, 201);
  const result = await submitPlan(ctx, body, customerActor(c), c.req.header('user-agent'));
  return c.json({ reference: result.reference, portal_token: result.portal_token, availability: result.availability }, 201);
});

publicWeddingRoutes.get('/plan/:token', async (c) => c.json(await publicInquiryView(c.get('ctx'), await tokenSubject(c, ['inquiry_access']))));

/** Serves a customer's own document for an inquiry or project link they hold. Only customer-visible files. */
publicWeddingRoutes.get('/plan/:token/documents/:id', async (c) => {
  const ctx = c.get('ctx');
  const inquiryId = await tokenSubject(c, ['inquiry_access']);
  const doc = await ctx.db.selectFrom('wedding_documents').select(['storage_key', 'mime_type', 'filename']).where('id', '=', c.req.param('id')).where('inquiry_id', '=', inquiryId).where('customer_visible', '=', true).executeTakeFirst();
  if (!doc) throw notFound('Document not found.');
  const object = await ctx.storage.get(doc.storage_key);
  if (!object) throw notFound('Document not found.');
  c.header('Content-Type', doc.mime_type);
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Content-Disposition', doc.mime_type === 'application/pdf' ? `attachment; filename="${doc.filename.replace(/"/g, '')}"` : 'inline');
  c.header('Cache-Control', 'private, no-store');
  return c.body(new Uint8Array(object.body));
});

/** The same for a project link, covering files the team has shared with the customer. */
publicWeddingRoutes.get('/project/:token/documents/:id', async (c) => {
  const ctx = c.get('ctx');
  const projectId = await tokenSubject(c, ['project_access']);
  const project = await ctx.db.selectFrom('wedding_projects').select('inquiry_id').where('id', '=', projectId).executeTakeFirst();
  if (!project) throw notFound('Document not found.');
  const doc = await ctx.db.selectFrom('wedding_documents').select(['storage_key', 'mime_type', 'filename']).where('id', '=', c.req.param('id')).where('inquiry_id', '=', project.inquiry_id).where('customer_visible', '=', true).executeTakeFirst();
  if (!doc) throw notFound('Document not found.');
  const object = await ctx.storage.get(doc.storage_key);
  if (!object) throw notFound('Document not found.');
  c.header('Content-Type', doc.mime_type);
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Content-Disposition', doc.mime_type === 'application/pdf' ? `attachment; filename="${doc.filename.replace(/"/g, '')}"` : 'inline');
  c.header('Cache-Control', 'private, no-store');
  return c.body(new Uint8Array(object.body));
});

publicWeddingRoutes.get('/plan/:token/consultation-slots', async (c) => {
  const ctx = c.get('ctx');
  await tokenSubject(c, ['inquiry_access']);
  const q = readQuery(c, z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), days: z.coerce.number().int().min(1).max(180).optional() }));
  const result = await consultationSlots(ctx.db, ctx, q.from, q.days);
  return c.json({ ...result, slots: result.slots.map((s) => ({ start: s.start, end: s.end })) });
});

publicWeddingRoutes.post('/plan/:token/consultation', async (c) => {
  const ctx = c.get('ctx');
  await enforceRateLimit(ctx.db, ctx.clock, `consult:${c.get('ip')}`, 20, 600);
  const inquiryId = await tokenSubject(c, ['inquiry_access']);
  const body = await readJson(c, z.object({ starts_at: z.string().datetime(), format: z.string().min(1).max(60), reschedule: z.boolean().default(false) }));
  const booked = await bookConsultation(ctx, { inquiry_id: inquiryId, starts_at: new Date(body.starts_at), format: body.format, actor: customerActor(c), replace_existing: body.reschedule });
  return c.json({ starts_at: booked.starts_at, ends_at: booked.ends_at }, 201);
});

publicWeddingRoutes.delete('/plan/:token/consultation', async (c) => {
  const ctx = c.get('ctx');
  const inquiryId = await tokenSubject(c, ['inquiry_access']);
  const current = await ctx.db.selectFrom('consultations').select('id').where('inquiry_id', '=', inquiryId).where('status', '=', 'booked').executeTakeFirst();
  if (!current) throw conflict('not_booked', 'There is no consultation to cancel.');
  await cancelConsultation(ctx, current.id, 'Cancelled by customer', customerActor(c));
  return c.json({ cancelled: true });
});

publicWeddingRoutes.get('/quotes/:token', async (c) => c.json(await publicQuoteView(c.get('ctx'), await tokenSubject(c, ['quote_access']))));

publicWeddingRoutes.post('/quotes/:token/accept', async (c) => {
  const ctx = c.get('ctx');
  await enforceRateLimit(ctx.db, ctx.clock, `quote-accept:${c.get('ip')}`, 10, 600);
  const quoteId = await tokenSubject(c, ['quote_access']);
  const body = await readJson(c, z.object({ name: z.string().trim().min(2, 'Please type your full name.').max(160), agree: z.literal(true, { message: 'Please confirm that you accept this quote.' }) }));
  const result = await acceptQuote(ctx, quoteId, { name: body.name, ip: c.get('ip') }, customerActor(c));
  const invoice = await ctx.db.selectFrom('invoices').select('id').where('quote_id', '=', quoteId).where('kind', '=', 'deposit').executeTakeFirst();
  let pay_token: string | null = null;
  if (invoice) {
    const { mintAccessToken } = await import('../lib/tokens.js');
    pay_token = await mintAccessToken(ctx.db, ctx.clock, { purpose: 'invoice_access', subjectId: invoice.id, ttlMinutes: 60 * 24 * 30 });
  }
  return c.json({ status: result.status, pay_token });
});

publicWeddingRoutes.post('/quotes/:token/decline', async (c) => {
  const ctx = c.get('ctx');
  const quoteId = await tokenSubject(c, ['quote_access']);
  const body = await readJson(c, z.object({ reason: z.string().trim().max(1000).optional().nullable() }));
  await declineQuote(ctx, quoteId, body.reason ?? null, customerActor(c));
  return c.json({ declined: true });
});

publicWeddingRoutes.get('/pay/:token', async (c) => c.json(await publicInvoiceView(c.get('ctx'), await tokenSubject(c, ['invoice_access']))));

publicWeddingRoutes.post('/pay/:token', async (c) => {
  const ctx = c.get('ctx');
  await enforceRateLimit(ctx.db, ctx.clock, `invoice-pay:${c.get('ip')}`, 20, 60);
  const invoiceId = await tokenSubject(c, ['invoice_access']);
  const body = await readJson(c, z.object({ amount_cents: z.number().int().positive().optional().nullable() }));
  return c.json(await startInvoicePayment(ctx, invoiceId, c.req.param('token') ?? '', body.amount_cents));
});

publicWeddingRoutes.get('/project/:token', async (c) => c.json(await publicProjectView(c.get('ctx'), await tokenSubject(c, ['project_access']))));
