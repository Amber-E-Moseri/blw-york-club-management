/**
 * Contact creation no longer resolves people in the browser. The database links each contact to its person, from the
 * contact's email, in the same write (migration 073). These tests pin that contract: the client never looks a person up,
 * never creates one, and never sends a person id for a new contact.
 */

const insertCalls: Array<Record<string, unknown>> = [];
const fromCalls: string[] = [];
const rpcCalls: Array<[string, unknown]> = [];

jest.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      fromCalls.push(table);
      return {
        insert: (row: Record<string, unknown>) => {
          insertCalls.push({ table, ...row });
          return {
            select: () => ({
              single: () => Promise.resolve({ data: { id: 'contact-1', ...row }, error: null }),
            }),
          };
        },
      };
    },
    rpc: (name: string, args: unknown) => {
      rpcCalls.push([name, args]);
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

import { createContact } from '../lib/queries/contacts';

beforeEach(() => {
  insertCalls.length = 0;
  fromCalls.length = 0;
  rpcCalls.length = 0;
});

const input = {
  contact_name: 'Visitor',
  email: 'visitor@example.test',
  contact_phone: '4165550100',
  cell_id: 'cell-1',
  logged_by: 'leader-1',
} as Parameters<typeof createContact>[0];

describe('contact creation relies on database person linking', () => {
  it('inserts the contact without a person id and never reads or creates a person in the browser', async () => {
    await createContact(input);
    expect(fromCalls).toEqual(['contacts']);
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0].person_id).toBeUndefined();
  });

  it('never looks up a person by email from the browser (no person lookup RPC)', async () => {
    await createContact(input);
    expect(rpcCalls).toEqual([]);
  });

  it('never sends a null, undefined, or empty person id for a new contact', async () => {
    await createContact({ ...input, person_id: '' } as unknown as Parameters<typeof createContact>[0]);
    const row = insertCalls[0];
    expect(row.person_id).toBeUndefined();
  });

  it('propagates a database refusal instead of writing around it', async () => {
    const { supabase } = jest.requireMock('../lib/supabase') as { supabase: { from: (t: string) => unknown } };
    const original = supabase.from;
    supabase.from = () => ({
      insert: () => ({
        select: () => ({
          single: () => Promise.resolve({ data: null, error: { message: 'contacts_resolve_person refused' } }),
        }),
      }),
    });
    try {
      await expect(createContact(input)).rejects.toThrow(/refused/);
    } finally {
      supabase.from = original;
    }
  });
});
