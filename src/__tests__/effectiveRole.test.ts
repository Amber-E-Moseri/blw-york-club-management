import { effectiveRole } from '../lib/auth';

// Cell leadership is the assignment cells.leader_id, not the role label (migrations 049 and 054).
describe('effectiveRole', () => {
  it('treats an assigned active member as a cell leader, whatever their role label', () => {
    expect(effectiveRole({ role: 'member', status: 'active', ledCellIds: ['c1'] })).toBe('cell_leader');
  });

  it('grants nothing to a cell_leader label with no assignment', () => {
    expect(effectiveRole({ role: 'cell_leader', status: 'active', ledCellIds: [] })).toBe('member');
    expect(effectiveRole({ role: 'cell_leader', status: 'active' })).toBe('member');
  });

  it('removes leadership from an assigned account that is no longer active', () => {
    expect(effectiveRole({ role: 'member', status: 'inactive', ledCellIds: ['c1'] })).toBe('member');
    expect(effectiveRole({ role: 'cell_leader', status: 'rejected', ledCellIds: ['c1'] })).toBe('member');
  });

  it('keeps admin and coordinator roles unchanged', () => {
    expect(effectiveRole({ role: 'admin', status: 'active', ledCellIds: [] })).toBe('admin');
    expect(effectiveRole({ role: 'coordinator', status: 'active', ledCellIds: [] })).toBe('coordinator');
  });

  it('falls back to member when there is no user', () => {
    expect(effectiveRole(null)).toBe('member');
    expect(effectiveRole(undefined)).toBe('member');
  });
});
