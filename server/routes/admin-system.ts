import { Hono } from 'hono';
import { z } from 'zod';
import { sql } from 'kysely';
import type { AppEnv } from '../http/types.js';
import { staffActor } from '../http/types.js';
import { can, csvResponse, readJson, readQuery, requirePermission } from '../http/helpers.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { toCsv } from '../lib/csv.js';
import { addDays, addMinutes, atLocal, localDate } from '../lib/time.js';
import { renderTemplate, unknownVariables } from '../lib/template.js';
import { retryDeadJob } from '../automation/queue.js';
import { loadSettings, setApproval, updateSetting } from '../modules/settings/service.js';
import { SETTINGS_GROUPS, type SettingsGroup } from '../modules/settings/schema.js';
import { readinessChecks } from '../modules/settings/readiness.js';
import { checkIntegrity } from '../modules/system/integrity.js';
import { renderEmailHtml, sendDirect } from '../modules/notifications/service.js';
import { fulfillmentReport, salesReport, weddingsReport } from '../modules/reports/service.js';
import { googleConfigured } from '../modules/calendar/sync.js';
import { normalizeFacebookUrl } from '../modules/content/facebook.js';

export const adminSystemRoutes = new Hono<AppEnv>();

/* ---------- Overview ---------- */

adminSystemRoutes.get('/overview', async (c) => {
  const ctx = c.get('ctx');
  const staff = c.get('staff');
  const tz = (await loadSettings(ctx.db)).general.timezone;
  const today = localDate(ctx.clock.now(), tz);
  const dayStart = atLocal(today, '00:00', tz);
  const dayEnd = atLocal(addDays(today, 1, tz), '00:00', tz);
  const q = readQuery(c, z.object({ division: z.string().max(40).optional(), days: z.coerce.number().int().refine((n) => [7, 30, 90, 365].includes(n)).default(30) }));
  const divisionFilter = q.division ? sql`AND EXISTS (SELECT 1 FROM order_items i JOIN business_divisions d ON d.id = i.division_id WHERE i.order_id = o.id AND d.code = ${q.division})` : sql``;
  const financial = can(c, 'orders.financials');

  const orders = can(c, 'orders.view')
    ? (
        await sql<{ today: number; attention: number; review: number; awaiting_production: number; unfulfilled: number; paid_today: number; failed: number }>`
          SELECT
            count(*) FILTER (WHERE o.placed_at >= ${dayStart} AND o.placed_at < ${dayEnd} AND o.status NOT IN ('expired'))::int AS today,
            count(*) FILTER (WHERE o.needs_attention)::int AS attention,
            count(*) FILTER (WHERE o.status IN ('awaiting_review', 'needs_customer', 'inventory_shortage', 'delivery_failed'))::int AS review,
            count(*) FILTER (WHERE o.status = 'accepted')::int AS awaiting_production,
            count(*) FILTER (WHERE o.status IN ('accepted', 'preparing', 'ready', 'out_for_delivery', 'shipped', 'partially_fulfilled', 'rescheduling'))::int AS unfulfilled,
            COALESCE(sum(o.paid_cents) FILTER (WHERE o.placed_at >= ${dayStart} AND o.placed_at < ${dayEnd}), 0)::int AS paid_today,
            count(*) FILTER (WHERE o.status = 'payment_failed')::int AS failed
          FROM orders o WHERE true ${divisionFilter}
        `.execute(ctx.db)
      ).rows[0]
    : null;

  const weddings = can(c, 'weddings.view')
    ? (
        await sql<{ pending: number; upcoming_consultations: number; upcoming_events: number }>`
          SELECT
            (SELECT count(*)::int FROM wedding_inquiries i JOIN pipeline_stages s ON s.id = i.stage_id WHERE s.code = 'new_inquiry') AS pending,
            (SELECT count(*)::int FROM consultations c WHERE c.status = 'booked' AND c.starts_at >= ${ctx.clock.now()} AND c.starts_at < ${atLocal(addDays(today, 14, tz), '00:00', tz)}) AS upcoming_consultations,
            (SELECT count(*)::int FROM event_bookings b WHERE b.status = 'confirmed' AND b.event_date >= ${today} AND b.event_date <= ${addDays(today, 60, tz)}) AS upcoming_events
        `.execute(ctx.db)
      ).rows[0]
    : null;

  const deliveries = can(c, 'deliveries.view')
    ? await ctx.db
        .selectFrom('deliveries as d')
        .innerJoin('fulfillments as f', 'f.id', 'd.fulfillment_id')
        .innerJoin('orders as o', 'o.id', 'f.order_id')
        .leftJoin('staff_profiles as s', 's.id', 'd.driver_staff_id')
        .select(['d.id', 'd.status', 'f.window_start', 'f.window_end', 'o.reference', 'o.id as order_id', 's.display_name as driver_name'])
        .where('f.scheduled_date', '=', today)
        .where('o.status', 'not in', ['cancelled', 'rejected', 'expired', 'awaiting_payment', 'payment_failed', 'payment_processing'])
        .orderBy('f.window_start')
        .limit(30)
        .execute()
    : [];

  const lowStock = can(c, 'inventory.view')
    ? await ctx.db.selectFrom('low_stock_events as e').innerJoin('inventory_items as i', 'i.id', 'e.item_id').select(['i.id', 'i.name', 'e.available', 'e.threshold', 'i.unit']).where('e.resolved_at', 'is', null).orderBy('e.available').limit(10).execute()
    : [];

  const invoices = financial || can(c, 'weddings.financials')
    ? (
        await sql<{ outstanding: number; overdue: number; count: number }>`
          SELECT COALESCE(sum(total_cents - paid_cents), 0)::int AS outstanding,
            COALESCE(sum(total_cents - paid_cents) FILTER (WHERE due_on < ${today}), 0)::int AS overdue,
            count(*)::int AS count
          FROM invoices WHERE status IN ('sent', 'partially_paid')
        `.execute(ctx.db)
      ).rows[0]
    : null;

  const alerts = can(c, 'system.manage') || staff.roles.includes('owner')
    ? await ctx.db.selectFrom('system_alerts').select(['id', 'code', 'severity', 'title', 'detail', 'link', 'created_at']).where('status', '=', 'open').orderBy('created_at', 'desc').limit(15).execute()
    : [];

  const tasks = staff.staffId
    ? await ctx.db.selectFrom('staff_tasks').select(['id', 'title', 'status', 'due_at', 'subject_type', 'subject_id']).where('assigned_to', '=', staff.staffId).where('status', 'in', ['open', 'in_progress']).orderBy(sql`due_at NULLS LAST`).limit(10).execute()
    : [];

  const capacity = can(c, 'orders.view')
    ? (
        await sql<{ orders: number; points: number; minutes: number }>`
          SELECT count(*) FILTER (WHERE counts_as_order)::int AS orders, COALESCE(sum(points), 0)::int AS points, COALESCE(sum(prep_minutes), 0)::int AS minutes
          FROM capacity_claims WHERE status = 'active' AND claim_date = ${today}
        `.execute(ctx.db)
      ).rows[0]
    : null;

  const periodFrom = atLocal(addDays(today, -(q.days - 1), tz), '00:00', tz);
  const period = financial
    ? await (async () => {
        const includeTest = !ctx.payments.livemode;
        const sales = await salesReport(ctx.db, { from: periodFrom, to: dayEnd, division: q.division, includeTest });
        const cancelled = await sql<{ n: number }>`
          SELECT count(*)::int AS n FROM orders o WHERE o.status IN ('cancelled', 'rejected') AND o.updated_at >= ${periodFrom} AND o.updated_at < ${dayEnd} ${includeTest ? sql`` : sql`AND o.is_test = false`} ${divisionFilter}
        `.execute(ctx.db);
        return { days: q.days, gross_cents: sales.gross_cents, refunds_cents: sales.refunds_cents, net_cents: sales.net_cents, orders: sales.orders, cancellations: cancelled.rows[0].n };
      })()
    : null;

  const settings = await loadSettings(ctx.db);
  return c.json({
    today,
    period,
    orders,
    weddings,
    deliveries,
    low_stock: lowStock,
    invoices,
    alerts,
    my_tasks: tasks,
    capacity: capacity && { ...capacity, max_orders: settings.ordering.daily_order_limit, max_points: settings.ordering.daily_points_limit },
    show_financials: financial,
    test_mode: !ctx.payments.livemode,
  });
});

