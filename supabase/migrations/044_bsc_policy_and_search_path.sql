-- 044_bsc_policy_and_search_path.sql
--
-- Follow-up to 038–041, found by the schema contract check:
--   1. BSC and fellowship reads accepted any signed-in account
--      (auth.role() = 'authenticated'). Reads now require an active, approved member,
--      as every other read policy does.
--   2. The BSC helper functions were pinned to search_path=public. They now pin
--      public, pg_temp like the other SECURITY DEFINER functions.
--
-- Grants and EXECUTE rules are unchanged (ALTER FUNCTION keeps existing ACLs).

-- ─── Read policies ───────────────────────────────────────────────────────────

drop policy if exists bscs_read on public.bscs;
create policy bscs_read on public.bscs
  for select using (public.is_active_member());

drop policy if exists fellowships_read on public.fellowships;
create policy fellowships_read on public.fellowships
  for select using (public.is_active_member());

-- ─── Search path on SECURITY DEFINER helpers ─────────────────────────────────

alter function public.bsc_members_visible() set search_path = public, pg_temp;
alter function public.can_view_member(uuid) set search_path = public, pg_temp;
alter function public.is_bsc_leader_of(uuid) set search_path = public, pg_temp;
