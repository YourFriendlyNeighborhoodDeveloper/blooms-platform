import { sql } from 'kysely';
import type { Clock } from '../../lib/time.js';
import type { Db, Trx } from '../../db/client.js';
import { addDays, addMinutes, atLocal, localDate } from '../../lib/time.js';
import { blackoutFor, overrideFor, staffOnDuty, type BlackoutRow, type OverrideRow, type Reason, type StaffRow } from '../availability/engine.js';
import { loadSettings, type SettingsState } from '../settings/service.js';
import { conflict } from '../../lib/errors.js';

export type EventRequest = {
  event_date: string;
  ceremony_time?: string | null;
  reception_time?: string | null;
  rentals?: Array<{ rental_item_id: string; quantity: number }>;
  crews_required?: number;
  exclude_booking_id?: string | null;
};

export type EventTimes = {
  event_start: Date;
  event_end: Date;
  setup_start: Date;
  teardown_end: Date;
  rental_start: Date;
  rental_end: Date;
};

export function eventTimes(settings: SettingsState, date: string, ceremony?: string | null, reception?: string | null): EventTimes {
  const e = settings.events;
  const tz = settings.general.timezone;
  const first = ceremony ?? reception ?? e.default_start_time;
  const event_start = atLocal(date, first, tz);
  const anchor = reception ? atLocal(date, reception, tz) : event_start;
  const event_end = addMinutes(anchor > event_start ? anchor : event_start, e.default_event_hours * 60);
  const setup_start = addMinutes(event_start, -(e.setup_minutes + e.travel_minutes));
  const teardown_end = addMinutes(event_end, e.teardown_minutes + e.travel_minutes + e.buffer_minutes);
  return { event_start, event_end, setup_start, teardown_end, rental_start: setup_start, rental_end: teardown_end };
}

export type CrewPhase = { phase: 'setup' | 'teardown'; starts_at: Date; ends_at: Date };

/**
 * A crew is needed for setup and for teardown, not while guests are dancing. That is what lets two
 * events share one crew on the same day when the timing genuinely works.
 */
export const crewPhases = (t: EventTimes): CrewPhase[] => [
  { phase: 'setup', starts_at: t.setup_start, ends_at: t.event_start },
  { phase: 'teardown', starts_at: t.event_end, ends_at: t.teardown_end },
];

export type AvailabilityStatus = 'available' | 'review' | 'unavailable';

export type AvailabilityResult = {
  status: AvailabilityStatus;
  summary: string;
  reasons: Reason[];
  alternatives: string[];
  crews: { total: number; free: number; required: number };
  rentals: Array<{ rental_item_id: string; name: string; requested: number; available: number }>;
};

type Snapshot = {
  settings: SettingsState;
  crews: Array<{ id: string; name: string }>;
  reservations: Array<{ resource_id: string; starts_at: Date; ends_at: Date; booking_id: string }>;
  bookings: Array<{ id: string; event_date: string; status: string; workload_points: number; crews_required: number }>;
  blackouts: BlackoutRow[];
  overrides: OverrideRow[];
  staff: StaffRow[];
  rentalItems: Array<{ id: string; name: string; quantity: number; cleaning_buffer_minutes: number; active: boolean }>;
  rentalReservations: Array<{ rental_item_id: string; quantity: number; starts_at: Date; blocked_until: Date; booking_id: string | null }>;
  eventsDivisionId: string | null;
};

