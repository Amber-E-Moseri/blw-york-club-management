# Round 5: release consolidation

## 1. Final branch

| Item | Value |
|---|---|
| Final combined branch | `rc/blwyork-final-combined` |
| Worktree | `C:/Users/moser/Downloads/BLW York-final` |
| Final commit | `08a7c7b` (plus the commit that adds this report and the browser spec; see section 9) |
| Base | `rc/blwyork-combined-release` at `fe034b1` (an ancestor of the remediation branch, so nothing diverged) |
| Remediation branch | `remed/blwyork-authz-045` at `049fd91`, left unchanged |
| RC branch | `rc/blwyork-combined-release` left unchanged |

Integration method: the final branch starts at the remediation head, which already contains the RC history, so no merge or rewrite was needed. Two commits were added on top:

- `69588ea` restores migration 038 to its historical content (section 3).
- `08a7c7b` applies the schema golden after review (section 5).

Nothing was pushed or merged into `main`. The UI redesign branch (`ui/blwyork-hub-redesign`, currently checked out in the main checkout) was not touched. Another session's worktree (`rc/security-consolidation`) was not touched either.

## 2. Exact migration sequence

48 files, `000` to `047`. Versions are unique and contiguous (checked with `ls | sed | sort | uniq -d`, which is empty). Migrations `000`–`037` are unchanged from their historical content.

| Version | File | Status |
|---|---|---|
| 000–037 | historical, unchanged | applied |
| 038 | `038_event_audience_and_notifications.sql` | restored to historical content (sha `109fe796`, identical to `origin/main`) |
| 039 | `039_event_audience_meeting_delete.sql` | forward fix: drops the meeting-audience check |
| 040 | `040_bsc_hierarchy_access.sql` | BSC (renumbered from 038) |
| 041 | `041_bsc_member_views.sql` | BSC (renumbered from 039) |
| 042 | `042_bsc_grants.sql` | BSC (renumbered from 040) |
| 043 | `043_bsc_function_grants.sql` | BSC (renumbered from 041) |
| 044 | `044_bsc_policy_and_search_path.sql` | BSC (renumbered from 042), read-policy fix |
| 045 | `045_authz_active_staff_and_confession_privacy.sql` | F1–F5, confession privacy |
| 046 | `046_foundation_school_onboarding_enrollment.sql` | Foundation School onboarding (T6) |
| 047 | `047_prayer_visibility_active_author_and_cell_scope.sql` | T7, cross-cell prayer scope |

**038 verification.** The candidate's 038 had been edited in place (it dropped the meeting-audience check). The runbook records the hosted copy as applied by hand, and that copy is the historical one with the check. Restoring the historical bytes changes no end state: a fresh replay with the restored 038 gives a fingerprint byte-identical to the replay with the edited copy, and 039 supplies the forward fix. The upgrade path (historical 038, then 039, then 040–044 by hand) was verified in round 2 against a clean replay.

## 3. Migration 038 restore

`git show origin/main:supabase/migrations/038_event_audience_and_notifications.sql` is now the file on the final branch. `git diff origin/main` on that path is empty.

Compatibility: the two copies differ only by the `check` constraints and a comment. 039 drops `events_meeting_audience_requires_meeting`. For a database that applied the historical 038, 039 is the only change needed. For a database that applied the edited copy (none is known), 039's `drop constraint if exists` is a no-op. Both paths were verified.

## 4. Divergence review: candidate and remediation

- The candidate (`fe034b1`) is an ancestor of the remediation head. There are no commits on the candidate that the remediation branch lacks.
- The only functional change required for consolidation is the 038 restore above.
- Working-tree differences: none. The main checkout is on the UI branch and is out of scope.

**Divergence found in D1.** The approved decision is that cell leaders may view leadership prayers "only from their assigned cells". Two definitions of "assigned" exist in the codebase:

| Source | Definition | Used by |
|---|---|---|
| `cells.leader_id` | leader is assigned to the cell | `is_cell_leader_of`, `bscs_manage`, `meetings_manage_scoped`, the quick-add flow (`QuickAddModal.tsx` line 52) |
| `profiles.cell_id` plus `role = cell_leader` | leader belongs to the cell | `is_cell_leader_for_profile`, used by `profiles_select_scoped` and by 047's `prayers_leadership_read` |

Reproduced in a rolled-back transaction (`d1_divergence.sql`):

| Case | Current (047) | Approved D1 says | Result |
|---|---|---|---|
| X: assigned via `cells.leader_id`, no profile `cell_id` | 0 prayers | should see own cell's leadership prayers | **under-grant** |
| Y: profile `cell_id` for cell 2, but `cells.leader_id` for cell 2 is someone else | 1 prayer | should see nothing | **over-grant** |

The over-grant is a security defect against the approved decision.

