import {
  canManageCells,
  validateCellName,
  validateLeaderCandidate,
  validateMemberPlacement,
} from '../lib/cells/cellAdmin';
import type { Cell, Member } from '../types';

const cells: Cell[] = [
  { id: 'c1', name: 'North' },
  { id: 'c2', name: 'South' },
];

const member = (over: Partial<Member> = {}): Member => ({
  id: 'm1',
  full_name: 'Amahle Khumalo',
  email: 'amahle@example.org',
  role: 'member',
  joined_at: '2026-01-01',
  status: 'active',
  ...over,
});

describe('canManageCells', () => {
  it('allows active coordinators and admins only', () => {
    expect(canManageCells({ role: 'coordinator', status: 'active' })).toBe(true);
    expect(canManageCells({ role: 'admin', status: 'active' })).toBe(true);
    expect(canManageCells({ role: 'cell_leader', status: 'active' })).toBe(false);
    expect(canManageCells({ role: 'member', status: 'active' })).toBe(false);
  });

  it('denies inactive or pending staff and a missing session', () => {
    expect(canManageCells({ role: 'coordinator', status: 'inactive' })).toBe(false);
    expect(canManageCells({ role: 'admin', status: 'pending' })).toBe(false);
    expect(canManageCells(null)).toBe(false);
    expect(canManageCells(undefined)).toBe(false);
  });
});

describe('validateCellName', () => {
  it('trims and collapses whitespace in valid names', () => {
    expect(validateCellName('  North   Campus ', cells)).toEqual({ ok: true, value: 'North Campus' });
  });

  it('rejects empty and over-long names', () => {
    expect(validateCellName('   ', cells)).toEqual({ ok: false, error: 'Enter a cell name.' });
    const long = 'x'.repeat(81);
    expect(validateCellName(long, cells).ok).toBe(false);
  });

  it('rejects a name already used by another cell, ignoring case', () => {
    // One assertion, no branch: a result that is accepted (ok: true) fails here instead of passing silently.
    expect(validateCellName('  north ', cells)).toMatchObject({ ok: false, error: expect.stringContaining('already exists') });
  });

  it('lets a cell keep its own name when renaming', () => {
    expect(validateCellName('North', cells, 'c1').ok).toBe(true);
    expect(validateCellName('South', cells, 'c1').ok).toBe(false);
  });
});

describe('validateLeaderCandidate', () => {
  it('accepts only active members', () => {
    expect(validateLeaderCandidate(member())).toBeNull();
    expect(validateLeaderCandidate(member({ status: 'pending' }))).toContain('active member');
    expect(validateLeaderCandidate(member({ status: 'rejected' }))).toContain('active member');
    expect(validateLeaderCandidate(member({ status: undefined }))).toContain('active member');
  });
});

describe('validateMemberPlacement', () => {
  it('allows placing an active member in a different cell', () => {
    expect(validateMemberPlacement(member({ cell_id: 'c1' }), 'c2', cells)).toBeNull();
    expect(validateMemberPlacement(member(), 'c1', cells)).toBeNull();
  });

  it('blocks pending, rejected and inactive members so they gain no cell scope', () => {
    for (const status of ['pending', 'rejected', 'inactive'] as const) {
      const problem = validateMemberPlacement(member({ status }), 'c1', cells);
      expect(problem).toContain('Only active members');
    }
  });

  it('blocks placing a member into the cell they already belong to', () => {
    expect(validateMemberPlacement(member({ cell_id: 'c1' }), 'c1', cells)).toContain('already in this cell');
  });

  it('blocks an unknown destination cell', () => {
    expect(validateMemberPlacement(member(), 'missing', cells)).toBe('Choose a cell that exists.');
  });

  it('allows removal only for a member who is in a cell', () => {
    expect(validateMemberPlacement(member({ cell_id: 'c1' }), null, cells)).toBeNull();
    expect(validateMemberPlacement(member(), null, cells)).toContain('not in a cell');
  });
});
