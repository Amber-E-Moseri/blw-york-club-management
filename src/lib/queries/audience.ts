import { supabase } from '../supabase';
import { toAudiencePayload, type AudienceDraft } from '../audience/audienceRules';

// Data access for targeted affirmations and saved groups. Staff only; RLS and create_affirmation enforce it.

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

export async function fetchAudienceCells(): Promise<AudienceCell[]> {
  const { data, error } = await supabase.from('cells').select('id, name').order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as AudienceCell[];
}

export async function fetchSavedAudienceGroups(): Promise<SavedAudienceGroup[]> {
  const { data, error } = await supabase
    .from('saved_audience_groups')
    .select('id, name, created_by, is_active, members:saved_audience_group_members(user_id)')
    .eq('is_active', true)
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as {
    id: string; name: string; created_by: string; is_active: boolean; members: { user_id: string }[];
  }[]).map((g) => ({
    id: g.id,
    name: g.name,
    created_by: g.created_by,
    is_active: g.is_active,
    member_ids: g.members.map((m) => m.user_id),
  }));
}

/** Creates the group and its members in one transaction (create_saved_audience_group RPC). */
export async function createSavedAudienceGroup(input: { name: string; memberIds: string[] }): Promise<string> {
  const { data, error } = await supabase.rpc('create_saved_audience_group', {
    p_name: input.name.trim(),
    p_member_ids: input.memberIds,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/** Creates one affirmation and its recipients in one transaction (create_affirmation RPC). Returns the new id. */
export async function createTargetedAffirmation(input: {
  title: string;
  body: string;
  scheduledDate: string;
  audience: AudienceDraft;
}): Promise<string> {
  const { data, error } = await supabase.rpc('create_affirmation', {
    p_title: input.title,
    p_body: input.body,
    p_scheduled_date: input.scheduledDate,
    ...toAudiencePayload(input.audience),
  });
  if (error) throw new Error(error.message);
  return data as string;
}
