import { NotSavedError, assignMemberToBsc, createBsc, setBscLeader } from '../lib/queries/bscs';

// Every BSC write must report success only when the database returned the stored row. These tests fake the Supabase
// responses to prove a zero-row result is refused, never shown as a success.

const mockRpc = jest.fn();
const mockFrom = jest.fn();

jest.mock('../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

/** A PostgREST-style builder: every chained call returns the builder; the terminal call resolves to the response. */
function chain(terminal: { data: unknown; error: { message: string } | null }) {
  const builder: Record<string, unknown> = {};
  const proxy = new Proxy(builder, {
    get: (_t, prop: string) => {
      if (prop === 'then') return undefined;
      return (..._args: unknown[]) => (['maybeSingle', 'single'].includes(prop) ? Promise.resolve(terminal) : proxy);
    },
  });
  return proxy;
}

beforeEach(() => {
  mockRpc.mockReset();
  mockFrom.mockReset();
});

describe('assignMemberToBsc', () => {
  it('resolves when the RPC returns the stored assignment', async () => {
    mockRpc.mockResolvedValue({ data: [{ member_id: 'm1', bsc_id: 'b1' }], error: null });
    await expect(assignMemberToBsc('m1', 'b1')).resolves.toBeUndefined();
    expect(mockRpc).toHaveBeenCalledWith('assign_member_to_bsc', { p_member_id: 'm1', p_bsc_id: 'b1' });
  });

  it('refuses a zero-row result instead of reporting success', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    await expect(assignMemberToBsc('m1', 'b1')).rejects.toBeInstanceOf(NotSavedError);
  });

  it('surfaces the database refusal message', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'The BSC must belong to the member\'s current cell.' } });
    await expect(assignMemberToBsc('m1', 'b1')).rejects.toThrow('current cell');
  });

  it('refuses a result that names a different member', async () => {
    mockRpc.mockResolvedValue({ data: [{ member_id: 'other', bsc_id: 'b1' }], error: null });
    await expect(assignMemberToBsc('m1', 'b1')).rejects.toBeInstanceOf(NotSavedError);
  });
});

describe('setBscLeader', () => {
  it('returns the stored BSC row', async () => {
    const row = { id: 'b1', cell_id: 'c1', name: 'Class', leader_id: 'm1' };
    mockFrom.mockReturnValue(chain({ data: row, error: null }));
    await expect(setBscLeader('b1', 'm1')).resolves.toEqual(row);
  });

  it('refuses an update that matched no row (RLS filtered it out)', async () => {
    mockFrom.mockReturnValue(chain({ data: null, error: null }));
    await expect(setBscLeader('b1', 'm1')).rejects.toBeInstanceOf(NotSavedError);
  });
});

describe('createBsc', () => {
  it('returns the created row', async () => {
    const row = { id: 'b2', cell_id: 'c1', name: 'New class', leader_id: null };
    mockFrom.mockReturnValue(chain({ data: row, error: null }));
    await expect(createBsc({ cell_id: 'c1', name: 'New class', leader_id: null })).resolves.toEqual(row);
  });

  it('refuses an insert that returned no row', async () => {
    mockFrom.mockReturnValue(chain({ data: null, error: null }));
    await expect(createBsc({ cell_id: 'c1', name: 'New class', leader_id: null })).rejects.toBeInstanceOf(NotSavedError);
  });
});
