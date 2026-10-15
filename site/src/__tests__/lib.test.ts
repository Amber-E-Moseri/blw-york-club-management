import { describe, expect, it } from 'vitest';
import { safeHttpsUrl } from '../lib/links';
import { formatTime, googleCalendarUrl, icsForEvent, partitionEvents, todayInSiteZone } from '../lib/dates';
import { validateField, validateForm, type FieldSpec } from '../lib/forms';
import { sampleContent } from '../content/sample-data';

describe('safeHttpsUrl', () => {
  it('accepts an https destination', () => {
    expect(safeHttpsUrl('https://example.org/rock-solid-ops/enroll')).toBe('https://example.org/rock-solid-ops/enroll');
  });

  it.each([
    ['empty string', ''],
    ['undefined', undefined],
    ['http scheme', 'http://example.org/enrol'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['embedded credentials', 'https://user:pass@example.org/enrol'],
    ['not a URL', 'rock solid'],
  ])('rejects %s', (_label, value) => {
    expect(safeHttpsUrl(value as string | undefined)).toBeNull();
  });
});

describe('dates', () => {
  it('formats 24-hour times as 12-hour labels', () => {
    expect(formatTime('18:30')).toBe('6:30 PM');
    expect(formatTime('00:05')).toBe('12:05 AM');
    expect(formatTime('12:00')).toBe('12:00 PM');
  });

  it('partitions events around today: upcoming ascending, past descending', () => {
    const events = sampleContent.events;
    const { upcoming, past } = partitionEvents(events, '2026-10-15');
    expect(upcoming.map((e) => e.date)).toEqual([...upcoming.map((e) => e.date)].sort());
    expect(past.map((e) => e.date)).toEqual([...past.map((e) => e.date)].sort().reverse());
    expect(upcoming.length + past.length).toBe(events.length);
    expect(upcoming.every((e) => e.date >= '2026-10-15')).toBe(true);
    expect(past.every((e) => e.date < '2026-10-15')).toBe(true);
  });

  it('computes today in the site time zone', () => {
    // 02:30 UTC on 16 Oct is still 15 Oct in Toronto (EDT, UTC-4).
    expect(todayInSiteZone(new Date('2026-10-16T02:30:00Z'))).toBe('2026-10-15');
  });

  it('builds calendar links and escapes ICS text', () => {
    const event = { ...sampleContent.events[0], summary: 'Pray; share, learn\nnow' };
    const ics = icsForEvent(event, 'York, Toronto', '20260101T000000Z');
    expect(ics).toContain('DTSTART;TZID=America/Toronto:20261112T183000');
    expect(ics).toContain('DESCRIPTION:Pray\\; share\\, learn\\nnow');
    expect(googleCalendarUrl(event, 'York')).toContain('ctz=America%2FToronto');
  });
});

describe('form validation', () => {
  const name: FieldSpec = { id: 'name', label: 'Name', kind: 'text', required: true };
  const email: FieldSpec = { id: 'email', label: 'Email', kind: 'email', required: true };
  const phone: FieldSpec = { id: 'phone', label: 'Phone', kind: 'tel', required: false };
  const status: FieldSpec = { id: 'status', label: 'Status', kind: 'select', required: true, options: ['A', 'B'] };

  it('requires non-empty values', () => {
    expect(validateField(name, '   ')).toBe('Please complete this field.');
    expect(validateField(name, ' Ada ')).toBeNull();
  });

  it('validates email and phone shapes', () => {
    expect(validateField(email, 'ada@example')).toBe('Enter a valid email address.');
    expect(validateField(email, 'ada@example.org')).toBeNull();
    expect(validateField(phone, '')).toBeNull();
    expect(validateField(phone, 'abc')).toBe('Enter a valid phone number.');
  });

  it('rejects select values outside the offered options', () => {
    expect(validateField(status, 'Z')).toBe('Choose one of the options.');
  });

  it('requires consent in addition to field rules', () => {
    const result = validateForm([name, status], { name: 'Ada', status: 'A' }, false);
    expect(result.errors).toEqual({});
    expect(result.consentError).toMatch(/consent/i);
  });
});
