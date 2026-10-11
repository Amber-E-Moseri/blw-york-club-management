/**
 * Calendar links for events. Google Calendar opens from a URL; Apple Calendar, Outlook and most other clients
 * open an .ics file, so one download covers them.
 *
 * Event times are stored as a local wall-clock date and time with no timezone, so they are read in APP_TIME_ZONE.
 */

/** The church's local timezone. Event dates and times are entered in this zone. */
export const APP_TIME_ZONE = 'America/Toronto';

const DEFAULT_DURATION_MINUTES = 60;

export interface CalendarEvent {
  id: string;
  title: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM or HH:MM:SS; empty means an all-day event */
  time?: string | null;
  location?: string | null;
  description?: string | null;
  durationMinutes?: number;
}

/** Offset of `tz` from UTC at the given instant, in minutes. */
function tzOffsetMinutes(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wallAsUtc = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
  return (wallAsUtc - utcMs) / 60000;
}

/** Converts a wall-clock date and time in `tz` to the matching UTC instant. */
export function zonedTimeToUtc(date: string, time: string, tz: string = APP_TIME_ZONE): Date {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute, second = 0] = time.split(':').map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  // Two passes so the offset is right on either side of a daylight-saving change.
  const first = wall - tzOffsetMinutes(wall, tz) * 60000;
  return new Date(wall - tzOffsetMinutes(first, tz) * 60000);
}

/** YYYYMMDDTHHMMSSZ, the UTC form both Google Calendar and iCalendar use. */
function toUtcStamp(instant: Date): string {
  return instant.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function compactDate(date: string): string {
  return date.replace(/-/g, '');
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

/** Start and end of the event as UTC instants, or null for an all-day event. */
function timedRange(event: CalendarEvent): { start: Date; end: Date } | null {
  if (!event.time) return null;
  const start = zonedTimeToUtc(event.date, event.time);
  const end = new Date(start.getTime() + (event.durationMinutes ?? DEFAULT_DURATION_MINUTES) * 60000);
  return { start, end };
}

/** A link that opens Google Calendar with this event filled in, ready to save. */
export function buildGoogleCalendarUrl(event: CalendarEvent): string {
  const range = timedRange(event);
  const dates = range
    ? `${toUtcStamp(range.start)}/${toUtcStamp(range.end)}`
    : `${compactDate(event.date)}/${compactDate(addDays(event.date, 1))}`;

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates,
  });
  if (event.description) params.set('details', event.description);
  if (event.location) params.set('location', event.location);

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Escapes text for an iCalendar property value (RFC 5545 section 3.3.11). */
function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** Number of UTF-8 octets a single code point occupies. */
function utf8Length(char: string): number {
  const codePoint = char.codePointAt(0) ?? 0;
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

/** Folds a content line at 75 octets, as RFC 5545 section 3.1 requires, without splitting a character. */
function foldIcsLine(line: string): string {
  const chunks: string[] = [];
  let current = '';
  let currentBytes = 0;
  let limit = 75;
  for (const char of line) {
    const bytes = utf8Length(char);
    if (currentBytes + bytes > limit) {
      chunks.push(current);
      current = '';
      currentBytes = 0;
      limit = 74; // continuation lines start with a space, which uses one octet
    }
    current += char;
    currentBytes += bytes;
  }
  chunks.push(current);
  return chunks.join('\r\n ');
}

/** A complete .ics calendar containing one event. */
export function buildIcs(event: CalendarEvent, now: Date = new Date()): string {
  const range = timedRange(event);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//BLW York Hub//Events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:event-${event.id}@blw-york-hub`,
    `DTSTAMP:${toUtcStamp(now)}`,
  ];

  if (range) {
    lines.push(`DTSTART:${toUtcStamp(range.start)}`, `DTEND:${toUtcStamp(range.end)}`);
  } else {
    lines.push(
      `DTSTART;VALUE=DATE:${compactDate(event.date)}`,
      `DTEND;VALUE=DATE:${compactDate(addDays(event.date, 1))}`
    );
  }

  lines.push(`SUMMARY:${escapeIcsText(event.title)}`);
  if (event.location) lines.push(`LOCATION:${escapeIcsText(event.location)}`);
  if (event.description) lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');

  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}

/** Saves the event as an .ics file in the browser. Apple Calendar opens it directly. */
export function downloadIcs(event: CalendarEvent): void {
  const blob = new Blob([buildIcs(event)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${event.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'event'}.ics`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
