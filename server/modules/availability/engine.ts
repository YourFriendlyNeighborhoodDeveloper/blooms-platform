import { DateTime } from 'luxon';
import type { Db } from '../../db/client.js';
import type { Clock, HoursRow } from '../../lib/time.js';
import { addDays, addHours, addMinutes, addWorkingMinutes, atLocal, localDate, localTime, weekdayOf } from '../../lib/time.js';
import { loadSettings, type SettingsState } from '../settings/service.js';

export type Reason = { code: string; message: string };
export type SlotStatus = 'open' | 'review' | 'blocked';
export type Method = 'pickup' | 'delivery' | 'shipping';

export type DemandLine = {
  product_id: string;
  name: string;
  quantity: number;
  division_id: string;
  prep_minutes: number;
  complexity_points: number;
  min_lead_hours: number;
  allow_pickup: boolean;
  allow_delivery: boolean;
  allow_shipping: boolean;
  restricted_zone_ids: string[];
  season_start_md: string | null;
  season_end_md: string | null;
  available_from: string | null;
  available_until: string | null;
  requires_approval: boolean | null;
  is_custom: boolean;
};

export type Demand = { lines: DemandLine[]; subtotal_cents: number };

export type WindowRow = {
  id: string;
  kind: string;
  zone_id: string | null;
  division_id: string | null;
  weekday: number;
  start_time: string;
  end_time: string;
  cutoff_minutes: number;
  max_stops: number | null;
};

export type ZoneRow = { id: string; name: string; postal_codes: string[]; fee_cents: number; min_order_cents: number; travel_minutes: number | null };

export type BlackoutRow = {
  scope: string;
  division_id: string | null;
  resource_id: string | null;
  starts_on: string;
  ends_on: string;
  affects: string[];
  reason: string;
  public_message: string | null;
};

export type OverrideRow = {
  on_date: string;
  division_id: string | null;
  max_orders: number | null;
  max_points: number | null;
  max_stops: number | null;
  max_events: number | null;
  same_day_enabled: boolean | null;
};

export type StaffRow = {
  id: string;
  display_name: string;
  capabilities: string[];
  max_appointments_per_day: number | null;
  max_events_per_day: number | null;
  availability: Array<{ weekday: number; starts_at: string; ends_at: string }>;
  time_off: Array<{ starts_on: string; ends_on: string }>;
};

export type ClaimTotals = { orders: number; points: number; minutes: number };

export type PolicyContext = {
  now: Date;
  tz: string;
  settings: SettingsState;
  hours: HoursRow[];
  divisionHours: Map<string, HoursRow[]>;
  blackouts: BlackoutRow[];
  overrides: OverrideRow[];
  windows: WindowRow[];
  zones: ZoneRow[];
  staff: StaffRow[];
  claims: Map<string, ClaimTotals>;
  stops: Map<string, number>;
};

const trimTime = (t: string) => t.slice(0, 5);

