-- 094_profile_write_boundary.sql
--
-- Forward-only. PROPOSED, NOT APPLIED: diff review and approval first.
--
-- Closes the direct-write bypasses at the PRIVILEGE layer rather than by inspecting current_user:
--   1. Direct DELETE on public.profiles. profiles_coordinator_administer (022) is FOR ALL and the API roles hold a
--      table-level DELETE grant (024), so a coordinator could delete a profile directly. No application path deletes one.
--   2. Direct UPDATE of status, cell_id and bsc_id. A coordinator could move a member between cells without the checks
--      in transfer_member_cell, or set a BSC without the checks in assign_member_to_bsc, or change status without the
--      transitions in set_member_status and the approval RPCs. The application changes these only through the RPCs.
--   3. service_role profile writes. service_role is a backend key, not an operator. It has no application or Edge
--      Function path that writes profiles (verified: no write in supabase/functions or api/). Its UPDATE grant covered
--      role and admin_role, and guard_profile_privileged_columns (048) exempts service_role before its staff checks, so
--      a service_role write could assign a staff role to a pending account. It also covered status, cell and BSC through
--      the owner-only exemption. Fixtures that need profile state use the approved workflow RPCs or a local owner
--      helper (see supabase/verification/lib.mjs), not the service_role key.
--
-- Boundary after this migration:
--   authenticated: table-level INSERT and SELECT (unchanged, see the INSERT note below); column-level UPDATE only on
--                  email, full_name, role, admin_role, avatar_url, joined_at, person_id, student_number. Role and admin_role
--                  stay coordinator-only under 048. Ordinary self-edit (full_name, student_number, avatar_url) keeps working.
--   service_role:  table-level SELECT only. No INSERT, UPDATE or DELETE on profiles.
--   owner-run RPCs keep full access because they are SECURITY DEFINER and owned by postgres:
--     approve_pending_member, reject_pending_member, set_member_status (status);
--     transfer_member_cell(member, cell, reason), assign_pending_applicant_to_cell(member, cell, reason) (cell_id, 093);
--     assign_member_to_bsc (bsc_id).
--
-- INSERT. authenticated keeps table-level INSERT, as the reviewed grant matrix (schema_contract.json) records. A
-- coordinator's FOR ALL policy therefore still allows a direct INSERT of a profile with a status, cell or BSC. This is NOT
-- closed here. It needs a separate review (see the blocker list in the consolidation report) before a guard is adopted.
--
-- A write to any column outside the grants is refused by PostgreSQL before RLS or any trigger runs, whatever current_user
-- is, and whatever a client sets in a session variable.
--
-- Dependencies: 022 (profiles policies), 024 (table grants), 048 (guard), 055 and 058 (assign_member_to_bsc),
-- 072 (transfer_member_cell), 080 and 083 (set_member_status), 089 and 090 (status guard), 092 and 093 (placement).

-- PUBLIC and anon are listed explicitly, so no inherited grant can restore a direct write.
revoke update, delete on table public.profiles from public, anon, authenticated, service_role;
revoke insert on table public.profiles from service_role;

grant update (email, full_name, role, admin_role, avatar_url, joined_at, person_id, student_number)
  on table public.profiles to authenticated;