/* ---------- Settings ---------- */

adminSystemRoutes.get('/settings', async (c) => {
  requirePermission(c, 'settings.manage');
  const ctx = c.get('ctx');
  return c.json({ ...(await loadSettings(ctx.db)), integration_status: { payments: ctx.payments.name, livemode: ctx.payments.livemode, email: ctx.email.name, email_real: ctx.email.deliversForReal, sms: ctx.sms.enabled, storage: ctx.storage.name, google_calendar: googleConfigured(ctx.env) } });
});

adminSystemRoutes.put('/settings/:group', async (c) => {
  requirePermission(c, 'settings.manage');
  const group = c.req.param('group') as SettingsGroup;
  if (!SETTINGS_GROUPS.includes(group)) throw notFound('Unknown settings group.');
  const body = await c.req.json().catch(() => {
    throw badRequest('Expected a JSON body.');
  });
  const value = await updateSetting(c.get('ctx').db, group, body, staffActor(c));
  return c.json({ value, warnings: (await readinessChecks(c.get('ctx'))).warnings });
});

adminSystemRoutes.post('/settings/:group/approval', async (c) => {
  const staff = requirePermission(c, 'settings.manage');
  if (!staff.roles.includes('owner')) throw badRequest('Only an owner can approve business policies.');
  const group = c.req.param('group') as SettingsGroup;
  if (!SETTINGS_GROUPS.includes(group)) throw notFound('Unknown settings group.');
  const { approved } = await readJson(c, z.object({ approved: z.boolean() }));
  await setApproval(c.get('ctx').db, group, approved, staffActor(c));
  return c.json({ ok: true });
});

