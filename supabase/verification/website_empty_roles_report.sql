-- Read-only report: roles that hold no permissions at all (website or operational).
-- Run in the Supabase SQL Editor as a read-only query, against the Preview or production project, and review the output.
-- This file changes nothing. Nothing here deletes or alters a role.
--
-- A role with no permissions cannot be told apart by the database from an operational role that was deliberately left
-- empty. So the report lists every empty, non-built-in role. Review each row by name and creator before acting.
--
-- Recovery for a role that IS a website role that was created empty (before migration 059):
--   1. Give it its intended website permissions as a core administrator, through the Hub:
--        select public.web_set_website_role_permissions('<role id>', array['website.pages.edit'], 'Recovery: set intended permissions');
--      The function is atomic and refuses an empty set, so the role is never left empty again.
--   2. If the role is not wanted, retire it instead. Retirement needs the role to hold a website permission (step 1) and
--      no assignments; it is audited:
--        select public.web_retire_website_role('<role id>', 'Recovery: unused role retired');
--   Do not delete the admin_roles row directly: that bypasses the audit trail.

select
  r.id,
  r.name,
  r.description,
  r.created_at,
  r.created_by,
  (select count(*) from public.admin_role_assignments a where a.role_id = r.id) as assignments,
  (select count(*) from public.web_audit_log l where l.target = r.id::text and l.action = 'role.created') as created_audit_rows
from public.admin_roles r
where r.is_system = false
  and not exists (select 1 from public.admin_role_permissions p where p.role_id = r.id)
order by r.created_at;
