// Calendar-date helpers. Meeting dates are plain YYYY-MM-DD values that name a day on the viewer's own calendar,
// so they are built and compared in local time. toISOString() converts to UTC first, which moves an evening date
// in a western zone (or a morning date in an eastern zone) onto a neighbouring day.

export function toLocalDateKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function shiftLocalDays(days: number, from: Date = new Date()): Date {
  const shifted = new Date(from);
  shifted.setDate(shifted.getDate() + days);
  return shifted;
}

export interface LocalMonthRange {
  start: string;
  end: string;
}

// First and last calendar day of the month containing `date`, as YYYY-MM-DD keys.
export function localMonthRange(date: Date = new Date()): LocalMonthRange {
  return {
    start: toLocalDateKey(new Date(date.getFullYear(), date.getMonth(), 1)),
    end: toLocalDateKey(new Date(date.getFullYear(), date.getMonth() + 1, 0)),
  };
}

export interface LocalMonthInstants {
  start: string;
  nextStart: string;
}

// The same month as half-open instants for timestamp columns: [start, nextStart).
export function localMonthInstants(date: Date = new Date()): LocalMonthInstants {
  return {
    start: new Date(date.getFullYear(), date.getMonth(), 1).toISOString(),
    nextStart: new Date(date.getFullYear(), date.getMonth() + 1, 1).toISOString(),
  };
}

// 'YYYY-MM' -> 'October 2026'. Built from its parts, so no timezone conversion can shift the month.
export function formatMonthHeading(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString('en-CA', { month: 'long', year: 'numeric' });
}

export function monthKeyOf(dateKey: string): string {
  return dateKey.slice(0, 7);
}

export function groupByMonth<T extends { date: string }>(items: T[]): Record<string, T[]> {
  return items.reduce<Record<string, T[]>>((acc, item) => {
    const key = monthKeyOf(item.date);
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});
}
