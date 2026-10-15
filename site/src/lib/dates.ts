import type { PublicEvent } from '../content/types';

// The site is for York University, Toronto. Calendar output uses this zone; formatting uses it too.
export const SITE_TIME_ZONE = 'America/Toronto';

/** Formats an ISO date (YYYY-MM-DD) in the site zone. The date is anchored at noon UTC to avoid day shifts. */
export function formatDate(iso: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SITE_TIME_ZONE, ...options }).format(
    new Date(`${iso}T12:00:00Z`),
  );
}

/** 24-hour HH:MM to a 12-hour label, for example 18:30 to 6:30 PM. */
export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

export function eventTimeRange(event: Pick<PublicEvent, 'start' | 'end'>): string {
  return `${formatTime(event.start)} – ${formatTime(event.end)}`;
}

/** Events split by whether the date is today or later. Upcoming is ascending, past is descending. */
export function partitionEvents(events: PublicEvent[], today: string): { upcoming: PublicEvent[]; past: PublicEvent[] } {
  const upcoming = events.filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const past = events.filter((e) => e.date < today).sort((a, b) => b.date.localeCompare(a.date));
  return { upcoming, past };
}

/** Today's date in the site zone as YYYY-MM-DD. */
export function todayInSiteZone(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SITE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function compact(iso: string): string {
  return iso.replace(/-/g, '');
}
function compactTime(hhmm: string): string {
  return `${hhmm.replace(':', '')}00`;
}

/** Google Calendar template link for an event. */
export function googleCalendarUrl(event: PublicEvent, location: string): string {
  const dates = `${compact(event.date)}T${compactTime(event.start)}/${compact(event.date)}T${compactTime(event.end)}`;
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates,
    ctz: SITE_TIME_ZONE,
    details: event.summary,
    location,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** iCalendar (.ics) text for an event. Line endings follow RFC 5545. */
export function icsForEvent(event: PublicEvent, location: string, stamp: string): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//BLW York//Events//EN',
    'BEGIN:VEVENT',
    `UID:${event.slug}@blw-york`,
    `DTSTAMP:${stamp}`,
    `DTSTART;TZID=${SITE_TIME_ZONE}:${compact(event.date)}T${compactTime(event.start)}`,
    `DTEND;TZID=${SITE_TIME_ZONE}:${compact(event.date)}T${compactTime(event.end)}`,
    `SUMMARY:${escapeIcs(event.title)}`,
    `DESCRIPTION:${escapeIcs(event.summary)}`,
    `LOCATION:${escapeIcs(location)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n');
}

function escapeIcs(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}
