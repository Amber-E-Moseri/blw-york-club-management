/**
 * createContact must never send an empty string for the nullable uuid column contacts.cell_id.
 * A user without a cell produces cell_id '' in the form; the database rejects that with a 400.
 *
 * createContact also resolves a person first (contacts.person_id is NOT NULL), so the mock routes
 * by table: `people` returns a person row, and `contacts` is the insert these tests check.
 */
import { createContact } from '../lib/queries/contacts';
import { supabase } from '../lib/supabase';

jest.mock('../lib/supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

const base = {
  contact_name: 'Release Test Contact',
  tag: 'General',
  follow_up_status: 'Open',
  date_contacted: '2026-01-01',
  phone_hidden: false,
  is_member: false,
  logged_by: '62b1d48e-ca45-427f-a71b-35f5fa327ec6',
};

// Returns the contacts insert spy. The people insert returns a person row so person resolution succeeds.
function mockInsert() {
  const contactsInsert = jest.fn((_payload: Record<string, unknown>) => ({
    select: () => ({ single: () => Promise.resolve({ data: { id: 'new-contact' }, error: null }) }),
  }));
  const peopleInsert = jest.fn((_payload: Record<string, unknown>) => ({
    select: () => ({
      single: () =>
        Promise.resolve({
          data: { id: 'person-1', full_name: base.contact_name, email: null, phone: null, created_at: '', updated_at: '' },
          error: null,
        }),
    }),
  }));
  (supabase.from as jest.Mock).mockImplementation((table: string) =>
    table === 'people' ? { insert: peopleInsert } : { insert: contactsInsert }
  );
  (supabase.rpc as jest.Mock).mockResolvedValue({ data: null, error: null });
  return contactsInsert;
}

beforeEach(() => {
  (supabase.from as jest.Mock).mockReset();
  (supabase.rpc as jest.Mock).mockReset();
});

test('createContact sends cell_id as null, never an empty string, when the user has no cell', async () => {
  const insert = mockInsert();

  await createContact({ ...base, cell_id: '' } as Parameters<typeof createContact>[0]);

  expect(insert).toHaveBeenCalledTimes(1);
  const payload = insert.mock.calls[0][0] as Record<string, unknown>;
  expect(payload.cell_id).toBeNull();
  expect(payload.cell_id).not.toBe('');
});

test('createContact keeps a real cell_id and still sets logged_by', async () => {
  const insert = mockInsert();
  const cellId = '3f1c9a2e-5b7d-4e8f-9a0b-1c2d3e4f5a6b';

  await createContact({ ...base, cell_id: cellId } as Parameters<typeof createContact>[0]);

  const payload = insert.mock.calls[0][0] as Record<string, unknown>;
  expect(payload.cell_id).toBe(cellId);
  expect(payload.logged_by).toBe(base.logged_by);
});
