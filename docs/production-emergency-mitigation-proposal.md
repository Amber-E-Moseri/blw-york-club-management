# Production profile and prayer visibility: emergency mitigation v2 (compatibility-checked)

Status: PROPOSAL. Not executed. Production HOLD. Owner approval and the two read-only counts are required first.

## Why v1 was withdrawn

v1 replaced the profile policies with self-or-staff. That was tested against a local replica and it would have removed access that the deployed Production app relies on. The Production `member_directory` view (`security_invoker`) also calls the same role-based helper, so v1 would have changed the directory as well. v2 is the smallest change that removes the role-based grant and keeps assigned leaders working.

## Findings (catalog definitions; local replica, not the live database)

1. `is_cell_leader_for_profile(target)` grants access when the caller's **role** is `cell_leader` and shares the target's cell. It is called by `profiles_select_scoped`, `user_profiles_select_scoped`, and the `member_directory` view. Demonstrated: a role-only leader with no assignment reads a same-cell member's profile, user profile (phone, bio), and a pending applicant's profile. This is an unauthorized disclosure path under the owner's rule.
2. `prayers_leadership_read` grants any `cell_leader` account every leadership and shared request across cells. Demonstrated: it exposes an anonymous leadership request with its `author_id`.

## v2 change

- `supabase/verification/emergency/production_profile_v2_helper.sql`: replaces only the body of `is_cell_leader_for_profile`. The three call sites are unchanged. Access requires the caller to be an active account and `cells.leader_id = caller`, with the target active. Pending, rejected and inactive targets are hidden from leaders. The role label is not consulted.
- `supabase/verification/emergency/production_prayer_v2.sql`: replaces the role-based prayer read. Staff are unchanged. An assigned leader sees non-anonymous requests only. Leadership requests are limited to members of cells the leader leads. Shared requests are readable by any active assigned leader. Role-only accounts with no assignment see nothing.

## Compatibility (replica results)

| Reader | Read | Before | v2 | Verdict |
|---|---|---|---|---|
| Assigned leader (role `cell_leader`) | cell member directory | 6, including pending | 5, pending hidden | Retained, pending protected |
| Assigned leader (role `cell_leader`) | member phone (user profile) | 1 | 1 | Retained |
| Assigned leader (role `member`) | own cell directory | 0 (no access today) | 2 | Access gained, as the approved model grants |
| Role-only, unassigned | cell directory | 6 (exposed) | 1 (self only) | Unauthorized access removed |
| Role-only, unassigned | member profile / user profile | 1 / 1 | 0 / 0 | Removed |
| Any non-admin | pending applicant profile | 1 (exposed) | 0 | Protected |
| Cross-cell leader | member of other cell | 0 | 0 | Unchanged |
| Ordinary member | other member | 0 | 0 | Unchanged |
| Self | own profile | 1 | 1 | Unchanged |
| Admin | all profiles including pending | 10 | 10 | Unchanged |
| Assigned leader | leadership prayers | 5 (includes anonymous, cross-cell) | 2 (own cell, non-anonymous) | Anonymous identity protected |
| Role-only | prayers | 5 (exposed) | 0 | Removed |
| Assigned leader B | own-cell leadership prayer | 5 | 2 (own cell and shared) | Retained |
| Admin | prayers | 5 | 5 | Unchanged |
| Ordinary member | prayers | 0 | 0 | Unchanged |

Notes:
- The existing deployed Production app gates its leader pages by role. The assigned-leader cases above are the data the app's own queries would receive. This emergency step does not change the app.
- Assigned leaders with the member role now see their cell's directory data. The old UI still hides the Members page from them, so no new page is exposed.

## Residual exposure, not fixed by v2

Assigned leaders can still read a member's `student_number`, from both `profiles` and `user_profiles`. The replica confirms this. It is a separate over-disclosure of a protected attribute. A column-level revoke would also break self-profile reads of `student_number`, which the app selects, so it needs a design change. Recorded for the planned upgrade, not part of this emergency step.

## Files

- Mitigation: `supabase/verification/emergency/production_profile_v2_helper.sql`, `supabase/verification/emergency/production_prayer_v2.sql`
- Rollback: `supabase/verification/emergency/production_profile_v2_rollback.sql` (restores the exported helper body), `supabase/verification/emergency/production_prayer_rollback.sql` (restores the exported policy)
- Catalog text used by the replica: `production_is_cell_leader_for_profile.catalog.sql`, `production_member_directory.catalog.sql`
- Replica test: `supabase/verification/emergency/production_mitigation_v2.replica.mjs` (`MODE=current` and `MODE=v2`)

## Owner-run read-only checks (counts only, no personal data)

1. `select count(*) from public.profiles where role = 'cell_leader' and status = 'active';`
2. `select count(*) from public.profiles p where p.role = 'cell_leader' and p.status = 'active' and not exists (select 1 from public.cells c where c.leader_id = p.id);`

Query 2 is the number of role-only leaders affected by the change. Zero means the change has no current effect on any account, and only prevents future exposure.

## Execution (after approval only)

Run `production_profile_v2_helper.sql` and then `production_prayer_v2.sql`, each in its own transaction, in the Production SQL editor. Verify with one staff account and one assigned leader account. Keep the rollback files ready.
