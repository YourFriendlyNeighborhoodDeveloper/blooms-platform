import { Hono } from 'hono';
import { z } from 'zod';
import { sql } from 'kysely';
import type { AppEnv } from '../http/types.js';
import { staffActor } from '../http/types.js';
import { can, csvResponse, readJson, readQuery, requirePermission } from '../http/helpers.js';
import { notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { toCsv } from '../lib/csv.js';
import { anonymizeCustomer, exportCustomerData } from '../modules/customers/privacy.js';

export const adminCustomerRoutes = new Hono<AppEnv>();

adminCustomerRoutes.get('/', async (c) => {
  requirePermission(c, 'customers.view');
  const db = c.get('ctx').db;
  const q = readQuery(c, z.object({ q: z.string().max(100).optional(), limit: z.coerce.number().int().min(1).max(500).default(100), offset: z.coerce.number().int().min(0).default(0) }));
  let query = db
    .selectFrom('customers as u')
    .select([
      'u.id', 'u.name', 'u.email', 'u.phone_e164', 'u.created_at', 'u.tags', 'u.anonymized_at',
      sql<number>`(SELECT count(*)::int FROM orders o WHERE o.customer_id = u.id AND o.status <> 'expired')`.as('order_count'),
      sql<number>`(SELECT COALESCE(sum(o.paid_cents - o.refunded_cents), 0)::int FROM orders o WHERE o.customer_id = u.id)`.as('lifetime_cents'),
      sql<number>`(SELECT count(*)::int FROM wedding_inquiries i WHERE i.customer_id = u.id)`.as('event_count'),
    ])
    .orderBy('u.created_at', 'desc')
    .limit(q.limit)
    .offset(q.offset);
  if (q.q) {
    const term = `%${q.q.replace(/[%_\\]/g, '\\$&')}%`;
    query = query.where((eb) => eb.or([eb('u.name', 'ilike', term), sql<boolean>`u.email::text ILIKE ${term}`, eb('u.phone_e164', 'like', `%${q.q?.replace(/\D/g, '') || 'x'}%`)]));
  }
  const rows = await query.execute();
  const money = can(c, 'orders.financials');
  return c.json({ customers: rows.map((r) => (money ? r : { ...r, lifetime_cents: undefined })) });
});

adminCustomerRoutes.get('/requests/data', async (c) => {
  requirePermission(c, 'customers.privacy');
  const rows = await c.get('ctx').db.selectFrom('data_requests as r').innerJoin('customers as u', 'u.id', 'r.customer_id').select(['r.id', 'r.kind', 'r.status', 'r.created_at', 'r.customer_id', 'u.name', 'u.email']).orderBy('r.created_at', 'desc').limit(200).execute();
  return c.json({ requests: rows });
});

adminCustomerRoutes.get('/:id', async (c) => {
  requirePermission(c, 'customers.view');
  const db = c.get('ctx').db;
  const id = c.req.param('id');
  const customer = await db.selectFrom('customers').selectAll().where('id', '=', id).executeTakeFirst();
  if (!customer) throw notFound('Customer not found.');
  const financial = can(c, 'orders.financials');
  const orders = await db.selectFrom('orders').select(['id', 'reference', 'status', 'payment_status', 'placed_at', 'total_cents', 'is_test']).where('customer_id', '=', id).orderBy('placed_at', 'desc').limit(100).execute();
  const events = await db.selectFrom('wedding_inquiries as i').leftJoin('wedding_projects as p', 'p.inquiry_id', 'i.id').select(['i.id', 'i.reference', 'i.event_type', 'i.event_date', 'i.status', 'p.id as project_id', 'p.status as project_status']).where('i.customer_id', '=', id).orderBy('i.event_date', 'desc').execute();
  const consultations = await db.selectFrom('consultations').select(['id', 'starts_at', 'format', 'status', 'inquiry_id']).where('customer_id', '=', id).orderBy('starts_at', 'desc').execute();
  const quotes = financial ? await db.selectFrom('quotes').select(['id', 'reference', 'status', 'total_cents', 'inquiry_id', 'created_at']).where('customer_id', '=', id).orderBy('created_at', 'desc').execute() : [];
  const invoices = financial ? await db.selectFrom('invoices').select(['id', 'number', 'kind', 'status', 'total_cents', 'paid_cents', 'due_on', 'project_id']).where('customer_id', '=', id).orderBy('created_at', 'desc').execute() : [];
  const refunds = financial
    ? await db.selectFrom('refunds as r').innerJoin('payments as p', 'p.id', 'r.payment_id').leftJoin('orders as o', 'o.id', 'p.order_id').leftJoin('invoices as inv', 'inv.id', 'p.invoice_id').select(['r.id', 'r.amount_cents', 'r.status', 'r.reason', 'r.created_at']).where((eb) => eb.or([eb('o.customer_id', '=', id), eb('inv.customer_id', '=', id)])).orderBy('r.created_at', 'desc').execute()
    : [];
  const addresses = await db.selectFrom('customer_addresses').selectAll().where('customer_id', '=', id).execute();
  const communications = await db.selectFrom('customer_communications as m').leftJoin('users as u', 'u.id', 'm.staff_user_id').select(['m.id', 'm.direction', 'm.channel', 'm.subject', 'm.body', 'm.created_at', 'u.email as author']).where('m.customer_id', '=', id).orderBy('m.created_at', 'desc').limit(200).execute();
  const consents = await db.selectFrom('customer_consents').select(['id', 'channel', 'purpose', 'granted', 'source', 'disclosure_text', 'created_at']).where('customer_id', '=', id).orderBy('created_at', 'desc').execute();
  const suppressed = customer.phone_e164 ? await db.selectFrom('sms_suppressions').select(['reason', 'created_at']).where('phone_e164', '=', customer.phone_e164).executeTakeFirst() : null;
  return c.json({ ...customer, orders: orders.map((o) => (financial ? o : { ...o, total_cents: undefined, payment_status: undefined })), events, consultations, quotes, invoices, refunds, addresses, communications, consents, sms_suppressed: suppressed ?? null, access: { financials: financial } });
});

adminCustomerRoutes.patch('/:id', async (c) => {
  requirePermission(c, 'customers.manage');
  const ctx = c.get('ctx');
  const body = await readJson(c, z.object({ name: z.string().trim().min(1).max(120).optional(), notes: z.string().max(10_000).nullable().optional(), special_requests: z.string().max(4000).nullable().optional(), tags: z.array(z.string().max(40)).max(30).optional() }));
  await ctx.db.updateTable('customers').set(body).where('id', '=', c.req.param('id')).execute();
  await audit(ctx.db, staffActor(c), 'customer.update', { type: 'customer', id: c.req.param('id') });
  return c.json({ ok: true });
});

adminCustomerRoutes.post('/:id/notes', async (c) => {
  requirePermission(c, 'customers.manage');
  const { body, channel } = await readJson(c, z.object({ body: z.string().trim().min(1).max(4000), channel: z.enum(['note', 'phone']).default('note') }));
  await c.get('ctx').db.insertInto('customer_communications').values({ customer_id: c.req.param('id'), direction: 'note', channel, body, staff_user_id: c.get('staff').userId }).execute();
  return c.json({ ok: true }, 201);
});

adminCustomerRoutes.get('/:id/export', async (c) => {
  requirePermission(c, 'customers.privacy');
  const ctx = c.get('ctx');
  const data = await exportCustomerData(ctx, c.req.param('id'));
  await audit(ctx.db, staffActor(c), 'privacy.export', { type: 'customer', id: c.req.param('id') });
  await ctx.db.updateTable('data_requests').set({ status: 'completed', completed_at: ctx.clock.now(), handled_by: c.get('staff').userId }).where('customer_id', '=', c.req.param('id')).where('kind', '=', 'export').where('status', '=', 'requested').execute();
  c.header('Content-Disposition', `attachment; filename="customer-${c.req.param('id')}.json"`);
  return c.json(data);
});

adminCustomerRoutes.post('/:id/anonymize', async (c) => {
  requirePermission(c, 'customers.privacy');
  await anonymizeCustomer(c.get('ctx'), c.req.param('id'), staffActor(c));
  return c.json({ ok: true });
});

adminCustomerRoutes.get('/export/all.csv', async (c) => {
  requirePermission(c, 'customers.privacy');
  const ctx = c.get('ctx');
  const rows = await ctx.db.selectFrom('customers').select(['name', 'email', 'phone_e164', 'created_at']).where('anonymized_at', 'is', null).orderBy('created_at').limit(50_000).execute();
  await audit(ctx.db, staffActor(c), 'customers.export', null, { rows: rows.length });
  return csvResponse(c, 'customers.csv', toCsv(rows));
});

export const adminMessageRoutes = new Hono<AppEnv>();

adminMessageRoutes.get('/', async (c) => {
  requirePermission(c, 'customers.view');
  const q = readQuery(c, z.object({ status: z.enum(['new', 'open', 'closed']).optional() }));
  let query = c.get('ctx').db.selectFrom('support_requests').selectAll().orderBy('created_at', 'desc').limit(300);
  if (q.status) query = query.where('status', '=', q.status);
  return c.json({ messages: await query.execute() });
});

adminMessageRoutes.patch('/:id', async (c) => {
  requirePermission(c, 'customers.manage');
  const body = await readJson(c, z.object({ status: z.enum(['new', 'open', 'closed']).optional(), assigned_to: z.string().uuid().nullable().optional() }));
  await c.get('ctx').db.updateTable('support_requests').set(body).where('id', '=', c.req.param('id')).execute();
  return c.json({ ok: true });
});
