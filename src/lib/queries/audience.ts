import { supabase } from '../supabase';
import { toCreateSpecArgs } from '../audience/spec';
import type { AudienceCandidate, AudienceCell, AudienceSavedGroup, AudienceSpecDraft } from '../../types/audience';
import type { Member } from '../../types';

// Data access for the shared audience model (migrations 059, 068, 071, 072). Staff only for writes.
// The database re-checks every rule; nothing here is authoritative.

export async function fetchAudienceCells(): Promise<AudienceCell[]> {
  const { data, error } = await supabase
    .from('cells')
    .select('id, name, leader_id')
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as { id: string; name: string; leader_id: string | null }[]).map((c) => ({
    id: c.id,
    name: c.name,
    leaderId: c.leader_id,
  }));
}

/** Active saved groups with their member ids. Staff can read these; members cannot (066). */
export async function fetchSavedGroups(): Promise<AudienceSavedGroup[]> {
  const { data, error } = await supabase
    .from('saved_groups')
    .select('id, name, is_active, members:saved_group_members(profile_id)')
    .eq('is_active', true)
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as {
    id: string; name: string; is_active: boolean; members: { profile_id: string }[];
  }[]).map((g) => ({
    id: g.id,
    name: g.name,
    isActive: g.is_active,
    memberIds: g.members.map((m) => m.profile_id),
  }));
}

/** Creates a group and its members in one call (create_saved_group, migration 071). Returns the new id. */
export async function createSavedGroup(input: { name: string; memberIds: string[] }): Promise<string> {
  const { data, error } = await supabase.rpc('create_saved_group', {
    p_name: input.name.trim(),
    p_member_ids: input.memberIds,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/** Freezes an audience as a spec (create_audience_spec, migration 071). Returns the spec id. */
export async function createAudienceSpec(draft: AudienceSpecDraft): Promise<string> {
  const { data, error } = await supabase.rpc('create_audience_spec', toCreateSpecArgs(draft));
  if (error) throw new Error(error.message);
  return data as string;
}

/** Candidates for the selector. Only active profiles are offered; the server checks every id again. */
export function audienceCandidatesFromMembers(members: Member[]): AudienceCandidate[] {
  return members
    .filter((m) => (m as Member & { status?: string }).status === 'active')
    .map((m) => ({
      id: m.id,
      fullName: m.full_name || m.id,
      email: m.email ?? null,
      cellId: m.cell_id ?? null,
      status: 'active' as const,
    }));
}
