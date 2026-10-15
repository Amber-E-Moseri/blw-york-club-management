import { supabase } from '../supabase';
import type {
  MembershipRelationship,
  MembershipTransition,
  EstablishMembershipInput,
  MergePeopleInput,
} from '../../types/person';

// ─── Membership read ──────────────────────────────────────────────────────────

export async function getActiveMembership(personId: string): Promise<MembershipRelationship | null> {
  const { data } = await supabase
    .from('memberships')
    .select('id, person_id, joined_at, role, status, cell_id')
    .eq('person_id', personId)
    .eq('status', 'active')
    .maybeSingle();
  return data ? mapMembership(data) : null;
}

// ─── Membership establishment ─────────────────────────────────────────────────

/**
 * Establishes a membership for an existing person (contact → member conversion).
 *
 * ONE HUMAN = ONE PERSON RECORD: this does not create a new people row.
 * The person's id is unchanged. Only a memberships row is added.
 *
 * Also writes a membership_transitions audit row and updates
 * contacts.is_member + contacts.member_id for the legacy bridge.
 */
export async function establishMembership(
  input: EstablishMembershipInput
): Promise<MembershipRelationship> {
  // Guard: person must exist
  const { data: person, error: personErr } = await supabase
    .from('people')
    .select('id')
    .eq('id', input.personId)
    .maybeSingle();
  if (personErr || !person) throw new Error('Person not found');

  const requestedStatus = input.status ?? 'active';

  // Guard: not already in the same open membership state
  const existing = await getActiveMembership(input.personId);
  if (existing) throw new Error('Person already has an active membership');
  if (requestedStatus === 'pending') {
    const pending = await getPendingMembership(input.personId);
    if (pending) throw new Error('Person already has a pending membership');
  }

  // Guard: acting user must be coordinator or admin
  const { data: actor } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', input.performedBy)
    .maybeSingle();
  if (!actor || !['coordinator', 'admin'].includes(actor.role as string)) {
    throw new Error('Not authorised to establish membership');
  }

  // Insert membership
  const { data: membership, error: membershipErr } = await supabase
    .from('memberships')
    .insert({
      person_id: input.personId,
      role: input.role ?? 'member',
      status: requestedStatus,
      cell_id: input.cellId ?? null,
    })
    .select('id, person_id, joined_at, role, status, cell_id')
    .single();

  if (membershipErr || !membership) {
    throw new Error(membershipErr?.message ?? 'Membership insert failed');
  }

  // Write audit transition
  await supabase.from('membership_transitions').insert({
    person_id: input.personId,
    from_type: 'contact',
    to_type: requestedStatus === 'pending' ? 'pending_membership' : 'member',
    performed_by: input.performedBy,
    notes: input.notes ?? null,
  });

  // Update legacy bridge on contacts row (backward-compat)
  // Finds the contact row for this person (if any) and sets is_member + member_id.
  // member_id cannot be set here since we no longer create profiles rows in this path.
  // We set is_member = true and leave member_id null for new-path conversions.
  await supabase
    .from('contacts')
    .update({ is_member: true })
    .eq('person_id', input.personId);

  return mapMembership(membership);
}

export async function getPendingMembership(personId: string): Promise<MembershipRelationship | null> {
  const { data } = await supabase
    .from('memberships')
    .select('id, person_id, joined_at, role, status, cell_id')
    .eq('person_id', personId)
    .eq('status', 'pending')
    .maybeSingle();
  return data ? mapMembership(data) : null;
}

export async function mergePeople(input: MergePeopleInput): Promise<string> {
  const { data, error } = await supabase.rpc('merge_people', {
    target_person_id: input.targetPersonId,
    source_person_id: input.sourcePersonId,
    merge_notes: input.notes ?? null,
  });

  if (error) throw new Error(error.message);
  return data as string;
}

// ─── Transition history ───────────────────────────────────────────────────────

export async function getMembershipTransitions(personId: string): Promise<MembershipTransition[]> {
  const { data, error } = await supabase
    .from('membership_transitions')
    .select('id, person_id, from_type, to_type, transitioned_at, performed_by, notes')
    .eq('person_id', personId)
    .order('transitioned_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapTransition);
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function mapMembership(row: Record<string, unknown>): MembershipRelationship {
  return {
    id: row['id'] as string,
    personId: row['person_id'] as string,
    joinedAt: row['joined_at'] as string,
    role: row['role'] as MembershipRelationship['role'],
    status: row['status'] as MembershipRelationship['status'],
    cellId: (row['cell_id'] as string | null) ?? null,
  };
}

function mapTransition(row: Record<string, unknown>): MembershipTransition {
  return {
    id: row['id'] as string,
    personId: row['person_id'] as string,
    fromType: (row['from_type'] as string | null) ?? null,
    toType: row['to_type'] as string,
    transitionedAt: row['transitioned_at'] as string,
    performedBy: (row['performed_by'] as string | null) ?? null,
    notes: (row['notes'] as string | null) ?? null,
  };
}
