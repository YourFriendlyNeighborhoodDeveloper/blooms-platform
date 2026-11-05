import { describe, expect, it } from 'vitest';
import { addWorkingMinutes, atLocal, localDate, localTime, weekdayOf } from './time.js';

const TZ = 'America/Detroit';
const hours = [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens_at: '09:00', closes_at: '17:00', closed: false }));

describe('business timezone', () => {
  it('converts wall-clock times correctly on both sides of daylight saving', () => {
    expect(atLocal('2026-07-01', '09:00', TZ).toISOString()).toBe('2026-07-01T13:00:00.000Z'); // EDT, UTC-4
    expect(atLocal('2026-12-01', '09:00', TZ).toISOString()).toBe('2026-12-01T14:00:00.000Z'); // EST, UTC-5
  });

  it('handles the spring-forward gap, when 2:30 AM does not exist', () => {
    const at = atLocal('2027-03-14', '02:30', TZ);
    expect(localTime(at, TZ)).toBe('03:30');
    expect(localDate(at, TZ)).toBe('2027-03-14');
  });

  it('resolves the fall-back overlap, when 1:30 AM happens twice', () => {
    const at = atLocal('2026-11-01', '01:30', TZ);
    expect(localTime(at, TZ)).toBe('01:30');
    expect(at.toISOString()).toBe('2026-11-01T06:30:00.000Z'); // always the later occurrence, EST
  });

  it('knows the local date near midnight, regardless of the server timezone', () => {
    expect(localDate(new Date('2026-11-11T03:30:00Z'), TZ)).toBe('2026-11-10'); // 10:30 PM on the 10th
    expect(weekdayOf('2026-11-10', TZ)).toBe(2); // Tuesday
    expect(weekdayOf('2026-11-08', TZ)).toBe(0); // Sunday
  });
});

describe('addWorkingMinutes', () => {
  it('counts only open hours', () => {
    const start = atLocal('2026-11-10', '16:00', TZ); // Tuesday, 1 hour before close
    const end = addWorkingMinutes(start, 120, hours, TZ)!;
    expect(localDate(end, TZ)).toBe('2026-11-11');
    expect(localTime(end, TZ)).toBe('10:00');
  });

  it('starts at opening when started overnight', () => {
    const start = atLocal('2026-11-10', '23:30', TZ);
    const end = addWorkingMinutes(start, 30, hours, TZ)!;
    expect(localDate(end, TZ)).toBe('2026-11-11');
    expect(localTime(end, TZ)).toBe('09:30');
  });

  it('skips closed days and blocked dates', () => {
    const start = atLocal('2026-11-07', '16:30', TZ); // Saturday
    const skipSunday = addWorkingMinutes(start, 60, hours, TZ)!;
    expect(localDate(skipSunday, TZ)).toBe('2026-11-09');
    const skipMonday = addWorkingMinutes(start, 60, hours, TZ, (d) => d === '2026-11-09')!;
    expect(localDate(skipMonday, TZ)).toBe('2026-11-10');
  });

  it('returns null rather than a false promise when there is no open time', () => {
    expect(addWorkingMinutes(atLocal('2026-11-10', '09:00', TZ), 60, [], TZ)).toBeNull();
  });

  it('is correct across a daylight saving change', () => {
    const open247 = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens_at: '00:00', closes_at: '23:59', closed: false }));
    const start = atLocal('2026-10-31', '23:00', TZ);
    const end = addWorkingMinutes(start, 180, open247, TZ)!;
    expect(end.getTime() - start.getTime()).toBeLessThanOrEqual(180 * 60_000 + 2 * 60_000);
  });
});
