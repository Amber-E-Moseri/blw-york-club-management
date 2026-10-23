import {
  deleteAnnouncement,
  getAnnouncementsPage,
  updateAnnouncement,
} from '../lib/queries';
import { supabase } from '../lib/supabase';

jest.mock('../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

type Result = { data?: unknown; error?: { message: string } | null };

// A chainable stand-in for a PostgREST builder. Every call is recorded; awaiting the builder yields `result`.
function builderFor(result: Result) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const builder: any = {
    calls,
    then: (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  for (const method of ['select', 'or', 'order', 'limit', 'update', 'delete', 'eq']) {
    builder[method] = jest.fn((...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    });
  }
  return builder;
}

function rowsFor(from: number, to: number) {
  // Descending ids, one row per number, so the first row returned is the largest number.
  return Array.from({ length: to - from + 1 }, (_, i) => {
    const n = to - i;
    return {
      id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
      title: `Title ${n}`,
      body: `Body ${n}`,
      author_id: 'a',
      author_name: 'A',
      created_at: new Date(Date.UTC(2026, 8, 1) + n * 60_000).toISOString(),
    };
  });
}

beforeEach(() => {
  (supabase.from as jest.Mock).mockReset();
});

describe('getAnnouncementsPage', () => {
  it('orders by created_at then id, and asks for one extra row to detect another page', async () => {
    const builder = builderFor({ data: rowsFor(1, 3) });
    (supabase.from as jest.Mock).mockReturnValue(builder);

    await getAnnouncementsPage(undefined, 2);

    const methods = builder.calls.map((c: { method: string }) => c.method);
    expect(methods).not.toContain('or');
    expect(builder.calls.filter((c: { method: string }) => c.method === 'order')).toEqual([
      { method: 'order', args: ['created_at', { ascending: false }] },
      { method: 'order', args: ['id', { ascending: false }] },
    ]);
    expect(builder.calls.find((c: { method: string }) => c.method === 'limit')?.args).toEqual([3]);
  });

  it('returns at most one page of rows and reports hasMore when there are more', async () => {
    (supabase.from as jest.Mock).mockReturnValue(builderFor({ data: rowsFor(1, 3) }));

    const page = await getAnnouncementsPage(undefined, 2);

    expect(page.items.map((a) => a.title)).toEqual(['Title 3', 'Title 2']);
    expect(page.hasMore).toBe(true);
  });

  it('reports no more rows when the page is the last one', async () => {
    (supabase.from as jest.Mock).mockReturnValue(builderFor({ data: rowsFor(1, 2) }));

    const page = await getAnnouncementsPage(undefined, 2);

    expect(page.items).toHaveLength(2);
    expect(page.hasMore).toBe(false);
  });

  it('filters strictly after the cursor, with an id tie-breaker for equal timestamps', async () => {
    const builder = builderFor({ data: [] });
    (supabase.from as jest.Mock).mockReturnValue(builder);
    const cursor = { created_at: '2026-09-01T00:05:00.000+00:00', id: 'abc-123' };

    await getAnnouncementsPage(cursor, 20);

    const orCall = builder.calls.find((c: { method: string }) => c.method === 'or');
    expect(orCall?.args[0]).toBe(
      'created_at.lt."2026-09-01T00:05:00.000+00:00",and(created_at.eq."2026-09-01T00:05:00.000+00:00",id.lt.abc-123)'
    );
  });

  it('surfaces the database error message', async () => {
    (supabase.from as jest.Mock).mockReturnValue(builderFor({ error: { message: 'permission denied' } }));

    await expect(getAnnouncementsPage()).rejects.toThrow('permission denied');
  });
});

describe('updateAnnouncement', () => {
  it('sends only title and body, scoped to the one id', async () => {
    const row = { id: 'one', title: 'New', body: 'Text', author_id: 'a', author_name: 'A', created_at: 'x' };
    const builder = builderFor({ data: [row] });
    (supabase.from as jest.Mock).mockReturnValue(builder);

    const saved = await updateAnnouncement('one', 'New', 'Text');

    expect(builder.calls).toEqual([
      { method: 'update', args: [{ title: 'New', body: 'Text' }] },
      { method: 'eq', args: ['id', 'one'] },
      { method: 'select', args: ['*'] },
    ]);
    expect(saved).toEqual(row);
  });

  it('treats an empty result as a refusal, not a silent success', async () => {
    (supabase.from as jest.Mock).mockReturnValue(builderFor({ data: [] }));

    await expect(updateAnnouncement('one', 'New', 'Text')).rejects.toThrow('was not saved');
  });

  it('surfaces the database error message', async () => {
    (supabase.from as jest.Mock).mockReturnValue(builderFor({ error: { message: 'row-level security' } }));

    await expect(updateAnnouncement('one', 'New', 'Text')).rejects.toThrow('row-level security');
  });
});

describe('deleteAnnouncement', () => {
  it('deletes only the requested id and asks for the id back', async () => {
    const builder = builderFor({ data: [{ id: 'one' }] });
    (supabase.from as jest.Mock).mockReturnValue(builder);

    await expect(deleteAnnouncement('one')).resolves.toBeUndefined();

    expect(builder.calls).toEqual([
      { method: 'delete', args: [] },
      { method: 'eq', args: ['id', 'one'] },
      { method: 'select', args: ['id'] },
    ]);
  });

  it('treats zero deleted rows as a refusal, because RLS filters silently', async () => {
    (supabase.from as jest.Mock).mockReturnValue(builderFor({ data: [] }));

    await expect(deleteAnnouncement('one')).rejects.toThrow('was not deleted');
  });

  it('surfaces the database error message', async () => {
    (supabase.from as jest.Mock).mockReturnValue(builderFor({ error: { message: 'network down' } }));

    await expect(deleteAnnouncement('one')).rejects.toThrow('network down');
  });
});
