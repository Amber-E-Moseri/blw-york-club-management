-- 067_event_audience_read_gate.sql
--
-- Owner workstream: Shared Audience Infrastructure / Meetings
-- Dependencies:    059 (resolve_audience), 060 (events.audience_spec_id), 066 (is_meeting_manager, is_meeting_participant)
-- Contract ref:    docs/ops-shared-contracts.md §1, §3, §4, §10 (E2E-14, E2E-15)
--
-- Forward-only. The events_read policy from 017 lets every authenticated account read every event. That exposes
-- the title, time and location of events that are aimed at a restricted meeting or at a targeted audience.
--
-- After this migration an event is readable by:
--   * everyone authenticated, when audience = 'all' (unchanged, so pending accounts can still reach the approval screen);
--   * admins and coordinators, always;
--   * for audience = 'meeting': the people who can see that meeting (its managers and its participants);
--   * for the spec-based modes (cells, saved_groups, explicit): the active members resolve_audience() returns for the
--     event's audience_spec_id.
-- Pending, rejected and inactive accounts read nothing except 'all' events. Writes are unchanged (events_manage, 035).

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
      and (
        public.is_meeting_manager(audience_meeting_id)
        or public.is_meeting_participant(audience_meeting_id)
      )
    )
    or (
      audience_spec_id is not null
      and public.is_active_member()
      and exists (
        select 1 from public.resolve_audience(audience_spec_id) r
        where r.profile_id = auth.uid()
      )
    )
  );

-- ─── Trigger function from 062 ───────────────────────────────────────────────────────────────────────────────────────
-- assignments_completed_at_stamp() is a trigger function. 062 created it without revoking PUBLIC EXECUTE, so it was
-- callable by anon. Trigger functions run from the table trigger and need no API execute grant.
revoke all on function public.assignments_completed_at_stamp() from public, anon, authenticated, service_role;
