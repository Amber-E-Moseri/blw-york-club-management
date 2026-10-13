import { supabase } from '../supabase';
import {
  type AudienceChangeResult,
  type MeetingAudienceSelection,
  toPublishParams,
  toSetAudienceParams,
} from '../audience/meetingAudience';
import type { AudiencePerson, Cell, MemberGroup } from '../../types';

/**
 * Previews an audience without writing anything. The database returns the recipient count and what would change.
 * The organizer sees this before anything is sent or published.
 */
export async function previewMeetingAudience(
  meetingId: string,
  selection: MeetingAudienceSelection,
): Promise<AudienceChangeResult> {
  const { data, error } = await supabase.rpc('set_meeting_audience', toSetAudienceParams(meetingId, selection, true));
  if (error) throw new Error(error.message);
  return data as AudienceChangeResult;
}

/**
 * Applies an audience. One transaction in the database: invitations are added, invitees who fall out of the audience
 * are removed (unless they already have a recorded outcome), and access follows immediately.
 */
export async function setMeetingAudience(
  meetingId: string,
  selection: MeetingAudienceSelection,
): Promise<AudienceChangeResult> {
  const { data, error } = await supabase.rpc('set_meeting_audience', toSetAudienceParams(meetingId, selection, false));
  if (error) throw new Error(error.message);
  return data as AudienceChangeResult;
}

/** Publishes a draft. The database refuses an invite-only meeting that has no invitees yet. */
export async function publishMeeting(meetingId: string): Promise<{ published_at: string; recipients: number }> {
  const { data, error } = await supabase.rpc('publish_meeting', toPublishParams(meetingId));
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

export async function fetchMemberGroups(): Promise<MemberGroup[]> {
  const { data, error } = await supabase
    .from('member_groups')
    .select('id, name, created_by, created_at, member_group_members(count)')
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: Record<string, unknown>) => {
    const counts = row.member_group_members as Array<{ count: number }> | undefined;
    return {
      id: row.id as string,
      name: row.name as string,
      created_by: row.created_by as string,
      created_at: row.created_at as string,
      member_count: counts?.[0]?.count ?? 0,
    };
  });
}

export async function createMemberGroup(name: string, createdBy: string): Promise<MemberGroup> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Give the group a name.');
  const { data, error } = await supabase
    .from('member_groups')
    .insert({ name: trimmed, created_by: createdBy })
    .select('id, name, created_by, created_at')
    .single();
  if (error) throw new Error(error.message);
  return data as MemberGroup;
}

/**
 * Makes the group's membership equal to userIds. Only the difference is written, so a failed write never empties the
 * group. Each write is still a separate statement. The database rejects inactive accounts (the policy requires them).
 */
export async function setMemberGroupMembers(
  groupId: string,
  userIds: string[],
  addedBy: string,
): Promise<void> {
  const current = new Set(await fetchGroupMemberIds(groupId));
  const wanted = new Set(userIds);
  const toAdd = userIds.filter((id, i) => userIds.indexOf(id) === i && !current.has(id));
  const toRemove = Array.from(current).filter((id) => !wanted.has(id));

  if (toAdd.length > 0) {
    const { error } = await supabase
      .from('member_group_members')
      .insert(toAdd.map((user_id) => ({ group_id: groupId, user_id, added_by: addedBy })));
    if (error) throw new Error(error.message);
  }
  if (toRemove.length > 0) {
    const { error } = await supabase
      .from('member_group_members')
      .delete()
      .eq('group_id', groupId)
      .in('user_id', toRemove);
    if (error) throw new Error(error.message);
  }
}

export async function fetchGroupMemberIds(groupId: string): Promise<string[]> {
  const { data, error } = await supabase.from('member_group_members').select('user_id').eq('group_id', groupId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => row.user_id as string);
}
