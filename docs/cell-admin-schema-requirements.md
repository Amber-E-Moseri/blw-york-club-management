# Cell administration: schema requirements (for Agent 6)

Status: **not migrated.** No migration number is claimed here. Agent 6 assigns the number after checking
`rc/blwyork-canonical`, which holds migrations 039–058. This branch (`ui/blwyork-hub-redesign`) stops at 038.

The UI in `src/pages/Cells.tsx` works on the current schema. The items below close gaps the UI cannot close alone.

## Already enforced on this branch (no migration needed)

- `cells_manage` (005): only coordinators can insert, update or delete cells.
- `profiles_guard_privileged_columns` (028): only admins and coordinators can change `profiles.cell_id`.
- `profiles_staff_edit_audit` (028): staff edits to `cell_id` are written to `staff_profile_edit_audit`.
- `member_directory` (016): cell leaders see only members of cells they lead.

## Gaps that need a migration

1. **Archive a cell.** `cells` has no archive column. Add `archived_at timestamptz null`, and have the cell list
   and member pickers filter on it. The UI deliberately omits archive until this exists.
2. **Pending and rejected members cannot be placed in a cell (server side).** The UI blocks it, but
   `profiles.cell_id` accepts any profile. Add a guard that rejects a non-null `cell_id` unless the target profile
   is `active`.
3. **Leader must be active (server side).** Canonical migration 049 adds `guard_leader_assignment` for
   `cells.leader_id`. This branch has no such trigger; port it.
4. **Cell create, rename and leader changes are not audited.** Add a `cell_admin_audit` table (actor, action,
   cell id, before and after values) with triggers on `cells`.
5. **Member transfer should be one transaction.** Today it is a single profile update, so it is atomic. If a
   Bible Study Class (BSC) layer is added, a transfer must also clear the BSC in the same RPC.

## Bible Study Class safeguards

BSC tables, `profiles.bsc_id` and the `assign_member_to_bsc` RPC exist only on the canonical branch (migrations
040–058). This branch has none of them, so the transfer safeguards cannot be tested here. Before this feature
ships on the canonical branch, a transfer must:

- clear the member's BSC assignment, or refuse the transfer while assigned (canonical 058 refuses a cell change
  while assigned, so the UI must call the RPC that clears it first);
- go through the audited RPC, never a direct `bsc_id` update.
