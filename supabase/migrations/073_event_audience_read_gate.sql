-- 072_event_audience_read_gate.sql
--
-- Owner workstream: Shared audience infrastructure / Meetings
-- Dependencies:    017 (events_read), 038 and 060 (events.audience, audience_meeting_id, audience_spec_id),
--                  068 (resolve_audience_all), 072 (can_view_meeting, is_meeting_manager, is_in_audience_spec)
-- Contract ref:    docs/ops-shared-contracts.md §2, §10
--
-- Forward-only. events_read (017) lets every authenticated account read every event, so the title, time and place of an
-- event aimed at a private meeting or a targeted audience are visible to unrelated members.
--
-- After this migration an event is readable by:
--   * everyone authenticated when audience = 'all' (unchanged, so a pending account can still reach the approval screen);
--   * admins and coordinators, always;
--   * audience = 'meeting': anyone who can view that meeting (can_view_meeting, which requires an active account);
--   * the spec-based audiences (cells, saved_groups, explicit): active members that the spec resolves to.
-- Writes are unchanged (events_manage, 035).

drop policy if exists events_read on public.events;
create policy events_read
  on public.events
  for select
  to authenticated
  using (
    audience = 'all'
    or public.is_admin_or_coordinator()
    or (
      audience = 'meeting'
      and audience_meeting_id is not null
      and public.can_view_meeting(audience_meeting_id)
    )
    or (
      audience_spec_id is not null
      and public.is_active_member()
      and public.is_in_audience_spec(audience_spec_id, auth.uid())
    )
  );
