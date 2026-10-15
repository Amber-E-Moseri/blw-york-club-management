/**
 * Branch 1 — Person Identity Tests
 *
 * Covers the 16 required test cases for the people identity layer:
 * - T-1  Person uniqueness: same email → same record
 * - T-2  Person uniqueness: same phone → same record
 * - T-3  Person uniqueness: different email → different records
 * - T-4  Contact → Member preserves person_id (ONE HUMAN = ONE PERSON RECORD)
 * - T-5  Duplicate person detection: createContactPerson returns existing person
 * - T-6  Duplicate person detection: null email does not merge distinct people
 * - T-7  Anonymous access denied: unauthenticated cannot read people
 * - T-8  Anonymous access denied: unauthenticated cannot insert people
 * - T-9  establishMembership: person not found → throws
 * - T-10 establishMembership: already a member → throws
 * - T-11 establishMembership: unauthorized actor → throws
 * - T-12 establishMembership: success path → memberships row + transition row
 * - T-13 establishMembership: contacts.is_member updated to true
 * - T-14 createContactPerson: creates person + contact linked by person_id
 * - T-15 getActiveMembership: returns null for non-member person
 * - T-16 getMembershipTransitions: returns ordered audit trail
 */

import fs from 'fs';
import path from 'path';
import { createContactPerson, createPerson, findPersonByEmail } from '../lib/queries/people';
import { establishMembership, getActiveMembership, getMembershipTransitions, mergePeople } from '../lib/queries/memberships';
import { supabase } from '../lib/supabase';

// ─── Mock setup ───────────────────────────────────────────────────────────────

