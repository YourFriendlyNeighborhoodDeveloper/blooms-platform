import { sql } from 'kysely';
import type { AppContext } from '../../context.js';
import type { Db } from '../../db/client.js';
import { audit, type Actor } from '../../lib/audit.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { addDays, addHours, addMinutes, atLocal, localDate, weekdayOf } from '../../lib/time.js';
import { emit } from '../../automation/events.js';
import { blackoutFor } from '../availability/engine.js';
import { loadSettings } from '../settings/service.js';
import { moveToStage } from './pipeline.js';

export type ConsultationSlot = { start: Date; end: Date; staff_ids: string[] };

const minutesOf = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

/** Open consultation times, computed from real schedules, time off, closures and existing bookings. */
export async function consultationSlots(db: Db, ctx: Pick<AppContext, 'clock'>, from?: string, days?: number): Promise<{ slots: ConsultationSlot[]; configured: boolean; timezone: string; duration_minutes: number }> {
  const settings = await loadSettings(db);
  const c = settings.consultations;
  const tz = settings.general.timezone;
  const now = ctx.clock.now();
  const today = localDate(now, tz);
  const start = from && from > today ? from : today;
  const horizon = Math.min(days ?? c.horizon_days, c.horizon_days);
  const end = addDays(today, c.horizon_days, tz);
  const staff = await db
    .selectFrom('staff_profiles')
    .innerJoin('users', 'users.id', 'staff_profiles.user_id')
    .select(['staff_profiles.id', 'staff_profiles.max_appointments_per_day'])
    .where('staff_profiles.active', '=', true)
    .where('users.status', '=', 'active')
    .where(sql<boolean>`'consultation' = ANY(staff_profiles.capabilities)`)
    .execute();
  const configured = c.enabled && staff.length > 0;
  if (!configured) return { slots: [], configured: false, timezone: tz, duration_minutes: c.duration_minutes };

  const ids = staff.map((s) => s.id);
  const availability = await db.selectFrom('staff_availability').select(['staff_id', 'weekday', 'starts_at', 'ends_at']).where('staff_id', 'in', ids).execute();
  const timeOff = await db.selectFrom('staff_time_off').select(['staff_id', 'starts_on', 'ends_on']).where('staff_id', 'in', ids).where('ends_on', '>=', start).where('starts_on', '<=', end).execute();
  const blackouts = await db.selectFrom('blackout_rules').select(['scope', 'division_id', 'resource_id', 'starts_on', 'ends_on', 'affects', 'reason', 'public_message']).where('ends_on', '>=', start).where('starts_on', '<=', end).execute();
  const booked = await db.selectFrom('consultations').select(['staff_id', 'starts_at', 'ends_at']).where('status', '=', 'booked').where('ends_at', '>', now).execute();

  const earliest = addHours(now, c.min_notice_hours);
  const slots: ConsultationSlot[] = [];
  for (let i = 0; i < horizon; i++) {
    const date = addDays(start, i, tz);
    if (date > end) break;
    if (blackoutFor({ blackouts }, date, 'consultations', [])) continue;
    const weekday = weekdayOf(date, tz);
    const byTime = new Map<number, ConsultationSlot>();
    for (const s of staff) {
      if (timeOff.some((o) => o.staff_id === s.id && date >= o.starts_on && date <= o.ends_on)) continue;
      const dayBookings = booked.filter((b) => b.staff_id === s.id && localDate(b.starts_at, tz) === date);
      if (s.max_appointments_per_day !== null && dayBookings.length >= s.max_appointments_per_day) continue;
      for (const shift of availability.filter((a) => a.staff_id === s.id && a.weekday === weekday)) {
        const open = minutesOf(shift.starts_at);
        const close = minutesOf(shift.ends_at);
        for (let m = open; m + c.duration_minutes <= close; m += c.step_minutes) {
          const hh = String(Math.floor(m / 60)).padStart(2, '0');
          const mm = String(m % 60).padStart(2, '0');
          const slotStart = atLocal(date, `${hh}:${mm}`, tz);
          const slotEnd = addMinutes(slotStart, c.duration_minutes);
          if (slotStart < earliest) continue;
          const clash = dayBookings.some((b) => slotStart < addMinutes(b.ends_at, c.buffer_minutes) && b.starts_at < addMinutes(slotEnd, c.buffer_minutes));
          if (clash) continue;
          const key = slotStart.getTime();
          const existing = byTime.get(key);
          if (existing) existing.staff_ids.push(s.id);
          else byTime.set(key, { start: slotStart, end: slotEnd, staff_ids: [s.id] });
        }
      }
    }
    slots.push(...[...byTime.values()].sort((a, b) => a.start.getTime() - b.start.getTime()));
  }
  return { slots, configured: true, timezone: tz, duration_minutes: c.duration_minutes };
}

