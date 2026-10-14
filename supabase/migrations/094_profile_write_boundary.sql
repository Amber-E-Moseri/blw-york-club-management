-- 094_profile_write_boundary.sql
--
-- Forward-only. PROPOSED, NOT APPLIED: diff review and approval first.
--
-- Closes two coordinator bypasses, and the matching service_role paths, at the PRIVILEGE layer rather than by
-- inspecting current_user:
--   1. Direct DELETE on public.profiles. profiles_coordinator_administer (022) is FOR ALL and the API roles hold a
--      table-level DELETE grant (024), so a coordinator could delete a profile directly. No application path deletes one.
--   2. Direct UPDATE of status, cell_id and bsc_id. A coordinator could move a member between cells without the checks
--      in transfer_member_cell, or set a BSC without the checks in assign_member_to_bsc, or change status without the
--      transitions in set_member_status and the approval RPCs. The application changes these only through the RPCs.
--
-- Boundary. The API roles (authenticated, service_role) lose table-level UPDATE and DELETE on profiles and are granted
-- UPDATE only on the columns the application writes directly. A write to any other column is refused by PostgreSQL
-- before RLS or any trigger runs, whatever current_user is, and whatever a client sets in a session variable.
-- The owner-run RPCs keep full access because they are SECURITY DEFINER and owned by postgres:
--   approve_pending_member, reject_pending_member, set_member_status (status);
--   transfer_member_cell(member, cell, reason), assign_pending_applicant_to_cell(member, cell, reason) (cell_id, 093);
--   assign_member_to_bsc (bsc_id).
--
-- Granted directly, unchanged: email, full_name, role, admin_role, avatar_url, joined_at, person_id, student_number.
-- Coordinators still change role and admin_role directly, under the guard in 048 (role changes need an active account).
-- Ordinary self-edit (full_name, student_number, avatar_url) keeps working. The protected-field rules in 048 still apply.
--
-- Not granted to API roles: id, status, cell_id, bsc_id, updated_at (set by trigger). INSERT is unchanged.
--
-- Dependencies: 022 (profiles policies), 024 (table grants), 048 (guard), 055 and 058 (assign_member_to_bsc),
-- 072 (transfer_member_cell), 080 and 083 (set_member_status), 089 and 090 (status guard), 092 and 093 (placement).

-- PUBLIC and anon are listed explicitly, so no inherited grant can restore a direct write.
revoke update, delete on table public.profiles from public, anon, authenticated, service_role;

grant update (email, full_name, role, admin_role, avatar_url, joined_at, person_id, student_number)
  on table public.profiles to authenticated, service_role;
