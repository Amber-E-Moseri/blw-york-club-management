-- 038_event_audience_and_notifications.sql
--
-- Event audience and push notification tracking.
--
--   audience = 'all'      notify every active member who has push enabled
--   audience = 'meeting'  notify the people assigned to audience_meeting_id (its meeting_attendances)
--
-- notified_at is set once by the notify-event edge function so an event cannot be pushed twice.

alter table public.events
  add column if not exists audience text not null default 'all'
    check (audience in ('all', 'meeting')),
  add column if not exists audience_meeting_id uuid references public.meetings(id) on delete set null,
  add column if not exists notified_at timestamptz;

-- No check ties audience = 'meeting' to a non-null audience_meeting_id. An event whose meeting is deleted keeps
-- audience = 'meeting' with a null meeting, and notify-event refuses to send it. See 039.
