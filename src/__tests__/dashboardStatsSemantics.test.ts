// Dashboard metric definitions, checked against the query calls they make. The Supabase client is replaced by the
// recorder, so each test sees which filters were applied and returns queued counts in the order the queries are issued.
import { getEnhancedDashboardStats, getUpcomingMeetings } from '../lib/queries/dashboardStats';
import { pinClock } from '../testUtils/localClock';

jest.mock('../lib/supabase', () => require('../testUtils/supabaseRecorder'));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const fake = require('../testUtils/supabaseRecorder').__fake as {
  log: Array<{ target: string; op: string; args: unknown[] }>;
  queue: (key: string, resp: { data?: unknown; error: { message: string } | null; count?: number | null }) => void;
  reset: () => void;
};

// Local 21:30 on 27 Oct 2026. In Toronto the UTC date is already the 28th, which the old code got wrong.
const pinnedNow = () => new Date(2026, 9, 27, 21, 30);
pinClock(pinnedNow);

beforeEach(() => {
  fake.reset();
  jest.setSystemTime(pinnedNow());
});

const argsFor = (target: string, op: string) =>
  fake.log.filter((call) => call.target === target && call.op === op).map((call) => call.args);

const ok = (count: number) => ({ data: null, error: null, count });
const failed = (message = 'relation does not exist') => ({ data: null, error: { message }, count: null });

describe('member metrics', () => {
  test('the Members count is limited to active profiles', async () => {
    fake.queue('profiles', ok(4));
    fake.queue('profiles', ok(1));
    fake.queue('profiles', ok(0));

    const stats = await getEnhancedDashboardStats('user-1', 'member');

    expect(stats.member_count).toBe(4);
    expect(stats.pending_member_count).toBe(1);
    const statusFilters = argsFor('profiles', 'eq').filter((args) => args[0] === 'status').map((args) => args[1]);
    expect(statusFilters).toEqual(['active', 'pending', 'active']);
  });

  test('inactive and rejected profiles are never counted', async () => {
    await getEnhancedDashboardStats('user-1', 'member');

    const statuses = argsFor('profiles', 'eq').filter((args) => args[0] === 'status').map((args) => args[1]);
    expect(statuses).not.toContain('inactive');
    expect(statuses).not.toContain('rejected');
  });

  test('new-member growth counts active joins between the local month start and the next month start', async () => {
    await getEnhancedDashboardStats('user-1', 'member');

    expect(argsFor('profiles', 'gte')).toContainEqual(['joined_at', new Date(2026, 9, 1).toISOString()]);
    expect(argsFor('profiles', 'lt')).toContainEqual(['joined_at', new Date(2026, 10, 1).toISOString()]);
  });
});

describe('meeting metrics', () => {
  test('"this month" counts the whole local month, including meetings that already happened', async () => {
    fake.queue('meetings', ok(2));
    fake.queue('meetings', ok(0));

    const stats = await getEnhancedDashboardStats('user-1', 'member');

    expect(stats.meetings_this_month).toBe(2);
    expect(argsFor('meetings', 'gte')).toContainEqual(['date', '2026-10-01']);
    expect(argsFor('meetings', 'lte')).toContainEqual(['date', '2026-10-31']);
  });

  test('upcoming count includes meetings dated today', async () => {
    fake.queue('meetings', ok(0));
    fake.queue('meetings', ok(1));

    const stats = await getEnhancedDashboardStats('user-1', 'member');

    expect(stats.upcoming_events).toBe(1);
    expect(argsFor('meetings', 'gte')).toContainEqual(['date', '2026-10-27']);
  });

  test('the month window moves to November on the first local day, even while UTC is still on October 31', async () => {
    jest.setSystemTime(new Date(2026, 10, 1, 0, 30));

    await getEnhancedDashboardStats('user-1', 'member');

    expect(argsFor('meetings', 'gte')).toContainEqual(['date', '2026-11-01']);
    expect(argsFor('meetings', 'lte')).toContainEqual(['date', '2026-11-30']);
  });

  test('the upcoming list keeps today\'s meeting when Toronto is still on the 27th', async () => {
    await getUpcomingMeetings('user-1');

    expect(argsFor('meetings', 'gte')).toContainEqual(['date', '2026-10-27']);
  });

  test('testimonies this month use the local month instants, not a UTC date string', async () => {
    await getEnhancedDashboardStats('user-1', 'member');

    expect(argsFor('testimonies', 'gte')).toContainEqual(['created_at', new Date(2026, 9, 1).toISOString()]);
    expect(argsFor('testimonies', 'lt')).toContainEqual(['created_at', new Date(2026, 10, 1).toISOString()]);
  });
});

describe('unavailable versus zero', () => {
  test('a failed optional query is reported as unavailable (null), not zero', async () => {
    fake.queue('announcements', failed());
    fake.queue('prayer_requests', failed());
    fake.queue('habit_entries', failed());
    fake.queue('devotional_views', failed());

    const stats = await getEnhancedDashboardStats('user-1', 'member');

    expect(stats.announcement_count).toBeNull();
    expect(stats.active_prayer_requests).toBeNull();
    expect(stats.habit_streak_avg).toBeNull();
    expect(stats.devotional_views_this_month).toBeNull();
  });

  test('genuinely empty datasets stay at zero', async () => {
    fake.queue('announcements', ok(0));
    fake.queue('prayer_requests', ok(0));
    fake.queue('habit_entries', { data: [], error: null });
    fake.queue('devotional_views', ok(0));

    const stats = await getEnhancedDashboardStats('user-1', 'member');

    expect(stats.announcement_count).toBe(0);
    expect(stats.active_prayer_requests).toBe(0);
    expect(stats.habit_streak_avg).toBe(0);
    expect(stats.devotional_views_this_month).toBe(0);
  });

  test('habit average is computed from completed entries when there are rows', async () => {
    fake.queue('habit_entries', {
      data: [
        { template_id: 'a', entry_date: '2026-10-21', status: 'done' },
        { template_id: 'a', entry_date: '2026-10-22', status: 'missed' },
        { template_id: 'a', entry_date: '2026-10-23', status: 'done' },
        { template_id: 'a', entry_date: '2026-10-24', status: 'done' },
      ],
      error: null,
    });

    const stats = await getEnhancedDashboardStats('user-1', 'member');

    expect(stats.habit_streak_avg).toBe(Math.round((3 / 4) * 7));
  });

  test('a failed required query fails the whole load instead of showing zeros', async () => {
    fake.queue('meetings', failed('meetings unavailable'));

    await expect(getEnhancedDashboardStats('user-1', 'member')).rejects.toThrow('meetings unavailable');
  });

  test('the unread count and cell attendance rate are unavailable, not hardcoded zeros', async () => {
    const member = await getEnhancedDashboardStats('user-1', 'member');
    const leader = await getEnhancedDashboardStats('user-1', 'cell_leader', 'cell-1');

    expect(member.unread_announcements).toBeNull();
    expect(leader.cell_meeting_attendance_rate).toBeNull();
    expect(member.cell_meeting_attendance_rate).toBeUndefined();
  });
});
