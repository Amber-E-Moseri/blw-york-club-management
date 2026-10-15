import { supabase } from '../supabase';
import {
  type AudienceChangeResult,
  type AudienceMode,
  type AudienceSelection,
  toSetAudienceParams,
} from '../audience/audienceContract';
import type { AudiencePerson, Cell, SavedGroup } from '../../types';

/**
 * Previews an audience without changing invitations. The database returns the recipient count and what would change.
 * Nothing is written, not even the audience spec.
 */
export async function previewMeetingAudience(
  meetingId: string,
  selection: AudienceSelection,
): Promise<AudienceChangeResult> {
  const { data, error } = await supabase.rpc('set_meeting_audience', toSetAudienceParams(meetingId, selection, true));
  if (error) throw new Error(error.message);
  return data as AudienceChangeResult;
}

/**
 * Applies an audience. In one transaction the database writes a new immutable audience spec, reconciles invitations to
 * it, and points the meeting at it. Recipients who have a recorded outcome cannot be removed.
 */
export async function setMeetingAudience(
  meetingId: string,
  selection: AudienceSelection,
): Promise<AudienceChangeResult> {
  const { data, error } = await supabase.rpc('set_meeting_audience', toSetAudienceParams(meetingId, selection, false));
  if (error) throw new Error(error.message);
  return data as AudienceChangeResult;
}

/**
 * Reads the audience a meeting was last saved with, so reopening the panel shows it again. Returns null when the meeting
 * has no saved spec. audience_specs is readable by admins and coordinators only (RLS), so for anyone else the row is
 * hidden and the panel keeps its defaults.
 */
export async function fetchSavedMeetingAudience(meetingId: string): Promise<AudienceSelection | null> {
  const { data: meeting, error: meetingError } = await supabase
    .from('meetings')
    .select('audience_spec_id')
    .eq('id', meetingId)
    .maybeSingle();
  if (meetingError) throw new Error(meetingError.message);
  const specId = (meeting as { audience_spec_id: string | null } | null)?.audience_spec_id ?? null;
  if (!specId) return null;

  const { data: spec, error: specError } = await supabase
    .from('audience_specs')
    .select('mode, cell_ids, group_ids, profile_ids')
    .eq('id', specId)
    .maybeSingle();
  if (specError) throw new Error(specError.message);
  if (!spec) return null;

  const row = spec as {
    mode: AudienceMode;
    cell_ids: string[] | null;
    group_ids: string[] | null;
    profile_ids: string[] | null;
  };
  return {
    mode: row.mode,
    cellIds: row.cell_ids ?? [],
    groupIds: row.group_ids ?? [],
    profileIds: row.profile_ids ?? [],
  };
}

/** Publishes a draft. The database refuses an invite-only meeting that has no invitees yet. */
export async function publishMeeting(meetingId: string): Promise<{ published_at: string; recipients: number }> {
  const { data, error } = await supabase.rpc('publish_meeting', { p_meeting_id: meetingId });
  if (error) throw new Error(error.message);
  return data as { published_at: string; recipients: number };
}

export async function fetchCells(): Promise<Cell[]> {
  const { data, error } = await supabase.from('cells').select('id, name, leader_id').order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Cell[];
}

/** Active accounts only. Staff pick specific members from this list. */
export async function fetchActiveAudiencePeople(): Promise<AudiencePerson[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, cell_id')
    .eq('status', 'active')
    .order('full_name', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as AudiencePerson[];
}

/** Saved groups (operational table saved_groups). Staff only, enforced by RLS. */
export async function fetchSavedGroups(): Promise<SavedGroup[]> {
  const { data, error } = await supabase
    .from('saved_groups')
    .select('id, name, description, created_by, is_active, created_at, saved_group_members(count)')
    .eq('is_active', true)
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: Record<string, unknown>) => {
    const counts = row.saved_group_members as Array<{ count: number }> | undefined;
    return {
      id: row.id as string,
      name: row.name as string,
      description: (row.description as string | null) ?? null,
      created_by: row.created_by as string,
      is_active: row.is_active as boolean,
      created_at: row.created_at as string,
      member_count: counts?.[0]?.count ?? 0,
    };
  });
}

export async function createSavedGroup(name: string, createdBy: string): Promise<SavedGroup> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Give the group a name.');
  const { data, error } = await supabase
    .from('saved_groups')
    .insert({ name: trimmed, created_by: createdBy })
    .select('id, name, description, created_by, is_active, created_at')
    .single();
  if (error) throw new Error(error.message);
  return data as SavedGroup;
}

export async function fetchSavedGroupMemberIds(groupId: string): Promise<string[]> {
  const { data, error } = await supabase.from('saved_group_members').select('profile_id').eq('group_id', groupId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => row.profile_id as string);
}

/**
 * Makes the group's membership equal to profileIds. Only the difference is written, so a failed write never empties the
 * group. The database accepts members through the staff-only policy on saved_group_members.
 */
export async function setSavedGroupMembers(groupId: string, profileIds: string[], addedBy: string): Promise<void> {
  const current = new Set(await fetchSavedGroupMemberIds(groupId));
  const wanted = new Set(profileIds);
  const toAdd = profileIds.filter((id, i) => profileIds.indexOf(id) === i && !current.has(id));
  const toRemove = Array.from(current).filter((id) => !wanted.has(id));

  if (toAdd.length > 0) {
    const { error } = await supabase
      .from('saved_group_members')
      .insert(toAdd.map((profile_id) => ({ group_id: groupId, profile_id, added_by: addedBy })));
    if (error) throw new Error(error.message);
  }
  if (toRemove.length > 0) {
    const { error } = await supabase
      .from('saved_group_members')
      .delete()
      .eq('group_id', groupId)
      .in('profile_id', toRemove);
    if (error) throw new Error(error.message);
  }
}
