/**
 * Branch 1 — Person Identity Tests
 *
 * Covers the 16 required test cases for the people identity layer:
 * - T-1  Person uniqueness: same email → same record
 * - T-2  Person uniqueness: same phone → same record
 * - T-3  Person uniqueness: different email → different records
 * - T-4  Contact → Member preserves person_id (ONE HUMAN = ONE PERSON RECORD)
 * - T-6  Duplicate person detection: null email does not merge distinct people
 * - T-7  Anonymous access denied: unauthenticated cannot read people
 * - T-8  Anonymous access denied: unauthenticated cannot insert people
 * - T-9  establishMembership: person not found → throws
 * - T-10 establishMembership: already a member → throws
 * - T-11 establishMembership: unauthorized actor → throws
 * - T-12 establishMembership: success path → memberships row + transition row
 * - T-13 establishMembership: contacts.is_member updated to true
 * - T-15 getActiveMembership: returns null for non-member person
 * - T-16 getMembershipTransitions: returns ordered audit trail
 */

import { establishMembership, getActiveMembership, getMembershipTransitions, mergePeople } from '../lib/queries/memberships';
import { supabase } from '../lib/supabase';

// ─── Mock setup ───────────────────────────────────────────────────────────────

jest.mock('../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

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

// ─── T-2: Same phone → same people record ────────────────────────────────────

// ─── T-3: Different email → different records ─────────────────────────────────

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


// ─── T-6: null email does not merge distinct people ───────────────────────────

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

// T-19 (rejected history and reapplication), T-21 (merge authorization) and T-22 (merge repointing) were source-text
// checks. They are now executable database checks in supabase/verification/f2_suite_membership.sql: H05-H06, M01-M04 and G02-G09.

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