adminSystemRoutes.get('/readiness', async (c) => {
  requirePermission(c, 'settings.manage');
  return c.json(await readinessChecks(c.get('ctx')));
});

/** A person confirms that a restore from backup was actually tested. The checklist shows when, and asks again after 90 days. */
adminSystemRoutes.post('/readiness/backups', async (c) => {
  const staff = requirePermission(c, 'settings.manage');
  if (!staff.roles.includes('owner')) throw forbidden('Only an owner can record this.');
  const ctx = c.get('ctx');
  const now = ctx.clock.now();
  await ctx.db
    .insertInto('integration_settings')
    .values({ provider: 'backups', enabled: true, last_verified_at: now, updated_by: staff.userId })
    .onConflict((oc) => oc.column('provider').doUpdateSet({ enabled: true, last_verified_at: now, updated_by: staff.userId }))
    .execute();
  await audit(ctx.db, staffActor(c), 'backups.restore_tested', { type: 'settings' });
  return c.json({ ok: true });
});

/* ---------- Templates and rules ---------- */

const SAMPLE = {
  business: { name: 'Sample Shop', phone: '(555) 555-0100', address: '100 Sample St', email: 'hello@example.test' },
  customer: { name: 'Sample Customer', first_name: 'Sample', email: 'sample@example.test', phone: '(555) 555-0123' },
  order: { reference: 'BL-SAMP-LE12', total: '$73.60', items_text: '1 × Sample Bouquet', fulfillment_text: 'Pickup: Wed, Nov 11, 10:00 AM – 6:00 PM', tracking_url: 'https://example.test/track/sample', admin_url: 'https://example.test/admin/orders/sample', review_reasons: 'Sample reason.', hold_until: 'Wed, Nov 11 at 5:00 PM EST', payment_note: 'You have not been charged.', refund_note: 'You were not charged.', reason: 'Sample reason.' },
  payment: { amount: '$73.60', for: 'order BL-SAMP-LE12', link: 'https://example.test/pay/sample', admin_url: 'https://example.test/admin', reason: 'Sample reason.' },
  refund: { amount: '$10.00', for: 'order BL-SAMP-LE12', reason: 'Sample reason.' },
  inquiry: { reference: 'EV-SAMP-LE12', event_type: 'Wedding', event_date: 'Saturday, June 12, 2027', guest_count: 120, venue: 'Sample Barn', budget: '$2,500 – $5,000', availability_text: 'The team will confirm availability.', portal_url: 'https://example.test/plan/sample', admin_url: 'https://example.test/admin/weddings/sample', clarification: 'Sample question.', suggested_date: 'Saturday, June 19, 2027', decline_reason: 'Sample reason.' },
  consultation: { when: 'Mon, Jan 11 at 2:00 PM EST', format: 'In the shop', staff_name: 'Sample Staff' },
  quote: { reference: 'QT-SAMP-LE12', total: '$3,200.00', deposit: '$800.00', valid_until: 'January 25, 2027', url: 'https://example.test/quote/sample' },
  invoice: { number: 'INV-2027-0001', amount_due: '$800.00', due_on: 'January 25, 2027', url: 'https://example.test/pay/sample', admin_url: 'https://example.test/admin' },
  booking: { hold_until: 'Jan 18 at 5:00 PM EST', next_step: 'Your booking is now being confirmed.' },
  project: { url: 'https://example.test/project/sample' },
  milestone: { title: 'Final counts due', description: 'Confirm your final guest count.', due: 'May 29, 2027' },
  event: { items_text: '1 × Sample Bouquet', note: 'Sample note.', reason: 'Sample reason.', tracking_text: 'UPS tracking: 1Z999', days_until: 7 },
  item: { name: 'Sample Stem', sku: 'SAMPLE-1', unit: 'stem', available: 3, threshold: 10, admin_url: 'https://example.test/admin/inventory' },
  support: { reference: 'MSG-SAMP-LE12', name: 'Sample Customer', email: 'sample@example.test', topic: 'Flowers', message: 'Sample message.', admin_url: 'https://example.test/admin' },
  rental: { name: 'Sample Arch', quantity: 1, due: 'Sun, Jun 13 at 11:00 AM EDT', admin_url: 'https://example.test/admin/rentals' },
  job: { kind: 'notification.deliver', attempts: 8, error: 'Sample error', admin_url: 'https://example.test/admin/system/jobs' },
  login: { url: 'https://example.test/account/verify/sample' },
  invite: { url: 'https://example.test/admin/invite/sample' },
  reset: { url: 'https://example.test/admin/reset/sample' },
  cart: { url: 'https://example.test/cart' },
  preferences: { url: 'https://example.test/preferences/sample' },
};