**Proposed fix (not applied; needs review).** `proposed_048.sql` adds `is_assigned_cell_leader_for_profile(uuid)`, which uses `cells.leader_id` with the author's `profiles.cell_id`, and replaces only `prayers_leadership_read` to use it. Tested in a rolled-back transaction: X = 1, Y = 0. This is a new production-visible permission change, so I did not commit it, as you asked. The same divergence also affects `profiles_select_scoped` (cell leaders' profile visibility). That is a separate decision.

## 5. Golden

The proposed 047 golden was checked against a fresh combined replay before being applied:

- Fresh replay of `000`–`047` (with the restored 038): fingerprint byte-identical to the earlier 047 replay, and to a second replay in the final certification run.
- Diff against the repository golden (`44aa2b9`): 31 entries. Every one maps to an approved migration (listed in the commit `08a7c7b`):
  - BSC (040–044): tables `bscs` and `fellowships`, `cells.fellowship_id`, `profiles.bsc_id`, `guard_profile_bsc_assignment`, `is_bsc_leader_of`, `bsc_members_visible`.
  - F1 (045): status-gated staff policies on cells, people, meetings, email log, admin roles, books of the month, daily pages, monthly devotionals, Foundation School classes, prayers.
  - F2, F3, F4, T5 (045): broad confession read removed, scoped read through `can_view_member`, `confession_declaration_counts`, active-member scope.
  - F5 (045): own devotional, habit, prayer and Foundation School records require an active account.
  - Foundation School (046): enrolment policies split by operation; progress unchanged.
  - Prayers (047): shared requires an active author; leadership requires an active author and staff or the author's cell leader.
- No change outside these: `extensions` unchanged, no `profiles` policy change, events and announcements unchanged.

Applied in commit `08a7c7b`. Checker: 30/30 parity. Jest's schema-contract gate now passes.

## 6. Test totals (fresh replay of `000`–`047`, then the suites in this order)

| Gate | Result |
|---|---|
| Replay `000`–`047` | PASS, 48 migrations |
| Real-schema authorisation matrix | **83/83** |
| BSC effective (real schema) | **37/37** |
| Foundation School onboarding | **35/35** |
| Confession app compatibility | **10/10** |
| SQL: release RLS and people | 33/33 |
| SQL: guard and approval bootstrap | 32/32 |
| SQL: active guard (cert 031/032) | 11/11 |
| SQL: meeting attendance | 9/9 |
| BSC access model (stand-in helpers; not evidence about real policies) | 28/28 |
| Schema fingerprint vs restored-038 replay | byte-identical |
| Schema contract with the repository golden | **30/30** |
| Prayer visibility, real authenticated sessions | **19/19** |
| Notify-event (transpiled) | **45/45** |
| Edge security | **18/18** |
| P0 behavioural | **123/123** |
| P0 boundary | **44/44** |
| Auth workflow | **12/12** |
| Authorisation | **61/61** |
| Email and push | **36/36** |
| Storage | **30/30** |
| Jest, with the real-code integration tests enabled (`CERT_SUPABASE_*` set to the local stack) | **35 of 35 suites, 291 of 291 tests passed, 0 skipped** |
| Jest, default environment (integration tests skip without `CERT_SUPABASE_*`) | **34 of 35 suites passed, 1 skipped; 280 passed, 0 failed, 11 skipped, 291 total** |
| TypeScript (`npm run typecheck`) | PASS, exit 0 |
| Production build | PASS, compiled successfully, **0 warnings** |
| Playwright (all specs, one dev server with local configuration) | **18/18** |
| Responsive (phone width 375 x 812) | 2 tests, 3 pages: My BSC and habits (leader), confessions (member), none scrolls horizontally; plus the release smoke's dashboard check |

The default run skips exactly the 11 integration tests, so 280 + 11 = 291, the same total as the integration run. The integration run is the reference.

Raw logs: `docs/release-consolidation/r5_*.txt`.

**Test-ordering incident (fixed).** The first run executed the SQL suites after the browser and behavioural suites, against a database those suites had written to. The matrix, BSC and guard tests then failed on leftover rows (2 fellowships expected, 18 found). The browser spec now removes the rows it creates in `afterAll`. The certification now replays before the SQL suites, and the reported totals above come from that order.

## 7. Skipped tests

All 11 skipped tests in the default run are one file: `src/__tests__/quickAddRealCode.integration.test.ts` (`describe.skip` unless `CERT_SUPABASE_URL` is a local URL with the anon and service keys).

- **Intentional:** it writes real rows to a database, so it must not run against an unknown host.
- **Coverage gap, closed locally:** it was not run in the default CI-style run. With the variables set to the local stack, all 11 pass against the shipped `createContactPerson`.
- **Recommendation:** run it in CI against a service container, with the same local-only guard.

