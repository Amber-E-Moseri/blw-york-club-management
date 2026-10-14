/**
 * Membership client tests. Authorization, the membership row, its transition and the contact flag are written by the
 * database in ONE transaction (establish_membership). These unit tests pin the client contract: the exact RPC payload, no
 * actor sent from the client, database errors passed through unchanged, and no direct write to contacts or transitions.
 * The database behaviour (authorization, atomic rollback, attribution, read isolation) is certified in
 * supabase/verification/f2_suite_membership.sql, which runs against disposable databases.
 *
 * - T-4  Establishing membership keeps the person id (ONE HUMAN = ONE PERSON RECORD)
 * - T-9  Person not found: the database error reaches the caller
 * - T-10 Already an active member: the database error reaches the caller
 * - T-11 Non-staff caller: the database refusal reaches the caller
 * - T-12 Success: exact RPC payload, membership read back
 * - T-13 The client writes no contact flag and no transition itself (the database does, atomically)
 * - T-14 The client never sends performed_by; the database records the authenticated caller
 * - T-15 getActiveMembership: returns null for a non-member person
 * - T-16 getMembershipTransitions: returns the audit trail newest first
 * - T-20 mergePeople calls the authorized database RPC
 */

import { establishMembership, getActiveMembership, getMembershipTransitions, mergePeople } from '../lib/queries/memberships';
import { supabase } from '../lib/supabase';

jest.mock('../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

const PERSON_ID = 'person-uuid-1';
const PERSON_ID_2 = 'person-uuid-2';
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

const membershipRow = {
  id: MEMBERSHIP_ID, person_id: PERSON_ID, joined_at: '2026-09-15T00:00:00Z',
  role: 'member', status: 'active', cell_id: null,
};

afterEach(() => jest.clearAllMocks());

// ─── T-4: establishing membership keeps the person id ─────────────────────────

test('T-4: establishing membership does not change person_id', async () => {
  (supabase.rpc as jest.Mock).mockResolvedValueOnce({ data: MEMBERSHIP_ID, error: null });
  (supabase.from as jest.Mock).mockReturnValueOnce(makeChain(membershipRow));

  const result = await establishMembership({ personId: PERSON_ID, performedBy: ACTOR_ID });

  expect(supabase.rpc).toHaveBeenCalledWith('establish_membership', expect.objectContaining({ p_person_id: PERSON_ID }));
  expect(result.personId).toBe(PERSON_ID);
});

// ─── T-9: person not found ────────────────────────────────────────────────────

test('T-9: establishMembership surfaces the database refusal when the person does not exist', async () => {
  (supabase.rpc as jest.Mock).mockResolvedValueOnce({ data: null, error: { message: 'Person not found.' } });

  await expect(establishMembership({ personId: 'non-existent', performedBy: ACTOR_ID })).rejects.toThrow('Person not found.');
  expect(supabase.from).not.toHaveBeenCalled();
});

// ─── T-10: already an active member ───────────────────────────────────────────

test('T-10: establishMembership surfaces the one-active-membership refusal unchanged', async () => {
  (supabase.rpc as jest.Mock).mockResolvedValueOnce({
    data: null,
    error: { message: 'duplicate key value violates unique constraint "memberships_one_active_per_person"' },
  });

  await expect(establishMembership({ personId: PERSON_ID, performedBy: ACTOR_ID }))
    .rejects.toThrow('memberships_one_active_per_person');
  expect(supabase.from).not.toHaveBeenCalled();
});

// ─── T-11: non-staff caller ───────────────────────────────────────────────────

test('T-11: a cell leader is refused by the database, and the client writes nothing', async () => {
  (supabase.rpc as jest.Mock).mockResolvedValueOnce({
    data: null,
    error: { message: 'You are not authorised for identity review.' },
  });

  await expect(establishMembership({ personId: PERSON_ID, performedBy: 'cell-leader-id' }))
    .rejects.toThrow('You are not authorised');
  expect(supabase.from).not.toHaveBeenCalled();
});

// ─── T-12: success path ───────────────────────────────────────────────────────

test('T-12: establishMembership sends the exact payload and returns the membership read back', async () => {
  (supabase.rpc as jest.Mock).mockResolvedValueOnce({ data: MEMBERSHIP_ID, error: null });
  const readBack = makeChain(membershipRow);
  (supabase.from as jest.Mock).mockReturnValueOnce(readBack);

  const result = await establishMembership({
    personId: PERSON_ID,
    performedBy: ACTOR_ID,
    notes: 'Joined after 4 visits',
    role: 'member',
    status: 'active',
  });

  expect(supabase.rpc).toHaveBeenCalledWith('establish_membership', {
    p_person_id: PERSON_ID,
    p_status: 'active',
    p_role: 'member',
    p_cell_id: null,
    p_notes: 'Joined after 4 visits',
  });
  expect(readBack.eq).toHaveBeenCalledWith('id', MEMBERSHIP_ID);
  expect(result.id).toBe(MEMBERSHIP_ID);
  expect(result.status).toBe('active');
  expect(result.role).toBe('member');
});

// ─── T-13: the client writes no contact flag and no transition ────────────────

test('T-13: the client writes neither contacts.is_member nor membership_transitions; the database does, in the same transaction', async () => {
  (supabase.rpc as jest.Mock).mockResolvedValueOnce({ data: MEMBERSHIP_ID, error: null });
  (supabase.from as jest.Mock).mockReturnValueOnce(makeChain(membershipRow));

  await establishMembership({ personId: PERSON_ID, performedBy: ACTOR_ID });

  const tablesTouched = (supabase.from as jest.Mock).mock.calls.map((c) => c[0]);
  expect(tablesTouched).toEqual(['memberships']);
  expect(tablesTouched).not.toContain('contacts');
  expect(tablesTouched).not.toContain('membership_transitions');
});

// ─── T-14: the client never sends an actor ────────────────────────────────────

test('T-14: performed_by is never sent; the database records the authenticated caller', async () => {
  (supabase.rpc as jest.Mock).mockResolvedValueOnce({ data: MEMBERSHIP_ID, error: null });
  (supabase.from as jest.Mock).mockReturnValueOnce(makeChain(membershipRow));

  await establishMembership({ personId: PERSON_ID, performedBy: 'someone-else' });

  const payload = (supabase.rpc as jest.Mock).mock.calls[0][1] as Record<string, unknown>;
  expect(Object.keys(payload).sort()).toEqual(['p_cell_id', 'p_notes', 'p_person_id', 'p_role', 'p_status']);
  expect(JSON.stringify(payload)).not.toContain('someone-else');
});

// ─── T-15: getActiveMembership returns null for a non-member ──────────────────

test('T-15: getActiveMembership returns null for contact-only person', async () => {
  (supabase.from as jest.Mock).mockReturnValueOnce(makeChain(null));

  const result = await getActiveMembership('contact-only-person-id');
  expect(result).toBeNull();
});

// ─── T-16: transition history newest first ────────────────────────────────────

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
// checks. They are executable database checks now: f2_suite_membership.sql H09-H10, M01-M04 and G02-G09.

// ─── T-20: merge ──────────────────────────────────────────────────────────────

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
