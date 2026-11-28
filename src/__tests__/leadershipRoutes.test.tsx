import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LeadershipProvider, useLeadership } from '../hooks/useLeadership';
import { ProtectedRoute } from '../components/layout/ProtectedRoute';
import type { AuthUser } from '../lib/auth';
import { supabase } from '../lib/supabase';

/**
 * The provider reads cells.leader_id and the route guard uses that capability. Only the Supabase lookup is replaced,
 * so these tests exercise the real provider, the real guard and the real router redirect.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Lookup = { data: unknown; error: { message: string } | null } | 'throw';

// Names start with "mock" so the hoisted jest.mock factory may reference them.
let mockNextLookup: Lookup = { data: [], error: null };
const mockLookupCalls: string[] = [];

jest.mock('../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: (_column: string, value: string) => {
          mockLookupCalls.push(value);
          const result = mockNextLookup;
          if (result === 'throw') return Promise.reject(new Error('network'));
          return Promise.resolve(result);
        },
      }),
    }),
  },
}));

const user = (overrides: Partial<AuthUser>): AuthUser =>
  ({ id: 'u-leader', name: 'Leader', role: 'member', status: 'active', ...overrides } as AuthUser);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  mockLookupCalls.length = 0;
  mockNextLookup = { data: [], error: null };
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

type Capability = ReturnType<typeof useLeadership>;

/** Renders the leader route with a probe for the capability, inside a real router, under the given user. */
async function renderLeaderRoute(current: AuthUser, path = '/hub/members') {
  let probe: Capability | null = null;
  const Probe: React.FC = () => {
    probe = useLeadership();
    return null;
  };
  await act(async () => {
    root.render(
      <LeadershipProvider user={current}>
        <MemoryRouter initialEntries={[path]}>
          <Probe />
          <Routes>
            <Route path="/hub" element={<p>HOME</p>} />
            <Route
              path="/hub/members"
              element={
                <ProtectedRoute user={current} requiresLeadership>
                  <p>MEMBERS</p>
                </ProtectedRoute>
              }
            />
          </Routes>
        </MemoryRouter>
      </LeadershipProvider>
    );
  });
  await flush();
  return {
    text: () => container.textContent ?? '',
    capability: (): Capability => probe as unknown as Capability,
  };
}

describe('leader routes', () => {
  it('lets an active assigned leader with the member role reach a leadership page', async () => {
    mockNextLookup = { data: [{ id: 'c1', name: 'Cell A', leader_id: 'u-leader' }], error: null };
    const view = await renderLeaderRoute(user({ role: 'member' }));
    expect(view.text()).toBe('MEMBERS');
    expect(view.capability().canUseLeaderPages).toBe(true);
  });

  it('sends a cell_leader role with no assignment away from a leader page', async () => {
    mockNextLookup = { data: [], error: null };
    const view = await renderLeaderRoute(user({ role: 'cell_leader' }));
    expect(view.text()).toBe('HOME');
    expect(view.capability().canUseLeaderPages).toBe(false);
  });

  it('removes access after the assignment is removed and the window regains focus, without a sign-out', async () => {
    mockNextLookup = { data: [{ id: 'c1', name: 'Cell A', leader_id: 'u-leader' }], error: null };
    const view = await renderLeaderRoute(user({ role: 'member' }));
    expect(view.text()).toBe('MEMBERS');

    mockNextLookup = { data: [], error: null };
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await flush();
    expect(view.capability().canUseLeaderPages).toBe(false);
    expect(view.text()).toBe('HOME');
  });

  it('fails closed on a lookup error and offers retry rather than granting access', async () => {
    mockNextLookup = { data: null, error: { message: 'denied' } };
    const view = await renderLeaderRoute(user({ role: 'member' }));
    expect(view.capability().canUseLeaderPages).toBe(false);
    expect(view.capability().error).toMatch(/Could not confirm/);
    expect(view.text()).toMatch(/Try again/);
    expect(view.text()).not.toBe('MEMBERS');
  });

  it('fails closed when the lookup throws', async () => {
    mockNextLookup = 'throw';
    const view = await renderLeaderRoute(user({ role: 'member' }));
    expect(view.capability().canUseLeaderPages).toBe(false);
    expect(view.text()).not.toBe('MEMBERS');
  });

  it("shows loading, not a denial, while an active leader's assignment is still being read", async () => {
    let resolveLookup: (value: unknown) => void = () => undefined;
    const pending = new Promise((resolve) => {
      resolveLookup = resolve;
    });
    const client = supabase as unknown as { from: () => unknown };
    const original = client.from;
    client.from = () => ({ select: () => ({ eq: () => pending }) });
    try {
      let probe: Capability | null = null;
      const Probe: React.FC = () => {
        probe = useLeadership();
        return null;
      };
      await act(async () => {
        root.render(
          <LeadershipProvider user={user({ role: 'member' })}>
            <Probe />
          </LeadershipProvider>
        );
      });
      expect((probe as unknown as Capability).loading).toBe(true);
      expect((probe as unknown as Capability).canUseLeaderPages).toBe(false);

      await act(async () => {
        resolveLookup({ data: [{ id: 'c1', name: 'Cell A', leader_id: 'u-leader' }], error: null });
      });
      await flush();
      expect((probe as unknown as Capability).loading).toBe(false);
      expect((probe as unknown as Capability).canUseLeaderPages).toBe(true);
    } finally {
      client.from = original;
    }
  });

  it('does not look up assignments for a pending account', async () => {
    mockNextLookup = { data: [{ id: 'c1', name: 'Cell A', leader_id: 'u-leader' }], error: null };
    const view = await renderLeaderRoute(user({ role: 'member', status: 'pending' }));
    expect(mockLookupCalls).toHaveLength(0);
    expect(view.capability().canUseLeaderPages).toBe(false);
  });
});