async function loadSnapshot(db: Db, clock: Clock, from: string, to: string): Promise<Snapshot> {
  const settings = await loadSettings(db);
  const now = clock.now();
  const start = atLocal(from, '00:00', settings.general.timezone);
  const end = atLocal(to, '23:59', settings.general.timezone);
  const crews = await db.selectFrom('resources').select(['id', 'name']).where('kind', '=', 'crew').where('active', '=', true).execute();
  const reservations = await db
    .selectFrom('resource_reservations as r')
    .innerJoin('resources as res', 'res.id', 'r.resource_id')
    .select(['r.resource_id', 'r.starts_at', 'r.ends_at', 'r.booking_id'])
    .where('res.kind', '=', 'crew')
    .where('r.status', '!=', 'released')
    .where((eb) => eb.or([eb('r.status', '!=', 'hold'), eb('r.hold_expires_at', '>', now)]))
    .where('r.ends_at', '>', start)
    .where('r.starts_at', '<', end)
    .execute();
  const bookings = await db
    .selectFrom('event_bookings')
    .select(['id', 'event_date', 'status', 'workload_points', 'crews_required'])
    .where('status', 'in', ['hold', 'approved', 'confirmed'])
    .where('event_date', '>=', from)
    .where('event_date', '<=', to)
    .where((eb) => eb.or([eb('status', '!=', 'hold'), eb('hold_expires_at', '>', now)]))
    .execute();
  const blackouts = await db
    .selectFrom('blackout_rules')
    .select(['scope', 'division_id', 'resource_id', 'starts_on', 'ends_on', 'affects', 'reason', 'public_message'])
    .where('ends_on', '>=', from)
    .where('starts_on', '<=', to)
    .execute();
  const overrides = await db
    .selectFrom('capacity_overrides')
    .select(['on_date', 'division_id', 'max_orders', 'max_points', 'max_stops', 'max_events', 'same_day_enabled'])
    .where('on_date', '>=', from)
    .where('on_date', '<=', to)
    .execute();
  const staffRows = await db
    .selectFrom('staff_profiles')
    .innerJoin('users', 'users.id', 'staff_profiles.user_id')
    .select(['staff_profiles.id', 'staff_profiles.display_name', 'staff_profiles.capabilities', 'staff_profiles.max_appointments_per_day', 'staff_profiles.max_events_per_day'])
    .where('staff_profiles.active', '=', true)
    .where('users.status', '=', 'active')
    .execute();
  const ids = staffRows.map((s) => s.id);
  const avail = ids.length ? await db.selectFrom('staff_availability').select(['staff_id', 'weekday', 'starts_at', 'ends_at']).where('staff_id', 'in', ids).execute() : [];
  const off = ids.length ? await db.selectFrom('staff_time_off').select(['staff_id', 'starts_on', 'ends_on']).where('staff_id', 'in', ids).where('ends_on', '>=', from).where('starts_on', '<=', to).execute() : [];
  const rentalItems = await db.selectFrom('rental_items').select(['id', 'name', 'quantity', 'cleaning_buffer_minutes', 'active']).execute();
  const rentalReservations = await db
    .selectFrom('rental_reservations')
    .select(['rental_item_id', 'quantity', 'starts_at', 'blocked_until', 'booking_id'])
    .where('status', 'in', ['hold', 'approved', 'confirmed', 'out', 'returned'])
    .where((eb) => eb.or([eb('status', '!=', 'hold'), eb('hold_expires_at', '>', now)]))
    .where('blocked_until', '>', start)
    .where('starts_at', '<', end)
    .execute();
  const division = await db.selectFrom('business_divisions').select('id').where('code', '=', 'events').executeTakeFirst();
  return {
    settings,
    crews,
    reservations,
    bookings,
    blackouts,
    overrides,
    staff: staffRows.map((s) => ({ ...s, availability: avail.filter((a) => a.staff_id === s.id), time_off: off.filter((o) => o.staff_id === s.id) })),
    rentalItems,
    rentalReservations,
    eventsDivisionId: division?.id ?? null,
  };
}

const overlaps = (a1: Date, a2: Date, b1: Date, b2: Date) => a1 < b2 && b1 < a2;

/** Most pieces in use at once during [start, end), after counting existing buffers. */
export function peakRentalUse(rows: Array<{ quantity: number; starts_at: Date; blocked_until: Date }>, start: Date, end: Date): number {
  const relevant = rows.filter((r) => overlaps(r.starts_at, r.blocked_until, start, end));
  const points = [start, ...relevant.map((r) => r.starts_at).filter((s) => s > start && s < end)];
  let peak = 0;
  for (const p of points) {
    const load = relevant.filter((r) => r.starts_at <= p && p < r.blocked_until).reduce((sum, r) => sum + r.quantity, 0);
    if (load > peak) peak = load;
  }
  return peak;
}

