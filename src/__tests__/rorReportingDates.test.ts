// ROR reporting dates (src/lib/rorDates.ts and the streak query layer). Every day and month sent to the streak RPC or
// shown to a leader is the Toronto calendar day. A UTC or browser-local day shifts a late-evening read to tomorrow.
import {
  ROR_SELF_REPORTED_NOTE,
  dateKeyOf,
  daysBetweenKeys,
  formatRorDay,
  rorMonthYear,
  rorToday,
} from '../lib/rorDates';
import { fetchRorStreak } from '../lib/queries/rorStreaks';
import { pinClock } from '../testUtils/localClock';

jest.mock('../lib/supabase', () => require('../testUtils/supabaseRecorder'));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const fake = require('../testUtils/supabaseRecorder').__fake as {
  log: Array<{ target: string; op: string; args: unknown[] }>;
  reset: () => void;
};

// 30 Nov 2026, 21:30 in Toronto (EST, UTC-5). In UTC this is already 1 Dec 2026.
const pinnedNow = () => new Date('2026-11-30T21:30:00-05:00');
pinClock(pinnedNow);

beforeEach(() => {
  fake.reset();
  jest.setSystemTime(pinnedNow());
});

describe('rorToday and rorMonthYear use the Toronto calendar', () => {
  it('gives the Toronto day for a late-evening instant (UTC has already moved on)', () => {
    expect(rorToday()).toBe('2026-11-30');
    expect(rorToday(new Date('2026-12-01T02:30:00Z'))).toBe('2026-11-30');
  });

  it('gives the Toronto reporting month, not the UTC month', () => {
    // 1 Dec 2026 02:30 UTC is still 30 Nov in Toronto.
    expect(rorMonthYear()).toBe('2026-11');
    // 1 Nov 2026 03:30 UTC is still 31 Oct in Toronto.
    expect(rorMonthYear(new Date('2026-11-01T03:30:00Z'))).toBe('2026-10');
  });

  it('uses the Toronto offset in daylight time as well', () => {
    // 15 Jul 2026 23:30 EDT (UTC-4) is 16 Jul 03:30 UTC.
    expect(rorToday(new Date('2026-07-16T03:30:00Z'))).toBe('2026-07-15');
  });
});

describe('dateKeyOf', () => {
  it('keeps a date-only value unchanged', () => {
    expect(dateKeyOf('2026-11-20')).toBe('2026-11-20');
  });

  it('converts a timestamp to its Toronto day', () => {
    // 02:00 UTC on 20 Nov is 21:00 on 19 Nov in Toronto.
    expect(dateKeyOf('2026-11-20T02:00:00Z')).toBe('2026-11-19');
  });

  it('returns null for empty or unreadable values', () => {
    expect(dateKeyOf(null)).toBeNull();
    expect(dateKeyOf(undefined)).toBeNull();
    expect(dateKeyOf('')).toBeNull();
    expect(dateKeyOf('not a date')).toBeNull();
  });
});

describe('daysBetweenKeys', () => {
  it('counts calendar days', () => {
    expect(daysBetweenKeys('2026-11-20', '2026-11-26')).toBe(6);
    expect(daysBetweenKeys('2026-11-26', '2026-11-20')).toBe(-6);
    expect(daysBetweenKeys('2026-11-26', '2026-11-26')).toBe(0);
  });

  it('counts across the Toronto DST change without losing or gaining a day', () => {
    // Clocks went back on 1 Nov 2026; the calendar gap is still one day.
    expect(daysBetweenKeys('2026-10-31', '2026-11-01')).toBe(1);
    expect(daysBetweenKeys('2026-03-14', '2026-03-15')).toBe(1);
  });

  it('crosses a year end and a leap day', () => {
    expect(daysBetweenKeys('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetweenKeys('2028-02-28', '2028-03-01')).toBe(2);
  });

  it('returns null for an invalid key', () => {
    expect(daysBetweenKeys('2026-11-20', 'nope')).toBeNull();
  });
});

describe('formatRorDay shows the stored calendar day, not the day before', () => {
  it('shows a date-only last-read value as that same day', () => {
    // A bare 2026-11-20 parsed as UTC midnight shows "Nov 19" in Toronto. The label must show Nov 20.
    expect(formatRorDay('2026-11-20')).toBe('Nov 20');
    expect(formatRorDay(dateKeyOf('2026-11-20'))).toBe('Nov 20');
  });

  it('shows a dash when there is no date', () => {
    expect(formatRorDay(null)).toBe('—');
    expect(formatRorDay('garbage')).toBe('—');
  });
});

describe('ROR is labelled as self-reported', () => {
  it('provides a non-verified note for display', () => {
    expect(ROR_SELF_REPORTED_NOTE).toMatch(/self-reported/i);
    expect(ROR_SELF_REPORTED_NOTE).toMatch(/not a verified attendance record/i);
  });
});

describe('fetchRorStreak sends Toronto reporting dates by default', () => {
  it('sends the Toronto day and Toronto month, not the UTC ones', async () => {
    await fetchRorStreak('member-1');

    const call = fake.log.find((c) => c.target === 'rpc:get_ror_streak');
    expect(call).toBeDefined();
    expect(call!.args[0]).toEqual({
      p_member_id: 'member-1',
      p_today: '2026-11-30',
      p_month_year: '2026-11',
    });
  });

  it('uses explicit dates when they are supplied', async () => {
    await fetchRorStreak('member-1', '2026-11-26', '2026-11');

    const call = fake.log.find((c) => c.target === 'rpc:get_ror_streak');
    expect(call!.args[0]).toEqual({
      p_member_id: 'member-1',
      p_today: '2026-11-26',
      p_month_year: '2026-11',
    });
  });
});