No other skips exist (checked with `grep` for `skip`, `xit`, `xdescribe`, `todo`).

## 8. Browser coverage added

`e2e/affected-flows.spec.ts` (7 tests, run serially against the local stack, rows cleaned up afterwards):

| Area | Test |
|---|---|
| Confessions (T1, T5) | member sees the confession and "2 declared"; no other member is named |
| Confessions (T1) | pending account held at the approval screen and cannot open confessions |
| BSC (T2, T4) | leader sees own BSC members, including a pending member, and no member of another BSC |
| BSC | ordinary member cannot see the BSC leader list |
| Habits | member sees own habit tracker and template |
| Phone width | leader's My BSC and habits pages do not scroll horizontally |
| Phone width | confessions page does not scroll horizontally |

Not covered, and why:
- **Prayers:** there is no prayer UI route. `getPrayerRequests()` is defined but not called, and the only prayer touchpoint is a dashboard count. Prayer visibility is covered by the real-session test (19/19) and the matrix instead.
- **Foundation School:** no UI exists. Covered by 35 database checks.

## 9. Gaps found in the UI (not fixed; decisions needed)

- **G1. BSC leader role gate.** `AdminBscs` lets any active member be chosen as a BSC leader. `MyBsc` opens only for `admin`, `coordinator` and `cell_leader`, so a BSC leader with the plain member role has database access and no page. The fixture uses `cell_leader`. Decide: promote BSC leaders to `cell_leader`, or gate `MyBsc` on BSC leadership. Changing the gate is production-visible, so it is not done here.
- **G2. Prayer board.** Not routed; see section 8.
- **G3. Divergent cell-leader definitions** (section 4). Blocks release review until 048 is decided.

## 10. Hosted compatibility requirements

Full procedure: `docs/release-consolidation/HOSTED_COMPARISON.md`. Summary, all read-only:

1. Migration history: `select version, name from supabase_migrations.schema_migrations`, then `check_migration_history.mjs`. Stop on any unknown, renamed, gap or old-number BSC entry.
2. Schema: run `schema_fingerprint.sql` (a single `SELECT`), then `check_schema_contract.mjs` against the golden. Expect only the entries in the release report.
3. Policies: the policy dump, diffed against `local_reference_policy_dump.txt` (145 lines).
4. Requirements before any hosted change:
   - a verified backup and recorded migration version;
   - the hosted case (A, B or C, from round 2) confirmed by the history check;
   - for case A, 038 applied by hand with the check, and 039 to follow;
   - 040–047 applied only in order, through an approved path;
   - no history repair without a person's approval;
   - a smoke test on a separate test project before production, including one real device.

## 11. Restricted moderation workflow

Evaluated separately, not implemented: `docs/release-consolidation/MODERATION_WORKFLOW_EVALUATION.md`.

Recommendation: keep option A for this release (inactive and rejected authors' prayers stay hidden and unmoderated). Do not add a staff read of their content (option C). A metadata-only moderation RPC with an audit table (option B) can follow after its own review.

## 12. Release-review GO/NO-GO

**Release review: NO-GO until the D1 decision is made.** The current cell-leader rule over-grants access to a cell leader who is not assigned to the cell (case Y), and it under-grants an assigned leader (case X). Both contradict the approved decision. Proposed fix 048 is tested (X = 1, Y = 0).

Becomes GO if you approve `proposed_048.sql`, or explicitly accept the current rule as the intended meaning of "assigned" (in which case the approved decision text needs to be corrected to match).

Everything else passes review: migrations 038–047 are unique, sequential and forward-only, and the full certification is green on a fresh replay.

## 13. Production GO/NO-GO

**Production: NO-GO.** Blockers:

1. The D1 decision (section 12).
2. Hosted state unverified: history, schema and policies need the read-only checks in `HOSTED_COMPARISON.md`, and hosted application of 038–047 needs its own approval.
3. The Deno-runtime notification test (`NOTIFY_MODE=deno`) has not been run here (Docker host networking). It should run in CI.
4. A hosted test project and a real-device notification smoke test.
5. G1: the BSC leader page gate (decide the role model).
6. Moderation option A, confirmed as the release position.
7. The stand-in `bsc_access_model_test.sql` should be rewritten against the real helpers, or removed. The real-schema suites carry the evidence.

## 14. Remaining steps to finalise

1. Review and decide D1 (approve 048, or correct the approved text).
2. Decide G1 (role model for BSC leaders).
3. Commit this report and the browser spec on `rc/blwyork-final-combined`.
4. Run the hosted read-only checks and decide the hosted case. Apply nothing before approval.
5. Run the Deno-runtime notification test in CI, with the integration tests (`CERT_SUPABASE_*`) on a local service container.
6. Complete the hosted test-project smoke test and the real-device notification test.
7. Re-assess production readiness.