function evaluate(snapshot: Snapshot, req: EventRequest, now: Date): Omit<AvailabilityResult, 'alternatives' | 'summary'> {
  const { settings } = snapshot;
  const e = settings.events;
  const tz = settings.general.timezone;
  const blocks: Reason[] = [];
  const reviews: Reason[] = [];
  const divisions = snapshot.eventsDivisionId ? [snapshot.eventsDivisionId] : [];
  const date = req.event_date;
  const times = eventTimes(settings, date, req.ceremony_time, req.reception_time);
  const crewsRequired = req.crews_required ?? e.crews_per_event;

  const today = localDate(now, tz);
  if (date <= today) blocks.push({ code: 'past', message: 'That date has passed.' });
  if (date < addDays(today, e.min_notice_days, tz)) {
    blocks.push({ code: 'min_notice', message: `The shop needs at least ${e.min_notice_days} days of notice for events.` });
  }

  const closure = blackoutFor(snapshot, date, 'events', divisions);
  if (closure) blocks.push({ code: 'blackout', message: closure.public_message ?? 'The shop is not taking events on that date.' });

  for (let i = 1; i <= e.prep_days; i++) {
    const prep = addDays(date, -i, tz);
    const prepClosure = blackoutFor(snapshot, prep, 'events', divisions);
    if (prepClosure) {
      blocks.push({ code: 'prep_blocked', message: 'The shop is closed during the days it would need to prepare for that date.' });
      break;
    }
  }

  const others = snapshot.bookings.filter((b) => b.id !== req.exclude_booking_id);
  const sameDay = others.filter((b) => b.event_date === date);
  const override = overrideFor(snapshot, date, divisions);
  const maxEvents = override?.max_events ?? e.max_events_per_day;
  if (maxEvents === null) reviews.push({ code: 'events_limit_not_configured', message: 'The daily event limit is not set, so the team confirms this by hand.' });
  else if (sameDay.length + 1 > maxEvents) blocks.push({ code: 'capacity_events', message: 'The shop is fully booked for events on that date.' });

  // Crews: how many are free for every phase of this event?
  const phases = crewPhases(times);
  const blackedOutCrews = new Set(snapshot.blackouts.filter((b) => b.scope === 'resource' && date >= b.starts_on && date <= b.ends_on).map((b) => b.resource_id));
  const usable = snapshot.crews.filter((c) => !blackedOutCrews.has(c.id));
  const free = usable.filter((crew) =>
    phases.every((p) => !snapshot.reservations.some((r) => r.resource_id === crew.id && r.booking_id !== req.exclude_booking_id && overlaps(r.starts_at, r.ends_at, p.starts_at, p.ends_at))),
  ).length;
  if (crewsRequired > 0) {
    if (!snapshot.crews.length) reviews.push({ code: 'crews_not_configured', message: 'Event crews are not set up yet, so the team confirms this by hand.' });
    else if (free < crewsRequired) blocks.push({ code: 'capacity_crews', message: 'All of the shop’s event crews are committed at that time.' });
  }

  // Are enough people actually working that day?
  const crewStaff = staffOnDuty({ staff: snapshot.staff, tz }, 'event_crew', date);
  if (crewsRequired > 0) {
    if (!snapshot.staff.some((s) => s.capabilities.includes('event_crew'))) {
      reviews.push({ code: 'staff_not_configured', message: 'The event staff schedule is not set, so the team confirms this by hand.' });
    } else if (e.staff_per_crew !== null) {
      const needed = (sameDay.reduce((sum, b) => sum + b.crews_required, 0) + crewsRequired) * e.staff_per_crew;
      if (crewStaff.length < needed) blocks.push({ code: 'capacity_staff', message: 'There are not enough people working that day to staff another event.' });
    }
  }

  if (e.points_per_prep_day !== null && e.prep_days > 0) {
    const windowStart = addDays(date, -e.prep_days, tz);
    const load = others.filter((b) => b.event_date >= windowStart && b.event_date <= addDays(date, e.prep_days, tz)).reduce((s, b) => s + b.workload_points, 0);
    if (load > e.points_per_prep_day * e.prep_days) blocks.push({ code: 'capacity_production', message: 'The studio has too much event work around that date.' });
  }

  const rentals: AvailabilityResult['rentals'] = [];
  for (const r of req.rentals ?? []) {
    const item = snapshot.rentalItems.find((i) => i.id === r.rental_item_id);
    if (!item || !item.active) {
      blocks.push({ code: 'rental_inactive', message: 'One of those rental items is no longer offered.' });
      continue;
    }
    const until = addMinutes(times.rental_end, item.cleaning_buffer_minutes);
    const used = peakRentalUse(
      snapshot.rentalReservations.filter((x) => x.rental_item_id === item.id && x.booking_id !== req.exclude_booking_id),
      times.rental_start,
      until,
    );
    const available = Math.max(0, item.quantity - used);
    rentals.push({ rental_item_id: item.id, name: item.name, requested: r.quantity, available });
    if (available < r.quantity) blocks.push({ code: 'rental_short', message: `Only ${available} of ${item.name} ${available === 1 ? 'is' : 'are'} available for those dates.` });
  }

  if (!settings.approved.ordering) {
    reviews.push({ code: 'policy_unapproved', message: 'Booking rules are not approved yet, so the team confirms every date by hand.' });
  }

  return {
    status: blocks.length ? 'unavailable' : reviews.length ? 'review' : 'available',
    reasons: blocks.length ? blocks : reviews,
    crews: { total: snapshot.crews.length, free, required: crewsRequired },
    rentals,
  };
}

