import { fetchAffirmationsForDate, fetchUpcomingAffirmations } from '../lib/queries/affirmations';
import { supabase } from '../lib/supabase';

// F2: members must not read other members' declaration rows (identities or timestamps). The query layer may fetch
// aggregate counts through confession_declaration_counts and the caller's own declaration rows only.

jest.mock('../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
    auth: { getUser: jest.fn() },
  },
}));

const ME = 'member-me';
const CONFESSION_IDS = ['c-1', 'c-2'];

/** A chainable query that resolves to `result` when awaited. */
function chain(result: { data: unknown; error: unknown }) {
  const c: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'gte', 'lte', 'order', 'in', 'match']) {
    c[m] = jest.fn(() => c);
  }
  c.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return c;
}

const confessionRows = [
  { id: 'c-1', title: 'One', body: 'b', scheduled_date: '2026-10-12', is_active: true },
  { id: 'c-2', title: 'Two', body: 'b', scheduled_date: '2026-10-12', is_active: true },
];

beforeEach(() => {
  (supabase.auth.getUser as jest.Mock).mockResolvedValue({ data: { user: { id: ME } } });
});

afterEach(() => jest.clearAllMocks());

describe('affirmation declarations privacy (F2)', () => {
  test('the affirmation query does not embed other members declarations', async () => {
    const confessions = chain({ data: confessionRows, error: null });
    const declared = chain({ data: [{ confession_id: 'c-1' }], error: null });
    (supabase.from as jest.Mock).mockImplementation((table: string) =>
      table === 'confessions' ? confessions : declared,
    );
    (supabase.rpc as jest.Mock).mockResolvedValue({
      data: [
        { confession_id: 'c-1', declaration_count: 3 },
        { confession_id: 'c-2', declaration_count: 0 },
      ],
      error: null,
    });

    await fetchAffirmationsForDate('2026-10-12');

    // The embedded select would have requested confession_declarations(user_id) for every member.
    expect(confessions.select).toHaveBeenCalledWith('*');
    expect((confessions.select as jest.Mock).mock.calls.flat().join(' ')).not.toMatch(/confession_declarations/);
  });

  test('counts come from the aggregate RPC and declared_by_me from the caller own row only', async () => {
    const confessions = chain({ data: confessionRows, error: null });
    const declared = chain({ data: [{ confession_id: 'c-1' }], error: null });
    (supabase.from as jest.Mock).mockImplementation((table: string) =>
      table === 'confessions' ? confessions : declared,
    );
    (supabase.rpc as jest.Mock).mockResolvedValue({
      data: [
        { confession_id: 'c-1', declaration_count: 3 },
        { confession_id: 'c-2', declaration_count: 0 },
      ],
      error: null,
    });

    const result = await fetchAffirmationsForDate('2026-10-12');

    expect(supabase.rpc).toHaveBeenCalledWith('confession_declaration_counts', { p_confession_ids: CONFESSION_IDS });
    expect(declared.eq).toHaveBeenCalledWith('user_id', ME);
    expect(declared.in).toHaveBeenCalledWith('confession_id', CONFESSION_IDS);

    const byId = Object.fromEntries(result.map((c) => [c.id, c]));
    expect(byId['c-1']).toMatchObject({ declaration_count: 3, declared_by_me: true });
    expect(byId['c-2']).toMatchObject({ declaration_count: 0, declared_by_me: false });
  });

  test('upcoming affirmations use the same privacy-preserving summary', async () => {
    const confessions = chain({ data: confessionRows, error: null });
    const declared = chain({ data: [], error: null });
    (supabase.from as jest.Mock).mockImplementation((table: string) =>
      table === 'confessions' ? confessions : declared,
    );
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: [], error: null });

    const result = await fetchUpcomingAffirmations(7);

    expect((confessions.select as jest.Mock).mock.calls.flat().join(' ')).not.toMatch(/confession_declarations/);
    expect(result.every((c) => c.declaration_count === 0 && c.declared_by_me === false)).toBe(true);
  });

  test('no query reads declaration rows without the caller id filter', async () => {
    const confessions = chain({ data: confessionRows, error: null });
    const declared = chain({ data: [], error: null });
    (supabase.from as jest.Mock).mockImplementation((table: string) =>
      table === 'confessions' ? confessions : declared,
    );
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: [], error: null });

    await fetchAffirmationsForDate('2026-10-12');

    expect(declared.eq).toHaveBeenCalledWith('user_id', ME);
  });
});
