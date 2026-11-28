// Date rules for the reading-streak (ROR) figures. Every ROR date is a calendar day on the Toronto reporting calendar
// (src/lib/dates.ts), not a UTC day and not the browser's local day.
//
// last_completed is a SQL date, so it arrives as 'YYYY-MM-DD'. Parsing that with new Date() reads it as UTC midnight,
// which is the previous evening in Toronto and shifts the displayed day and the days-since count by one.

import { isDateKey, toLocalDateKey } from './dates';

/** Shown wherever reading status appears. Reading status is entered by the member, not verified. */
export const ROR_SELF_REPORTED_NOTE =
  'Reading status is self-reported by the member. It is not a verified attendance record.';

/** Today's calendar day on the Toronto reporting calendar, as YYYY-MM-DD. */
export function rorToday(now: Date = new Date()): string {
  return toLocalDateKey(now);
}

/** The reporting month as YYYY-MM, taken from the Toronto calendar day. */
export function rorMonthYear(now: Date = new Date()): string {
  return rorToday(now).slice(0, 7);
}

/**
 * The calendar day of a stored date. Date-only values are kept as they are. A timestamp is converted to its Toronto
 * day. Returns null for a value that is neither.
 */
export function dateKeyOf(value: string | null | undefined): string | null {
  if (!value) return null;
  if (isDateKey(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return toLocalDateKey(parsed);
}

/** Whole calendar days from one day key to another (negative if the second is earlier), or null if either is invalid. */
export function daysBetweenKeys(fromKey: string, toKey: string): number | null {
  if (!isDateKey(fromKey) || !isDateKey(toKey)) return null;
  const [fy, fm, fd] = fromKey.split('-').map(Number);
  const [ty, tm, td] = toKey.split('-').map(Number);
  const from = Date.UTC(fy, fm - 1, fd);
  const to = Date.UTC(ty, tm - 1, td);
  return Math.round((to - from) / 86_400_000);
}

/** A day key as a short label such as "Nov 20", computed without a time zone shift. */
export function formatRorDay(dateKey: string | null): string {
  if (!dateKey || !isDateKey(dateKey)) return '—';
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-CA', {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}
