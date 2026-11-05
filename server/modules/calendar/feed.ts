import { DateTime } from 'luxon';
import { sql } from 'kysely';
import type { Db } from '../../db/client.js';
import { addDays, atLocal, weekdayOf } from '../../lib/time.js';
import { loadSettings } from '../settings/service.js';

export type CalendarItem = {
  id: string;
  source_id: string;
  kind: 'consultation' | 'event' | 'setup' | 'teardown' | 'delivery' | 'pickup' | 'task' | 'shift' | 'time_off' | 'blackout' | 'rental_return' | 'store_hours' | 'custom';
  title: string;
  start: Date;
  end: Date;
  all_day: boolean;
  staff_id: string | null;
  status: string | null;
  link: string | null;
  movable: boolean;
  conflict: boolean;
  detail?: string | null;
  order_id?: string | null;
};

export type DaySummary = { date: string; orders: number; points: number; prep_minutes: number; stops: number; events: number; max_orders: number | null; max_points: number | null; closed: boolean; closure: string | null };

/** One shared calendar, built from the records each module already owns, so nothing can drift out of sync. */
export async function calendarRange(db: Db, input: { from: string; to: string; kinds?: string[]; staff_id?: string | null }) {
  const settings = await loadSettings(db);
  const tz = settings.general.timezone;
  const start = atLocal(input.from, '00:00', tz);
  const end = atLocal(addDays(input.to, 1, tz), '00:00', tz);
  const items: CalendarItem[] = [];
  const want = (k: string) => !input.kinds?.length || input.kinds.includes(k);

  if (want('consultation')) {
    const rows = await db
      .selectFrom('consultations as c')
      .innerJoin('customers as u', 'u.id', 'c.customer_id')
      .select(['c.id', 'c.starts_at', 'c.ends_at', 'c.status', 'c.format', 'c.staff_id', 'c.inquiry_id', 'u.name'])
      .where('c.status', '=', 'booked')
      .where('c.starts_at', '<', end)
      .where('c.ends_at', '>', start)
      .execute();
    for (const r of rows) items.push({ id: `consultation:${r.id}`, source_id: r.id, kind: 'consultation', title: `Consultation: ${r.name}`, start: r.starts_at, end: r.ends_at, all_day: false, staff_id: r.staff_id, status: r.status, link: r.inquiry_id ? `/admin/weddings/${r.inquiry_id}` : null, movable: true, conflict: false, detail: r.format });
  }

  if (want('event') || want('setup') || want('teardown')) {
    const rows = await db
      .selectFrom('event_bookings as b')
      .innerJoin('wedding_inquiries as i', 'i.id', 'b.inquiry_id')
      .innerJoin('customers as u', 'u.id', 'i.customer_id')
      .select(['b.id', 'b.status', 'b.event_start', 'b.event_end', 'b.event_date', 'b.setup_minutes', 'b.teardown_minutes', 'b.travel_minutes', 'b.buffer_minutes', 'b.inquiry_id', 'i.event_type', 'i.venue_name', 'u.name'])
      .where('b.status', 'in', ['hold', 'approved', 'confirmed', 'completed', 'inquiry'])
      .where('b.event_start', '<', end)
      .where('b.event_end', '>', start)
      .execute();
    for (const b of rows) {
      const tentative = b.status === 'inquiry';
      if (want('event')) items.push({ id: `event:${b.id}`, source_id: b.id, kind: 'event', title: `${tentative ? 'Inquiry' : b.status === 'hold' ? 'Hold' : 'Event'}: ${b.name} (${b.event_type})`, start: b.event_start, end: b.event_end, all_day: false, staff_id: null, status: b.status, link: `/admin/weddings/${b.inquiry_id}`, movable: b.status !== 'completed', conflict: false, detail: b.venue_name });
      if (tentative) continue;
      if (want('setup')) items.push({ id: `setup:${b.id}`, source_id: b.id, kind: 'setup', title: `Setup: ${b.name}`, start: new Date(b.event_start.getTime() - (b.setup_minutes + b.travel_minutes) * 60_000), end: b.event_start, all_day: false, staff_id: null, status: b.status, link: `/admin/weddings/${b.inquiry_id}`, movable: false, conflict: false });
      if (want('teardown')) items.push({ id: `teardown:${b.id}`, source_id: b.id, kind: 'teardown', title: `Teardown: ${b.name}`, start: b.event_end, end: new Date(b.event_end.getTime() + (b.teardown_minutes + b.travel_minutes + b.buffer_minutes) * 60_000), all_day: false, staff_id: null, status: b.status, link: `/admin/weddings/${b.inquiry_id}`, movable: false, conflict: false });
    }
  }

  if (want('delivery') || want('pickup')) {
    const rows = await db
      .selectFrom('fulfillments as f')
      .innerJoin('orders as o', 'o.id', 'f.order_id')
      .leftJoin('deliveries as d', 'd.fulfillment_id', 'f.id')
      .select(['f.id', 'f.method', 'f.window_start', 'f.window_end', 'f.status', 'f.order_id', 'o.reference', 'o.contact_name', 'd.driver_staff_id', 'o.status as order_status'])
      .where('f.window_start', '<', end)
      .where('f.window_end', '>', start)
      .where('f.method', 'in', ['pickup', 'delivery'])
      .where('o.status', 'not in', ['cancelled', 'rejected', 'expired'])
      .execute();
    for (const f of rows) {
      const kind = f.method as 'pickup' | 'delivery';
      if (!want(kind)) continue;
      items.push({ id: `${kind}:${f.id}`, source_id: f.id, order_id: f.order_id, kind, title: `${kind === 'pickup' ? 'Pickup' : 'Delivery'}: ${f.reference} (${f.contact_name})`, start: f.window_start as Date, end: f.window_end as Date, all_day: false, staff_id: f.driver_staff_id, status: f.status, link: `/admin/orders/${f.order_id}`, movable: !['fulfilled', 'cancelled', 'returned'].includes(f.status), conflict: kind === 'delivery' && !f.driver_staff_id && f.status !== 'fulfilled' });
    }
  }

  if (want('task')) {
    const rows = await db.selectFrom('staff_tasks').select(['id', 'title', 'due_at', 'status', 'assigned_to', 'est_minutes', 'subject_type', 'subject_id']).where('status', 'in', ['open', 'in_progress', 'blocked']).where('due_at', '>=', start).where('due_at', '<', end).execute();
    for (const t of rows) {
      const dueAt = t.due_at as Date;
      items.push({ id: `task:${t.id}`, source_id: t.id, kind: 'task', title: t.title, start: new Date(dueAt.getTime() - (t.est_minutes ?? 30) * 60_000), end: dueAt, all_day: false, staff_id: t.assigned_to, status: t.status, link: t.subject_type === 'order' ? `/admin/orders/${t.subject_id}` : t.subject_type === 'project' ? `/admin/weddings/projects/${t.subject_id}` : '/admin/tasks', movable: true, conflict: false });
    }
  }

  const staff = await db.selectFrom('staff_profiles').innerJoin('users', 'users.id', 'staff_profiles.user_id').select(['staff_profiles.id', 'staff_profiles.display_name']).where('staff_profiles.active', '=', true).where('users.status', '=', 'active').execute();
  const staffName = new Map(staff.map((s) => [s.id, s.display_name]));

  if (want('time_off')) {
    const rows = await db.selectFrom('staff_time_off').select(['id', 'staff_id', 'starts_on', 'ends_on', 'kind']).where('ends_on', '>=', input.from).where('starts_on', '<=', input.to).execute();
    for (const r of rows) items.push({ id: `time_off:${r.id}`, source_id: r.id, kind: 'time_off', title: `Off: ${staffName.get(r.staff_id) ?? 'Team member'}`, start: atLocal(r.starts_on, '00:00', tz), end: atLocal(addDays(r.ends_on, 1, tz), '00:00', tz), all_day: true, staff_id: r.staff_id, status: r.kind, link: '/admin/team', movable: false, conflict: false });
  }

  if (want('shift')) {
    const rows = await db.selectFrom('staff_availability').select(['id', 'staff_id', 'weekday', 'starts_at', 'ends_at']).execute();
    for (let i = 0; ; i++) {
      const date = addDays(input.from, i, tz);
      if (date > input.to) break;
      const weekday = weekdayOf(date, tz);
      for (const r of rows.filter((x) => x.weekday === weekday && staffName.has(x.staff_id))) {
        items.push({ id: `shift:${r.id}:${date}`, source_id: r.id, kind: 'shift', title: `${staffName.get(r.staff_id)} working`, start: atLocal(date, r.starts_at.slice(0, 5), tz), end: atLocal(date, r.ends_at.slice(0, 5), tz), all_day: false, staff_id: r.staff_id, status: null, link: '/admin/team', movable: false, conflict: false });
      }
    }
  }

  if (want('store_hours')) {
    const rows = await db.selectFrom('business_hours').select(['id', 'weekday', 'opens_at', 'closes_at', 'closed']).where('division_id', 'is', null).execute();
    for (let i = 0; ; i++) {
      const date = addDays(input.from, i, tz);
      if (date > input.to) break;
      const row = rows.find((x) => x.weekday === weekdayOf(date, tz));
      if (row && !row.closed && row.opens_at && row.closes_at) items.push({ id: `hours:${row.id}:${date}`, source_id: row.id, kind: 'store_hours', title: 'Shop open', start: atLocal(date, row.opens_at.slice(0, 5), tz), end: atLocal(date, row.closes_at.slice(0, 5), tz), all_day: false, staff_id: null, status: null, link: '/admin/settings', movable: false, conflict: false });
    }
  }

  const blackouts = await db.selectFrom('blackout_rules').select(['id', 'starts_on', 'ends_on', 'reason', 'public_message', 'note', 'scope', 'affects']).where('ends_on', '>=', input.from).where('starts_on', '<=', input.to).execute();
  if (want('blackout')) {
    for (const r of blackouts) items.push({ id: `blackout:${r.id}`, source_id: r.id, kind: 'blackout', title: `Closed: ${r.note ?? r.public_message ?? r.reason}`, start: atLocal(r.starts_on, '00:00', tz), end: atLocal(addDays(r.ends_on, 1, tz), '00:00', tz), all_day: true, staff_id: null, status: r.reason, link: '/admin/settings', movable: false, conflict: false });
  }

  if (want('rental_return')) {
    const rows = await db.selectFrom('rental_reservations as r').innerJoin('rental_items as i', 'i.id', 'r.rental_item_id').select(['r.id', 'r.ends_at', 'r.blocked_until', 'r.quantity', 'r.status', 'i.name']).where('r.status', 'in', ['confirmed', 'out']).where('r.ends_at', '>=', start).where('r.ends_at', '<', end).execute();
    for (const r of rows) items.push({ id: `rental_return:${r.id}`, source_id: r.id, kind: 'rental_return', title: `Return: ${r.quantity} × ${r.name}`, start: r.ends_at, end: r.blocked_until > r.ends_at ? r.blocked_until : new Date(r.ends_at.getTime() + 30 * 60_000), all_day: false, staff_id: null, status: r.status, link: '/admin/rentals', movable: false, conflict: false });
  }

  if (want('custom')) {
    const rows = await db.selectFrom('calendar_entries').selectAll().where('starts_at', '<', end).where('ends_at', '>', start).execute();
    for (const r of rows) items.push({ id: `custom:${r.id}`, source_id: r.id, kind: 'custom', title: r.title, start: r.starts_at, end: r.ends_at, all_day: r.all_day, staff_id: r.staff_id, status: null, link: null, movable: true, conflict: false, detail: r.notes });
  }

  // Conflict flags: the same person booked twice, or anything scheduled on a closed date.
  const timed = items.filter((i) => i.staff_id && !['shift', 'time_off', 'blackout', 'store_hours'].includes(i.kind));
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const a = timed[i];
      const b = timed[j];
      if (a.staff_id === b.staff_id && a.start < b.end && b.start < a.end) {
        a.conflict = true;
        b.conflict = true;
      }
    }
  }
  const off = items.filter((i) => i.kind === 'time_off');
  for (const item of timed) if (off.some((o) => o.staff_id === item.staff_id && item.start < o.end && o.start < item.end)) item.conflict = true;
  const closures = blackouts.filter((b) => b.scope === 'business');
  for (const item of items) {
    if (['blackout', 'store_hours', 'shift', 'time_off'].includes(item.kind)) continue;
    const date = DateTime.fromJSDate(item.start, { zone: tz }).toISODate() as string;
    if (closures.some((c) => date >= c.starts_on && date <= c.ends_on)) item.conflict = true;
  }

  // Assigned people are attached to the events and orders they work on, for the team filter.
  const assignments = await db
    .selectFrom('staff_assignments as a')
    .innerJoin('staff_profiles as s', 's.id', 'a.staff_id')
    .leftJoin('wedding_projects as p', (join) => join.onRef('p.id', '=', 'a.subject_id').on('a.subject_type', '=', 'project'))
    .select(['a.staff_id', 'a.subject_type', 'a.subject_id', 'p.booking_id', 's.display_name'])
    .execute();
  const teamFor = (item: CalendarItem) => {
    if (['event', 'setup', 'teardown'].includes(item.kind)) return assignments.filter((a) => a.subject_type === 'project' && a.booking_id === item.source_id);
    if (item.order_id) return assignments.filter((a) => a.subject_type === 'order' && a.subject_id === item.order_id);
    return [];
  };
  for (const item of items) {
    const team = teamFor(item);
    if (team.length) item.detail = [item.detail, `Team: ${team.map((t) => t.display_name).join(', ')}`].filter(Boolean).join(' · ');
  }
  // Filtering by person shows their own work, plus anything nobody has claimed yet.
  const filtered = input.staff_id
    ? items.filter((i) => {
        const team = teamFor(i);
        if (team.length) return team.some((t) => t.staff_id === input.staff_id);
        return i.staff_id === input.staff_id || !i.staff_id;
      })
    : items;

  // Daily capacity, so a manager can see load without opening every order.
  const claims = await sql<{ claim_date: string; orders: number; points: number; minutes: number; stops: number }>`
    SELECT claim_date::text, count(*) FILTER (WHERE counts_as_order)::int AS orders, COALESCE(sum(points), 0)::int AS points, COALESCE(sum(prep_minutes), 0)::int AS minutes, COALESCE(sum(stops), 0)::int AS stops
    FROM capacity_claims WHERE status = 'active' AND claim_date BETWEEN ${input.from}::date AND ${input.to}::date GROUP BY claim_date
  `.execute(db);
  const eventsByDay = await sql<{ event_date: string; n: number }>`
    SELECT event_date::text, count(*)::int AS n FROM event_bookings WHERE status IN ('hold','approved','confirmed') AND event_date BETWEEN ${input.from}::date AND ${input.to}::date GROUP BY event_date
  `.execute(db);
  const summaries: DaySummary[] = [];
  for (let i = 0; ; i++) {
    const date = addDays(input.from, i, tz);
    if (date > input.to) break;
    const c = claims.rows.find((r) => r.claim_date === date);
    const closure = closures.find((b) => date >= b.starts_on && date <= b.ends_on);
    summaries.push({
      date,
      orders: c?.orders ?? 0,
      points: c?.points ?? 0,
      prep_minutes: c?.minutes ?? 0,
      stops: c?.stops ?? 0,
      events: eventsByDay.rows.find((r) => r.event_date === date)?.n ?? 0,
      max_orders: settings.ordering.daily_order_limit,
      max_points: settings.ordering.daily_points_limit,
      closed: Boolean(closure),
      closure: closure?.public_message ?? closure?.note ?? null,
    });
  }
  return { items: filtered.sort((a, b) => a.start.getTime() - b.start.getTime()), summaries, staff: staff.map((s) => ({ id: s.id, name: s.display_name })), timezone: tz };
}

const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** A read-only calendar feed that any calendar app can subscribe to. Being read-only, it cannot overwrite a booking. */
export function toIcs(name: string, items: CalendarItem[], now: Date): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Blooms Platform//Calendar//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${icsText(name)}`];
  for (const i of items) {
    lines.push('BEGIN:VEVENT', `UID:${i.id.replace(/:/g, '-')}@blooms-platform`, `DTSTAMP:${icsDate(now)}`, `DTSTART:${icsDate(i.start)}`, `DTEND:${icsDate(i.end)}`, `SUMMARY:${icsText(i.title)}`);
    if (i.detail) lines.push(`DESCRIPTION:${icsText(i.detail)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}
