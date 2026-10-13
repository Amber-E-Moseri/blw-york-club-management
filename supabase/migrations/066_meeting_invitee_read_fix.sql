-- 066_meeting_invitee_read_fix.sql
--
-- Forward-only fix for circular RLS dependency introduced in migration 061.
--
-- Problem:
--   meetings_explicit_invitee_read checks meeting_attendances via RLS.
--   meeting_attendances_select_scoped checks meetings via RLS.
--   Each depends on the other, so PostgreSQL resolves both to empty sets,
--   leaving invited members unable to see explicit meetings or their own
--   attendance rows.
--
-- Fix:
--   Introduce is_meeting_invitee(p_meeting_id) as SECURITY DEFINER so it reads
--   meeting_attendances directly without going through RLS.
--   Rewrite meetings_explicit_invitee_read to use the helper.
--   No change to meeting_attendances_select_scoped — its meetings subquery
--   now resolves cleanly because the meetings policy no longer triggers the loop.

-- ── 1. Helper: invitee check bypasses meeting_attendances RLS ────────────────

create or replace function public.is_meeting_invitee(p_meeting_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.meeting_attendances
    where meeting_id = p_meeting_id
      and user_id = auth.uid()
  );
$$;

revoke all on function public.is_meeting_invitee(uuid) from public, anon;
grant execute on function public.is_meeting_invitee(uuid) to authenticated, service_role;

-- ── 2. Replace meetings_explicit_invitee_read with loop-free version ─────────

drop policy if exists meetings_explicit_invitee_read on public.meetings;
create policy meetings_explicit_invitee_read on public.meetings
  for select
  to authenticated
  using (
    visibility = 'explicit'
    and public.is_active_member()
    and public.is_meeting_invitee(id)
  );
