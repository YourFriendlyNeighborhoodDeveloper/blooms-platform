import { Hono } from 'hono';
import { z } from 'zod';
import { sql } from 'kysely';
import type { AppEnv } from '../http/types.js';
import { staffActor } from '../http/types.js';
import { readJson, readQuery, requirePermission } from '../http/helpers.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { addMinutes, weekdayOf } from '../lib/time.js';
import { emit } from '../automation/events.js';
import { mintAccessToken } from '../lib/tokens.js';
import { toE164 } from '../lib/phone.js';
import { revokeAllForUser } from '../auth/sessions.js';
import { createStaffUser } from '../auth/staff.js';
import { sendDirect } from '../modules/notifications/service.js';
import { calendarRange } from '../modules/calendar/feed.js';
import { rescheduleFulfillment } from '../modules/orders/actions.js';
import { loadSettings, businessTimezone } from '../modules/settings/service.js';
import { eventTimes, reserveBookingResources } from '../modules/weddings/availability.js';
import { bookConsultation } from '../modules/weddings/consultations.js';

export const adminOpsRoutes = new Hono<AppEnv>();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:\d{2})?$/);

/* ---------- Calendar ---------- */

adminOpsRoutes.get('/calendar', async (c) => {
  requirePermission(c, 'calendar.view');
  const q = readQuery(c, z.object({ from: isoDate, to: isoDate, kinds: z.string().optional(), staff_id: z.string().uuid().optional() }));
  if (q.to < q.from) throw badRequest('The end date is before the start date.');
  return c.json(await calendarRange(c.get('ctx').db, { from: q.from, to: q.to, kinds: q.kinds ? q.kinds.split(',') : undefined, staff_id: q.staff_id }));
});

/** Drag and drop lands here. Nothing moves until the same rules that protect customers have approved the new time. */
adminOpsRoutes.post('/calendar/move', async (c) => {
  requirePermission(c, 'calendar.manage');
  const ctx = c.get('ctx');
  const body = await readJson(c, z.object({ kind: z.enum(['consultation', 'event', 'delivery', 'pickup', 'task', 'custom']), id: z.string().uuid(), date: isoDate, time: hhmm.optional() }));
  const tz = await businessTimezone(ctx.db);
  const actor = staffActor(c);

  if (body.kind === 'task') {
    const t = await ctx.db.selectFrom('staff_tasks').select('due_at').where('id', '=', body.id).executeTakeFirst();
    if (!t) throw notFound('Task not found.');
    const { DateTime } = await import('luxon');
    const prev = t.due_at ? DateTime.fromJSDate(t.due_at, { zone: tz }).toFormat('HH:mm') : '09:00';
    const due = DateTime.fromISO(`${body.date}T${(body.time ?? prev).slice(0, 5)}`, { zone: tz }).toJSDate();
    await ctx.db.updateTable('staff_tasks').set({ due_at: due }).where('id', '=', body.id).execute();
    await audit(ctx.db, actor, 'task.move', { type: 'task', id: body.id }, { to: body.date });
    return c.json({ ok: true });
  }

  if (body.kind === 'custom') {
    const entry = await ctx.db.selectFrom('calendar_entries').select(['starts_at', 'ends_at']).where('id', '=', body.id).executeTakeFirst();
    if (!entry) throw notFound('Entry not found.');
    const { DateTime } = await import('luxon');
    const prev = DateTime.fromJSDate(entry.starts_at, { zone: tz });
    const next = DateTime.fromISO(`${body.date}T${(body.time ?? prev.toFormat('HH:mm')).slice(0, 5)}`, { zone: tz }).toJSDate();
    await ctx.db.updateTable('calendar_entries').set({ starts_at: next, ends_at: new Date(next.getTime() + (entry.ends_at.getTime() - entry.starts_at.getTime())) }).where('id', '=', body.id).execute();
    return c.json({ ok: true });
  }

  if (body.kind === 'consultation') {
    const k = await ctx.db.selectFrom('consultations').select(['inquiry_id', 'starts_at', 'format', 'status']).where('id', '=', body.id).executeTakeFirst();
    if (!k || !k.inquiry_id) throw notFound('Consultation not found.');
    if (k.status !== 'booked') throw conflict('not_booked', 'This consultation is not active.');
    const { DateTime } = await import('luxon');
    const time = (body.time ?? DateTime.fromJSDate(k.starts_at, { zone: tz }).toFormat('HH:mm')).slice(0, 5);
    const start = DateTime.fromISO(`${body.date}T${time}`, { zone: tz }).toJSDate();
    const booked = await bookConsultation(ctx, { inquiry_id: k.inquiry_id, starts_at: start, format: k.format, actor, replace_existing: true });
    return c.json({ ok: true, starts_at: booked.starts_at });
  }

  if (body.kind === 'delivery' || body.kind === 'pickup') {
    const f = await ctx.db.selectFrom('fulfillments as f').leftJoin('delivery_windows as w', 'w.id', 'f.window_id').select(['f.id', 'f.method', 'w.start_time', 'w.zone_id']).where('f.id', '=', body.id).executeTakeFirst();
    if (!f) throw notFound('Fulfilment not found.');
    const weekday = weekdayOf(body.date, tz);
    const candidates = await ctx.db.selectFrom('delivery_windows').select(['id', 'start_time', 'zone_id']).where('kind', '=', f.method as 'pickup').where('weekday', '=', weekday).where('active', '=', true).orderBy('start_time').execute();
    const window = candidates.find((w) => w.start_time === f.start_time && w.zone_id === f.zone_id) ?? candidates.find((w) => w.zone_id === f.zone_id) ?? candidates[0];
    if (!window) throw conflict('no_window', 'There is no delivery or pickup window on that day.');
    return c.json(await rescheduleFulfillment(ctx, f.id, { date: body.date, window_id: window.id }, actor));
  }

  // Event: resources are re-reserved at the new time, or the move is refused and nothing changes.
  await ctx.db.transaction().execute(async (trx) => {
    const booking = await trx.selectFrom('event_bookings').selectAll().where('id', '=', body.id).forUpdate().executeTakeFirst();
    if (!booking) throw notFound('Booking not found.');
    const inquiry = await trx.selectFrom('wedding_inquiries').select(['ceremony_time', 'reception_time']).where('id', '=', booking.inquiry_id).executeTakeFirstOrThrow();
    const settings = await loadSettings(trx);
    const times = eventTimes(settings, body.date, inquiry.ceremony_time, inquiry.reception_time);
    if (booking.status !== 'inquiry') {
      const rentals = await trx.selectFrom('rental_reservations').select(['rental_item_id', 'quantity']).where('booking_id', '=', booking.id).where('status', 'in', ['hold', 'approved', 'confirmed']).execute();
      await reserveBookingResources(trx, ctx.clock, { ...booking, event_date: body.date }, { status: booking.status === 'hold' ? 'hold' : booking.status === 'approved' ? 'approved' : 'confirmed', holdExpiresAt: booking.hold_expires_at, times, rentals });
      await emit(trx, 'booking.modified', { type: 'booking', id: booking.id }, { note: `Your event has moved to ${body.date}.` });
    }
    await trx.updateTable('event_bookings').set({ event_date: body.date, event_start: times.event_start, event_end: times.event_end }).where('id', '=', booking.id).execute();
    await trx.updateTable('wedding_inquiries').set({ event_date: body.date }).where('id', '=', booking.inquiry_id).execute();
    await audit(trx, actor, 'booking.move', { type: 'booking', id: booking.id }, { from: booking.event_date, to: body.date });
  });
  return c.json({ ok: true });
});

