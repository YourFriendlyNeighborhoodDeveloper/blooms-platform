import { DateTime } from 'luxon';

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export type HoursRow = { weekday: number; opens_at: string | null; closes_at: string | null; closed: boolean };

/** Sunday = 0 ... Saturday = 6, matching JavaScript and the database. */
export const weekdayOf = (date: string, tz: string) => DateTime.fromISO(date, { zone: tz }).weekday % 7;

export const localDate = (at: Date, tz: string) => DateTime.fromJSDate(at, { zone: tz }).toISODate() as string;

export const localTime = (at: Date, tz: string) => DateTime.fromJSDate(at, { zone: tz }).toFormat('HH:mm');

/**
 * The instant for a wall-clock date and time in the business timezone. Spring-forward gaps resolve
 * to the next valid time. Fall-back overlaps consistently resolve to the later occurrence (standard time).
 */
export function atLocal(date: string, time: string, tz: string): Date {
  const dt = DateTime.fromISO(`${date}T${time.length === 5 ? `${time}:00` : time}`, { zone: tz });
  if (!dt.isValid) throw new Error(`Invalid local time ${date} ${time} in ${tz}`);
  return dt.toJSDate();
}

export const addDays = (date: string, days: number, tz: string) => DateTime.fromISO(date, { zone: tz }).plus({ days }).toISODate() as string;

export const addMinutes = (at: Date, minutes: number) => new Date(at.getTime() + minutes * 60_000);

export const addHours = (at: Date, hours: number) => addMinutes(at, hours * 60);

export function formatDate(date: string, tz: string): string {
  return DateTime.fromISO(date, { zone: tz }).toFormat('cccc, LLLL d, yyyy');
}

export function formatDateTime(at: Date | string, tz: string): string {
  const dt = typeof at === 'string' ? DateTime.fromISO(at, { zone: tz }) : DateTime.fromJSDate(at, { zone: tz });
  return dt.toFormat("ccc, LLL d 'at' h:mm a ZZZZ");
}

export function formatTimeRange(start: Date, end: Date, tz: string): string {
  const s = DateTime.fromJSDate(start, { zone: tz });
  const e = DateTime.fromJSDate(end, { zone: tz });
  return `${s.toFormat('ccc, LLL d, h:mm a')} – ${e.toFormat('h:mm a')}`;
}

export const isValidTimeZone = (tz: string) => DateTime.local().setZone(tz).isValid;

/**
 * The moment `minutes` of production time have elapsed from `start`, counting only open business
 * hours. Blocked dates are skipped. Returns null if no open time exists within the horizon,
 * which callers treat as "cannot be promised".
 */
export function addWorkingMinutes(
  start: Date,
  minutes: number,
  hours: HoursRow[],
  tz: string,
  isBlocked: (date: string) => boolean = () => false,
  horizonDays = 120,
): Date | null {
  let remaining = minutes;
  const cursor = DateTime.fromJSDate(start, { zone: tz });
  if (remaining <= 0) return start;
  for (let i = 0; i < horizonDays; i++) {
    const day = cursor.plus({ days: i }).startOf('day');
    const date = day.toISODate() as string;
    if (isBlocked(date)) continue;
    const row = hours.find((h) => h.weekday === day.weekday % 7);
    if (!row || row.closed || !row.opens_at || !row.closes_at) continue;
    const open = DateTime.fromJSDate(atLocal(date, row.opens_at, tz), { zone: tz });
    const close = DateTime.fromJSDate(atLocal(date, row.closes_at, tz), { zone: tz });
    const begin = i === 0 && cursor > open ? cursor : open;
    if (begin >= close) continue;
    const available = close.diff(begin, 'minutes').minutes;
    if (remaining <= available) return begin.plus({ minutes: remaining }).toJSDate();
    remaining -= available;
  }
  return null;
}
