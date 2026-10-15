import { supabase } from '../supabase';
import type { Meeting, MeetingInput, MeetingAttendance } from '../../types';

export async function fetchMeetings(upcoming = true): Promise<Meeting[]> {
  const today = new Date().toISOString().split('T')[0];
  const userId = (await supabase.auth.getUser()).data.user?.id;

  let q = supabase
    .from('meetings')
    .select('*')
    .order('date', { ascending: true })
    .order('time', { ascending: true });

  if (upcoming) q = q.gte('date', today);

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  const meetings = (data ?? []) as Meeting[];
  if (!userId || meetings.length === 0) return meetings;

  const { data: ownAttendances, error: attendanceError } = await supabase
    .from('meeting_attendances')
    .select('meeting_id')
    .eq('user_id', userId)
    .in('meeting_id', meetings.map((meeting) => meeting.id));

  if (attendanceError) {
    console.warn('Unable to load meeting attendance status', attendanceError.message);
    return meetings.map((meeting) => ({ ...meeting, user_confirmed: false }));
  }

  const confirmedMeetingIds = new Set((ownAttendances ?? []).map((row) => row.meeting_id as string));
  return meetings.map((meeting) => ({
    ...meeting,
    user_confirmed: confirmedMeetingIds.has(meeting.id),
  }));
}

export async function fetchMeeting(id: string): Promise<Meeting | null> {
  const { data, error } = await supabase
    .from('meetings').select('*').eq('id', id).single();
  if (error) throw new Error(error.message);
  return data;
}

function normalizeInput<T extends Partial<MeetingInput>>(input: T): T {
  const out = { ...input };
  if ('end_time' in out && !out.end_time) delete out.end_time;
  if ('location' in out && !out.location) (out as Record<string, unknown>).location = null;
  if ('zoom_link' in out && !out.zoom_link) (out as Record<string, unknown>).zoom_link = null;
  return out;
}

export async function createMeeting(
  input: MeetingInput & { created_by: string }
): Promise<Meeting> {
  const { data, error } = await supabase
    .from('meetings').insert(normalizeInput(input)).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateMeeting(
  id: string,
  input: Partial<MeetingInput>
): Promise<Meeting> {
  const { data, error } = await supabase
    .from('meetings').update(normalizeInput(input)).eq('id', id).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteMeeting(id: string): Promise<void> {
  const { error } = await supabase.from('meetings').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function confirmAttendance(
  meetingId: string,
  userId: string,
  userName: string
): Promise<void> {
  const { error } = await supabase
    .from('meeting_attendances')
    .upsert(
      { meeting_id: meetingId, user_id: userId, user_name: userName },
      { onConflict: 'meeting_id,user_id', ignoreDuplicates: true },
    );
  if (error) throw new Error(error.message);
}

export async function cancelAttendance(meetingId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('meeting_attendances')
    .delete()
    .match({ meeting_id: meetingId, user_id: userId });
  if (error) throw new Error(error.message);
}

export async function fetchAttendances(meetingId: string): Promise<MeetingAttendance[]> {
  const { data, error } = await supabase
    .from('meeting_attendances')
    .select('*')
    .eq('meeting_id', meetingId)
    .order('confirmed_at', { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function markAttended(
  meetingId: string,
  userId: string,
  attended: boolean
): Promise<void> {
  const { error } = await supabase
    .from('meeting_attendances')
    .update({ attended })
    .match({ meeting_id: meetingId, user_id: userId });
  if (error) throw new Error(error.message);
}
