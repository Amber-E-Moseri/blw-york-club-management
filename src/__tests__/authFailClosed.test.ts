import { supabase } from '../lib/supabase';
import {
  buildProfile,
  canUseApp,
  effectiveRole,
  getUserPermissions,
  getUserRole,
  hasPermission,
} from '../lib/auth';

// Regression tests for fail-closed approval and role handling. These cover the client helpers that decide what a
// signed-in account may see. The database remains the authority (RLS and RPCs, migrations 016, 022, 023 and 028).

jest.mock('../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

const row = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'user-1',
  email: 'person@example.test',
  full_name: 'Test Person',
  role: 'member',
  status: 'active',
  joined_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('buildProfile: approval status is taken as stored, never widened', () => {
  it.each(['pending', 'active', 'inactive', 'rejected'] as const)('keeps a recognised status: %s', (status) => {
    expect(buildProfile(row({ status })).status).toBe(status);
  });

  it('treats a missing status as pending, not active', () => {
    const { status, ...withoutStatus } = row();
    expect(status).toBe('active');
    expect(buildProfile(withoutStatus).status).toBe('pending');
  });

  it('treats a null status as pending', () => {
    expect(buildProfile(row({ status: null })).status).toBe('pending');
  });

  it('treats an unrecognised status as pending', () => {
    expect(buildProfile(row({ status: 'banned' })).status).toBe('pending');
    expect(buildProfile(row({ status: 'ACTIVE' })).status).toBe('pending');
    expect(buildProfile(row({ status: 1 })).status).toBe('pending');
  });
});

describe('buildProfile: missing profile record', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a row with no id', { email: 'x@example.test', status: 'active' }],
    ['a row with an empty id', { id: '', status: 'active' }],
  ])('refuses to build a user from %s', (_label, value) => {
    expect(() => buildProfile(value as Record<string, unknown> | null | undefined)).toThrow('Profile not found.');
  });
});

describe('buildProfile: unknown roles', () => {
  it.each(['superuser', 'Admin', 'constructor', 'toString', '__proto__', ''])(
    'maps the unknown role %j to member',
    (role) => {
      expect(buildProfile(row({ role })).role).toBe('member');
    },
  );

  it('maps a missing role to member', () => {
    const { role, ...withoutRole } = row();
    expect(role).toBe('member');
    expect(buildProfile(withoutRole).role).toBe('member');
  });

  it('keeps every recognised role unchanged', () => {
    for (const role of ['coordinator', 'admin', 'cell_leader', 'member']) {
      expect(buildProfile(row({ role })).role).toBe(role);
    }
  });
});

describe('canUseApp: only an active account enters the Hub', () => {
  it('admits an active account', () => {
    expect(canUseApp({ status: 'active' })).toBe(true);
  });

  it.each([
    ['pending', { status: 'pending' }],
    ['rejected', { status: 'rejected' }],
    ['inactive', { status: 'inactive' }],
    ['a missing status', {}],
    ['an unrecognised status', { status: 'banned' }],
    ['a null status', { status: null }],
  ])('holds %s outside the Hub', (_label, user) => {
    expect(canUseApp(user as never)).toBe(false);
  });

  it('holds a signed-out or missing user', () => {
    expect(canUseApp(null)).toBe(false);
    expect(canUseApp(undefined)).toBe(false);
  });

  it('holds an unapproved admin and coordinator', () => {
    expect(canUseApp({ status: 'pending' })).toBe(false);
    expect(canUseApp({ status: 'rejected' })).toBe(false);
    expect(canUseApp({ status: 'inactive' })).toBe(false);
  });
});

describe('effectiveRole: only an active account acts on its role', () => {
  it('keeps admin and coordinator for an active account', () => {
    expect(effectiveRole({ role: 'admin', status: 'active', ledCellIds: [] })).toBe('admin');
    expect(effectiveRole({ role: 'coordinator', status: 'active', ledCellIds: [] })).toBe('coordinator');
  });

  it.each(['pending', 'rejected', 'inactive'] as const)('demotes an %s admin to member', (status) => {
    expect(effectiveRole({ role: 'admin', status, ledCellIds: [] })).toBe('member');
    expect(effectiveRole({ role: 'coordinator', status, ledCellIds: [] })).toBe('member');
  });

  it('demotes an admin with a missing status to member', () => {
    expect(effectiveRole({ role: 'admin', ledCellIds: [] } as never)).toBe('member');
  });

  it('gives an active account with no cell no elevated role', () => {
    expect(effectiveRole({ role: 'cell_leader', status: 'active', ledCellIds: [] })).toBe('member');
  });
});

describe('permissions: unknown roles and prototype names get nothing', () => {
  it.each(['superuser', 'constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'grants no permissions to %s',
    (role) => {
      expect(getUserPermissions(role as never)).toEqual([]);
      expect(hasPermission(role as never, 'manage_members')).toBe(false);
      expect(hasPermission(role as never, '*')).toBe(false);
    },
  );

  it('keeps the coordinator wildcard and the member grants unchanged', () => {
    expect(hasPermission('coordinator', 'anything_at_all')).toBe(true);
    expect(hasPermission('member', 'view_events')).toBe(true);
    expect(hasPermission('member', 'manage_members')).toBe(false);
  });
});

describe('getUserRole: the role lookup fails closed', () => {
  type Single = jest.Mock<Promise<{ data: unknown; error: unknown }>, []>;

  function mockProfileRole(single: Single) {
    const eq = jest.fn(() => ({ single }));
    const select = jest.fn(() => ({ eq }));
    (supabase.from as unknown as jest.Mock).mockReturnValue({ select });
  }

  afterEach(() => jest.clearAllMocks());

  it('returns a recognised role', async () => {
    mockProfileRole(jest.fn().mockResolvedValue({ data: { role: 'admin' }, error: null }));
    await expect(getUserRole('user-1')).resolves.toBe('admin');
  });

  it('returns member for an unrecognised role label', async () => {
    mockProfileRole(jest.fn().mockResolvedValue({ data: { role: 'superuser' }, error: null }));
    await expect(getUserRole('user-1')).resolves.toBe('member');
  });

  it('throws when the profile record is missing', async () => {
    mockProfileRole(jest.fn().mockResolvedValue({ data: null, error: { message: 'No rows' } }));
    await expect(getUserRole('user-1')).rejects.toThrow('Could not fetch role.');
  });
});

describe('App approval gate is an allowlist', () => {
  // A denylist (status === 'pending' || 'rejected' || 'inactive') lets any other status string into the Hub.
  const app = require('fs').readFileSync(require('path').resolve(__dirname, '..', 'App.tsx'), 'utf8').replace(/\r/g, '');

  it('holds every user that is not active', () => {
    expect(app).toContain('if (!canUseApp(user)) {');
    expect(app).not.toMatch(/user\.status === 'pending' \|\| user\.status === 'rejected'/);
  });
});
