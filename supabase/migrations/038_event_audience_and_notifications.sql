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

alter table public.events
  drop constraint if exists events_meeting_audience_requires_meeting;

alter table public.events
  add constraint events_meeting_audience_requires_meeting
    check (audience = 'all' or audience_meeting_id is not null);
