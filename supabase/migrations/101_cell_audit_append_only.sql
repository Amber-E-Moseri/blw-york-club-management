-- 101_cell_audit_append_only.sql
--
-- Forward-only. Changes no earlier migration. Migrations 000-100 are unchanged.
--
-- Gap. cell_admin_audit (072) and member_cell_audit (072) have no append-only guard. The table owner can still UPDATE
-- or DELETE their rows. The other audit tables are guarded: communication_audit (087) and contact_attribution_audit,
-- person_identity_audit and the identity audits (097). service_role already has no UPDATE or DELETE on these two tables.
--
-- Fix. Attach the existing refusal function from 097 (_f2_refuse_audit_mutation) to both tables, for every role. INSERT
-- is kept: the writers are the audit triggers. Neither table has a foreign key, so no cascade is refused.
--
-- Not carried from PR #6 076: its audience-oracle changes (S1) are not needed on this lineage, because F2 082 already
-- restricts meeting_audience_spec to the meeting's manager and the invitation policy uses meeting_roster_allowed (074).
-- Its audit_refuse_mutation duplicates _f2_refuse_audit_mutation and is not created here.

-- Explicit, so the grant state is recorded even though it already holds.
revoke update, delete on public.cell_admin_audit, public.member_cell_audit from service_role;

drop trigger if exists cell_admin_audit_append_only on public.cell_admin_audit;
create trigger cell_admin_audit_append_only
  before update or delete on public.cell_admin_audit
  for each row execute function public._f2_refuse_audit_mutation();

drop trigger if exists member_cell_audit_append_only on public.member_cell_audit;
create trigger member_cell_audit_append_only
  before update or delete on public.member_cell_audit
  for each row execute function public._f2_refuse_audit_mutation();
