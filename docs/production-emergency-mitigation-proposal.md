# Production profile and prayer visibility: emergency mitigation proposal

Status: PROPOSAL. Not executed. Production HOLD. Owner approval is required before any step is applied.

## Finding

Read-only assessment of the Production catalog export (`blwyork-production-evidence.json`). No hosted access was used.

| # | Path | Effective definition (catalog text) | Demonstrated in local replica | Classification |
|---|------|-------------------------------------|-------------------------------|----------------|
| 1 | `profiles` and `user_profiles` read | `profiles_select_scoped` and `user_profiles_select_scoped` allow `is_cell_leader_for_profile(id)`. That helper grants access when the caller's **role** is `cell_leader` and shares the target's cell. | Yes. A role-only leader with no assignment reads a same-cell member's profile (student number, email), that member's phone and bio, and a pending applicant's profile. Cross-cell members and ordinary members read nothing. | **Demonstrated unauthorized disclosure path** (given the owner's rule that the role alone confers no cell authority). |
| 2 | `prayer_requests` read | `prayers_leadership_read` allows any account whose **role** is `cell_leader` to read every leadership or shared request, across cells, with no anonymity exclusion. | Yes. A role-only leader reads leadership requests from another cell and an anonymous leadership request, which exposes its `author_id`. | **Demonstrated unauthorized disclosure path** (identity of anonymous authors). |
| 3 | Other `cell_leader`-role references (`meetings_manage_scoped`, `prayers`, and others) | Mixed: some are role branches restricted to rows the account created, others use `is_cell_leader_of`. | Not tested. | Outdated-policy review; not in this emergency scope. |

Scope limits, stated plainly:
- The replica is built from the exact helper and policy text in the export. It uses a minimal schema and an approximation of `is_admin_or_coordinator` (the export does not contain its body). Results for leaders do not depend on that approximation.
- Whether a live Production account currently matches the role-only path depends on data. **Read-only owner check (count only, no personal data):** `select count(*) from public.profiles where role = 'cell_leader' and status = 'active';` and `select count(*) from public.profiles p where p.role = 'cell_leader' and p.status = 'active' and exists (select 1 from public.profiles m where m.cell_id = p.cell_id and m.id <> p.id);`. A count of zero for the second query means path 1 has no current data exposure.

## Proposed mitigation

Files (in the repository, not applied):
- `supabase/verification/emergency/production_profile_mitigation.sql`
- `supabase/verification/emergency/production_prayer_mitigation.sql`

Profile part: replaces the two role-based read policies with the self-or-staff policies already defined by candidate migration 070. Prayer part: removes the role-based leadership read and gives staff the same visibility rule.

Impact:
- Staff (admin, coordinator): unchanged.
- Each user's own profile: unchanged.
- Role-only `cell_leader` accounts: lose reads of other members' profiles and leadership prayers. These reads were not authorized under the owner's rule.
- Assigned cell leaders with the ordinary member role: no change in Production today, because the Production helper never matched them. They gain nothing from this step; their access comes from the reconciled candidate.
- Other Production policies are not changed. Those under item 3 remain for the planned upgrade.
- Application impact: the leader Members list and leader prayer views stop returning other members. Expected, because those reads were not authorized.

Tests (local replica, rerunnable):
- `supabase/verification/emergency/production_profile_replica.test.mjs` (before, after, rolled back).
- `supabase/verification/emergency/production_prayer_replica.test.mjs` (before, after, rolled back).

Results recorded during assessment:
- Profiles: role-only leader reads member profile, user profile and pending applicant before; reads none after; self and admin unchanged; rollback restores the exposure.
- Prayers: role-only leader sees 4 of 4 before, including the anonymous request with `author_id`; sees none after; admin sees 4 of 4; rollback restores.

Rollback:
- `supabase/verification/emergency/production_profile_rollback.sql`
- `supabase/verification/emergency/production_prayer_rollback.sql`
Both restore the exact catalog USING expressions.

Execution (after owner approval only): run the two mitigation files in the Production SQL editor, each inside its own transaction, then run the two owner count queries above, then verify with a staff account and a non-staff account. Keep the rollback files ready.
