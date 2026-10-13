import { deriveBscCapabilities } from '../lib/bscAccess';

const active = (role: 'coordinator' | 'admin' | 'cell_leader' | 'member') => ({ role, status: 'active' as const });
const none = { ledCellIds: [], ledBscIds: [] };

describe('deriveBscCapabilities', () => {
  it('gives an active coordinator full BSC management and My Bible Study Class', () => {
    const caps = deriveBscCapabilities(active('coordinator'), none);
    expect(caps).toMatchObject({
      isStaff: true,
      canManageRoster: true,
      canCreateBsc: true,
      canOpenManagement: true,
      canViewMyBsc: true,
    });
  });

  it('lets an active admin manage rosters', () => {
    const caps = deriveBscCapabilities(active('admin'), none);
    expect(caps.canManageRoster).toBe(true);
  });

  it('lets an active member who leads a BSC open My Bible Study Class, but not manage anything', () => {
    const caps = deriveBscCapabilities(active('member'), { ledCellIds: [], ledBscIds: ['b1'] });
    expect(caps).toMatchObject({
      isStaff: false,
      canManageRoster: false,
      canCreateBsc: false,
      canOpenManagement: false,
      canViewMyBsc: true,
    });
  });

  it('lets a cell leader create BSCs in a led cell, but not move members', () => {
    const caps = deriveBscCapabilities(active('member'), { ledCellIds: ['c1'], ledBscIds: [] });
    expect(caps).toMatchObject({ canCreateBsc: true, canOpenManagement: true, canManageRoster: false, canViewMyBsc: true });
  });

  it('gives a role-only cell leader (no led cell) nothing', () => {
    const caps = deriveBscCapabilities(active('cell_leader'), none);
    expect(caps).toMatchObject({ canCreateBsc: false, canOpenManagement: false, canViewMyBsc: false });
  });

  it('gives a pending or rejected account nothing, even with a leadership assignment', () => {
    for (const status of ['pending', 'rejected', 'inactive'] as const) {
      const caps = deriveBscCapabilities({ role: 'coordinator', status }, { ledCellIds: ['c1'], ledBscIds: ['b1'] });
      expect(caps).toMatchObject({ isStaff: false, canManageRoster: false, canCreateBsc: false, canViewMyBsc: false });
    }
  });

  it('treats a missing user as having no access', () => {
    expect(deriveBscCapabilities(null, { ledCellIds: ['c1'], ledBscIds: ['b1'] })).toMatchObject({
      isStaff: false,
      canManageRoster: false,
      canViewMyBsc: false,
    });
  });
});