adminOpsRoutes.post('/calendar/entries', async (c) => {
  requirePermission(c, 'calendar.manage');
  const ctx = c.get('ctx');
  const body = await readJson(c, z.object({ title: z.string().trim().min(1).max(200), starts_at: z.string().datetime(), ends_at: z.string().datetime(), all_day: z.boolean().default(false), staff_id: z.string().uuid().nullable().optional(), notes: z.string().max(2000).nullable().optional() }));
  if (new Date(body.ends_at) < new Date(body.starts_at)) throw badRequest('The end is before the start.');
  return c.json(await ctx.db.insertInto('calendar_entries').values({ ...body, created_by: c.get('staff').userId }).returning('id').executeTakeFirstOrThrow(), 201);
});

adminOpsRoutes.delete('/calendar/entries/:id', async (c) => {
  requirePermission(c, 'calendar.manage');
  await c.get('ctx').db.deleteFrom('calendar_entries').where('id', '=', c.req.param('id')).execute();
  return c.json({ ok: true });
});

adminOpsRoutes.post('/calendar/feed-link', async (c) => {
  const staff = requirePermission(c, 'calendar.view');
  const ctx = c.get('ctx');
  const token = await mintAccessToken(ctx.db, ctx.clock, { purpose: 'calendar_feed', subjectId: staff.staffId, ttlMinutes: 60 * 24 * 365 });
  return c.json({ url: `${ctx.env.PUBLIC_BASE_URL}/api/calendar/feed/${token}.ics` });
});

/* ---------- Tasks ---------- */

adminOpsRoutes.get('/tasks', async (c) => {
  requirePermission(c, 'tasks.view');
  const ctx = c.get('ctx');
  const q = readQuery(c, z.object({ status: z.string().optional(), mine: z.enum(['true']).optional(), assignee: z.string().uuid().optional() }));
  let query = ctx.db.selectFrom('staff_tasks as t').leftJoin('staff_profiles as s', 's.id', 't.assigned_to').select(['t.id', 't.title', 't.description', 't.status', 't.priority', 't.due_at', 't.est_minutes', 't.required_capability', 't.assigned_to', 't.subject_type', 't.subject_id', 's.display_name as assignee']).orderBy(sql`t.due_at NULLS LAST`).limit(500);
  if (q.status === 'open' || !q.status) query = query.where('t.status', 'in', ['open', 'in_progress', 'blocked']);
  else query = query.where('t.status', '=', q.status as 'done');
  if (q.mine) query = query.where('t.assigned_to', '=', c.get('staff').staffId);
  if (q.assignee) query = query.where('t.assigned_to', '=', q.assignee);
  return c.json({ tasks: await query.execute() });
});

