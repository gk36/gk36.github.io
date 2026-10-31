import { describe, expect, it } from 'vitest';
import { addDays, ageOn, dayKeyFor, daysBetween, isDayKey, wallClock } from './time';

const ATH = 'Europe/Athens';
const at = (iso: string) => Date.parse(iso);

describe('dayKeyFor', () => {
  it('a 01:30 snack with a 04:00 day start belongs to the previous day', () => {
    // 2026-10-29T23:30Z = 01:30 on Oct 30 in Athens (EET, UTC+2)
    expect(wallClock(at('2026-10-29T23:30:00Z'), ATH).h).toBe(1);
    expect(dayKeyFor(at('2026-10-29T23:30:00Z'), ATH, 4)).toBe('2026-10-29');
    expect(dayKeyFor(at('2026-10-29T23:30:00Z'), ATH, 0)).toBe('2026-10-30');
  });

  it('handles the 25-hour day (Athens DST ends 2026-10-25 04:00 → 03:00)', () => {
    // 03:30 happens twice; both belong to Oct 24 with a 04:00 start.
    expect(dayKeyFor(at('2026-10-25T00:30:00Z'), ATH, 4)).toBe('2026-10-24'); // 03:30 EEST
    expect(dayKeyFor(at('2026-10-25T01:30:00Z'), ATH, 4)).toBe('2026-10-24'); // 03:30 EET
    expect(dayKeyFor(at('2026-10-25T02:00:00Z'), ATH, 4)).toBe('2026-10-25'); // 04:00 EET
    expect(dayKeyFor(at('2026-10-25T21:59:00Z'), ATH, 4)).toBe('2026-10-25'); // 23:59 EET
  });

  it('handles the 23-hour day (Athens DST starts 2027-03-28 03:00 → 04:00)', () => {
    expect(dayKeyFor(at('2027-03-28T00:30:00Z'), ATH, 4)).toBe('2027-03-27'); // 02:30 EET
    expect(wallClock(at('2027-03-28T01:00:00Z'), ATH).h).toBe(4); // 03:00 never exists
    expect(dayKeyFor(at('2027-03-28T01:00:00Z'), ATH, 4)).toBe('2027-03-28');
  });

  it('respects other zones', () => {
    expect(dayKeyFor(at('2026-10-30T03:00:00Z'), 'America/New_York', 0)).toBe('2026-10-29');
  });
});

describe('calendar helpers', () => {
  it('addDays across month and year ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
  });
  it('daysBetween', () => {
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
    expect(daysBetween('2026-10-26', '2026-10-24')).toBe(-2);
  });
  it('isDayKey', () => {
    expect(isDayKey('2026-10-30')).toBe(true);
    expect(isDayKey('2026-02-30')).toBe(false);
    expect(isDayKey('30/10/2026')).toBe(false);
  });
  it('ageOn switches exactly on the birthday', () => {
    expect(ageOn('2008-05-14', '2026-05-13')).toBe(17);
    expect(ageOn('2008-05-14', '2026-05-14')).toBe(18);
  });
});
