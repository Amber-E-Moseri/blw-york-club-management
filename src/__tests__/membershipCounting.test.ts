// Approved-member rules (src/lib/membership.ts) and the query layer that applies them. A pending or rejected account is
// registered but is not a member, so it must not appear in directory lists, cell rosters, unassigned counts, the
// devotional denominator or the dashboard member count.
import {
  APPROVED_STATUS,
  approvedCountByCell,
  approvedMembers,
  isApprovedMember,
  unassignedApprovedMembers,
} from '../lib/membership';
import { fetchMembersFiltered } from '../lib/queries/members';
import { fetchDevotionalMonthReport } from '../lib/queries/reports';
import { getDashboardStats } from '../lib/queries';

jest.mock('../lib/supabase', () => require('../testUtils/supabaseRecorder'));
jest.mock('../lib/email/emailService', () => ({
  sendEmail: jest.fn(),
  getAppOrigin: () => 'http://localhost',
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const fake = require('../testUtils/supabaseRecorder').__fake as {
  log: Array<{ target: string; op: string; args: unknown[] }>;
  queue: (key: string, resp: { data?: unknown; error: { message: string } | null; count?: number | null }) => void;
  reset: () => void;
};

beforeEach(() => {
  fake.reset();
});

const argsFor = (target: string, op: string) =>
  fake.log.filter((call) => call.target === target && call.op === op).map((call) => call.args);

describe('approved-member helpers', () => {
  it('uses the active profile status as the approval marker', () => {
    expect(APPROVED_STATUS).toBe('active');
  });

  it('treats only an active account as approved', () => {
    expect(isApprovedMember({ status: 'active' })).toBe(true);
    expect(isApprovedMember({ status: 'pending' })).toBe(false);
    expect(isApprovedMember({ status: 'rejected' })).toBe(false);
    expect(isApprovedMember({ status: 'inactive' })).toBe(false);
    expect(isApprovedMember({ status: 'ACTIVE' })).toBe(false);
    expect(isApprovedMember({ status: null })).toBe(false);
    expect(isApprovedMember({})).toBe(false);
    expect(isApprovedMember(null)).toBe(false);
    expect(isApprovedMember(undefined)).toBe(false);
  });

  it('filters a list down to approved accounts only', () => {
    const rows = [
      { id: 'a', status: 'active' },
      { id: 'b', status: 'pending' },
      { id: 'c', status: 'rejected' },
      { id: 'd', status: 'active' },
    ];
    expect(approvedMembers(rows).map((r) => r.id)).toEqual(['a', 'd']);
  });

  it('counts unassigned only among approved accounts', () => {
    const rows = [
      { id: 'a', status: 'active', cell_id: null },
      { id: 'b', status: 'pending', cell_id: null },
      { id: 'c', status: 'active', cell_id: 'cell-1' },
      { id: 'd', status: 'rejected', cell_id: undefined },
      { id: 'e', status: 'active', cell_id: '' },
    ];
    expect(unassignedApprovedMembers(rows).map((r) => r.id)).toEqual(['a', 'e']);
  });

  it('counts approved members per cell and omits cells with none', () => {
    const rows = [
      { status: 'active', cell_id: 'cell-1' },
      { status: 'active', cell_id: 'cell-1' },
      { status: 'pending', cell_id: 'cell-1' },
      { status: 'active', cell_id: 'cell-2' },
      { status: 'pending', cell_id: 'cell-3' },
      { status: 'active', cell_id: null },
    ];
    const counts = approvedCountByCell(rows);
    expect(counts.get('cell-1')).toBe(2);
    expect(counts.get('cell-2')).toBe(1);
    expect(counts.has('cell-3')).toBe(false);
    expect(counts.size).toBe(2);
  });
});

describe('member directory query', () => {
  it('restricts the directory to approved accounts', async () => {
    await fetchMembersFiltered();
    expect(fake.log.filter((c) => c.target === 'member_directory' && c.op === 'eq')).toContainEqual(
      expect.objectContaining({ args: ['status', 'active'] }),
    );
  });

  it('keeps the approval filter when search, role and cell filters are added', async () => {
    await fetchMembersFiltered({ search: 'ann', role: 'member', cellId: 'cell-1' });
    const eqArgs = argsFor('member_directory', 'eq');
    expect(eqArgs).toContainEqual(['status', 'active']);
    expect(eqArgs).toContainEqual(['role', 'member']);
    expect(eqArgs).toContainEqual(['cell_id', 'cell-1']);
  });

  it('returns the rows it was given', async () => {
    fake.queue('member_directory', {
      data: [{ id: 'm1', full_name: 'Ann', email: 'ann@example.com', status: 'active' }],
      error: null,
    });
    const rows = await fetchMembersFiltered();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('m1');
  });
});

describe('devotional month report denominator', () => {
  it('counts approved accounts as the denominator, not every registered profile', async () => {
    fake.queue('profiles', { data: null, error: null, count: 4 });
    fake.queue('devotional_views', {
      data: [
        { member_id: 'a', day_of_month: 1 },
        { member_id: 'b', day_of_month: 1 },
      ],
      error: null,
    });

    const days = await fetchDevotionalMonthReport('dev-1', 2);

    expect(argsFor('profiles', 'eq')).toContainEqual(['status', 'active']);
    expect(days[0]).toEqual({ day_of_month: 1, viewed_count: 2, member_count: 4, percentage: 50 });
    expect(days[1]).toEqual({ day_of_month: 2, viewed_count: 0, member_count: 4, percentage: 0 });
  });

  it('reports zero rather than dividing by zero when there are no approved members', async () => {
    fake.queue('profiles', { data: null, error: null, count: 0 });
    fake.queue('devotional_views', { data: [], error: null });

    const days = await fetchDevotionalMonthReport('dev-1', 1);

    expect(days[0].member_count).toBe(0);
    expect(days[0].percentage).toBe(0);
  });
});

describe('dashboard member counts', () => {
  it('filters every profile count to approved accounts', async () => {
    await getDashboardStats();

    const profileQueries = fake.log.filter((c) => c.target === 'profiles' && c.op === 'eq');
    expect(profileQueries.length).toBeGreaterThanOrEqual(2);
    for (const call of profileQueries) {
      expect(call.args).toEqual(['status', 'active']);
    }
  });
});