const taskSchema = z.object({ title: z.string().trim().min(1).max(300), description: z.string().max(4000).nullable().optional(), priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'), due_at: z.string().datetime().nullable().optional(), est_minutes: z.number().int().min(0).nullable().optional(), assigned_to: z.string().uuid().nullable().optional(), required_capability: z.string().max(40).nullable().optional(), subject_type: z.string().max(30).nullable().optional(), subject_id: z.string().uuid().nullable().optional() });

adminOpsRoutes.post('/tasks', async (c) => {
  requirePermission(c, 'tasks.manage');
  return c.json(await c.get('ctx').db.insertInto('staff_tasks').values({ ...(await readJson(c, taskSchema)), created_by: c.get('staff').userId }).returning('id').executeTakeFirstOrThrow(), 201);
});

adminOpsRoutes.patch('/tasks/:id', async (c) => {
  requirePermission(c, 'tasks.manage');
  const ctx = c.get('ctx');
  const body = await readJson(c, taskSchema.partial().extend({ status: z.enum(['open', 'in_progress', 'blocked', 'done', 'cancelled']).optional() }));
  const res = await ctx.db
    .updateTable('staff_tasks')
    .set({ ...body, ...(body.status === 'done' ? { completed_at: ctx.clock.now(), completed_by: c.get('staff').userId } : {}) })
    .where('id', '=', c.req.param('id'))
    .executeTakeFirst();
  if (!Number(res.numUpdatedRows)) throw notFound('Task not found.');
  return c.json({ ok: true });
});

/* ---------- Deliveries ---------- */

adminOpsRoutes.get('/deliveries', async (c) => {
  const staff = requirePermission(c, 'deliveries.view');
  const ctx = c.get('ctx');
  const q = readQuery(c, z.object({ date: isoDate.optional(), status: z.string().optional(), mine: z.enum(['true']).optional() }));
  let query = ctx.db
    .selectFrom('deliveries as d')
    .innerJoin('fulfillments as f', 'f.id', 'd.fulfillment_id')
    .innerJoin('orders as o', 'o.id', 'f.order_id')
    .leftJoin('delivery_zones as z', 'z.id', 'd.zone_id')
    .leftJoin('staff_profiles as s', 's.id', 'd.driver_staff_id')
    .leftJoin('delivery_vehicles as v', 'v.id', 'd.vehicle_id')
    .select([
      'd.id', 'd.status', 'd.driver_staff_id', 'd.vehicle_id', 'd.route_id', 'd.stop_sequence', 'd.attempt', 'd.proof_note', 'd.failure_reason', 'd.dispatched_at', 'd.delivered_at', 'f.id as fulfillment_id', 'f.scheduled_date', 'f.window_start', 'f.window_end', 'f.address', 'f.instructions', 'f.recipient_name', 'f.recipient_phone', 'f.order_id', 'o.reference', 'o.status as order_status', 'z.name as zone_name', 's.display_name as driver_name', 'v.name as vehicle_name',
      sql<string>`(SELECT string_agg(i.quantity || ' × ' || i.name, ', ') FROM fulfillment_items fi JOIN order_items i ON i.id = fi.order_item_id WHERE fi.fulfillment_id = f.id)`.as('items_text'),
      sql<string[]>`(SELECT array_agg(fi.order_item_id) FROM fulfillment_items fi WHERE fi.fulfillment_id = f.id)`.as('item_ids'),
    ])
    .where('o.status', 'not in', ['cancelled', 'rejected', 'expired', 'awaiting_payment', 'payment_processing', 'payment_failed'])
    .orderBy('f.window_start')
    .limit(500);
  if (q.date) query = query.where('f.scheduled_date', '=', q.date);
  if (q.status) query = query.where('d.status', '=', q.status as 'assigned');
  // Delivery staff see their own runs. Managers see everything.
  if (q.mine || !staff.permissions.has('orders.view')) query = query.where('d.driver_staff_id', '=', staff.staffId);
  return c.json({ deliveries: await query.execute() });
});

adminOpsRoutes.post('/deliveries/:id/assign', async (c) => {
  requirePermission(c, 'deliveries.manage');
  const ctx = c.get('ctx');
  const body = await readJson(c, z.object({ driver_staff_id: z.string().uuid().nullable().optional(), vehicle_id: z.string().uuid().nullable().optional(), route_id: z.string().uuid().nullable().optional(), stop_sequence: z.number().int().min(0).nullable().optional() }));
  const id = c.req.param('id');
  await ctx.db.transaction().execute(async (trx) => {
    const d = await trx.selectFrom('deliveries as d').innerJoin('fulfillments as f', 'f.id', 'd.fulfillment_id').select(['d.status', 'f.scheduled_date', 'f.window_start', 'f.window_end']).where('d.id', '=', id).forUpdate().executeTakeFirst();
    if (!d) throw notFound('Delivery not found.');
    if (body.driver_staff_id && d.scheduled_date) {
      const off = await trx.selectFrom('staff_time_off').select('id').where('staff_id', '=', body.driver_staff_id).where('starts_on', '<=', d.scheduled_date).where('ends_on', '>=', d.scheduled_date).executeTakeFirst();
      if (off) throw conflict('driver_off', 'That driver is off on this date.');
    }
    await trx.updateTable('deliveries').set({ ...body, status: d.status === 'scheduled' && body.driver_staff_id ? 'assigned' : d.status }).where('id', '=', id).execute();
    await audit(trx, staffActor(c), 'delivery.assign', { type: 'delivery', id }, body);
  });
  return c.json({ ok: true });
});

adminOpsRoutes.post('/deliveries/:id/proof', async (c) => {
  requirePermission(c, 'deliveries.manage');
  const ctx = c.get('ctx');
  const { note } = await readJson(c, z.object({ note: z.string().trim().min(1, 'Please describe the proof of delivery.').max(1000) }));
  await ctx.db.updateTable('deliveries').set({ proof_note: note }).where('id', '=', c.req.param('id')).execute();
  await audit(ctx.db, staffActor(c), 'delivery.proof', { type: 'delivery', id: c.req.param('id') });
  return c.json({ ok: true });
});

adminOpsRoutes.post('/deliveries/:id/retry', async (c) => {
  requirePermission(c, 'deliveries.manage');
  const ctx = c.get('ctx');
  await ctx.db.updateTable('deliveries').set((eb) => ({ attempt: eb('attempt', '+', 1), status: 'rescheduled', failure_reason: null })).where('id', '=', c.req.param('id')).where('status', '=', 'failed').execute();
  await audit(ctx.db, staffActor(c), 'delivery.retry', { type: 'delivery', id: c.req.param('id') });
  return c.json({ ok: true });
});

const zoneSchema = z.object({ name: z.string().trim().min(1).max(100), postal_codes: z.array(z.string().regex(/^\d{5}$/, 'ZIP codes must be 5 digits.')).min(1, 'Add at least one ZIP code.'), fee_cents: z.number().int().min(0), min_order_cents: z.number().int().min(0).default(0), travel_minutes: z.number().int().min(0).nullable().optional(), active: z.boolean().default(true), notes: z.string().max(500).nullable().optional(), sort_order: z.number().int().default(0) });

adminOpsRoutes.get('/delivery-setup', async (c) => {
  requirePermission(c, 'deliveries.view');
  const db = c.get('ctx').db;
  return c.json({
    zones: await db.selectFrom('delivery_zones').selectAll().orderBy('sort_order').execute(),
    windows: await db.selectFrom('delivery_windows').selectAll().orderBy('weekday').orderBy('start_time').execute(),
    vehicles: await db.selectFrom('delivery_vehicles').selectAll().orderBy('name').execute(),
    routes: await db.selectFrom('delivery_routes').selectAll().orderBy('route_date', 'desc').limit(100).execute(),
    drivers: await db.selectFrom('staff_profiles').select(['id', 'display_name']).where('active', '=', true).where(sql<boolean>`'delivery' = ANY(capabilities)`).execute(),
  });
});

adminOpsRoutes.post('/zones', async (c) => {
  requirePermission(c, 'delivery.settings');
  const row = await c.get('ctx').db.insertInto('delivery_zones').values(await readJson(c, zoneSchema)).returning('id').executeTakeFirstOrThrow();
  await audit(c.get('ctx').db, staffActor(c), 'zone.create', { type: 'zone', id: row.id });
  return c.json(row, 201);
});

adminOpsRoutes.put('/zones/:id', async (c) => {
  requirePermission(c, 'delivery.settings');
  await c.get('ctx').db.updateTable('delivery_zones').set(await readJson(c, zoneSchema)).where('id', '=', c.req.param('id')).execute();
  await audit(c.get('ctx').db, staffActor(c), 'zone.update', { type: 'zone', id: c.req.param('id') });
  return c.json({ ok: true });
});

const windowSchema = z.object({ kind: z.enum(['delivery', 'pickup']), zone_id: z.string().uuid().nullable().optional(), division_id: z.string().uuid().nullable().optional(), weekday: z.number().int().min(0).max(6), start_time: hhmm, end_time: hhmm, cutoff_minutes: z.number().int().min(0).default(0), max_stops: z.number().int().min(0).nullable().optional(), active: z.boolean().default(true) });

adminOpsRoutes.post('/windows', async (c) => {
  requirePermission(c, 'delivery.settings');
  const body = await readJson(c, windowSchema);
  if (body.end_time <= body.start_time) throw badRequest('The window must end after it starts.');
  return c.json(await c.get('ctx').db.insertInto('delivery_windows').values(body).returning('id').executeTakeFirstOrThrow(), 201);
});

adminOpsRoutes.put('/windows/:id', async (c) => {
  requirePermission(c, 'delivery.settings');
  const body = await readJson(c, windowSchema);
  if (body.end_time <= body.start_time) throw badRequest('The window must end after it starts.');
  await c.get('ctx').db.updateTable('delivery_windows').set(body).where('id', '=', c.req.param('id')).execute();
  return c.json({ ok: true });
});

adminOpsRoutes.delete('/windows/:id', async (c) => {
  requirePermission(c, 'delivery.settings');
  await c.get('ctx').db.updateTable('delivery_windows').set({ active: false }).where('id', '=', c.req.param('id')).execute();
  return c.json({ ok: true });
});

const vehicleSchema = z.object({ name: z.string().trim().min(1).max(100), max_stops: z.number().int().min(0).nullable().optional(), active: z.boolean().default(true), notes: z.string().max(500).nullable().optional() });

adminOpsRoutes.post('/vehicles', async (c) => {
  requirePermission(c, 'delivery.settings');
  return c.json(await c.get('ctx').db.insertInto('delivery_vehicles').values(await readJson(c, vehicleSchema)).returning('id').executeTakeFirstOrThrow(), 201);
});

adminOpsRoutes.put('/vehicles/:id', async (c) => {
  requirePermission(c, 'delivery.settings');
  await c.get('ctx').db.updateTable('delivery_vehicles').set(await readJson(c, vehicleSchema)).where('id', '=', c.req.param('id')).execute();
  return c.json({ ok: true });
});

adminOpsRoutes.post('/routes', async (c) => {
  requirePermission(c, 'deliveries.manage');
  const body = await readJson(c, z.object({ route_date: isoDate, name: z.string().max(100).nullable().optional(), driver_staff_id: z.string().uuid().nullable().optional(), vehicle_id: z.string().uuid().nullable().optional(), notes: z.string().max(1000).nullable().optional() }));
  return c.json(await c.get('ctx').db.insertInto('delivery_routes').values(body).returning('id').executeTakeFirstOrThrow(), 201);
});

/* ---------- Staff assignments ---------- */

const assignmentSubject = z.enum(['order', 'project']);
const assignmentPermission = { order: 'orders.manage', project: 'weddings.manage' } as const;
const assignmentView = { order: 'orders.view', project: 'weddings.view' } as const;

adminOpsRoutes.get('/assignments', async (c) => {
  const q = readQuery(c, z.object({ subject_type: assignmentSubject, subject_id: z.string().uuid() }));
  requirePermission(c, assignmentView[q.subject_type]);
  const db = c.get('ctx').db;
  return c.json({
    assignments: await db
      .selectFrom('staff_assignments as a')
      .innerJoin('staff_profiles as s', 's.id', 'a.staff_id')
      .select(['a.id', 'a.staff_id', 'a.role', 's.display_name'])
      .where('a.subject_type', '=', q.subject_type)
      .where('a.subject_id', '=', q.subject_id)
      .orderBy('a.created_at')
      .execute(),
    staff: await db.selectFrom('staff_profiles').select(['id', 'display_name', 'job_title']).where('active', '=', true).orderBy('display_name').execute(),
  });
});

adminOpsRoutes.post('/assignments', async (c) => {
  const body = await readJson(c, z.object({ subject_type: assignmentSubject, subject_id: z.string().uuid(), staff_id: z.string().uuid(), role: z.string().trim().max(80).nullable().optional() }));
  const staff = requirePermission(c, assignmentPermission[body.subject_type]);
  const ctx = c.get('ctx');
  const dates =
    body.subject_type === 'order'
      ? await ctx.db.selectFrom('fulfillments').select('scheduled_date as date').where('order_id', '=', body.subject_id).where('scheduled_date', 'is not', null).execute()
      : await ctx.db.selectFrom('wedding_projects as p').innerJoin('event_bookings as b', 'b.id', 'p.booking_id').select('b.event_date as date').where('p.id', '=', body.subject_id).execute();
  const row = await ctx.db
    .insertInto('staff_assignments')
    .values({ staff_id: body.staff_id, subject_type: body.subject_type, subject_id: body.subject_id, role: body.role ?? null, created_by: staff.userId })
    .onConflict((oc) => oc.columns(['staff_id', 'subject_type', 'subject_id']).doUpdateSet({ role: body.role ?? null }))
    .returning('id')
    .executeTakeFirstOrThrow();
  await audit(ctx.db, staffActor(c), 'assignment.create', { type: body.subject_type, id: body.subject_id }, { staff_id: body.staff_id, role: body.role ?? null });
  // Allowed, because preparation can happen on other days, but the person assigning should know.
  let warning: string | null = null;
  for (const { date } of dates) {
    if (!date) continue;
    const off = await ctx.db.selectFrom('staff_time_off').select('id').where('staff_id', '=', body.staff_id).where('starts_on', '<=', date).where('ends_on', '>=', date).executeTakeFirst();
    if (off) warning = `Assigned, but this person is off on ${date}.`;
  }
  return c.json({ id: row.id, warning }, 201);
});

adminOpsRoutes.delete('/assignments/:id', async (c) => {
  const ctx = c.get('ctx');
  const row = await ctx.db.selectFrom('staff_assignments').select(['id', 'subject_type', 'subject_id', 'staff_id']).where('id', '=', c.req.param('id')).executeTakeFirst();
  if (!row) throw notFound('Assignment not found.');
  requirePermission(c, assignmentPermission[row.subject_type as 'order' | 'project']);
  await ctx.db.deleteFrom('staff_assignments').where('id', '=', row.id).execute();
  await audit(ctx.db, staffActor(c), 'assignment.delete', { type: row.subject_type, id: row.subject_id }, { staff_id: row.staff_id });
  return c.json({ ok: true });
});

/* ---------- Hours and blackouts ---------- */

adminOpsRoutes.get('/hours', async (c) => {
  requirePermission(c, 'settings.manage');
  return c.json({ hours: await c.get('ctx').db.selectFrom('business_hours').selectAll().where('division_id', 'is', null).orderBy('weekday').execute() });
});

adminOpsRoutes.put('/hours', async (c) => {
  requirePermission(c, 'settings.manage');
  const ctx = c.get('ctx');
  const body = await readJson(c, z.object({ days: z.array(z.object({ weekday: z.number().int().min(0).max(6), closed: z.boolean(), opens_at: hhmm.nullable().optional(), closes_at: hhmm.nullable().optional() })).length(7) }));
  await ctx.db.transaction().execute(async (trx) => {
    await trx.deleteFrom('business_hours').where('division_id', 'is', null).execute();
    for (const d of body.days) {
      if (!d.closed && (!d.opens_at || !d.closes_at || d.closes_at <= d.opens_at)) throw badRequest('Each open day needs an opening time before its closing time.');
      await trx.insertInto('business_hours').values({ weekday: d.weekday, closed: d.closed, opens_at: d.closed ? null : d.opens_at, closes_at: d.closed ? null : d.closes_at }).execute();
    }
    await audit(trx, staffActor(c), 'hours.update', null, { days: body.days });
  });
  return c.json({ ok: true });
});

const blackoutSchema = z.object({ scope: z.enum(['business', 'division', 'resource']).default('business'), division_id: z.string().uuid().nullable().optional(), resource_id: z.string().uuid().nullable().optional(), starts_on: isoDate, ends_on: isoDate, reason: z.enum(['closure', 'holiday', 'weather', 'capacity', 'special_event', 'other']).default('closure'), affects: z.array(z.enum(['orders', 'pickup', 'delivery', 'shipping', 'consultations', 'events'])).default([]), public_message: z.string().max(300).nullable().optional(), note: z.string().max(500).nullable().optional() });

adminOpsRoutes.get('/blackouts', async (c) => {
  requirePermission(c, 'settings.manage');
  return c.json({ blackouts: await c.get('ctx').db.selectFrom('blackout_rules').selectAll().orderBy('starts_on', 'desc').limit(200).execute() });
});

adminOpsRoutes.post('/blackouts', async (c) => {
  requirePermission(c, 'settings.manage');
  const ctx = c.get('ctx');
  const body = await readJson(c, blackoutSchema);
  if (body.ends_on < body.starts_on) throw badRequest('The end date is before the start date.');
  const row = await ctx.db.insertInto('blackout_rules').values({ ...body, created_by: c.get('staff').userId }).returning('id').executeTakeFirstOrThrow();
  await audit(ctx.db, staffActor(c), 'blackout.create', { type: 'blackout', id: row.id }, body);
  return c.json(row, 201);
});

adminOpsRoutes.delete('/blackouts/:id', async (c) => {
  requirePermission(c, 'settings.manage');
  const ctx = c.get('ctx');
  await ctx.db.deleteFrom('blackout_rules').where('id', '=', c.req.param('id')).execute();
  await audit(ctx.db, staffActor(c), 'blackout.delete', { type: 'blackout', id: c.req.param('id') });
  return c.json({ ok: true });
});

adminOpsRoutes.get('/capacity-overrides', async (c) => {
  requirePermission(c, 'settings.manage');
  return c.json({ overrides: await c.get('ctx').db.selectFrom('capacity_overrides').selectAll().orderBy('on_date', 'desc').limit(200).execute() });
});

adminOpsRoutes.put('/capacity-overrides', async (c) => {
  requirePermission(c, 'settings.manage');
  const ctx = c.get('ctx');
  const body = await readJson(c, z.object({ on_date: isoDate, division_id: z.string().uuid().nullable().optional(), max_orders: z.number().int().min(0).nullable().optional(), max_points: z.number().int().min(0).nullable().optional(), max_stops: z.number().int().min(0).nullable().optional(), max_events: z.number().int().min(0).nullable().optional(), same_day_enabled: z.boolean().nullable().optional(), note: z.string().max(300).nullable().optional() }));
  await ctx.db.transaction().execute(async (trx) => {
    await trx.deleteFrom('capacity_overrides').where('on_date', '=', body.on_date).where(body.division_id ? (eb) => eb('division_id', '=', body.division_id as string) : (eb) => eb('division_id', 'is', null)).execute();
    await trx.insertInto('capacity_overrides').values({ ...body, division_id: body.division_id ?? null }).execute();
    await audit(trx, staffActor(c), 'capacity.override', null, body);
  });
  return c.json({ ok: true });
});

adminOpsRoutes.delete('/capacity-overrides/:id', async (c) => {
  requirePermission(c, 'settings.manage');
  await c.get('ctx').db.deleteFrom('capacity_overrides').where('id', '=', c.req.param('id')).execute();
  return c.json({ ok: true });
});

/* ---------- Team ---------- */

adminOpsRoutes.get('/team', async (c) => {
  requirePermission(c, 'staff.view');
  const db = c.get('ctx').db;
  const staff = await db.selectFrom('staff_profiles as s').innerJoin('users as u', 'u.id', 's.user_id').select(['s.id', 's.user_id', 's.display_name', 's.phone_e164', 's.job_title', 's.color', 's.capabilities', 's.active', 's.max_appointments_per_day', 's.max_events_per_day', 's.max_stops_per_day', 's.notes', 'u.email', 'u.status', 'u.last_login_at']).orderBy('s.display_name').execute();
  const ids = staff.map((s) => s.id);
  const userIds = staff.map((s) => s.user_id);
  const roles = await db.selectFrom('roles').selectAll().orderBy('name').execute();
  const links = userIds.length ? await db.selectFrom('user_roles').selectAll().where('user_id', 'in', userIds).execute() : [];
  const availability = ids.length ? await db.selectFrom('staff_availability').selectAll().where('staff_id', 'in', ids).orderBy('weekday').orderBy('starts_at').execute() : [];
  const timeOff = ids.length ? await db.selectFrom('staff_time_off').selectAll().where('staff_id', 'in', ids).orderBy('starts_on', 'desc').limit(200).execute() : [];
  const permissions = await db.selectFrom('permissions').selectAll().orderBy('category').orderBy('code').execute();
  const rolePermissions = await db.selectFrom('role_permissions').selectAll().execute();
  return c.json({
    staff: staff.map((s) => ({ ...s, role_ids: links.filter((l) => l.user_id === s.user_id).map((l) => l.role_id), availability: availability.filter((a) => a.staff_id === s.id), time_off: timeOff.filter((o) => o.staff_id === s.id) })),
    roles: roles.map((r) => ({ ...r, permissions: rolePermissions.filter((p) => p.role_id === r.id).map((p) => p.permission_code) })),
    permissions,
    resources: await db.selectFrom('resources').selectAll().orderBy('kind').orderBy('name').execute(),
  });
});

adminOpsRoutes.post('/team/invite', async (c) => {
  requirePermission(c, 'staff.manage');
  const ctx = c.get('ctx');
  const body = await readJson(c, z.object({ email: z.string().trim().toLowerCase().email(), display_name: z.string().trim().min(1).max(120), role_codes: z.array(z.string()).min(1, 'Choose at least one role.'), capabilities: z.array(z.enum(['production', 'delivery', 'event_crew', 'consultation'])).default([]), job_title: z.string().max(100).nullable().optional() }));
  if (body.role_codes.includes('owner') && !c.get('staff').roles.includes('owner')) throw forbidden('Only an owner can invite another owner.');
  const created = await createStaffUser(ctx.db, { email: body.email, displayName: body.display_name, roleCodes: body.role_codes, capabilities: body.capabilities, jobTitle: body.job_title });
  const token = await mintAccessToken(ctx.db, ctx.clock, { purpose: 'staff_invite', subjectId: created.userId, ttlMinutes: 60 * 24 * 7, singleUse: true });
  await sendDirect(ctx, { template: 'staff_invite', to: body.email, staffUserId: created.userId, audience: 'staff', dedupe: `invite:${created.userId}:${token.slice(0, 12)}`, vars: { invite: { url: `${ctx.env.PUBLIC_BASE_URL}/admin/invite/${token}` } } });
  await audit(ctx.db, staffActor(c), 'staff.invite', { type: 'user', id: created.userId }, { roles: body.role_codes });
  return c.json({ id: created.staffId }, 201);
});

adminOpsRoutes.patch('/team/:id', async (c) => {
  requirePermission(c, 'staff.manage');
  const ctx = c.get('ctx');
  const body = await readJson(c, z.object({ display_name: z.string().trim().min(1).max(120).optional(), phone: z.string().max(30).nullable().optional(), job_title: z.string().max(100).nullable().optional(), color: z.string().max(20).nullable().optional(), capabilities: z.array(z.enum(['production', 'delivery', 'event_crew', 'consultation'])).optional(), max_appointments_per_day: z.number().int().min(0).nullable().optional(), max_events_per_day: z.number().int().min(0).nullable().optional(), max_stops_per_day: z.number().int().min(0).nullable().optional(), notes: z.string().max(2000).nullable().optional() }));
  const { phone, ...rest } = body;
  const res = await ctx.db.updateTable('staff_profiles').set({ ...rest, ...(phone !== undefined ? { phone_e164: toE164(phone) } : {}) }).where('id', '=', c.req.param('id')).executeTakeFirst();
  if (!Number(res.numUpdatedRows)) throw notFound('Team member not found.');
  await audit(ctx.db, staffActor(c), 'staff.update', { type: 'staff', id: c.req.param('id') });
  return c.json({ ok: true });
});

adminOpsRoutes.put('/team/:id/roles', async (c) => {
  const actorStaff = requirePermission(c, 'staff.manage');
  const ctx = c.get('ctx');
  const { role_ids } = await readJson(c, z.object({ role_ids: z.array(z.string().uuid()).min(1) }));
  await ctx.db.transaction().execute(async (trx) => {
    const profile = await trx.selectFrom('staff_profiles').select('user_id').where('id', '=', c.req.param('id')).executeTakeFirst();
    if (!profile) throw notFound('Team member not found.');
    const ownerRole = await trx.selectFrom('roles').select('id').where('code', '=', 'owner').executeTakeFirstOrThrow();
    if (role_ids.includes(ownerRole.id) && !actorStaff.roles.includes('owner')) throw forbidden('Only an owner can grant the owner role.');
    await assertAnotherOwnerRemains(trx, profile.user_id, role_ids.includes(ownerRole.id));
    await trx.deleteFrom('user_roles').where('user_id', '=', profile.user_id).execute();
    await trx.insertInto('user_roles').values(role_ids.map((role_id) => ({ user_id: profile.user_id, role_id }))).execute();
    await audit(trx, staffActor(c), 'staff.roles', { type: 'user', id: profile.user_id }, { role_ids });
  });
  return c.json({ ok: true });
});

async function assertAnotherOwnerRemains(trx: Parameters<typeof audit>[0], userId: string, stillOwner: boolean) {
  if (stillOwner) return;
  const owners = await trx.selectFrom('user_roles as ur').innerJoin('roles as r', 'r.id', 'ur.role_id').innerJoin('users as u', 'u.id', 'ur.user_id').select('ur.user_id').where('r.code', '=', 'owner').where('u.status', '=', 'active').execute();
  if (owners.length === 1 && owners[0].user_id === userId) throw conflict('last_owner', 'The business must keep at least one active owner.');
}

adminOpsRoutes.post('/team/:id/deactivate', async (c) => {
  requirePermission(c, 'staff.manage');
  const ctx = c.get('ctx');
  await ctx.db.transaction().execute(async (trx) => {
    const profile = await trx.selectFrom('staff_profiles').select('user_id').where('id', '=', c.req.param('id')).executeTakeFirst();
    if (!profile) throw notFound('Team member not found.');
    await assertAnotherOwnerRemains(trx, profile.user_id, false);
    await trx.updateTable('users').set({ status: 'disabled' }).where('id', '=', profile.user_id).execute();
    await trx.updateTable('staff_profiles').set({ active: false }).where('id', '=', c.req.param('id')).execute();
    await revokeAllForUser(trx, ctx.clock, profile.user_id);
    await audit(trx, staffActor(c), 'staff.deactivate', { type: 'user', id: profile.user_id });
  });
  return c.json({ ok: true });
});

adminOpsRoutes.post('/team/:id/reactivate', async (c) => {
  requirePermission(c, 'staff.manage');
  const ctx = c.get('ctx');
  const profile = await ctx.db.selectFrom('staff_profiles').select('user_id').where('id', '=', c.req.param('id')).executeTakeFirst();
  if (!profile) throw notFound('Team member not found.');
  await ctx.db.updateTable('users').set({ status: 'active' }).where('id', '=', profile.user_id).where('password_hash', 'is not', null).execute();
  await ctx.db.updateTable('staff_profiles').set({ active: true }).where('id', '=', c.req.param('id')).execute();
  await audit(ctx.db, staffActor(c), 'staff.reactivate', { type: 'user', id: profile.user_id });
  return c.json({ ok: true });
});

adminOpsRoutes.put('/team/:id/availability', async (c) => {
  requirePermission(c, 'staff.manage');
  const ctx = c.get('ctx');
  const { shifts } = await readJson(c, z.object({ shifts: z.array(z.object({ weekday: z.number().int().min(0).max(6), starts_at: hhmm, ends_at: hhmm })) }));
  await ctx.db.transaction().execute(async (trx) => {
    await trx.deleteFrom('staff_availability').where('staff_id', '=', c.req.param('id')).execute();
    for (const s of shifts) {
      if (s.ends_at <= s.starts_at) throw badRequest('Each shift must end after it starts.');
      await trx.insertInto('staff_availability').values({ staff_id: c.req.param('id'), ...s }).execute();
    }
    await audit(trx, staffActor(c), 'staff.availability', { type: 'staff', id: c.req.param('id') });
  });
  return c.json({ ok: true });
});

adminOpsRoutes.post('/team/:id/time-off', async (c) => {
  const staff = requirePermission(c, 'staff.view');
  if (!staff.permissions.has('staff.manage') && staff.staffId !== c.req.param('id')) throw forbidden();
  const ctx = c.get('ctx');
  const body = await readJson(c, z.object({ starts_on: isoDate, ends_on: isoDate, kind: z.enum(['day_off', 'vacation', 'sick', 'other']).default('day_off'), note: z.string().max(300).nullable().optional() }));
  if (body.ends_on < body.starts_on) throw badRequest('The end date is before the start date.');
  const row = await ctx.db.insertInto('staff_time_off').values({ ...body, staff_id: c.req.param('id'), created_by: staff.userId }).returning('id').executeTakeFirstOrThrow();
  await audit(ctx.db, staffActor(c), 'staff.time_off', { type: 'staff', id: c.req.param('id') }, body);
  return c.json(row, 201);
});

adminOpsRoutes.delete('/time-off/:id', async (c) => {
  requirePermission(c, 'staff.manage');
  await c.get('ctx').db.deleteFrom('staff_time_off').where('id', '=', c.req.param('id')).execute();
  return c.json({ ok: true });
});

adminOpsRoutes.put('/roles/:id/permissions', async (c) => {
  const staff = requirePermission(c, 'staff.manage');
  if (!staff.roles.includes('owner')) throw forbidden('Only an owner can change what a role can do.');
  const ctx = c.get('ctx');
  const { permissions } = await readJson(c, z.object({ permissions: z.array(z.string()) }));
  const role = await ctx.db.selectFrom('roles').select('code').where('id', '=', c.req.param('id')).executeTakeFirst();
  if (!role) throw notFound('Role not found.');
  if (role.code === 'owner') throw conflict('owner_locked', 'The owner role always has every permission.');
  await ctx.db.transaction().execute(async (trx) => {
    await trx.deleteFrom('role_permissions').where('role_id', '=', c.req.param('id')).execute();
    if (permissions.length) await trx.insertInto('role_permissions').values(permissions.map((permission_code) => ({ role_id: c.req.param('id'), permission_code }))).execute();
    await audit(trx, staffActor(c), 'role.permissions', { type: 'role', id: c.req.param('id') }, { permissions });
  });
  return c.json({ ok: true });
});

const resourceSchema = z.object({ kind: z.enum(['crew', 'vehicle', 'space', 'equipment']), name: z.string().trim().min(1).max(100), division_id: z.string().uuid().nullable().optional(), active: z.boolean().default(true), notes: z.string().max(500).nullable().optional() });

adminOpsRoutes.post('/resources', async (c) => {
  requirePermission(c, 'settings.manage');
  return c.json(await c.get('ctx').db.insertInto('resources').values(await readJson(c, resourceSchema)).returning('id').executeTakeFirstOrThrow(), 201);
});

adminOpsRoutes.put('/resources/:id', async (c) => {
  requirePermission(c, 'settings.manage');
  await c.get('ctx').db.updateTable('resources').set(await readJson(c, resourceSchema)).where('id', '=', c.req.param('id')).execute();
  return c.json({ ok: true });
});

/* ---------- Rentals ---------- */

const rentalSchema = z.object({ name: z.string().trim().min(1).max(160), category: z.string().max(80).nullable().optional(), description: z.string().max(2000).nullable().optional(), image_url: z.string().max(500).nullable().optional(), quantity: z.number().int().min(0), price_cents: z.number().int().min(0).nullable().optional(), setup_requirements: z.string().max(1000).nullable().optional(), logistics_notes: z.string().max(1000).nullable().optional(), requires_delivery: z.boolean().default(false), cleaning_buffer_minutes: z.number().int().min(0).default(0), replacement_cost_cents: z.number().int().min(0).nullable().optional(), active: z.boolean().default(true), sort_order: z.number().int().default(0) });

adminOpsRoutes.get('/rentals', async (c) => {
  requirePermission(c, 'rentals.manage');
  const db = c.get('ctx').db;
  const items = await db.selectFrom('rental_items').selectAll().orderBy('sort_order').orderBy('name').execute();
  const reservations = await db
    .selectFrom('rental_reservations as r')
    .innerJoin('rental_items as i', 'i.id', 'r.rental_item_id')
    .leftJoin('event_bookings as b', 'b.id', 'r.booking_id')
    .leftJoin('wedding_inquiries as q', 'q.id', 'b.inquiry_id')
    .leftJoin('customers as u', 'u.id', 'q.customer_id')
    .select(['r.id', 'r.rental_item_id', 'r.quantity', 'r.starts_at', 'r.ends_at', 'r.blocked_until', 'r.status', 'r.returned_at', 'r.condition_notes', 'r.damage_notes', 'r.damage_cost_cents', 'i.name as item_name', 'u.name as customer_name', 'q.id as inquiry_id', 'q.event_date'])
    .where('r.status', 'in', ['hold', 'approved', 'confirmed', 'out'])
    .orderBy('r.starts_at')
    .limit(500)
    .execute();
  return c.json({ items, reservations });
});

adminOpsRoutes.post('/rentals', async (c) => {
  requirePermission(c, 'rentals.manage');
  const row = await c.get('ctx').db.insertInto('rental_items').values(await readJson(c, rentalSchema)).returning('id').executeTakeFirstOrThrow();
  await audit(c.get('ctx').db, staffActor(c), 'rental.create', { type: 'rental', id: row.id });
  return c.json(row, 201);
});

adminOpsRoutes.put('/rentals/:id', async (c) => {
  requirePermission(c, 'rentals.manage');
  await c.get('ctx').db.updateTable('rental_items').set(await readJson(c, rentalSchema)).where('id', '=', c.req.param('id')).execute();
  return c.json({ ok: true });
});

adminOpsRoutes.post('/rental-reservations/:id/out', async (c) => {
  requirePermission(c, 'rentals.manage');
  const ctx = c.get('ctx');
  await ctx.db.updateTable('rental_reservations').set({ status: 'out' }).where('id', '=', c.req.param('id')).where('status', 'in', ['confirmed', 'approved']).execute();
  await audit(ctx.db, staffActor(c), 'rental.out', { type: 'rental_reservation', id: c.req.param('id') });
  return c.json({ ok: true });
});

/** Recording a return keeps the piece blocked through its cleaning buffer, measured from when it really came back. */
adminOpsRoutes.post('/rental-reservations/:id/return', async (c) => {
  requirePermission(c, 'rentals.manage');
  const ctx = c.get('ctx');
  const body = await readJson(c, z.object({ returned_at: z.string().datetime().optional(), condition_notes: z.string().max(1000).nullable().optional(), damage_notes: z.string().max(1000).nullable().optional(), damage_cost_cents: z.number().int().min(0).nullable().optional() }));
  const returnedAt = body.returned_at ? new Date(body.returned_at) : ctx.clock.now();
  await ctx.db.transaction().execute(async (trx) => {
    const r = await trx.selectFrom('rental_reservations').select(['buffer_minutes', 'status']).where('id', '=', c.req.param('id')).forUpdate().executeTakeFirst();
    if (!r) throw notFound('Reservation not found.');
    if (r.status === 'returned' || r.status === 'cancelled') throw conflict('reservation_closed', 'This reservation is closed.');
    await trx
      .updateTable('rental_reservations')
      .set({ status: 'returned', returned_at: returnedAt, blocked_until: addMinutes(returnedAt, r.buffer_minutes), condition_notes: body.condition_notes ?? null, damage_notes: body.damage_notes ?? null, damage_cost_cents: body.damage_cost_cents ?? null })
      .where('id', '=', c.req.param('id'))
      .execute();
    await audit(trx, staffActor(c), 'rental.return', { type: 'rental_reservation', id: c.req.param('id') }, { damage: Boolean(body.damage_notes) });
  });
  return c.json({ ok: true });
});