/**
 * Books a consultation. Every staff member free at that time is tried under a per-staff lock, and an
 * exclusion constraint guarantees that two customers can never hold the same person at the same time.
 */
export async function bookConsultation(ctx: AppContext, input: { inquiry_id: string; starts_at: Date; format: string; actor: Actor; replace_existing?: boolean }) {
  const settings = await loadSettings(ctx.db);
  const c = settings.consultations;
  const tz = settings.general.timezone;
  if (!c.enabled) throw conflict('consultations_disabled', 'Online consultation booking is not available right now. Please call the shop.');
  if (!c.formats.includes(input.format)) throw badRequest('Please choose how you would like to meet.');
  const ends_at = addMinutes(input.starts_at, c.duration_minutes);

  const result = await ctx.db.transaction().execute(async (trx) => {
    const inquiry = await trx.selectFrom('wedding_inquiries').select(['id', 'customer_id', 'status', 'assigned_to']).where('id', '=', input.inquiry_id).forUpdate().executeTakeFirst();
    if (!inquiry) throw notFound('This plan could not be found.');
    if (['declined', 'closed'].includes(inquiry.status)) throw conflict('inquiry_closed', 'This inquiry has been closed. Please call the shop.');

    const current = await trx.selectFrom('consultations').select(['id']).where('inquiry_id', '=', input.inquiry_id).where('status', '=', 'booked').executeTakeFirst();
    if (current && !input.replace_existing) throw conflict('already_booked', 'You already have a consultation booked. You can change it below.');
    if (current) await trx.updateTable('consultations').set({ status: 'cancelled', cancelled_reason: 'Rescheduled' }).where('id', '=', current.id).execute();

    const { slots } = await consultationSlots(trx, ctx, localDate(input.starts_at, tz), 1);
    const slot = slots.find((s) => s.start.getTime() === input.starts_at.getTime());
    if (!slot) throw conflict('slot_taken', 'That time was just taken. Please choose another.');
    const order = inquiry.assigned_to && slot.staff_ids.includes(inquiry.assigned_to) ? [inquiry.assigned_to, ...slot.staff_ids.filter((s) => s !== inquiry.assigned_to)] : slot.staff_ids;

    for (const staffId of [...order].sort()) await sql`SELECT pg_advisory_xact_lock(hashtext(${`consult:${staffId}`}))`.execute(trx);
    // Re-read under lock: another transaction may have committed while this one waited.
    const fresh = await trx
      .selectFrom('consultations')
      .select(['staff_id', 'starts_at', 'ends_at'])
      .where('status', '=', 'booked')
      .where('staff_id', 'in', order)
      .where('ends_at', '>', addMinutes(input.starts_at, -c.buffer_minutes))
      .where('starts_at', '<', addMinutes(ends_at, c.buffer_minutes))
      .execute();
    const staffId = order.find((id) => !fresh.some((b) => b.staff_id === id));
    if (!staffId) throw conflict('slot_taken', 'That time was just taken. Please choose another.');

    const created = await trx
      .insertInto('consultations')
      .values({ inquiry_id: input.inquiry_id, customer_id: inquiry.customer_id, staff_id: staffId, format: input.format, starts_at: input.starts_at, ends_at })
      .returning('id')
      .executeTakeFirstOrThrow();
    await moveToStage(trx, input.inquiry_id, 'consultation_scheduled', { onlyFrom: ['new_inquiry'] });
    await trx.updateTable('wedding_inquiries').set({ consultation_format: input.format }).where('id', '=', input.inquiry_id).execute();
    await emit(trx, 'consultation.booked', { type: 'consultation', id: created.id }, { customer_id: inquiry.customer_id });
    await audit(trx, input.actor, 'consultation.book', { type: 'consultation', id: created.id }, { starts_at: input.starts_at.toISOString(), rescheduled: Boolean(current) });
    return { id: created.id, starts_at: input.starts_at, ends_at, staff_id: staffId };
  });
  return result;
}

export async function cancelConsultation(ctx: AppContext, id: string, reason: string | null, actor: Actor) {
  await ctx.db.transaction().execute(async (trx) => {
    const c = await trx.selectFrom('consultations').select(['id', 'status', 'customer_id']).where('id', '=', id).forUpdate().executeTakeFirst();
    if (!c) throw notFound('Consultation not found.');
    if (c.status !== 'booked') throw conflict('not_booked', 'This consultation is not active.');
    await trx.updateTable('consultations').set({ status: 'cancelled', cancelled_reason: reason }).where('id', '=', id).execute();
    await emit(trx, 'consultation.cancelled', { type: 'consultation', id }, { customer_id: c.customer_id });
    await audit(trx, actor, 'consultation.cancel', { type: 'consultation', id }, { reason });
  });
}
