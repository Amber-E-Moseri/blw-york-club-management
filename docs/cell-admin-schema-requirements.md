# Cell administration: schema requirements and status

Status: **migrated as 073** on `integ/blwyork-cell-unified-port`, on top of `integ/blwyork-unified-candidate` (migrations 000–070).
Migrations 071 and 072 are claimed by uncommitted work in other worktrees and are left free. Migration 073 is the next
number that no ref or worktree claims. The migration-contiguity test fails until 071 and 072 are resolved.

The first version of this file (cell UI commit `7684b69`) listed the gaps. This version records where each rule is now
enforced. It is the source for the certification checks.

## Where each rule is enforced

| Rule | Enforced by | Notes |
| --- | --- | --- |
| Admins and coordinators manage cells (create, rename, leader, archive, delete) | `cells_manage` policy (073), uses `is_admin_or_coordinator()` | 045 allowed coordinators only. Active accounts only, because the helper checks `status = 'active'`. |
| Only active members are placed in a cell | `profiles_guard_member_cell_placement` trigger (073) | Fires on insert and on change of `cell_id`. Pending and rejected accounts cannot be placed. |
| A leader must be an active account | `cells_guard_leader_assignment` trigger (049) | Already present in the baseline. |
| A leader who stops being active loses the cell | `profiles_release_cell_leadership` trigger (073) | Clears `cells.leader_id`. The change is audited. The member keeps their cell and loses access through `is_active_member()`. |
| Transfer or removal of a member in a Bible Study Class | `guard_profile_bsc_assignment` (058), and `transfer_member_cell` RPC (073) | The RPC refuses first, with a clear message. The UI blocks it earlier and names the class. |
| Transfer or removal of a member who leads a cell | `transfer_member_cell` RPC (073), and the UI check | Refused until a new leader is assigned to each led cell. |
| Atomic transfer with authorization and audit | `transfer_member_cell(member, cell)` RPC (073) | One transaction: authorization, status, BSC and leadership checks, one row update, row-count check. |
| Archive a cell | `cells.archived_at` and `guard_cell_lifecycle` (073) | Archiving needs zero members and zero BSCs. An archived cell cannot be given a leader. Clearing one is allowed. |
| Delete a cell | `guard_cell_lifecycle` (073) | Refused while members or BSCs exist. Deleting would null `profiles.cell_id` and cascade `bscs` without an audit record. Archive instead. |
| Archived cells are hidden from pickers | `fetchCells`, `listCells` (client) | An archived cell has no members, so the audience and announcement functions (059, 064) cannot reach it. |
| Cell create, rename, archive and leader changes are audited | `cell_admin_audit` and `cells_admin_audit` trigger (073) | Before and after values, with the actor. Readable by active admins and coordinators. |
| Every member cell change is audited | `member_cell_audit` and `profiles_member_cell_audit` trigger (073) | Covers the RPC and any direct write. The staff edit audit (028) does not track `cell_id`, so it could not be relied on. |
| Zero-row writes are reported as failures | Client (`maybeSingle` plus row-count check) | RLS denial returns no error, so a missing row is an error. |

## Bible Study Class checks

- A member cannot change cell while `profiles.bsc_id` is set (058). A cell transfer must first clear the class with
  `assign_member_to_bsc(member, null)` (055, 058). That RPC is the only path that changes `bsc_id`.
- The Cells page loads class names with `bsc_members_visible()` (058). The RPC returns only rows the viewer may see. A
  missing name is not proof that a member has no class, so the transfer RPC still refuses.

## Not yet done

- The Cells page has no control to clear a BSC from the cell screen. Staff use the Bible Study Classes page
  (`/admin/bscs`).
- A rejected member who is still in a cell keeps that placement. Only placement changes are guarded. Removal is allowed.
- Archive and restore have no end-to-end test yet. They need the certification run.
- `schema_fingerprint.golden.json` and `schema_contract.json` must be regenerated after a clean replay.
