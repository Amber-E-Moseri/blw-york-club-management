import { createCell, renameCell, setCellLeader, setMemberCell } from '../lib/queries/cellAdmin';
import type { Cell, Member } from '../types';

// Records every builder call so the tests can assert which writes reached the database.
const mockCalls: Array<{ table: string; op: string; payload?: unknown; filters: unknown[] }> = [];
let mockNext: { data: unknown; error: { message: string } | null } = { data: null, error: null };

jest.mock('../lib/supabase', () => {
  const builder = (table: string) => {
    const entry: { table: string; op: string; payload?: unknown; filters: unknown[] } = { table, op: 'select', filters: [] };
    mockCalls.push(entry);
    const chain: Record<string, unknown> = {};
    chain.insert = (payload: unknown) => { entry.op = 'insert'; entry.payload = payload; return chain; };
    chain.update = (payload: unknown) => { entry.op = 'update'; entry.payload = payload; return chain; };
    chain.select = () => chain;
    chain.eq = (col: string, val: unknown) => { entry.filters.push([col, val]); return chain; };
    chain.maybeSingle = () => Promise.resolve(mockNext);
    return chain;
  };
  return { supabase: { from: (table: string) => builder(table) } };
});

const actorManager = { role: 'coordinator', status: 'active' };
const actorLeader = { role: 'cell_leader', status: 'active' };
const cells: Cell[] = [{ id: 'c1', name: 'North' }, { id: 'c2', name: 'South' }];
const active: Member = {
  id: 'm1', full_name: 'Amahle Khumalo', email: 'a@example.org', role: 'member', joined_at: '2026-01-01', status: 'active',
};
const pending: Member = { ...active, id: 'm2', full_name: 'Thabo Radebe', status: 'pending' };

beforeEach(() => {
  mockCalls.length = 0;
  mockNext = { data: { id: 'x' }, error: null };
});

describe('cell administration writes', () => {
  it('refuses every write for a non-manager before touching the database', async () => {
    await expect(createCell('East', actorLeader, cells)).rejects.toThrow('Only active coordinators and admins');
    await expect(renameCell('c1', 'East', actorLeader, cells)).rejects.toThrow('Only active coordinators');
    await expect(setCellLeader('c1', 'm1', actorLeader, [active])).rejects.toThrow('Only active coordinators');
    await expect(setMemberCell(active, 'c2', actorLeader, cells)).rejects.toThrow('Only active coordinators');
    expect(mockCalls).toHaveLength(0);
  });

  it('creates a cell with the trimmed name', async () => {
    mockNext = { data: { id: 'c9', name: 'East', leader_id: null }, error: null };
    await createCell('  East ', actorManager, cells);
    expect(mockCalls[0]).toMatchObject({ table: 'cells', op: 'insert', payload: { name: 'East' } });
  });

  it('rejects a duplicate cell name before the insert', async () => {
    await expect(createCell('north', actorManager, cells)).rejects.toThrow('already exists');
    expect(mockCalls).toHaveLength(0);
  });

  it('reports a zero-row update as a failure (RLS denial returns no error)', async () => {
    mockNext = { data: null, error: null };
    await expect(renameCell('c1', 'Central', actorManager, cells)).rejects.toThrow('may have been removed');
  });

  it('surfaces the database error message', async () => {
    mockNext = { data: null, error: { message: 'permission denied for table cells' } };
    await expect(renameCell('c1', 'Central', actorManager, cells)).rejects.toThrow('permission denied');
  });

  it('refuses to assign a pending member as leader', async () => {
    await expect(setCellLeader('c1', 'm2', actorManager, [pending])).rejects.toThrow('must be an active member');
    expect(mockCalls).toHaveLength(0);
  });

  it('assigns an active member as leader and clears the leader with null', async () => {
    await setCellLeader('c1', 'm1', actorManager, [active]);
    expect(mockCalls[0]).toMatchObject({ table: 'cells', op: 'update', payload: { leader_id: 'm1' } });
    mockCalls.length = 0;
    await setCellLeader('c1', null, actorManager, [active]);
    expect(mockCalls[0]).toMatchObject({ payload: { leader_id: null } });
  });

  it('refuses to place a pending member in a cell', async () => {
    await expect(setMemberCell(pending, 'c1', actorManager, cells)).rejects.toThrow('Only active members');
    expect(mockCalls).toHaveLength(0);
  });

  it('adds an active member to a cell with one profile update', async () => {
    await setMemberCell(active, 'c1', actorManager, cells);
    expect(mockCalls[0]).toMatchObject({ table: 'profiles', op: 'update', payload: { cell_id: 'c1' } });
    expect(mockCalls[0].filters).toEqual([['id', 'm1']]);
  });

  it('transfers an active member between cells', async () => {
    await setMemberCell({ ...active, cell_id: 'c1' }, 'c2', actorManager, cells);
    expect(mockCalls[0]).toMatchObject({ table: 'profiles', payload: { cell_id: 'c2' } });
  });

  it('removes a member from their cell with a null cell_id', async () => {
    await setMemberCell({ ...active, cell_id: 'c1' }, null, actorManager, cells);
    expect(mockCalls[0]).toMatchObject({ payload: { cell_id: null } });
  });

  it('reports a profile update that saved no row', async () => {
    mockNext = { data: null, error: null };
    await expect(setMemberCell(active, 'c1', actorManager, cells)).rejects.toThrow('was not changed');
  });
});

