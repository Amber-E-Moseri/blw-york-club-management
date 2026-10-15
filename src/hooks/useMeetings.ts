import { useState, useEffect, useCallback } from 'react';
import type { Meeting, MeetingInput, MeetingAttendance } from '../types';
import {
  fetchMeetings, createMeeting, updateMeeting, deleteMeeting,
  confirmAttendance, cancelAttendance, fetchAttendances,
} from '../lib/queries/meetings';

export function useMeetings(upcoming = true) {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setMeetings(await fetchMeetings(upcoming));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load meetings.');
    } finally {
      setLoading(false);
    }
  }, [upcoming]);

  useEffect(() => { load(); }, [load]);

  const save = useCallback(async (
    input: MeetingInput & { created_by: string },
    id?: string
  ) => {
    if (id) {
      const updated = await updateMeeting(id, input);
      setMeetings((prev) => prev.map((m) => (m.id === id ? updated : m)));
    } else {
      const created = await createMeeting(input);
      setMeetings((prev) => [...prev, created]);
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    await deleteMeeting(id);
    setMeetings((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const confirm = useCallback(async (meetingId: string, userId: string, userName: string) => {
    await confirmAttendance(meetingId, userId, userName);
    setMeetings((prev) =>
      prev.map((m) =>
        m.id === meetingId
          ? {
              ...m,
              user_confirmed: true,
              attendance_count:
                typeof m.attendance_count === 'number' ? m.attendance_count + 1 : m.attendance_count,
            }
          : m
      )
    );
  }, []);

  const cancel = useCallback(async (meetingId: string, userId: string) => {
    await cancelAttendance(meetingId, userId);
    setMeetings((prev) =>
      prev.map((m) =>
        m.id === meetingId
          ? {
              ...m,
              user_confirmed: false,
              attendance_count:
                typeof m.attendance_count === 'number'
                  ? Math.max(0, m.attendance_count - 1)
                  : m.attendance_count,
            }
          : m
      )
    );
  }, []);

  return { meetings, loading, error, refetch: load, save, remove, confirm, cancel };
}

export function useMeetingAttendances(meetingId: string | null) {
  const [attendances, setAttendances] = useState<MeetingAttendance[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!meetingId) return;
    setLoading(true);
    fetchAttendances(meetingId)
      .then(setAttendances)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [meetingId]);

  return { attendances, loading };
}
