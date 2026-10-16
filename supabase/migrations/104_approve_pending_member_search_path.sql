-- 104_approve_pending_member_search_path.sql
--
-- Owner workstream: release security gates (forward-only)
-- Dependencies:    016 (approve_pending_member, security definer), 103 (replacement body with the approval gate)
--
-- Problem closed: approve_pending_member(uuid) is SECURITY DEFINER and was pinned to search_path = public (016, 103).
-- The schema contract requires every definer function to pin search_path to pg_catalog, public, so that built-in
-- operators and types always resolve from pg_catalog first.
--
-- This changes configuration only. The function body, its grants (authenticated only) and its owner are untouched.
-- Historical migrations are not edited; this statement is the only change.

alter function public.approve_pending_member(uuid) set search_path = pg_catalog, public;
