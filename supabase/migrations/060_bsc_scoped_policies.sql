-- 060_bsc_scoped_policies.sql
-- Least-privilege BSC writes. Forward-only. Replaces the broad bscs_manage policy (ALL, from 040 and re-created by 044)
-- with per-operation policies that match the approved scoped model.
--
-- Why: bscs_manage let a cell leader DELETE any BSC row in their own cell. The approved model lets a cell leader insert
-- and update BSCs in their own cell, and reserves deletion for administrators and coordinators. Core administrators keep
-- full access, as before. Every predicate still requires an active account, because is_cell_leader_of() requires an
-- active member and is_admin_or_coordinator() depends on the caller's active role.
--
-- Unchanged: bscs_read (044, active members can read). No table, column, data or ledger change.

drop policy if exists bscs_manage on public.bscs;

create policy bscs_insert_scoped on public.bscs
  for insert to authenticated
  with check (public.is_core_admin() or public.is_admin_or_coordinator() or public.is_cell_leader_of(cell_id));

create policy bscs_update_scoped on public.bscs
  for update to authenticated
  using (public.is_core_admin() or public.is_admin_or_coordinator() or public.is_cell_leader_of(cell_id))
  with check (public.is_core_admin() or public.is_admin_or_coordinator() or public.is_cell_leader_of(cell_id));

create policy bscs_delete_staff on public.bscs
  for delete to authenticated
  using (public.is_core_admin() or public.is_admin_or_coordinator());
