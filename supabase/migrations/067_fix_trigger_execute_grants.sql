-- 067_fix_trigger_execute_grants.sql
--
-- Forward-only fixup for migration 062.
--
-- Problem:
--   assignments_completed_at_stamp() was created without revoking the default
--   PUBLIC execute privilege.  PostgreSQL grants EXECUTE to PUBLIC by default on
--   every new function; migration 062 added an explicit service_role grant but
--   never revoked PUBLIC, leaving the security-definer trigger function callable
--   by any role including anon.
--
-- Fix:
--   Revoke PUBLIC/anon/authenticated execute.  The function is called exclusively
--   via its trigger; no direct-call grant is needed by any API role.

revoke all on function public.assignments_completed_at_stamp() from public, anon, authenticated, service_role;
