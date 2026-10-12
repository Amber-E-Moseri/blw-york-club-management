-- 039_event_audience_meeting_delete.sql
--
-- events.audience_meeting_id is `on delete set null`. An earlier version of 038 also added a check that required a
-- meeting whenever audience = 'meeting', so deleting a meeting that an event was aimed at failed with a check
-- violation and blocked the delete.
--
-- Databases that applied that earlier 038 have the constraint, so it is dropped here. On a fresh replay the
-- constraint never exists and this is a no-op.
--
-- An event left with audience = 'meeting' and no meeting is not sent: notify-event refuses it and releases the
-- claim, so no one is notified by accident.

alter table public.events
  drop constraint if exists events_meeting_audience_requires_meeting;
