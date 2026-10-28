// Calendar-date helpers. Every expectation is written with local-time Date constructors, so it holds in whatever
// zone the suite runs in. The one test that needs a literal UTC offset only runs when the zone is Toronto (UTC-4 in
// October, EDT). Run the suite under TZ=UTC and under TZ=America/Toronto to cover both.
import {
  formatMonthHeading,
  groupByMonth,
  localMonthInstants,
  localMonthRange,
  monthKeyOf,
  shiftLocalDays,
  toLocalDateKey,
} from '../lib/dates';
import { pinClock } from '../testUtils/localClock';

// Local 21:30 on 27 Oct 2026. In Toronto the UTC date is already the 28th, which is the case the old code got wrong.
pinClock(() => new Date(2026, 9, 27, 21, 30));

const inToronto = new Date(2026, 9, 1).getTimezoneOffset() === 240;

test('an evening local date is not moved to the next UTC day', () => {
  expect(toLocalDateKey()).toBe('2026-10-27');
});

test('an early morning on the 1st stays on the 1st', () => {
  expect(toLocalDateKey(new Date(2026, 9, 1, 0, 5))).toBe('2026-10-01');
});

test('shifting back six days crosses a month boundary on the local calendar', () => {
  expect(toLocalDateKey(shiftLocalDays(-6, new Date(2026, 9, 3, 12)))).toBe('2026-09-27');
});

test('October range covers the 1st through the 31st', () => {
  expect(localMonthRange(new Date(2026, 9, 15))).toEqual({ start: '2026-10-01', end: '2026-10-31' });
});

test('September range ends on the 30th even late at night on the 30th', () => {
  expect(localMonthRange(new Date(2026, 8, 30, 23, 30))).toEqual({ start: '2026-09-01', end: '2026-09-30' });
});

test('December rolls into January of the next year', () => {
  expect(localMonthRange(new Date(2026, 11, 31, 23, 59))).toEqual({ start: '2026-12-01', end: '2026-12-31' });
  expect(localMonthRange(new Date(2027, 0, 1, 0, 1))).toEqual({ start: '2027-01-01', end: '2027-01-31' });
});

test('February covers 29 days in a leap year', () => {
  expect(localMonthRange(new Date(2028, 1, 10))).toEqual({ start: '2028-02-01', end: '2028-02-29' });
});

test('month instants start at local midnight, not UTC midnight', () => {
  const { start, nextStart } = localMonthInstants(new Date(2026, 9, 15));
  expect(new Date(start)).toEqual(new Date(2026, 9, 1));
  expect(new Date(nextStart)).toEqual(new Date(2026, 10, 1));
});

test('month headings name the correct month for the month key', () => {
  expect(formatMonthHeading('2026-09')).toBe('September 2026');
  expect(formatMonthHeading('2026-10')).toBe('October 2026');
  expect(formatMonthHeading('2027-01')).toBe('January 2027');
});

test('October 1 meetings are grouped under October, not September', () => {
  expect(monthKeyOf('2026-10-01')).toBe('2026-10');
  const grouped = groupByMonth([
    { id: 'sep-30', date: '2026-09-30' },
    { id: 'oct-1', date: '2026-10-01' },
    { id: 'oct-31', date: '2026-10-31' },
    { id: 'nov-1', date: '2026-11-01' },
  ]);
  expect(Object.keys(grouped)).toEqual(['2026-09', '2026-10', '2026-11']);
  expect(grouped['2026-10'].map((m) => m.id)).toEqual(['oct-1', 'oct-31']);
  expect(formatMonthHeading('2026-10')).toBe('October 2026');
});

(inToronto ? test : test.skip)('Toronto October starts at 04:00Z (EDT) and November at 04:00Z (still EDT on Nov 1)', () => {
  expect(localMonthInstants(new Date(2026, 9, 15))).toEqual({
    start: '2026-10-01T04:00:00.000Z',
    nextStart: '2026-11-01T04:00:00.000Z',
  });
});