const flatten = (o: Record<string, unknown>, prefix = ''): string[] =>
  Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? flatten(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`]));
const KNOWN_VARIABLES = flatten(SAMPLE);

adminSystemRoutes.get('/templates', async (c) => {
  requirePermission(c, 'templates.manage');
  const db = c.get('ctx').db;
  return c.json({ templates: await db.selectFrom('notification_templates').selectAll().orderBy('audience').orderBy('name').execute(), variables: KNOWN_VARIABLES, rules: await db.selectFrom('automation_rules').selectAll().orderBy('event_type').execute() });
});

adminSystemRoutes.put('/templates/:id', async (c) => {
  requirePermission(c, 'templates.manage');
  const ctx = c.get('ctx');
  const body = await readJson(c, z.object({ subject: z.string().max(300).nullable().optional(), body: z.string().min(1).max(10_000), enabled: z.boolean().optional() }));
  const unknown = unknownVariables(`${body.subject ?? ''} ${body.body}`, KNOWN_VARIABLES);
  if (unknown.length) throw badRequest(`These placeholders are not recognized: ${unknown.join(', ')}`);
  const tpl = await ctx.db.selectFrom('notification_templates').select(['channel', 'code']).where('id', '=', c.req.param('id')).executeTakeFirst();
  if (!tpl) throw notFound('Template not found.');
  if (tpl.channel === 'sms' && !/stop/i.test(body.body)) throw badRequest('Text messages must keep the "Reply STOP to opt out" wording.');
  await ctx.db.updateTable('notification_templates').set({ ...body, updated_by: c.get('staff').userId }).where('id', '=', c.req.param('id')).execute();
  await audit(ctx.db, staffActor(c), 'template.update', { type: 'template', id: c.req.param('id') }, { code: tpl.code });
  return c.json({ ok: true });
});

adminSystemRoutes.post('/templates/:id/preview', async (c) => {
  requirePermission(c, 'templates.manage');
  const ctx = c.get('ctx');
  const body = await readJson(c, z.object({ subject: z.string().max(300).nullable().optional(), body: z.string().max(10_000).optional() }));
  const tpl = await ctx.db.selectFrom('notification_templates').selectAll().where('id', '=', c.req.param('id')).executeTakeFirst();
  if (!tpl) throw notFound('Template not found.');
  const text = renderTemplate(body.body ?? tpl.body, SAMPLE);
  return c.json({ subject: renderTemplate(body.subject ?? tpl.subject ?? '', SAMPLE), text, html: tpl.channel === 'email' ? renderEmailHtml(text, SAMPLE.business.name) : null, segments: tpl.channel === 'sms' ? Math.ceil(text.length / 160) : null });
});

adminSystemRoutes.post('/templates/:id/test', async (c) => {
  const staff = requirePermission(c, 'templates.manage');
  const ctx = c.get('ctx');
  const tpl = await ctx.db.selectFrom('notification_templates').select(['code', 'channel']).where('id', '=', c.req.param('id')).executeTakeFirst();
  if (!tpl) throw notFound('Template not found.');
  if (tpl.channel !== 'email') throw badRequest('Test sends are for email templates. Texts are never sent to real numbers from here.');
  // A test only ever goes to the signed-in staff member, never to a customer.
  await sendDirect(ctx, { template: tpl.code, to: staff.email, staffUserId: staff.userId, audience: 'staff', dedupe: `test:${tpl.code}:${staff.userId}:${ctx.clock.now().getTime()}`, vars: SAMPLE });
  return c.json({ sent_to: staff.email });
});

adminSystemRoutes.get('/notifications', async (c) => {
  requirePermission(c, 'templates.manage');
  const q = readQuery(c, z.object({ status: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }));
  let query = c.get('ctx').db.selectFrom('notifications').select(['id', 'template_code', 'channel', 'audience', 'recipient', 'subject', 'status', 'status_reason', 'created_at', 'sent_at', 'delivered_at']).orderBy('created_at', 'desc').limit(q.limit);
  if (q.status) query = query.where('status', '=', q.status as 'failed');
  return c.json({ notifications: await query.execute() });
});

adminSystemRoutes.patch('/rules/:id', async (c) => {
  requirePermission(c, 'templates.manage');
  const ctx = c.get('ctx');
  const body = await readJson(c, z.object({ enabled: z.boolean().optional(), config: z.record(z.string(), z.unknown()).optional() }));
  await ctx.db.updateTable('automation_rules').set({ ...(body.enabled !== undefined ? { enabled: body.enabled } : {}), ...(body.config ? { config: JSON.stringify(body.config) } : {}) }).where('id', '=', c.req.param('id')).execute();
  await audit(ctx.db, staffActor(c), 'rule.update', { type: 'rule', id: c.req.param('id') }, body);
  return c.json({ ok: true });
});

adminSystemRoutes.post('/rules', async (c) => {
  requirePermission(c, 'templates.manage');
  const ctx = c.get('ctx');
  const body = await readJson(c, z.object({ event_type: z.string().min(1).max(60), action: z.enum(['notify_customer', 'notify_staff', 'create_task']), config: z.record(z.string(), z.unknown()) }));
  return c.json(await ctx.db.insertInto('automation_rules').values({ event_type: body.event_type, action: body.action, config: JSON.stringify(body.config) }).returning('id').executeTakeFirstOrThrow(), 201);
});

/* ---------- Jobs, webhooks, alerts, audit ---------- */

adminSystemRoutes.get('/system/jobs', async (c) => {
  requirePermission(c, 'system.manage');
  const db = c.get('ctx').db;
  const q = readQuery(c, z.object({ status: z.string().default('dead') }));
  const jobs = await db.selectFrom('automation_jobs').select(['id', 'kind', 'status', 'attempts', 'max_attempts', 'run_at', 'last_error', 'created_at', 'finished_at', 'payload']).where('status', '=', q.status as 'dead').orderBy('updated_at', 'desc').limit(200).execute();
  const counts = await sql<{ status: string; n: number }>`SELECT status, count(*)::int AS n FROM automation_jobs GROUP BY status`.execute(db);
  const workers = await db.selectFrom('worker_heartbeats').selectAll().orderBy('last_seen_at', 'desc').limit(10).execute();
  const pendingEvents = await db.selectFrom('automation_events').select((eb) => eb.fn.countAll<number>().as('n')).where('status', '=', 'pending').executeTakeFirstOrThrow();
  return c.json({ jobs, counts: counts.rows, workers, pending_events: Number(pendingEvents.n) });
});

adminSystemRoutes.post('/system/jobs/:id/retry', async (c) => {
  requirePermission(c, 'system.manage');
  const ctx = c.get('ctx');
  await retryDeadJob(ctx.db, ctx.clock, c.req.param('id'));
  await audit(ctx.db, staffActor(c), 'job.retry', { type: 'job', id: c.req.param('id') });
  return c.json({ ok: true });
});

adminSystemRoutes.get('/system/webhooks', async (c) => {
  requirePermission(c, 'system.manage');
  const rows = await c.get('ctx').db.selectFrom('webhook_events').select(['id', 'provider', 'event_id', 'event_type', 'status', 'attempts', 'error', 'received_at', 'processed_at']).orderBy('received_at', 'desc').limit(200).execute();
  return c.json({ webhooks: rows });
});

adminSystemRoutes.get('/system/alerts', async (c) => {
  requirePermission(c, 'system.manage');
  return c.json({ alerts: await c.get('ctx').db.selectFrom('system_alerts').selectAll().where('status', '!=', 'resolved').orderBy('created_at', 'desc').limit(200).execute() });
});

adminSystemRoutes.post('/system/alerts/:id/resolve', async (c) => {
  requirePermission(c, 'system.manage');
  const ctx = c.get('ctx');
  await ctx.db.updateTable('system_alerts').set({ status: 'resolved', resolved_at: ctx.clock.now(), resolved_by: c.get('staff').userId }).where('id', '=', c.req.param('id')).execute();
  return c.json({ ok: true });
});

adminSystemRoutes.get('/system/audit', async (c) => {
  requirePermission(c, 'audit.view');
  const q = readQuery(c, z.object({ action: z.string().max(60).optional(), limit: z.coerce.number().int().min(1).max(500).default(200) }));
  let query = c.get('ctx').db.selectFrom('audit_logs').selectAll().orderBy('created_at', 'desc').limit(q.limit);
  if (q.action) query = query.where('action', 'like', `${q.action}%`);
  return c.json({ entries: await query.execute() });
});

adminSystemRoutes.get('/system/integrity', async (c) => {
  requirePermission(c, 'system.manage');
  return c.json(await checkIntegrity(c.get('ctx').db));
});

adminSystemRoutes.get('/system/health', async (c) => {
  requirePermission(c, 'system.manage');
  const ctx = c.get('ctx');
  const beat = await ctx.db.selectFrom('worker_heartbeats').select('last_seen_at').orderBy('last_seen_at', 'desc').limit(1).executeTakeFirst();
  let storage = true;
  try {
    await ctx.storage.verify();
  } catch {
    storage = false;
  }
  return c.json({ worker_last_seen: beat?.last_seen_at ?? null, worker_ok: Boolean(beat && beat.last_seen_at > addMinutes(ctx.clock.now(), -5)), storage_ok: storage, env: ctx.env.APP_ENV, warnings: ctx.env.warnings });
});

/* ---------- Reports ---------- */

const reportQuery = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), division: z.string().max(40).optional(), include_test: z.enum(['true', 'false']).optional() });

const rangeOf = async (c: any): Promise<{ from: Date; to: Date; division: string | null; includeTest: boolean }> => {
  const q = readQuery(c, reportQuery);
  const tz = (await loadSettings(c.get('ctx').db)).general.timezone;
  // In test mode everything is test data, so reports would otherwise always be empty.
  const includeTest = q.include_test === 'true' || (q.include_test === undefined && !c.get('ctx').payments.livemode);
  return { from: atLocal(q.from, '00:00', tz), to: atLocal(addDays(q.to, 1, tz), '00:00', tz), division: q.division ?? null, includeTest };
};

adminSystemRoutes.get('/reports/sales', async (c) => {
  requirePermission(c, 'reports.financials');
  return c.json({ ...(await salesReport(c.get('ctx').db, await rangeOf(c))), test_data_included: (await rangeOf(c)).includeTest });
});

adminSystemRoutes.get('/reports/operations', async (c) => {
  requirePermission(c, 'reports.view');
  return c.json({ ...(await fulfillmentReport(c.get('ctx').db, await rangeOf(c))), test_data_included: (await rangeOf(c)).includeTest });
});

adminSystemRoutes.get('/reports/weddings', async (c) => {
  requirePermission(c, 'reports.view');
  const report = await weddingsReport(c.get('ctx').db, await rangeOf(c));
  const financial = can(c, 'reports.financials');
  return c.json(financial ? report : { ...report, confirmed_revenue_cents: undefined, outstanding_receivables_cents: undefined, overdue_receivables_cents: undefined });
});

adminSystemRoutes.get('/reports/sales.csv', async (c) => {
  requirePermission(c, 'reports.financials');
  const range = await rangeOf(c);
  const report = await salesReport(c.get('ctx').db, range);
  const d = (n: number | null) => (n === null ? '' : (n / 100).toFixed(2));
  const rows = [
    { metric: 'Orders', value: report.orders },
    { metric: 'Gross sales', value: d(report.gross_cents) },
    { metric: 'Refunds', value: d(report.refunds_cents) },
    { metric: 'Net sales', value: d(report.net_cents) },
    { metric: 'Average order', value: d(report.average_order_cents) },
    { metric: 'Sales tax collected', value: d(report.tax_collected_cents) },
    { metric: 'Delivery fees', value: d(report.delivery_cents) },
    { metric: 'Discounts given', value: d(report.discounts_cents) },
    ...report.by_division.map((x) => ({ metric: `Division: ${x.division}`, value: d(x.item_sales) })),
    ...report.best_sellers.map((x) => ({ metric: `Product: ${x.name}`, value: d(x.sales) })),
  ];
  return csvResponse(c, 'sales-report.csv', toCsv(rows));
});

/* ---------- Marketing: Facebook and content ---------- */

const videoSchema = z.object({ url: z.string().trim().url(), title: z.string().max(200).nullable().optional(), caption: z.string().max(1000).nullable().optional(), kind: z.enum(['video', 'live']).default('video'), enabled: z.boolean().default(true), featured: z.boolean().default(false), cta_label: z.string().max(60).nullable().optional(), cta_url: z.string().max(300).nullable().optional(), sort_order: z.number().int().default(0) });

const checkCta = (url?: string | null) => {
  if (url && !url.startsWith('/') && !/^https:\/\//.test(url)) throw badRequest('A call-to-action link must be a page on this site or an https link.');
};

adminSystemRoutes.get('/marketing/videos', async (c) => {
  requirePermission(c, 'marketing.manage');
  return c.json({ videos: await c.get('ctx').db.selectFrom('facebook_videos').selectAll().orderBy('sort_order').orderBy('created_at', 'desc').execute() });
});

adminSystemRoutes.post('/marketing/videos', async (c) => {
  requirePermission(c, 'marketing.manage');
  const ctx = c.get('ctx');
  const body = await readJson(c, videoSchema);
  checkCta(body.cta_url);
  const row = await ctx.db.transaction().execute(async (trx) => {
    if (body.featured) await trx.updateTable('facebook_videos').set({ featured: false }).where('featured', '=', true).execute();
    return trx.insertInto('facebook_videos').values({ ...body, url: normalizeFacebookUrl(body.url), created_by: c.get('staff').userId }).returning('id').executeTakeFirstOrThrow();
  });
  await audit(ctx.db, staffActor(c), 'facebook.add', { type: 'video', id: row.id });
  return c.json(row, 201);
});

adminSystemRoutes.put('/marketing/videos/:id', async (c) => {
  requirePermission(c, 'marketing.manage');
  const ctx = c.get('ctx');
  const body = await readJson(c, videoSchema);
  checkCta(body.cta_url);
  await ctx.db.transaction().execute(async (trx) => {
    if (body.featured) await trx.updateTable('facebook_videos').set({ featured: false }).where('featured', '=', true).where('id', '!=', c.req.param('id')).execute();
    await trx.updateTable('facebook_videos').set({ ...body, url: normalizeFacebookUrl(body.url) }).where('id', '=', c.req.param('id')).execute();
  });
  return c.json({ ok: true });
});

adminSystemRoutes.delete('/marketing/videos/:id', async (c) => {
  requirePermission(c, 'marketing.manage');
  await c.get('ctx').db.deleteFrom('facebook_videos').where('id', '=', c.req.param('id')).execute();
  return c.json({ ok: true });
});

const contentSchema = z.object({ slot: z.string().trim().min(1).max(40), title: z.string().trim().min(1).max(200), body: z.string().max(2000).nullable().optional(), image_url: z.string().max(500).nullable().optional(), link_label: z.string().max(60).nullable().optional(), link_url: z.string().max(300).nullable().optional(), active: z.boolean().default(false), starts_at: z.string().datetime().nullable().optional(), ends_at: z.string().datetime().nullable().optional(), sort_order: z.number().int().default(0) });

adminSystemRoutes.get('/marketing/content', async (c) => {
  requirePermission(c, 'marketing.manage');
  return c.json({ blocks: await c.get('ctx').db.selectFrom('content_blocks').selectAll().orderBy('slot').orderBy('sort_order').execute() });
});

adminSystemRoutes.post('/marketing/content', async (c) => {
  requirePermission(c, 'marketing.manage');
  const body = await readJson(c, contentSchema);
  checkCta(body.link_url);
  return c.json(await c.get('ctx').db.insertInto('content_blocks').values({ ...body, updated_by: c.get('staff').userId }).returning('id').executeTakeFirstOrThrow(), 201);
});

adminSystemRoutes.put('/marketing/content/:id', async (c) => {
  requirePermission(c, 'marketing.manage');
  const body = await readJson(c, contentSchema);
  checkCta(body.link_url);
  await c.get('ctx').db.updateTable('content_blocks').set({ ...body, updated_by: c.get('staff').userId }).where('id', '=', c.req.param('id')).execute();
  return c.json({ ok: true });
});

adminSystemRoutes.delete('/marketing/content/:id', async (c) => {
  requirePermission(c, 'marketing.manage');
  await c.get('ctx').db.deleteFrom('content_blocks').where('id', '=', c.req.param('id')).execute();
  return c.json({ ok: true });
});
