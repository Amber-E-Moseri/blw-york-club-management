import { deriveLeadership, type LedCell } from '../lib/leadership';
import type { AuthUser } from '../lib/auth';

/**
 * Leadership is derived from cells.leader_id (the authority), never from the profile role. These cases cover the
 * lifecycle the directive lists: assigned, role-only, other cell, not active, removed, reassigned, staff.
 */

const user = (overrides: Partial<AuthUser> = {}): AuthUser =>
  ({ id: 'u-leader', name: 'Leader', role: 'member', status: 'active', ...overrides } as AuthUser);

const cell = (id: string, leaderId: string | null): LedCell => ({ id, name: `Cell ${id}`, leader_id: leaderId });

describe('deriveLeadership', () => {
  it('grants leader pages to an active assigned leader with the ordinary member role', () => {
    const result = deriveLeadership(user({ role: 'member' }), [cell('c1', 'u-leader')]);
    expect(result.canUseLeaderPages).toBe(true);
    expect(result.isCellLeader).toBe(true);
    expect(result.ledCells.map((c) => c.id)).toEqual(['c1']);
    expect(result.isStaff).toBe(false);
  });

  it('grants nothing to a cell_leader profile role with no assignment', () => {
    const result = deriveLeadership(user({ role: 'cell_leader' }), []);
    expect(result.canUseLeaderPages).toBe(false);
    expect(result.isCellLeader).toBe(false);
    expect(result.ledCells).toEqual([]);
  });

  it('grants nothing to a cell_leader role whose only cell is led by someone else', () => {
    const result = deriveLeadership(user({ role: 'cell_leader' }), [cell('c2', 'u-other')]);
    expect(result.canUseLeaderPages).toBe(false);
  });

  it('ignores a returned row whose leader is not the user, even if a query returned it', () => {
    const result = deriveLeadership(user(), [cell('c2', 'u-other')]);
    expect(result.canUseLeaderPages).toBe(false);
    expect(result.ledCells).toEqual([]);
  });

  it.each(['pending', 'inactive', 'rejected'] as const)('grants nothing to an assigned leader whose account is %s', (status) => {
    const result = deriveLeadership(user({ status }), [cell('c1', 'u-leader')]);
    expect(result.canUseLeaderPages).toBe(false);
    expect(result.isCellLeader).toBe(false);
  });

  it('drops leadership when the assignment is removed (no cells returned)', () => {
    const before = deriveLeadership(user(), [cell('c1', 'u-leader')]);
    const after = deriveLeadership(user(), []);
    expect(before.canUseLeaderPages).toBe(true);
    expect(after.canUseLeaderPages).toBe(false);
  });

  it('drops leadership of a cell that was reassigned to someone else', () => {
    const after = deriveLeadership(user(), [cell('c1', 'u-new-leader')]);
    expect(after.canUseLeaderPages).toBe(false);
  });

  it('keeps staff access without any cell assignment (admin and coordinator)', () => {
    expect(deriveLeadership(user({ role: 'admin' }), []).canUseLeaderPages).toBe(true);
    expect(deriveLeadership(user({ role: 'coordinator' }), []).canUseLeaderPages).toBe(true);
    expect(deriveLeadership(user({ role: 'admin' }), []).isCellLeader).toBe(false);
  });

  it('does not grant staff access to a pending or inactive admin', () => {
    expect(deriveLeadership(user({ role: 'admin', status: 'pending' }), []).canUseLeaderPages).toBe(false);
  });

  it('grants nothing when there is no user', () => {
    expect(deriveLeadership(null, [cell('c1', 'u-leader')])).toEqual({
      isStaff: false,
      ledCells: [],
      isCellLeader: false,
      canUseLeaderPages: false,
    });
  });
});
