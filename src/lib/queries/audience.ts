import { supabase } from '../supabase';
import { toCreateSpecArgs } from '../audience/spec';
import type { AudienceSpecDraft } from '../../types/audience';

// Data access for targeted affirmations and saved groups. Staff only; RLS and the 076 RPCs enforce it.
// Targeting is a spec (kinds and exclusions). The database derives the recipients and freezes them (075).

export interface SavedAudienceGroup {
  id: string;
  name: string;
  created_by: string;
  is_active: boolean;
  member_ids: string[];
}

export interface AudienceCell {
  id: string;
  name: string;
}

/** Active cells only. An archived cell takes no members and cannot be targeted (072). */
export async function fetchAudienceCells(): Promise<AudienceCell[]> {
  const { data, error } = await supabase
    .from('cells')
    .select('id, name')
    .is('archived_at', null)
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as AudienceCell[];
}

export async function fetchSavedAudienceGroups(): Promise<SavedAudienceGroup[]> {
  const { data, error } = await supabase
    .from('saved_groups')
    .select('id, name, created_by, is_active, members:saved_group_members(profile_id)')
    .eq('is_active', true)
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as {
    id: string; name: string; created_by: string; is_active: boolean; members: { profile_id: string }[];
  }[]).map((g) => ({
    id: g.id,
    name: g.name,
    created_by: g.created_by,
    is_active: g.is_active,
    member_ids: g.members.map((m) => m.profile_id),
  }));
}

/** Creates the group and its members in one statement (create_saved_group, 076). */
export async function createSavedAudienceGroup(input: { name: string; memberIds: string[] }): Promise<string> {
  const { data, error } = await supabase.rpc('create_saved_group', {
    p_name: input.name.trim(),
    p_member_ids: input.memberIds,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/**
 * Creates one affirmation with its frozen audience, in one transaction (create_targeted_affirmation, 076).
 * The spec argument names match create_audience_spec(), so the draft goes through unchanged.
 */
export async function createTargetedAffirmation(input: {
  title: string;
  body: string;
  scheduledDate: string;
  audience: AudienceSpecDraft;
}): Promise<string> {
  const { data, error } = await supabase.rpc('create_targeted_affirmation', {
    p_title: input.title,
    p_body: input.body,
    p_scheduled_date: input.scheduledDate,
    ...toCreateSpecArgs(input.audience),
  });
  if (error) throw new Error(error.message);
  return data as string;
}