const SUMMARY: Record<AvailabilityStatus, string> = {
  available: 'That date looks open right now. It is not reserved until the team confirms it and any required deposit is paid.',
  review: 'The team will check that date for you. It is not reserved until they confirm it and any required deposit is paid.',
  unavailable: 'That date cannot be confirmed automatically. You can choose another date, or send your plan anyway and the team will take a look.',
};

/** Nearest workable dates to the one requested, closest first, so "no" always comes with an option. */
async function findAlternatives(db: Db, clock: Clock, req: EventRequest, want: number): Promise<string[]> {
  if (want <= 0) return [];
  const settings = await loadSettings(db);
  const tz = settings.general.timezone;
  const span = 60;
  const from = addDays(req.event_date, -span, tz);
  const to = addDays(req.event_date, span, tz);
  const snapshot = await loadSnapshot(db, clock, addDays(from, -settings.events.prep_days, tz), to);
  const now = clock.now();
  const out: string[] = [];
  for (let i = 1; i <= span && out.length < want; i++) {
    for (const date of [addDays(req.event_date, i, tz), addDays(req.event_date, -i, tz)]) {
      if (out.length >= want) break;
      if (evaluate(snapshot, { ...req, event_date: date }, now).status !== 'unavailable') out.push(date);
    }
  }
  return out.sort();
}

export async function checkEventAvailability(db: Db, clock: Clock, req: EventRequest): Promise<AvailabilityResult> {
  const settings = await loadSettings(db);
  const tz = settings.general.timezone;
  const snapshot = await loadSnapshot(db, clock, addDays(req.event_date, -Math.max(settings.events.prep_days, 3), tz), addDays(req.event_date, Math.max(settings.events.prep_days, 3), tz));
  const result = evaluate(snapshot, req, clock.now());
  const alternatives = result.status === 'unavailable' ? await findAlternatives(db, clock, req, settings.events.alternatives_to_offer) : [];
  return { ...result, summary: SUMMARY[result.status], alternatives };
}

