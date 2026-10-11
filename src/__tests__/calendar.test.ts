import { buildGoogleCalendarUrl, buildIcs, zonedTimeToUtc } from '../lib/calendar';

describe('zonedTimeToUtc', () => {
  it('converts summer Toronto time (EDT, UTC-4)', () => {
    expect(zonedTimeToUtc('2026-10-18', '19:00', 'America/Toronto').toISOString()).toBe('2026-10-18T23:00:00.000Z');
  });

  it('converts winter Toronto time (EST, UTC-5) after the daylight-saving change', () => {
    expect(zonedTimeToUtc('2026-11-03', '19:00', 'America/Toronto').toISOString()).toBe('2026-11-04T00:00:00.000Z');
  });
});

describe('buildGoogleCalendarUrl', () => {
  it('builds a timed Google Calendar template link with UTC dates', () => {
    const url = new URL(
      buildGoogleCalendarUrl({
        id: 'e1',
        title: 'Bible Study',
        date: '2026-10-18',
        time: '19:00',
        location: 'Room 2, Main St',
        description: 'Bring your Bible',
      })
    );
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('text')).toBe('Bible Study');
    expect(url.searchParams.get('dates')).toBe('20261018T230000Z/20261019T000000Z');
    expect(url.searchParams.get('location')).toBe('Room 2, Main St');
    expect(url.searchParams.get('details')).toBe('Bring your Bible');
  });

  it('builds an all-day link when there is no time', () => {
    const url = new URL(buildGoogleCalendarUrl({ id: 'e2', title: 'Retreat', date: '2026-12-31', time: '' }));
    expect(url.searchParams.get('dates')).toBe('20261231/20270101');
  });
});

describe('buildIcs', () => {
  const now = new Date('2026-10-01T12:00:00.000Z');

  it('produces a valid timed calendar with CRLF line endings', () => {
    const ics = buildIcs({ id: 'e1', title: 'Worship', date: '2026-10-18', time: '19:00' }, now);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('UID:event-e1@blw-york-hub\r\n');
    expect(ics).toContain('DTSTAMP:20261001T120000Z\r\n');
    expect(ics).toContain('DTSTART:20261018T230000Z\r\n');
    expect(ics).toContain('DTEND:20261019T000000Z\r\n');
    expect(ics).toContain('SUMMARY:Worship\r\n');
  });

  it('writes an all-day event as a DATE value spanning one day', () => {
    const ics = buildIcs({ id: 'e2', title: 'Retreat', date: '2026-12-31', time: null }, now);
    expect(ics).toContain('DTSTART;VALUE=DATE:20261231\r\n');
    expect(ics).toContain('DTEND;VALUE=DATE:20270101\r\n');
  });

  it('escapes commas, semicolons and newlines in text values', () => {
    const ics = buildIcs(
      { id: 'e3', title: 'Prayer, praise; thanks', date: '2026-10-18', time: null, description: 'line one\nline two' },
      now
    );
    expect(ics).toContain('SUMMARY:Prayer\\, praise\\; thanks\r\n');
    expect(ics).toContain('DESCRIPTION:line one\\nline two\r\n');
  });

  it('folds long lines so no physical line exceeds 75 octets', () => {
    const ics = buildIcs(
      { id: 'e4', title: 'A'.repeat(200), date: '2026-10-18', time: null },
      now
    );
    for (const line of ics.split('\r\n')) {
      expect(unescape(encodeURIComponent(line)).length).toBeLessThanOrEqual(75);
    }
    expect(ics.replace(/\r\n /g, '')).toContain(`SUMMARY:${'A'.repeat(200)}`);
  });
});
