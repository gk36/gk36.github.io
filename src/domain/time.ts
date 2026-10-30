/**
 * Calendar logic. A "day key" is the local calendar date (YYYY-MM-DD) of the user's day,
 * where the day starts at `dayStartHour` local WALL-CLOCK time (so a 01:30 snack with a
 * 04:00 day start belongs to the previous day). Wall-clock comparison keeps this correct
 * across DST changes (e.g. Athens' 25-hour 2026-10-25 and 23-hour 2027-03-28).
 */

export type DayKey = string;

const partsCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    partsCache.set(tz, f);
  }
  return f;
}

export interface WallClock { y: number; m: number; d: number; h: number; min: number }

export function wallClock(epochMs: number, tz: string): WallClock {
  const p: Record<string, number> = {};
  for (const part of fmt(tz).formatToParts(new Date(epochMs))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  return { y: p.year!, m: p.month!, d: p.day!, h: (p.hour ?? 0) % 24, min: p.minute ?? 0 };
}

const pad = (n: number) => String(n).padStart(2, '0');
export const toKey = (y: number, m: number, d: number): DayKey => `${y}-${pad(m)}-${pad(d)}`;

export function isDayKey(s: string): s is DayKey {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function addDays(key: DayKey, n: number): DayKey {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return toKey(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function dayKeyFor(epochMs: number, tz: string, dayStartHour = 0): DayKey {
  const w = wallClock(epochMs, tz);
  const key = toKey(w.y, w.m, w.d);
  return w.h < dayStartHour ? addDays(key, -1) : key;
}

export function minutesOfDay(epochMs: number, tz: string): number {
  const w = wallClock(epochMs, tz);
  return w.h * 60 + w.min;
}

/** Whole days between two keys (b − a). */
export function daysBetween(a: DayKey, b: DayKey): number {
  const [ay, am, ad] = a.split('-').map(Number) as [number, number, number];
  const [by, bm, bd] = b.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

export function formatDayLabel(key: DayKey, locale = 'en-GB'): string {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

/** Age in whole years on a given day (birth date as YYYY-MM-DD). */
export function ageOn(birthDate: DayKey, on: DayKey): number {
  const [by, bm, bd] = birthDate.split('-').map(Number) as [number, number, number];
  const [y, m, d] = on.split('-').map(Number) as [number, number, number];
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age -= 1;
  return age;
}

export function systemTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Athens';
  } catch {
    return 'Europe/Athens';
  }
}
