import { supabase } from '../supabase';
import type { Meeting, MeetingInput, MeetingAttendance, MeetingAttendanceStatus } from '../../types';

/** Attendance states that count as "going" for the signed-in user's own button. */
const GOING_STATES: MeetingAttendanceStatus[] = ['confirmed', 'attended'];

export async function fetchMeetings(upcoming = true): Promise<Meeting[]> {
  const today = new Date().toISOString().split('T')[0];
  const userId = (await supabase.auth.getUser()).data.user?.id;

  let q = supabase
    .from('meetings')
    .select('*')
    .order('date', { ascending: true })
    .order('time', { ascending: true });

  if (upcoming) q = q.gte('date', today);

  // Row-level security decides which meetings come back: drafts for organizers only, invite-only meetings for their
  // invitees and organizers, and nothing for pending or rejected accounts.
  const { data, error } = await q;
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
    return meetings.map((meeting) => ({ ...meeting, user_confirmed: false, user_attendance_status: null }));
  }

  const ownStatus = new Map(
    (ownAttendances ?? []).map((row) => [row.meeting_id as string, row.attendance_status as MeetingAttendanceStatus]),
  );
  return meetings.map((meeting) => {
    const status = ownStatus.get(meeting.id) ?? null;
    return {
      ...meeting,
      user_attendance_status: status,
      user_confirmed: status !== null && GOING_STATES.includes(status),
    };
  });
}

export async function fetchMeeting(id: string): Promise<Meeting | null> {
  const { data, error } = await supabase
    .from('meetings').select('*').eq('id', id).single();
  if (error) throw new Error(error.message);
  return data;
}

/** Table columns from the form input. The draft flag is not a column and is removed here. */
function toColumns(input: Partial<MeetingInput>): Record<string, unknown> {
  const { draft: _draft, ...columns } = input;
  const out: Record<string, unknown> = { ...columns };
  if ('end_time' in out && !out.end_time) delete out.end_time;
  if ('location' in out && !out.location) out.location = null;
  if ('zoom_link' in out && !out.zoom_link) out.zoom_link = null;
  return out;
}

export async function createMeeting(
  input: MeetingInput & { created_by: string }
): Promise<Meeting> {
  // A new meeting is published straight away unless it was created as a draft. A draft is published later with
  // publishMeeting(), once its invitations have been previewed.
  const row = { ...toColumns(input), published_at: input.draft ? null : new Date().toISOString() };
  const { data, error } = await supabase.from('meetings').insert(row).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateMeeting(
  id: string,
  input: Partial<MeetingInput>
): Promise<Meeting> {
  // Publication changes only through publishMeeting(), never through an edit.
  const columns = toColumns(input);
  delete columns.published_at;
  const { data, error } = await supabase.from('meetings').update(columns).eq('id', id).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteMeeting(id: string): Promise<void> {
  const { error } = await supabase.from('meetings').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/**
 * The signed-in user says they are going. Works for a public meeting (creates a self registration) and for a meeting
 * they were invited to (moves the invitation to confirmed). Staff-recorded outcomes cannot be overwritten.
 */
export async function confirmAttendance(meetingId: string): Promise<void> {
  const { error } = await supabase.rpc('respond_to_meeting_invitation', {
    p_meeting_id: meetingId,
    p_response: 'confirmed',
  });
  if (error) throw new Error(error.message);
}

/**
 * The signed-in user says they will not attend. The row is kept as 'excused', so an invitation is not lost and the
 * organizers can see the apology.
 */
export async function cancelAttendance(meetingId: string): Promise<void> {
  const { error } = await supabase.rpc('respond_to_meeting_invitation', {
    p_meeting_id: meetingId,
    p_response: 'excused',
  });
  if (error) throw new Error(error.message);
}

export async function fetchAttendances(meetingId: string): Promise<MeetingAttendance[]> {
  const { data, error } = await supabase
    .from('meeting_attendances')
    .select('*')
    .eq('meeting_id', meetingId)
    .order('user_name', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as MeetingAttendance[];
}

/** Records a staff outcome for one invitee or attendee. The legacy boolean is kept in step by the database. */
export async function markAttendanceStatus(
  meetingId: string,
  userId: string,
  status: MeetingAttendanceStatus,
): Promise<void> {
  const { error } = await supabase
    .from('meeting_attendances')
    .update({ attendance_status: status })
    .match({ meeting_id: meetingId, user_id: userId });
  if (error) throw new Error(error.message);
}

/** Boolean form kept for existing callers: true is attended, false is absent. */
export async function markAttended(
  meetingId: string,
  userId: string,
  attended: boolean
): Promise<void> {
  await markAttendanceStatus(meetingId, userId, attended ? 'attended' : 'absent');
}
