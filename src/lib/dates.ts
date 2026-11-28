// Reporting-calendar helpers. Every reporting date is interpreted on the America/Toronto calendar, whatever zone the
// browser or server runs in. Meeting dates are plain YYYY-MM-DD values that name a day in Toronto.
//
// toISOString() and local getters are not used for calendar keys: UTC conversion moves an evening Toronto date onto
// the next day, and the local clock depends on the viewer's machine. Month instants use Toronto midnight, so a
// timestamp column (joined_at, created_at) falls in the same month as the calendar it is reported against.

export const REPORTING_TIME_ZONE = 'America/Toronto';

const keyFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: REPORTING_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const wallFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: REPORTING_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_KEY = /^\d{4}-\d{2}$/;

/** True for a well-formed YYYY-MM-DD key that names a real calendar day. */
export function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_KEY.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/** The Toronto calendar day of an instant, as YYYY-MM-DD. */
export function toLocalDateKey(date: Date = new Date()): string {
  return keyFormatter.format(date);
}

/** Adds calendar days to a YYYY-MM-DD key. Arithmetic is on the calendar, so DST cannot shift the result. */
export function shiftDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The Toronto calendar day `days` away from `from`, returned as an instant at Toronto midnight of that day. */
export function shiftLocalDays(days: number, from: Date = new Date()): Date {
  return torontoMidnight(shiftDateKey(toLocalDateKey(from), days));
}

export interface LocalMonthRange {
  start: string;
  end: string;
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// First and last calendar day of the Toronto month containing `date`, as YYYY-MM-DD keys.
export function localMonthRange(date: Date = new Date()): LocalMonthRange {
  const [y, m] = toLocalDateKey(date).split('-');
  const year = Number(y);
  const month = Number(m);
  return {
    start: `${y}-${m}-01`,
    end: `${y}-${m}-${String(lastDayOfMonth(year, month)).padStart(2, '0')}`,
  };
}

export interface LocalMonthInstants {
  start: string;
  nextStart: string;
}

// Offset of Toronto wall-clock time from UTC at `instant`, in milliseconds (negative for UTC-4 and UTC-5).
function torontoOffsetMs(instant: Date): number {
  const parts: Record<string, string> = {};
  for (const part of wallFormatter.formatToParts(instant)) parts[part.type] = part.value;
  const wallAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  // The wall clock has whole seconds, so compare against the instant with its milliseconds removed.
  const ms = instant.getTime();
  const wholeSecondsMs = ms - (((ms % 1000) + 1000) % 1000);
  return wallAsUtc - wholeSecondsMs;
}

/** The instant at which the Toronto wall clock reads 00:00 on `dateKey`. Two passes handle a DST boundary. */
export function torontoMidnight(dateKey: string): Date {
  const [y, m, d] = dateKey.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const first = guess - torontoOffsetMs(new Date(guess));
  return new Date(guess - torontoOffsetMs(new Date(first)));
}

// The same Toronto month as half-open instants for timestamp columns: [start, nextStart).
export function localMonthInstants(date: Date = new Date()): LocalMonthInstants {
  const [y, m] = toLocalDateKey(date).split('-').map(Number);
  const nextMonth = m === 12 ? [y + 1, 1] : [y, m + 1];
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    start: torontoMidnight(`${y}-${pad(m)}-01`).toISOString(),
    nextStart: torontoMidnight(`${nextMonth[0]}-${pad(nextMonth[1])}-01`).toISOString(),
  };
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** 'YYYY-MM' -> 'October 2026'. Formatted from its parts in fixed month names, so no time zone can shift the month. */
export function formatMonthHeading(monthKey: string): string {
  if (monthKey === 'unknown' || !MONTH_KEY.test(monthKey)) return 'No date';
  const [year, month] = monthKey.split('-').map(Number);
  if (month < 1 || month > 12) return 'No date';
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

/** The 'YYYY-MM' group for a date key. A missing or invalid date goes to the 'unknown' group, never a crash. */
export function monthKeyOf(dateKey: unknown): string {
  return isDateKey(dateKey) ? dateKey.slice(0, 7) : 'unknown';
}

export function groupByMonth<T extends { date: unknown }>(items: T[]): Record<string, T[]> {
  return items.reduce<Record<string, T[]>>((acc, item) => {
    const key = monthKeyOf(item.date);
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});
}
