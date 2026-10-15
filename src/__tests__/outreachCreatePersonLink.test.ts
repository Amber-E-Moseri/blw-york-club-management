import { supabase } from '../lib/supabase';
import { createContact } from '../lib/queries/contacts';

jest.mock('../lib/supabase', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));

const from = supabase.from as unknown as jest.Mock;
const rpc = supabase.rpc as unknown as jest.Mock;
const COORD = '62b1d48e-ca45-427f-a71b-35f5fa327ec6';

type Call = { table: string; payload: Record<string, unknown> };
let calls: Call[];

// Wires the mocked client. `existingPersonId` is what the find_person_by_email RPC returns.
// `peopleInsertError` makes the people insert fail, to simulate a refused duplicate.
function wire({
  existingPersonId = null,
  peopleInsertError = null,
}: { existingPersonId?: string | null; peopleInsertError?: string | null } = {}) {
  rpc.mockImplementation(async () => ({ data: existingPersonId, error: null }));
  from.mockImplementation((table: string) => ({
    insert: (payload: Record<string, unknown>) => {
      calls.push({ table, payload });
      if (table === 'people' && peopleInsertError) {
        return { select: () => ({ single: async () => ({ data: null, error: { message: peopleInsertError } }) }) };
      }
      const data =
        table === 'people'
          ? { id: 'person-new', full_name: payload.full_name, email: payload.email ?? null, phone: payload.phone ?? null, created_at: '', updated_at: '' }
          : { id: 'contact-1', ...payload };
      return { select: () => ({ single: async () => ({ data, error: null }) }) };
    },
  }));
}

// A realistic Outreach form payload, matching the fields ContactForm sends.
const formInput = {
  contact_name: 'Release Test Contact',
  contact_phone: '0000000000',
  phone_hidden: false,
  email: 'release-test@example.test',
  tag: 'General',
  follow_up_status: 'Open',
  follow_up_assignee: '',
  date_contacted: '2026-10-10',
  notes: 'PR #2 post-migration verification test',
  is_member: false,
  cell_id: '',
  logged_by: COORD,
} as unknown as Parameters<typeof createContact>[0];

const contactInsert = () => calls.find((c) => c.table === 'contacts');

describe('Outreach contact creation links a person', () => {
  beforeEach(() => {
    calls = [];
    rpc.mockReset();
    from.mockReset();
  });

  it('creates the person before inserting the contact, and the contact carries its person_id', async () => {
    wire();
    await createContact(formInput);

    const order = calls.map((c) => c.table);
    expect(order).toEqual(['people', 'contacts']);

    const contact = contactInsert()!.payload;
    expect(contact.person_id).toBe('person-new');
    expect(contact.contact_name).toBe('Release Test Contact');
    expect(contact.contact_phone).toBe('0000000000');
    expect(contact.email).toBe('release-test@example.test');
    expect(contact.tag).toBe('General');
    expect(contact.follow_up_status).toBe('Open');
    expect(contact.notes).toBe('PR #2 post-migration verification test');
    expect(contact.logged_by).toBe(COORD);
  });

  it('reuses an existing person with the same confirmed email instead of creating a duplicate', async () => {
    wire({ existingPersonId: 'person-existing' });
    await createContact(formInput);

    expect(calls.map((c) => c.table)).toEqual(['contacts']);
    expect(contactInsert()!.payload.person_id).toBe('person-existing');
  });

  it('never sends a null, undefined, or empty person_id for a new Outreach contact', async () => {
    wire();
    await createContact(formInput);
    const personId = contactInsert()!.payload.person_id;
    expect(typeof personId).toBe('string');
    expect((personId as string).length).toBeGreaterThan(0);
  });

  it('still normalises an empty cell_id to null', async () => {
    wire();
    await createContact(formInput);
    expect(contactInsert()!.payload.cell_id).toBeNull();
  });

  it('refuses an ambiguous phone duplicate and writes no contact', async () => {
    wire({ peopleInsertError: 'duplicate key value violates unique constraint "people_phone_key"' });
    await expect(createContact({ ...formInput, email: undefined } as typeof formInput)).rejects.toThrow(
      /ambiguous-phone/
    );
    expect(contactInsert()).toBeUndefined();
  });
});