/**
 * Takes real resources for a booking. A global advisory lock serializes crew allocation, so a free
 * crew cannot be promised twice, and the exclusion constraint stands behind it as the last line of
 * defense. Rental capacity is enforced by a database trigger. Throws if anything is unavailable.
 */
export async function reserveBookingResources(trx: Trx, clock: Clock, booking: { id: string; event_date: string; crews_required: number; event_start: Date; event_end: Date; status?: string }, opts: { status: 'hold' | 'approved' | 'confirmed'; holdExpiresAt: Date | null; times: EventTimes; rentals: Array<{ rental_item_id: string; quantity: number }> }) {
  await sql`SELECT pg_advisory_xact_lock(hashtext('event-crews'))`.execute(trx);
  const now = clock.now();
  await trx.updateTable('resource_reservations').set({ status: 'released' }).where('status', '=', 'hold').where('hold_expires_at', '<=', now).execute();
  await trx.updateTable('resource_reservations').set({ status: 'released' }).where('booking_id', '=', booking.id).where('status', '!=', 'released').execute();
  await trx.updateTable('rental_reservations').set({ status: 'cancelled' }).where('booking_id', '=', booking.id).where('status', 'in', ['hold', 'approved', 'confirmed']).execute();

  const phases = crewPhases(opts.times);
  const crews = await trx.selectFrom('resources').select(['id', 'name']).where('kind', '=', 'crew').where('active', '=', true).orderBy('name').execute();
  const blackedOut = await trx.selectFrom('blackout_rules').select('resource_id').where('scope', '=', 'resource').where('starts_on', '<=', booking.event_date).where('ends_on', '>=', booking.event_date).execute();
  const out = new Set(blackedOut.map((b) => b.resource_id));
  const existing = await trx
    .selectFrom('resource_reservations')
    .select(['resource_id', 'starts_at', 'ends_at'])
    .where('status', '!=', 'released')
    .where('ends_at', '>', phases[0].starts_at)
    .where('starts_at', '<', phases[1].ends_at)
    .execute();

  let assigned = 0;
  for (const crew of crews) {
    if (assigned >= booking.crews_required) break;
    if (out.has(crew.id)) continue;
    const busy = phases.some((p) => existing.some((r) => r.resource_id === crew.id && overlaps(r.starts_at, r.ends_at, p.starts_at, p.ends_at)));
    if (busy) continue;
    for (const p of phases) {
      await trx
        .insertInto('resource_reservations')
        .values({ resource_id: crew.id, booking_id: booking.id, phase: p.phase, starts_at: p.starts_at, ends_at: p.ends_at, status: opts.status, hold_expires_at: opts.holdExpiresAt })
        .execute();
    }
    assigned++;
  }
  if (assigned < booking.crews_required) {
    throw conflict('capacity_crews', 'All of the shop’s event crews are committed at that time.');
  }

  for (const r of opts.rentals) {
    const item = await trx.selectFrom('rental_items').select(['cleaning_buffer_minutes']).where('id', '=', r.rental_item_id).executeTakeFirst();
    await trx
      .insertInto('rental_reservations')
      .values({
        rental_item_id: r.rental_item_id,
        booking_id: booking.id,
        quantity: r.quantity,
        starts_at: opts.times.rental_start,
        ends_at: opts.times.rental_end,
        buffer_minutes: item?.cleaning_buffer_minutes ?? 0,
        blocked_until: opts.times.rental_end,
        status: opts.status,
        hold_expires_at: opts.holdExpiresAt,
      })
      .execute();
  }
}

export async function releaseBookingResources(trx: Db, bookingId: string) {
  await trx.updateTable('resource_reservations').set({ status: 'released' }).where('booking_id', '=', bookingId).where('status', '!=', 'released').execute();
  await trx.updateTable('rental_reservations').set({ status: 'cancelled' }).where('booking_id', '=', bookingId).where('status', 'in', ['hold', 'approved', 'confirmed']).execute();
}
