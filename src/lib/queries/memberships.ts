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
 * Establishes a membership for an existing person (contact → member conversion) through establish_membership.
 *
 * ONE HUMAN = ONE PERSON RECORD: the person's id is unchanged. The database does everything in ONE transaction: it
 * authorizes the caller (admin or coordinator), writes the membership row, writes its transition with performed_by set to
 * the authenticated caller, and sets contacts.is_member. Any failure rolls all of it back. The client sends no actor and
 * writes no table itself. `performedBy` in the input is ignored and kept only for callers that already pass it.
 */
export async function establishMembership(
  input: EstablishMembershipInput
): Promise<MembershipRelationship> {
  const { data: id, error } = await supabase.rpc('establish_membership', {
    p_person_id: input.personId,
    p_status: input.status ?? 'active',
    p_role: input.role ?? 'member',
    p_cell_id: input.cellId ?? null,
    p_notes: input.notes ?? null,
  });
  if (error) throw new Error(error.message);

  const { data: membership, error: readErr } = await supabase
    .from('memberships')
    .select('id, person_id, joined_at, role, status, cell_id')
    .eq('id', id as string)
    .single();
  if (readErr || !membership) {
    throw new Error(readErr?.message ?? 'The membership was written but could not be read back');
  }
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
