import {
  createCell,
  renameCell,
  setCellArchived,
  setCellLeader,
  setMemberCell,
} from '../lib/queries/cellAdmin';
import type { Cell, Member } from '../types';

// Records every builder call so the tests can assert which writes reached the database.
const mockCalls: Array<{ table: string; op: string; payload?: unknown; filters: unknown[] }> = [];
let mockNext: { data: unknown; error: { message: string } | null } = { data: null, error: null };
let mockRpcNext: { data: unknown; error: { message: string } | null } = { data: [], error: null };

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
  const rpc = (fn: string, args: unknown) => {
    mockCalls.push({ table: fn, op: 'rpc', payload: args, filters: [] });
    return Promise.resolve(mockRpcNext);
  };
  return { supabase: { from: (table: string) => builder(table), rpc } };
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
  mockRpcNext = { data: [{ member_id: 'm1', cell_id: 'c1' }], error: null };
});

describe('cell administration writes', () => {
  it('refuses every write for a non-manager before touching the database', async () => {
    await expect(createCell('East', actorLeader, cells)).rejects.toThrow('Only active coordinators and admins');
    await expect(renameCell('c1', 'East', actorLeader, cells)).rejects.toThrow('Only active coordinators');
    await expect(setCellLeader('c1', 'm1', actorLeader, [active])).rejects.toThrow('Only active coordinators');
    await expect(setMemberCell(active, 'c2', actorLeader, cells)).rejects.toThrow('Only active coordinators');
    await expect(setCellArchived(cells[0], true, actorLeader, [])).rejects.toThrow('Only active coordinators');
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
});

describe('member placement through the transfer RPC', () => {
  it('adds an active member to a cell through transfer_member_cell', async () => {
    await setMemberCell(active, 'c1', actorManager, cells);
    expect(mockCalls[0]).toMatchObject({
      table: 'transfer_member_cell',
      op: 'rpc',
      payload: { p_member_id: 'm1', p_cell_id: 'c1' },
    });
  });

  it('transfers an active member between cells', async () => {
    await setMemberCell({ ...active, cell_id: 'c1' }, 'c2', actorManager, cells);
    expect(mockCalls[0]).toMatchObject({ payload: { p_member_id: 'm1', p_cell_id: 'c2' } });
  });

  it('removes a member from their cell with a null target', async () => {
    await setMemberCell({ ...active, cell_id: 'c1' }, null, actorManager, cells);
    expect(mockCalls[0]).toMatchObject({ payload: { p_member_id: 'm1', p_cell_id: null } });
  });

  it('reports an RPC that saved no row', async () => {
    mockRpcNext = { data: [], error: null };
    await expect(setMemberCell(active, 'c1', actorManager, cells)).rejects.toThrow('was not changed');
  });

  it('shows the database refusal message when the RPC is denied', async () => {
    mockRpcNext = { data: null, error: { message: 'This member is in a Bible Study Class. Remove them from it before changing cells.' } };
    await expect(setMemberCell({ ...active, cell_id: 'c1' }, 'c2', actorManager, cells)).rejects.toThrow('Bible Study Class');
  });

  it('blocks a transfer for a member in a Bible Study Class before the RPC', async () => {
    const inClass = { ...active, cell_id: 'c1', bsc_name: 'Thursday BSC' };
    await expect(setMemberCell(inClass, 'c2', actorManager, cells)).rejects.toThrow('Bible Study Class “Thursday BSC”');
    expect(mockCalls).toHaveLength(0);
  });

  it('blocks a transfer for a member who leads a cell until a new leader is assigned', async () => {
    const leadingCells: Cell[] = [{ id: 'c1', name: 'North', leader_id: 'm1' }, { id: 'c2', name: 'South' }];
    await expect(setMemberCell({ ...active, cell_id: 'c1' }, 'c2', actorManager, leadingCells)).rejects.toThrow('leads “North”');
    expect(mockCalls).toHaveLength(0);
  });
});

describe('archiving cells', () => {
  it('refuses to archive a cell that still has members, before any write', async () => {
    const members = [{ ...active, cell_id: 'c1' }];
    await expect(setCellArchived(cells[0], true, actorManager, members)).rejects.toThrow('Move or remove the 1 member');
    expect(mockCalls).toHaveLength(0);
  });

  it('archives an empty cell by setting archived_at', async () => {
    await setCellArchived(cells[0], true, actorManager, []);
    expect(mockCalls[0]).toMatchObject({ table: 'cells', op: 'update', filters: [['id', 'c1']] });
    expect((mockCalls[0].payload as { archived_at: string | null }).archived_at).toEqual(expect.any(String));
  });

  it('restores an archived cell by clearing archived_at', async () => {
    await setCellArchived(cells[0], false, actorManager, []);
    expect(mockCalls[0]).toMatchObject({ table: 'cells', op: 'update', payload: { archived_at: null } });
  });

  it('reports an archive that saved no row', async () => {
    mockNext = { data: null, error: null };
    await expect(setCellArchived(cells[0], true, actorManager, [])).rejects.toThrow('was not saved');
  });
});
