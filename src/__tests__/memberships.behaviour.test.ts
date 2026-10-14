/**
 * Behavioural tests for the merge and membership-history functions. Each test asserts the exact payload sent to the
 * database, the exact ordering requested, or the exact error that reaches the caller. None reads source text.
 */
import { mergePeople, getMembershipTransitions } from '../lib/queries/memberships';

const mockRpc = jest.fn();
const mockFrom = jest.fn();

jest.mock('../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

const TARGET = '00000000-0000-4000-8000-0000000000a1';
const SOURCE = '00000000-0000-4000-8000-0000000000a2';

/** A query builder that records each call and resolves to the configured result when awaited. */
function builder(result: { data: unknown; error: unknown }) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const api: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order', 'in', 'maybeSingle', 'single']) {
    api[m] = (...args: unknown[]) => {
      calls.push({ method: m, args });
      return api;
    };
  }
  api.then = (resolve: (v: unknown) => unknown) => resolve(result);
  return { api, calls };
}

beforeEach(() => {
  mockRpc.mockReset();
  mockFrom.mockReset();
});

describe('mergePeople calls the owner-run merge and nothing else', () => {
  it('sends the target, the source and the notes under the database parameter names, and returns the merged id', async () => {
    mockRpc.mockResolvedValue({ data: TARGET, error: null });
    const merged = await mergePeople({ targetPersonId: TARGET, sourcePersonId: SOURCE, notes: 'Duplicate of prospect' });
    expect(mockRpc).toHaveBeenCalledWith('merge_people', {
      target_person_id: TARGET,
      source_person_id: SOURCE,
      merge_notes: 'Duplicate of prospect',
    });
    expect(merged).toBe(TARGET);
  });

  it('sends null notes when the caller gives none (the database writes its default note)', async () => {
    mockRpc.mockResolvedValue({ data: TARGET, error: null });
    await mergePeople({ targetPersonId: TARGET, sourcePersonId: SOURCE });
    expect(mockRpc.mock.calls[0][1].merge_notes).toBeNull();
  });

  it('surfaces the database refusal text unchanged, for example a merge of two active memberships', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'Cannot merge people with two active memberships.' } });
    await expect(mergePeople({ targetPersonId: TARGET, sourcePersonId: SOURCE }))
      .rejects.toThrow('Cannot merge people with two active memberships.');
  });

  it('never writes people or memberships directly: a merge is one RPC, not table writes', async () => {
    mockRpc.mockResolvedValue({ data: TARGET, error: null });
    await mergePeople({ targetPersonId: TARGET, sourcePersonId: SOURCE });
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe('getMembershipTransitions returns the audit trail newest first, and fails loudly', () => {
  it('requests the person’s transitions ordered by transition time, newest first', async () => {
    const { api, calls } = builder({ data: [], error: null });
    mockFrom.mockReturnValue(api);
    await getMembershipTransitions(TARGET);
    expect(mockFrom).toHaveBeenCalledWith('membership_transitions');
    expect(calls).toContainEqual({ method: 'eq', args: ['person_id', TARGET] });
    expect(calls).toContainEqual({ method: 'order', args: ['transitioned_at', { ascending: false }] });
  });

  it('maps each transition row to the typed shape', async () => {
    const { api } = builder({
      data: [{
        id: 't1', person_id: TARGET, from_type: 'contact', to_type: 'member',
        transitioned_at: '2026-10-14T10:00:00Z', performed_by: 'coord-1', notes: 'Joined',
      }],
      error: null,
    });
    mockFrom.mockReturnValue(api);
    const rows = await getMembershipTransitions(TARGET);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 't1', personId: TARGET, fromType: 'contact', toType: 'member', notes: 'Joined' });
  });

  it('throws on a query error and does not return a partial trail', async () => {
    const { api } = builder({ data: null, error: { message: 'permission denied for table membership_transitions' } });
    mockFrom.mockReturnValue(api);
    await expect(getMembershipTransitions(TARGET)).rejects.toThrow('permission denied for table membership_transitions');
  });
});