/** Everything the rules need for a date range, read once so a whole calendar evaluates consistently. */
export async function loadPolicyContext(db: Db, clock: Clock, from: string, to: string): Promise<PolicyContext> {
  const settings = await loadSettings(db);
  const hoursRows = await db.selectFrom('business_hours').select(['division_id', 'weekday', 'opens_at', 'closes_at', 'closed']).execute();
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
  const windows = await db
    .selectFrom('delivery_windows')
    .select(['id', 'kind', 'zone_id', 'division_id', 'weekday', 'start_time', 'end_time', 'cutoff_minutes', 'max_stops'])
    .where('active', '=', true)
    .orderBy('start_time')
    .execute();
  const zones = await db.selectFrom('delivery_zones').select(['id', 'name', 'postal_codes', 'fee_cents', 'min_order_cents', 'travel_minutes']).where('active', '=', true).orderBy('sort_order').execute();
  const staffRows = await db
    .selectFrom('staff_profiles')
    .innerJoin('users', 'users.id', 'staff_profiles.user_id')
    .select(['staff_profiles.id', 'staff_profiles.display_name', 'staff_profiles.capabilities', 'staff_profiles.max_appointments_per_day', 'staff_profiles.max_events_per_day'])
    .where('staff_profiles.active', '=', true)
    .where('users.status', '=', 'active')
    .execute();
  const ids = staffRows.map((s) => s.id);
  const avail = ids.length ? await db.selectFrom('staff_availability').select(['staff_id', 'weekday', 'starts_at', 'ends_at']).where('staff_id', 'in', ids).execute() : [];
  const off = ids.length
    ? await db.selectFrom('staff_time_off').select(['staff_id', 'starts_on', 'ends_on']).where('staff_id', 'in', ids).where('ends_on', '>=', from).where('starts_on', '<=', to).execute()
    : [];
  const claimRows = await db
    .selectFrom('capacity_claims')
    .select(['claim_date', 'points', 'prep_minutes', 'counts_as_order', 'stops', 'window_id'])
    .where('status', '=', 'active')
    .where('claim_date', '>=', from)
    .where('claim_date', '<=', to)
    .execute();

  const claims = new Map<string, ClaimTotals>();
  const stops = new Map<string, number>();
  for (const c of claimRows) {
    const t = claims.get(c.claim_date) ?? { orders: 0, points: 0, minutes: 0 };
    t.orders += c.counts_as_order ? 1 : 0;
    t.points += c.points;
    t.minutes += c.prep_minutes;
    claims.set(c.claim_date, t);
    if (c.window_id && c.stops) {
      const key = `${c.claim_date}:${c.window_id}`;
      stops.set(key, (stops.get(key) ?? 0) + c.stops);
    }
  }

  const toRow = (h: (typeof hoursRows)[number]): HoursRow => ({ weekday: h.weekday, opens_at: h.opens_at, closes_at: h.closes_at, closed: h.closed });
  const divisionHours = new Map<string, HoursRow[]>();
  for (const h of hoursRows) {
    if (!h.division_id) continue;
    divisionHours.set(h.division_id, [...(divisionHours.get(h.division_id) ?? []), toRow(h)]);
  }

  return {
    now: clock.now(),
    tz: settings.general.timezone,
    settings,
    hours: hoursRows.filter((h) => !h.division_id).map(toRow),
    divisionHours,
    blackouts,
    overrides,
    windows,
    zones,
    staff: staffRows.map((s) => ({
      ...s,
      availability: avail.filter((a) => a.staff_id === s.id),
      time_off: off.filter((o) => o.staff_id === s.id),
    })),
    claims,
    stops,
  };
}

export function findZone(ctx: PolicyContext, postalCode: string | null | undefined): ZoneRow | null {
  const zip = (postalCode ?? '').trim().slice(0, 5);
  if (!zip) return null;
  return ctx.zones.find((z) => z.postal_codes.includes(zip)) ?? null;
}

/** Blackout in force for this date and activity, or null. Division closures only affect that division. */
export function blackoutFor(ctx: Pick<PolicyContext, 'blackouts'>, date: string, activity: string, divisionIds: string[]): BlackoutRow | null {
  return (
    ctx.blackouts.find((b) => {
      if (date < b.starts_on || date > b.ends_on) return false;
      if (b.scope === 'resource') return false;
      if (b.scope === 'division' && !divisionIds.includes(b.division_id as string)) return false;
      return b.affects.length === 0 || b.affects.includes(activity);
    }) ?? null
  );
}

export function overrideFor(ctx: Pick<PolicyContext, 'overrides'>, date: string, divisionIds: string[]): OverrideRow | null {
  const specific = ctx.overrides.find((o) => o.on_date === date && o.division_id && divisionIds.includes(o.division_id));
  return specific ?? ctx.overrides.find((o) => o.on_date === date && !o.division_id) ?? null;
}

export function staffOnDuty(ctx: Pick<PolicyContext, 'staff' | 'tz'>, capability: string, date: string, from?: string, to?: string): StaffRow[] {
  const weekday = weekdayOf(date, ctx.tz);
  return ctx.staff.filter((s) => {
    if (!s.capabilities.includes(capability)) return false;
    if (s.time_off.some((o) => date >= o.starts_on && date <= o.ends_on)) return false;
    return s.availability.some((a) => a.weekday === weekday && (!from || !to || (trimTime(a.starts_at) < to && trimTime(a.ends_at) > from)));
  });
}

/** Minutes of production time rostered on a date, after days off. */
export function productionMinutes(ctx: Pick<PolicyContext, 'staff' | 'tz'>, date: string): number {
  const weekday = weekdayOf(date, ctx.tz);
  let total = 0;
  for (const s of staffOnDuty(ctx, 'production', date)) {
    for (const a of s.availability.filter((x) => x.weekday === weekday)) {
      const [ah, am] = a.starts_at.split(':').map(Number);
      const [bh, bm] = a.ends_at.split(':').map(Number);
      total += bh * 60 + bm - (ah * 60 + am);
    }
  }
  return total;
}

export function inSeason(line: Pick<DemandLine, 'season_start_md' | 'season_end_md' | 'available_from' | 'available_until'>, date: string): boolean {
  if (line.available_from && date < line.available_from) return false;
  if (line.available_until && date > line.available_until) return false;
  if (line.season_start_md && line.season_end_md) {
    const md = date.slice(5);
    const { season_start_md: a, season_end_md: b } = line;
    // A season such as 11-15 to 01-05 wraps past New Year.
    return a <= b ? md >= a && md <= b : md >= a || md <= b;
  }
  return true;
}

