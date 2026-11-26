// Reporting-calendar regression tests for src/lib/dates.ts. These are independent of the machine's time zone:
// every expected value is fixed to the America/Toronto calendar.
import {
  formatMonthHeading,
  groupByMonth,
  isDateKey,
  localMonthInstants,
  localMonthRange,
  shiftDateKey,
  toLocalDateKey,
  torontoMidnight,
} from '../lib/dates';

describe('Toronto calendar keys', () => {
  it('names the Toronto day for an evening instant that is already the next day in UTC', () => {
    // 21:30 EDT on 25 Oct 2026 is 01:30 UTC on 26 Oct. The reporting day is still the 25th.
    expect(toLocalDateKey(new Date('2026-10-26T01:30:00Z'))).toBe('2026-10-25');
  });

  it('names the Toronto day for an early instant that is still the previous day in UTC', () => {
    // 00:30 EST on 1 Jan 2027 is 05:30 UTC on 1 Jan. Use a UTC-early instant on 1 Jan to check the other direction.
    expect(toLocalDateKey(new Date('2027-01-01T03:00:00Z'))).toBe('2026-12-31');
  });

  it('shifts calendar keys across a month boundary without time-of-day arithmetic', () => {
    expect(shiftDateKey('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDateKey('2028-03-01', -1)).toBe('2028-02-29');
    expect(shiftDateKey('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('Toronto midnight across DST', () => {
  it('is EDT (04:00 UTC) on 1 Nov 2026, the day DST ends, because the change happens at 02:00', () => {
    expect(torontoMidnight('2026-11-01').toISOString()).toBe('2026-11-01T04:00:00.000Z');
  });

  it('is EST (05:00 UTC) on 2 Nov 2026, after DST has ended', () => {
    expect(torontoMidnight('2026-11-02').toISOString()).toBe('2026-11-02T05:00:00.000Z');
  });

  it('is EST (05:00 UTC) on 14 Mar 2027, the day DST begins, because the change happens at 02:00', () => {
    expect(torontoMidnight('2027-03-14').toISOString()).toBe('2027-03-14T05:00:00.000Z');
  });

  it('is EDT (04:00 UTC) on 15 Mar 2027, after DST has begun', () => {
    expect(torontoMidnight('2027-03-15').toISOString()).toBe('2027-03-15T04:00:00.000Z');
  });
});

describe('month boundaries', () => {
  it('covers the March 2027 DST month in full', () => {
    expect(localMonthRange(new Date('2027-03-14T12:00:00-04:00'))).toEqual({ start: '2027-03-01', end: '2027-03-31' });
  });

  it('rolls from December into January in both the range and the instants', () => {
    const at = new Date('2026-12-31T23:30:00-05:00');
    expect(localMonthRange(at)).toEqual({ start: '2026-12-01', end: '2026-12-31' });
    expect(localMonthInstants(at)).toEqual({
      start: '2026-12-01T05:00:00.000Z',
      nextStart: '2027-01-01T05:00:00.000Z',
    });
  });

  it('gives February 29 in a leap year and 28 in a common year', () => {
    expect(localMonthRange(new Date('2028-02-10T12:00:00-05:00')).end).toBe('2028-02-29');
    expect(localMonthRange(new Date('2027-02-10T12:00:00-05:00')).end).toBe('2027-02-28');
  });
});

describe('headings and grouping', () => {
  it('names October 2026 correctly, regardless of the viewer\'s zone', () => {
    expect(formatMonthHeading('2026-10')).toBe('October 2026');
    expect(formatMonthHeading('2026-12')).toBe('December 2026');
  });

  it('refuses a malformed or out-of-range month key with a safe label, not a crash', () => {
    expect(formatMonthHeading('bad')).toBe('No date');
    expect(formatMonthHeading('2026-13')).toBe('No date');
    expect(formatMonthHeading('unknown')).toBe('No date');
  });

  it('groups 8 and 16 October under October, and sends malformed or missing dates to an unknown group', () => {
    const grouped = groupByMonth([
      { date: '2026-10-08' },
      { date: '2026-10-16' },
      { date: '2026-02-30' }, // not a real day
      { date: 'bad' },
      { date: null },
    ]);
    expect(Object.keys(grouped).sort()).toEqual(['2026-10', 'unknown']);
    expect(grouped['2026-10']).toHaveLength(2);
    expect(grouped.unknown).toHaveLength(3);
  });

  it('returns an empty object for an empty dataset', () => {
    expect(groupByMonth([])).toEqual({});
  });
});

describe('date-key validation', () => {
  it.each([
    ['2026-10-08', true],
    ['2028-02-29', true],
    ['2027-02-29', false],
    ['2026-02-30', false],
    ['2026-10-8', false],
    ['not a date', false],
    [null, false],
    [undefined, false],
  ])('isDateKey(%p) is %p', (value, expected) => {
    expect(isDateKey(value)).toBe(expected);
  });
});
