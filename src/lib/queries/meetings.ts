import { supabase } from '../supabase';
import type { Meeting, MeetingInput, MeetingAttendance, MeetingAttendanceStatus } from '../../types';
import { toLocalDateKey } from '../dates';

// Upcoming: meetings dated today or later, soonest first. Past: meetings dated before today, most recent first.
export async function fetchMeetings(upcoming = true): Promise<Meeting[]> {
  const today = toLocalDateKey();
  const userId = (await supabase.auth.getUser()).data.user?.id;

  const base = supabase.from('meetings').select('*');
  const dated = upcoming ? base.gte('date', today) : base.lt('date', today);
  const { data, error } = await dated
    .order('date', { ascending: upcoming })
    .order('time', { ascending: upcoming });
  if (error) throw new Error(error.message);

  const meetings = (data ?? []) as Meeting[];
  if (!userId || meetings.length === 0) return meetings;

  const { data: ownAttendances, error: attendanceError } = await supabase
    .from('meeting_attendances')
    .select('meeting_id, attendance_status')
    .eq('user_id', userId)
    .in('meeting_id', meetings.map((meeting) => meeting.id));

  if (attendanceError) {
    console.warn('Unable to load meeting attendance status', attendanceError.message);
    return meetings.map((meeting) => ({ ...meeting, user_confirmed: false }));
  }

  const attendanceByMeetingId = new Map(
    (ownAttendances ?? []).map((row) => [row.meeting_id as string, row.attendance_status as MeetingAttendanceStatus])
  );
  return meetings.map((meeting) => {
    const status = attendanceByMeetingId.get(meeting.id) ?? null;
    return {
      ...meeting,
      user_attendance_status: status,
      user_confirmed: status === 'confirmed' || status === 'attended',
    };
  });
}

export async function fetchMeeting(id: string): Promise<Meeting | null> {
  const { data, error } = await supabase
    .from('meetings').select('*').eq('id', id).single();
  if (error) throw new Error(error.message);
  return data;
}

function normalizeInput<T extends Partial<MeetingInput>>(input: T): Omit<T, 'draft' | 'published_at'> {
  const out = { ...input } as Record<string, unknown>;
  if ('end_time' in out && !out.end_time) delete out.end_time;
  if ('location' in out && !out.location) out.location = null;
  if ('zoom_link' in out && !out.zoom_link) out.zoom_link = null;
  delete out.draft;
  delete out.published_at;
  return out as Omit<T, 'draft' | 'published_at'>;
}

export async function createMeeting(
  input: MeetingInput & { created_by: string }
): Promise<Meeting> {
  const isDraft = (input as unknown as Record<string, unknown>).draft === true;
  const row = {
    ...normalizeInput(input),
    published_at: isDraft ? null : new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('meetings').insert(row).select().single();
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

export async function confirmAttendance(meetingId: string): Promise<void> {
  const { error } = await supabase
    .rpc('respond_to_meeting_invitation', { p_meeting_id: meetingId, p_response: 'confirmed' });
  if (error) throw new Error(error.message);
}

export async function cancelAttendance(meetingId: string): Promise<void> {
  const { error } = await supabase
    .rpc('respond_to_meeting_invitation', { p_meeting_id: meetingId, p_response: 'excused' });
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
    .update({ attendance_status: attended ? 'attended' : 'absent' })
    .match({ meeting_id: meetingId, user_id: userId });
  if (error) throw new Error(error.message);
}

export async function markAttendanceStatus(
  meetingId: string,
  userId: string,
  status: MeetingAttendanceStatus
): Promise<void> {
  const { error } = await supabase
    .from('meeting_attendances')
    .update({ attendance_status: status })
    .match({ meeting_id: meetingId, user_id: userId });
  if (error) throw new Error(error.message);
}