const fmtTime = (t: string) => DateTime.fromFormat(trimTime(t), 'HH:mm').toFormat('h:mm a');

export type Slot = {
  date: string;
  window_id: string;
  start: Date;
  end: Date;
  status: SlotStatus;
  reasons: Reason[];
};

/**
 * The central decision: can this demand be promised for this window? `blocked` must never reach
 * payment. `review` may proceed only as a request a person confirms. The same function powers the
 * calendar a customer sees and the final check inside the checkout transaction, so the UI cannot
 * offer anything the server would refuse.
 */
export function evaluateSlot(ctx: PolicyContext, demand: Demand, method: 'pickup' | 'delivery', date: string, window: WindowRow, zone: ZoneRow | null): Slot {
  const { settings, tz, now } = ctx;
  const ordering = settings.ordering;
  const blocks: Reason[] = [];
  const reviews: Reason[] = [];
  const divisions = [...new Set(demand.lines.map((l) => l.division_id))];
  let start = atLocal(date, window.start_time, tz);
  const end = atLocal(date, window.end_time, tz);

  const prep = demand.lines.reduce((sum, l) => sum + l.prep_minutes, 0);
  const points = demand.lines.reduce((sum, l) => sum + l.complexity_points, 0);
  const production = prep > 0 || points > 0;
  const override = overrideFor(ctx, date, divisions);

  if (end <= now) blocks.push({ code: 'past', message: 'That time has passed.' });

  const closure = blackoutFor(ctx, date, 'orders', divisions) ?? blackoutFor(ctx, date, method, divisions);
  if (closure) blocks.push({ code: 'blackout', message: closure.public_message ?? 'The shop is not taking orders for this date.' });

  for (const line of demand.lines) {
    if (!inSeason(line, date)) blocks.push({ code: 'out_of_season', message: `${line.name} is not available on this date.` });
    if (method === 'pickup' && !line.allow_pickup) blocks.push({ code: 'method_not_allowed', message: `${line.name} is not available for pickup.` });
    if (method === 'delivery' && !line.allow_delivery) blocks.push({ code: 'method_not_allowed', message: `${line.name} is not available for delivery.` });
    if (method === 'delivery' && zone && line.restricted_zone_ids.length && !line.restricted_zone_ids.includes(zone.id)) {
      blocks.push({ code: 'zone_restricted', message: `${line.name} cannot be delivered to this area.` });
    }
  }

  if (date === localDate(now, tz)) {
    const enabled = override?.same_day_enabled ?? ordering.same_day_enabled;
    if (!enabled) {
      blocks.push({ code: 'same_day_disabled', message: 'Same-day orders are not available online.' });
    } else if (ordering.same_day_cutoff && localTime(now, tz) > ordering.same_day_cutoff) {
      blocks.push({ code: 'same_day_cutoff', message: `Same-day orders close at ${fmtTime(ordering.same_day_cutoff)}.` });
    }
  }

  if (now > addMinutes(start, -window.cutoff_minutes)) {
    blocks.push({ code: 'window_cutoff', message: 'Orders for this window have closed.' });
  }

  const leadHours = Math.max(ordering.min_lead_hours, ...demand.lines.map((l) => l.min_lead_hours));
  let readyAt = addHours(now, leadHours);
  if (prep > 0) {
    if (!ctx.hours.length) {
      reviews.push({ code: 'hours_not_configured', message: 'Shop hours are not set, so preparation time needs confirming.' });
    } else {
      const worked = addWorkingMinutes(now, prep, ctx.hours, tz, (d) => blackoutFor(ctx, d, 'orders', divisions) !== null);
      if (!worked) blocks.push({ code: 'prep_time', message: 'There is not enough open time to prepare this.' });
      else if (worked > readyAt) readyAt = worked;
    }
  }

  if (method === 'delivery') {
    const travel = zone?.travel_minutes ?? 0;
    if (readyAt > addMinutes(start, -(settings.delivery.buffer_minutes + travel))) {
      blocks.push({ code: 'prep_time', message: 'There is not enough time to prepare and deliver this for that window.' });
    }
  } else if (readyAt >= end) {
    blocks.push({ code: 'prep_time', message: 'There is not enough time to prepare this for that window.' });
  } else if (readyAt > start) {
    start = readyAt;
  }

  if (production) {
    const used = ctx.claims.get(date) ?? { orders: 0, points: 0, minutes: 0 };
    const maxOrders = override?.max_orders ?? ordering.daily_order_limit;
    const maxPoints = override?.max_points ?? ordering.daily_points_limit;
    if (maxOrders === null && maxPoints === null) {
      reviews.push({ code: 'capacity_not_configured', message: 'Daily capacity is not set, so the shop confirms this by hand.' });
    }
    if (maxOrders !== null && used.orders + 1 > maxOrders) blocks.push({ code: 'capacity_orders', message: 'The shop is fully booked for this date.' });
    if (maxPoints !== null && used.points + points > maxPoints) blocks.push({ code: 'capacity_points', message: 'The shop does not have enough production capacity left for this date.' });

    const hasProductionStaff = ctx.staff.some((s) => s.capabilities.includes('production'));
    if (!hasProductionStaff) {
      reviews.push({ code: 'staff_not_configured', message: 'The production schedule is not set, so the shop confirms this by hand.' });
    } else if (prep > 0) {
      const rostered = productionMinutes(ctx, date);
      if (used.minutes + prep > rostered) blocks.push({ code: 'capacity_staff', message: 'There are not enough people working that day to prepare this.' });
    }
  }

  if (method === 'delivery') {
    if (!zone) {
      blocks.push({ code: 'no_zone', message: 'That address is outside the delivery area.' });
    } else {
      if (demand.subtotal_cents < zone.min_order_cents) {
        blocks.push({ code: 'min_order', message: `Delivery to ${zone.name} has a minimum order of $${(zone.min_order_cents / 100).toFixed(2)}.` });
      }
      const stopKey = `${date}:${window.id}`;
      const usedStops = ctx.stops.get(stopKey) ?? 0;
      const from = trimTime(window.start_time);
      const to = trimTime(window.end_time);
      const hasDrivers = ctx.staff.some((s) => s.capabilities.includes('delivery'));
      const drivers = staffOnDuty(ctx, 'delivery', date, from, to).length;
      if (settings.delivery.require_driver_on_duty) {
        if (!hasDrivers) reviews.push({ code: 'drivers_not_configured', message: 'The delivery schedule is not set, so the shop confirms this by hand.' });
        else if (drivers === 0) blocks.push({ code: 'no_driver', message: 'No driver is scheduled for this window.' });
      }
      const limits: number[] = [];
      if (window.max_stops !== null) limits.push(window.max_stops);
      if (override?.max_stops !== null && override?.max_stops !== undefined) limits.push(override.max_stops);
      const perDriver = settings.delivery.max_stops_per_driver_window;
      if (perDriver !== null && hasDrivers) limits.push(perDriver * drivers);
      if (!limits.length) reviews.push({ code: 'stops_not_configured', message: 'Delivery capacity is not set, so the shop confirms this by hand.' });
      else if (usedStops + 1 > Math.min(...limits)) blocks.push({ code: 'capacity_stops', message: 'This delivery window is full.' });
    }
  } else if (window.max_stops !== null) {
    const used = ctx.stops.get(`${date}:${window.id}`) ?? 0;
    if (used + 1 > window.max_stops) blocks.push({ code: 'capacity_stops', message: 'This pickup window is full.' });
  }

  if (!settings.approved.ordering) {
    reviews.push({ code: 'policy_unapproved', message: 'Ordering rules are not approved yet, so the shop confirms each order by hand.' });
  }
  for (const line of demand.lines) {
    const needs = line.requires_approval ?? (line.is_custom && ordering.custom_requires_approval);
    if (needs) reviews.push({ code: 'custom_approval', message: `${line.name} is confirmed by the shop before it is scheduled.` });
  }

  return {
    date,
    window_id: window.id,
    start,
    end,
    status: blocks.length ? 'blocked' : reviews.length ? 'review' : 'open',
    reasons: blocks.length ? blocks : reviews,
  };
}

export function windowsFor(ctx: PolicyContext, method: 'pickup' | 'delivery', date: string, zone: ZoneRow | null, divisionIds: string[]): WindowRow[] {
  const weekday = weekdayOf(date, ctx.tz);
  return ctx.windows.filter(
    (w) =>
      w.kind === method &&
      w.weekday === weekday &&
      (!w.zone_id || w.zone_id === zone?.id) &&
      (!w.division_id || divisionIds.includes(w.division_id)),
  );
}

export function listSlots(ctx: PolicyContext, demand: Demand, method: 'pickup' | 'delivery', zone: ZoneRow | null, from: string, days: number): Slot[] {
  const divisions = [...new Set(demand.lines.map((l) => l.division_id))];
  const out: Slot[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i, ctx.tz);
    for (const w of windowsFor(ctx, method, date, zone, divisions)) out.push(evaluateSlot(ctx, demand, method, date, w, zone));
  }
  return out;
}

export const earliestFeasible = (slots: Slot[]) => slots.find((s) => s.status !== 'blocked') ?? null;
