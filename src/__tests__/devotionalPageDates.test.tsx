// Devotional view dates. A view counts for the calendar day of the page that was read, on the Toronto reporting
// calendar. The day is never the UTC day, and reading an earlier page never records today.
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useDevotionalByDay } from '../hooks/useDevotional';
import { devotionalDateKey, getViewForDay, logView } from '../lib/queries/devotionals';
import { pinClock } from '../testUtils/localClock';

jest.mock('../lib/supabase', () => require('../testUtils/supabaseRecorder'));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const fake = require('../testUtils/supabaseRecorder').__fake as {
  log: Array<{ target: string; op: string; args: unknown[] }>;
  queue: (key: string, resp: { data?: unknown; error: { message: string } | null; count?: number | null }) => void;
  reset: () => void;
};

// 30 Nov 2026, 21:30 in Toronto. In UTC this is already 1 Dec 2026.
const pinnedNow = () => new Date('2026-11-30T21:30:00-05:00');
pinClock(pinnedNow);

beforeEach(() => {
  fake.reset();
  jest.setSystemTime(pinnedNow());
});

const argsFor = (target: string, op: string) =>
  fake.log.filter((call) => call.target === target && call.op === op).map((call) => call.args);

describe('devotionalDateKey', () => {
  it('builds a zero-padded calendar key', () => {
    expect(devotionalDateKey(2026, 11, 26)).toBe('2026-11-26');
    expect(devotionalDateKey(2026, 1, 5)).toBe('2026-01-05');
  });

  it('accepts 29 February only in a leap year', () => {
    expect(devotionalDateKey(2028, 2, 29)).toBe('2028-02-29');
    expect(devotionalDateKey(2026, 2, 29)).toBeNull();
  });

  it('rejects days that do not exist in the month', () => {
    expect(devotionalDateKey(2026, 4, 31)).toBeNull();
    expect(devotionalDateKey(2026, 11, 31)).toBeNull();
  });

  it('rejects out-of-range and non-integer parts', () => {
    expect(devotionalDateKey(2026, 13, 1)).toBeNull();
    expect(devotionalDateKey(2026, 0, 1)).toBeNull();
    expect(devotionalDateKey(2026, 11, 0)).toBeNull();
    expect(devotionalDateKey(2026, 11, 2.5)).toBeNull();
    expect(devotionalDateKey(Number.NaN, 11, 1)).toBeNull();
  });
});

describe('query-layer defaults use the Toronto day', () => {
  it('logView records the Toronto day when no date is given', async () => {
    await logView('member-1', 'dev-1', 26);

    const [row] = argsFor('devotional_views', 'upsert') as Array<[Record<string, unknown>]>;
    expect(row[0].viewed_date).toBe('2026-11-30');
  });

  it('logView records the page date when one is given', async () => {
    await logView('member-1', 'dev-1', 26, '2026-11-26');

    const [row] = argsFor('devotional_views', 'upsert') as Array<[Record<string, unknown>]>;
    expect(row[0].viewed_date).toBe('2026-11-26');
  });

  it('getViewForDay looks up the Toronto day when no date is given', async () => {
    await getViewForDay('member-1', 'dev-1', 26);

    expect(argsFor('devotional_views', 'eq')).toContainEqual(['viewed_date', '2026-11-30']);
  });
});

describe('useDevotionalByDay records and reads views against the page date', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  // Lets the hook's promise chain settle without using timers, which are faked in this file.
  const settle = async () => {
    for (let i = 0; i < 60; i++) await Promise.resolve();
  };

  it('marks a past page read for that page date, not for today', async () => {
    // Monthly devotional for November 2026 and its day-26 page.
    fake.queue('monthly_devotionals', {
      data: { id: 'dev-1', month: 11, year: 2026, total_days: 30, title: 'Test', book_title: 'Book' },
      error: null,
    });
    fake.queue('devotional_daily_pages', {
      data: { id: 'page-26', devotional_id: 'dev-1', day_of_month: 26, page_range: '1-2', image_url: '' },
      error: null,
    });
    // Load: getViewForDay (no view yet), then the engagement count and latest view.
    fake.queue('devotional_views', { data: null, error: null });
    fake.queue('devotional_views', { data: null, error: null, count: 0 });
    fake.queue('devotional_views', { data: null, error: null });
    // markAsRead: the recorded view.
    fake.queue('devotional_views', { data: { id: 'view-1', viewed_date: '2026-11-26' }, error: null });

    let latest: ReturnType<typeof useDevotionalByDay> | null = null;
    function Probe() {
      latest = useDevotionalByDay(11, 26, 2026, false);
      return null;
    }

    await act(async () => {
      root.render(<Probe />);
      await settle();
    });

    // The load looked up the view for the page's date.
    expect(argsFor('devotional_views', 'eq')).toContainEqual(['viewed_date', '2026-11-26']);

    await act(async () => {
      await latest!.markAsRead();
      await settle();
    });

    const [row] = argsFor('devotional_views', 'upsert') as Array<[Record<string, unknown>]>;
    expect(row[0].viewed_date).toBe('2026-11-26');
    expect(row[0].day_of_month).toBe(26);
    // Today is 30 Nov in Toronto, so a recorded "today" would be 2026-11-30. It must not be.
    expect(row[0].viewed_date).not.toBe('2026-11-30');
  });
});