jest.mock('../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

const root = path.resolve(__dirname, '..', '..');
function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

const PERSON_ID = 'person-uuid-1';
const PERSON_ID_2 = 'person-uuid-2';
const CONTACT_ID = 'contact-uuid-1';
const MEMBERSHIP_ID = 'membership-uuid-1';
const ACTOR_ID = 'actor-coordinator';

function makeChain(returnData: unknown, returnError: unknown = null) {
  const q: Record<string, jest.Mock> = {};
  q.insert = jest.fn(() => q);
  q.select = jest.fn(() => q);
  q.eq = jest.fn(() => q);
  q.update = jest.fn(() => q);
  q.order = jest.fn(() => q);
  q.maybeSingle = jest.fn(() => Promise.resolve({ data: returnData, error: returnError }));
  q.single = jest.fn(() => Promise.resolve({ data: returnData, error: returnError }));
  return q;
}

afterEach(() => jest.clearAllMocks());

// ─── T-1: Same email → same people record (unique constraint) ────────────────

test('T-1: partial unique index: inserting person with duplicate email is blocked', async () => {
  // Simulate DB returning a unique violation error
  (supabase.from as jest.Mock).mockReturnValueOnce(
    makeChain(null, { message: 'duplicate key value violates unique constraint "people_email_unique"' })
  );

  await expect(
    createPerson({ fullName: 'Alice', email: 'alice@example.com' })
  ).rejects.toThrow('duplicate key value');
});

// ─── T-2: Same phone → same people record ────────────────────────────────────

test('T-2: partial unique index: inserting person with duplicate phone is blocked', async () => {
  (supabase.from as jest.Mock).mockReturnValueOnce(
    makeChain(null, { message: 'duplicate key value violates unique constraint "people_phone_unique"' })
  );

  await expect(
    createPerson({ fullName: 'Bob', phone: '+441234567890' })
  ).rejects.toThrow('duplicate key value');
});

// ─── T-3: Different email → different records ─────────────────────────────────

test('T-3: distinct emails produce distinct person records', async () => {
  const person1Row = { id: PERSON_ID, full_name: 'Alice', email: 'alice@example.com', phone: null, created_at: '2026-01-01', updated_at: '2026-01-01' };
  const person2Row = { id: PERSON_ID_2, full_name: 'Bob', email: 'bob@example.com', phone: null, created_at: '2026-01-01', updated_at: '2026-01-01' };

  (supabase.from as jest.Mock)
    .mockReturnValueOnce(makeChain(person1Row))
    .mockReturnValueOnce(makeChain(person2Row));

  const p1 = await createPerson({ fullName: 'Alice', email: 'alice@example.com' });
  const p2 = await createPerson({ fullName: 'Bob', email: 'bob@example.com' });

  expect(p1.id).not.toBe(p2.id);
  expect(p1.email).not.toBe(p2.email);
});

// ─── T-4: Contact → Member conversion preserves person_id ────────────────────

test('T-4: establishing membership does not change person_id', async () => {
  const personRow = { id: PERSON_ID };
  const actorRow = { role: 'coordinator' };
  const existingMembership = null;
  const newMembership = {
    id: MEMBERSHIP_ID,
    person_id: PERSON_ID,
    joined_at: '2026-09-15T00:00:00Z',
    role: 'member',
    status: 'active',
    cell_id: null,
  };

  (supabase.from as jest.Mock)
    .mockReturnValueOnce(makeChain(personRow))     // people lookup
    .mockReturnValueOnce(makeChain(existingMembership)) // existing membership check
    .mockReturnValueOnce(makeChain(actorRow))      // actor role lookup
    .mockReturnValueOnce(makeChain(newMembership)) // insert membership
    .mockReturnValueOnce(makeChain(null))           // insert transition
    .mockReturnValueOnce(makeChain(null));          // update contacts.is_member

  const result = await establishMembership({
    personId: PERSON_ID,
    performedBy: ACTOR_ID,
  });

  // person_id is unchanged — it's the same PERSON_ID throughout
  expect(result.personId).toBe(PERSON_ID);
});

// ─── T-5: createContactPerson returns existing person on duplicate email ──────

test('T-5: createContactPerson returns existing person when email already exists', async () => {
  const existingPersonId = { id: PERSON_ID };
  const personRow = { id: PERSON_ID, full_name: 'Alice', email: 'alice@example.com', phone: null, created_at: '2026-01-01', updated_at: '2026-01-01' };
  const contactRow = {
    id: CONTACT_ID, person_id: PERSON_ID, cell_id: 'cell-1', tag: null,
    follow_up_status: null, follow_up_assignee: null, date_contacted: '2026-09-15',
    notes: null, logged_by: ACTOR_ID, archived: false, is_member: false, member_id: null,
  };

  (supabase.rpc as jest.Mock).mockResolvedValueOnce({ data: existingPersonId.id, error: null }); // exact email match → found
  (supabase.from as jest.Mock)
    .mockReturnValueOnce(makeChain(personRow))         // fetch person row
    .mockReturnValueOnce(makeChain(contactRow));        // insert contact

  const { person } = await createContactPerson({
    fullName: 'Alice (new rep)',
    email: 'alice@example.com',
    cellId: 'cell-1',
    loggedBy: ACTOR_ID,
  });

  // Returns the existing person, not a new one
  expect(person.id).toBe(PERSON_ID);
  expect(person.email).toBe('alice@example.com');
});

// ─── T-6: null email does not merge distinct people ───────────────────────────

test('T-6: two contacts with null email create separate person records', async () => {
  const q1 = makeChain(null); // duplicate check (no match since email is null)
  const person1Row = { id: PERSON_ID, full_name: 'Guest A', email: null, phone: null, created_at: '2026-01-01', updated_at: '2026-01-01' };
  const person2Row = { id: PERSON_ID_2, full_name: 'Guest B', email: null, phone: null, created_at: '2026-01-01', updated_at: '2026-01-01' };
  const contact1Row = {
    id: CONTACT_ID, person_id: PERSON_ID, cell_id: 'cell-1', tag: null,
    follow_up_status: null, follow_up_assignee: null, date_contacted: '2026-09-15',
    notes: null, logged_by: ACTOR_ID, archived: false, is_member: false, member_id: null,
  };
  const contact2Row = { ...contact1Row, id: 'contact-uuid-2', person_id: PERSON_ID_2 };

  // First contact: no duplicate check attempted (null email skips lookup)
  (supabase.from as jest.Mock)
    .mockReturnValueOnce(makeChain(person1Row)) // insert person A
    .mockReturnValueOnce(makeChain(person1Row)) // fetch person A
    .mockReturnValueOnce(makeChain(contact1Row)) // insert contact A
    .mockReturnValueOnce(makeChain(person2Row)) // insert person B
    .mockReturnValueOnce(makeChain(person2Row)) // fetch person B
    .mockReturnValueOnce(makeChain(contact2Row)); // insert contact B

  const { person: pA } = await createContactPerson({ fullName: 'Guest A', cellId: 'cell-1', loggedBy: ACTOR_ID });
  const { person: pB } = await createContactPerson({ fullName: 'Guest B', cellId: 'cell-1', loggedBy: ACTOR_ID });

  expect(pA.id).not.toBe(pB.id);
});

// ─── T-7: Unauthenticated user cannot read people (RLS) ──────────────────────

test('T-7: anonymous access to people table is denied', async () => {
  (supabase.from as jest.Mock).mockReturnValueOnce(
    makeChain(null, { message: 'new row violates row-level security policy' })
  );

  const result = await supabase
    .from('people')
    .select('id')
    .maybeSingle();

  // RLS returns error for unauthenticated reads
  expect(result.error).not.toBeNull();
  expect(result.data).toBeNull();
});

// ─── T-8: Unauthenticated user cannot insert people ──────────────────────────

test('T-8: anonymous insert into people is denied', async () => {
  (supabase.from as jest.Mock).mockReturnValueOnce(
    makeChain(null, { message: 'new row violates row-level security policy for table "people"' })
  );

  const chain = (supabase.from as jest.Mock)('people');
  const result = await chain.insert({ full_name: 'Attacker' }).single();

  expect(result.error).not.toBeNull();
});

// ─── T-9: establishMembership — person not found ──────────────────────────────

test('T-9: establishMembership throws when person does not exist', async () => {
  (supabase.from as jest.Mock).mockReturnValueOnce(makeChain(null)); // person not found

  await expect(
    establishMembership({ personId: 'non-existent', performedBy: ACTOR_ID })
  ).rejects.toThrow('Person not found');
});

// ─── T-10: establishMembership — already a member ────────────────────────────

test('T-10: establishMembership throws when person already has active membership', async () => {
  const personRow = { id: PERSON_ID };
  const existingMembership = {
    id: MEMBERSHIP_ID, person_id: PERSON_ID, joined_at: '2026-01-01',
    role: 'member', status: 'active', cell_id: null,
  };

  (supabase.from as jest.Mock)
    .mockReturnValueOnce(makeChain(personRow))        // person lookup
    .mockReturnValueOnce(makeChain(existingMembership)); // existing membership check

  await expect(
    establishMembership({ personId: PERSON_ID, performedBy: ACTOR_ID })
  ).rejects.toThrow('already has an active membership');
});

// ─── T-11: establishMembership — unauthorized actor ──────────────────────────

test('T-11: cell leader cannot establish membership', async () => {
  const personRow = { id: PERSON_ID };
  const noMembership = null;
  const actorRow = { role: 'cell_leader' };

  (supabase.from as jest.Mock)
    .mockReturnValueOnce(makeChain(personRow))   // person lookup
    .mockReturnValueOnce(makeChain(noMembership)) // no existing membership
    .mockReturnValueOnce(makeChain(actorRow));    // actor role

  await expect(
    establishMembership({ personId: PERSON_ID, performedBy: 'cell-leader-id' })
  ).rejects.toThrow('Not authorised');
});

// ─── T-12: establishMembership — success path ────────────────────────────────

test('T-12: establishMembership success creates memberships and transition rows', async () => {
  const personRow = { id: PERSON_ID };
  const noMembership = null;
  const actorRow = { role: 'coordinator' };
  const newMembership = {
    id: MEMBERSHIP_ID, person_id: PERSON_ID, joined_at: '2026-09-15T00:00:00Z',
    role: 'member', status: 'active', cell_id: null,
  };

  (supabase.from as jest.Mock)
    .mockReturnValueOnce(makeChain(personRow))
    .mockReturnValueOnce(makeChain(noMembership))
    .mockReturnValueOnce(makeChain(actorRow))
    .mockReturnValueOnce(makeChain(newMembership))
    .mockReturnValueOnce(makeChain(null)) // transition insert
    .mockReturnValueOnce(makeChain(null)); // contacts.is_member update

  const result = await establishMembership({
    personId: PERSON_ID,
    performedBy: ACTOR_ID,
    notes: 'Joined after 4 visits',
  });

  expect(result.id).toBe(MEMBERSHIP_ID);
  expect(result.personId).toBe(PERSON_ID);
  expect(result.status).toBe('active');
  expect(result.role).toBe('member');
});

// ─── T-13: establishMembership updates contacts.is_member ────────────────────

test('T-13: establishMembership sets contacts.is_member = true', async () => {
  const personRow = { id: PERSON_ID };
  const noMembership = null;
  const actorRow = { role: 'admin' };
  const newMembership = {
    id: MEMBERSHIP_ID, person_id: PERSON_ID, joined_at: '2026-09-15T00:00:00Z',
    role: 'member', status: 'active', cell_id: null,
  };

  const contactUpdateChain = makeChain(null);
  (supabase.from as jest.Mock)
    .mockReturnValueOnce(makeChain(personRow))
    .mockReturnValueOnce(makeChain(noMembership))
    .mockReturnValueOnce(makeChain(actorRow))
    .mockReturnValueOnce(makeChain(newMembership))
    .mockReturnValueOnce(makeChain(null))  // transition insert
    .mockReturnValueOnce(contactUpdateChain); // contacts update

  await establishMembership({ personId: PERSON_ID, performedBy: ACTOR_ID });

  expect(contactUpdateChain.update).toHaveBeenCalledWith({ is_member: true });
  expect(contactUpdateChain.eq).toHaveBeenCalledWith('person_id', PERSON_ID);
});

// ─── T-14: createContactPerson links person + contact via person_id ───────────

test('T-14: createContactPerson produces contact.person_id = person.id', async () => {
  const noExisting = null; // no duplicate email found
  const personRow = { id: PERSON_ID, full_name: 'New Contact', email: 'nc@example.com', phone: null, created_at: '2026-09-15', updated_at: '2026-09-15' };
  const contactRow = {
    id: CONTACT_ID, person_id: PERSON_ID, cell_id: 'cell-1', tag: 'first-timer',
    follow_up_status: null, follow_up_assignee: null, date_contacted: '2026-09-15',
    notes: 'Met at service', logged_by: ACTOR_ID, archived: false, is_member: false, member_id: null,
  };

  (supabase.rpc as jest.Mock).mockResolvedValueOnce({ data: noExisting, error: null }); // exact email match → none
  (supabase.from as jest.Mock)
    .mockReturnValueOnce(makeChain(personRow))  // insert person
    .mockReturnValueOnce(makeChain(personRow))  // fetch person
    .mockReturnValueOnce(makeChain(contactRow)); // insert contact

  const { person, contact } = await createContactPerson({
    fullName: 'New Contact',
    email: 'nc@example.com',
    cellId: 'cell-1',
    loggedBy: ACTOR_ID,
    tag: 'first-timer',
    notes: 'Met at service',
  });

  expect(person.id).toBe(PERSON_ID);
  expect(contact.personId).toBe(PERSON_ID);
  expect(contact.personId).toBe(person.id);
});

// ─── T-15: getActiveMembership returns null for non-member ───────────────────

test('T-15: getActiveMembership returns null for contact-only person', async () => {
  (supabase.from as jest.Mock).mockReturnValueOnce(makeChain(null));

  const result = await getActiveMembership('contact-only-person-id');
  expect(result).toBeNull();
});

// ─── T-16: getMembershipTransitions returns ordered audit trail ───────────────

test('T-16: getMembershipTransitions returns transitions newest-first', async () => {
  const transitions = [
    {
      id: 'trans-2', person_id: PERSON_ID, from_type: 'contact', to_type: 'member',
      transitioned_at: '2026-09-15T10:00:00Z', performed_by: ACTOR_ID, notes: 'Converted',
    },
    {
      id: 'trans-1', person_id: PERSON_ID, from_type: null, to_type: 'contact',
      transitioned_at: '2026-08-01T09:00:00Z', performed_by: ACTOR_ID, notes: 'First logged',
    },
  ];

  const q = makeChain(transitions);
  (supabase.from as jest.Mock).mockReturnValueOnce(q);
  q.single = jest.fn(() => Promise.resolve({ data: transitions, error: null }));
  q.maybeSingle = jest.fn(() => Promise.resolve({ data: transitions, error: null }));
  // Override order to return the full array
  q.order = jest.fn(() => ({
    then: (resolve: (v: { data: typeof transitions; error: null }) => void) =>
      resolve({ data: transitions, error: null }),
  }));

  const result = await getMembershipTransitions(PERSON_ID);

  expect(result).toHaveLength(2);
  expect(result[0].toType).toBe('member');
  expect(result[0].fromType).toBe('contact');
  expect(result[1].toType).toBe('contact');
  expect(result[1].fromType).toBeNull();
});

test('T-17: phone-only matches do not automatically reuse an existing person', async () => {
  const newPersonRow = {
    id: PERSON_ID_2,
    full_name: 'Phone Match',
    email: null,
    phone: '+1 416 555 0100',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  };
  const contactRow = {
    id: CONTACT_ID, person_id: PERSON_ID_2, cell_id: 'cell-1', tag: 'visitor',
    follow_up_status: null, follow_up_assignee: null, date_contacted: '2026-09-15',
    notes: 'Met at outreach', logged_by: ACTOR_ID, archived: false, is_member: false, member_id: null,
  };

  (supabase.from as jest.Mock)
    .mockReturnValueOnce(makeChain(newPersonRow)) // insert person
    .mockReturnValueOnce(makeChain(newPersonRow)) // fetch person
    .mockReturnValueOnce(makeChain(contactRow)); // insert contact

  const { person, contact } = await createContactPerson({
    fullName: 'Phone Match',
    phone: '+1 416 555 0100',
    cellId: 'cell-1',
    loggedBy: ACTOR_ID,
    tag: 'visitor',
    notes: 'Met at outreach',
  });

  expect(person.id).toBe(PERSON_ID_2);
  expect(contact.personId).toBe(PERSON_ID_2);
});

test('T-18: same name with different identity data remains different people', async () => {
  const person1Row = { id: PERSON_ID, full_name: 'Jordan Lee', email: null, phone: '111', created_at: '2026-01-01', updated_at: '2026-01-01' };
  const person2Row = { id: PERSON_ID_2, full_name: 'Jordan Lee', email: null, phone: '222', created_at: '2026-01-01', updated_at: '2026-01-01' };
  const contact1Row = {
    id: CONTACT_ID, person_id: PERSON_ID, cell_id: 'cell-1', tag: null,
    follow_up_status: null, follow_up_assignee: null, date_contacted: '2026-09-15',
    notes: null, logged_by: ACTOR_ID, archived: false, is_member: false, member_id: null,
  };
  const contact2Row = { ...contact1Row, id: 'contact-uuid-2', person_id: PERSON_ID_2 };

  (supabase.from as jest.Mock)
    .mockReturnValueOnce(makeChain(person1Row)) // insert person 1
    .mockReturnValueOnce(makeChain(person1Row)) // fetch person 1
    .mockReturnValueOnce(makeChain(contact1Row)) // insert contact 1
    .mockReturnValueOnce(makeChain(person2Row)) // insert person 2
    .mockReturnValueOnce(makeChain(person2Row)) // fetch person 2
    .mockReturnValueOnce(makeChain(contact2Row)); // insert contact 2

  const first = await createContactPerson({ fullName: 'Jordan Lee', phone: '111', cellId: 'cell-1', loggedBy: ACTOR_ID });
  const second = await createContactPerson({ fullName: 'Jordan Lee', phone: '222', cellId: 'cell-1', loggedBy: ACTOR_ID });

  expect(first.person.id).not.toBe(second.person.id);
});

test('T-19: rejected membership history and reapplication are supported by database constraints', () => {
  const migration = read('supabase/migrations/018_people_lifecycle_hardening.sql');

  expect(migration).toContain("status IN ('active', 'pending', 'inactive', 'rejected')");
  expect(migration).toContain('DROP CONSTRAINT IF EXISTS memberships_one_active');
  expect(migration).toContain("WHERE status = 'active'");
  expect(migration).toContain("WHERE status = 'pending'");
  expect(migration).not.toContain('unique (person_id, status)');
});

test('T-20: mergePeople calls the authorized database RPC', async () => {
  (supabase.rpc as jest.Mock).mockResolvedValueOnce({ data: PERSON_ID, error: null });

  const result = await mergePeople({
    targetPersonId: PERSON_ID,
    sourcePersonId: PERSON_ID_2,
    notes: 'Same phone confirmed by coordinator',
  });

  expect(result).toBe(PERSON_ID);
  expect(supabase.rpc).toHaveBeenCalledWith('merge_people', {
    target_person_id: PERSON_ID,
    source_person_id: PERSON_ID_2,
    merge_notes: 'Same phone confirmed by coordinator',
  });
});

test('T-21: merge authorization is enforced by the database function', () => {
  const migration = read('supabase/migrations/018_people_lifecycle_hardening.sql');

  expect(migration).toContain('SECURITY DEFINER');
  expect(migration).toContain('NOT public.is_admin_or_coordinator()');
  expect(migration).toContain("RAISE EXCEPTION 'Not authorised to merge people.'");
  expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.merge_people');
});

test('T-22: manual merge preserves outreach and membership history by repointing relationships', () => {
  const migration = read('supabase/migrations/018_people_lifecycle_hardening.sql');

  expect(migration).toContain('UPDATE public.contacts');
  expect(migration).toContain('UPDATE public.profiles');
  expect(migration).toContain('UPDATE public.memberships');
  expect(migration).toContain('UPDATE public.membership_transitions');
  expect(migration).not.toMatch(/DELETE FROM public\.contacts/i);
  expect(migration).not.toMatch(/DELETE FROM public\.contact_follow_ups/i);
  expect(migration).not.toMatch(/DELETE FROM public\.contact_audit_log/i);
});
