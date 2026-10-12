# BLW York Hub: authorisation remediation (F1–F5)

**Branch:** `remed/blwyork-authz-045`, worktree `C:/Users/moser/Downloads/BLW York-remed`, based on `fe034b1`.
**Nothing committed yet** at the time of writing (see section 8). The release candidate `rc/blwyork-combined-release` is untouched.
**Not done:** no hosted change, no push, no merge, no golden written into the repository, no change to any migration file that existed before.

## 1. Verdict

**NO-GO for production, still.** Every check this round passes, including the new real-schema matrix (68/68). The blockers are decisions and approvals, not failing tests (section 7):

1. Approve migration 045 and the app change (F2 counts).
2. Confirm four permission tradeoffs (section 5), one of which changes an older certification.
3. Approve the golden (the proposed one passes parity 30/30; it has not been written).
4. Run the hosted read-only checks and the history comparison (unchanged from round 2).

## 2. Implementation summary

| Requirement | What changed | Where |
|---|---|---|
| **F1** staff requires active account | 19 policies that compared `profiles.role` inline (no status test) now call the status-gated helpers `is_coordinator()`, `is_admin_or_coordinator()`, `is_devotional_admin()`, or `current_user_role()`. Scope is unchanged. Covers Book of the Month, cells, meetings, email log, devotional reads, admin role tables, people delete, prayers, Foundation School, daily pages and monthly devotionals. | `supabase/migrations/045_…sql` (part F1) |
| **F2** confession privacy | Broad read `confession_declarations_read` (any active member read every row) is dropped. Members read their own row. Leaders and staff keep scoped reads. A new `SECURITY DEFINER` function returns per-confession **counts only**, over active members. The app no longer embeds other members' rows. | migration 045; `src/lib/queries/confessions.ts` |
| **F3** BSC leaders | `can_view_member` now requires an active caller and an active member. Inactive, pending and rejected leaders see nothing. | migration 045 |
| **F4** pending members | `bsc_members_visible()` lists pending and active members in the caller's scope, profile fields only, for onboarding. Pending members' devotional, confession, habit, enrolment and prayer records are hidden from everyone except the account itself, and then only once active. | migration 045 |
| **F5** pending self-access | Own profile read and the pending self-onboarding update are unchanged. Own devotional, habit, prayer and Foundation School records are unreadable and unwritable until active. | migration 045 |

**Cross-table helper fix (found during testing).** Some new policies used `EXISTS (SELECT … FROM profiles …)` to check another member's status. Under `profiles` RLS, a teacher cannot see a student's row, so the check failed closed and broke the teacher's view. I replaced those checks with the existing security-definer helper `is_active_profile(uuid)`.

**Counts restricted to active members.** The first draft counted every declaration row, which let a member infer that a pending account had declared something. The count now excludes non-active accounts.

### Files modified or added (exact)

| Status | File |
|---|---|
| new | `supabase/migrations/045_authz_active_staff_and_confession_privacy.sql` |
| modified | `src/lib/queries/confessions.ts` |
| new | `src/__tests__/confessionPrivacy.test.ts` (4 tests) |
| new | `supabase/verification/authz_status_matrix_test.sql` (68 checks) |
| modified | `supabase/verification/bsc_effective_rls_test.sql` (3 expectations, see 5.1) |
| modified | `supabase/verification/cert_031_032_active_guard.sql` (1 expectation, see 5.1) |
| modified | `supabase/verification/schema_contract.json` (1 line: the new counts function) |
| new | `docs/release-remediation/REMEDIATION_REPORT.md` (this file) |
| new | `docs/release-remediation/proposed_schema_fingerprint_045.golden.json` (not written to the repo) |
| new | `docs/release-remediation/*_run.txt` (raw run logs, see section 6) |

No file under `supabase/migrations/` that existed before was changed. `git diff --name-status fe034b1 -- supabase/migrations` is empty.

## 3. Authorisation matrix (real schema, rolled-back tests)

The matrix is `authz_status_matrix_test.sql`: 68 checks, all passing. Statuses are `active`, `pending`, `rejected` and `inactive`.

| Actor (status) | Staff writes (F1) | Rhapsody reads (F3/F4) | Confession declarations (F2) | BSC onboarding list (F4) | Own growth and prayer (F5) |
|---|---|---|---|---|---|
| Coordinator (active) | books, cells, admin tables, email log, people delete: **allowed** | all active members' reads: 5 | active members' rows: 5 | all active + pending: 6 (admin) | own only |
| Coordinator (inactive) | all **denied** | 0 | 0 | 0 | 0 |
| Coordinator (pending) | all **denied** | 0 | 0 | 0 | 0 |
| Coordinator (rejected) | all **denied** | 0 | 0 | 0 | 0 |
| Admin (active) | books: **allowed** | 5 | 5 | 6 | own only |
| Cell leader C1 (active) | own-cell meetings: **allowed** | active members in C1: 4 | 4 | C1 scope | own only |
| Cell leader C2 (inactive) | own-cell meeting: **denied** | 0 | 0 | 0 | 0 |
| BSC leader B1 (active) | cannot edit other BSCs: **denied** | own member only: 1 | 1 | own BSC active + pending: 2 | own only |
| BSC leader B2 (active, unrelated) | — | own member only: 1 | 1 | own BSC only: 1 | own only |
| BSC leader B3 (active, fellowship F2) | — | own member only: 1 | 1 | own BSC only: 1 | own only |
| BSC leader B4 (inactive) | — | 0 | 0 | 0 | 0 |
| BSC leader B5 (pending) | — | 0 | 0 | 0 | 0 |
| BSC leader B6 (rejected) | — | 0 | 0 | — | 0 |
| Member (active) | — | own only: 1 | own only: 1 | 0 | own only |
| Member, no BSC (active) | — | 0 | 0 | 0 | 0 |
| Member (pending) | — | 0 | 0 | 0 | **0** |
| Member (rejected) | — | — | — | 0 | own profile readable: 1 |

Other checks passing: pending onboarding profile update (allowed); rejected profile update (denied); pending and rejected accounts cannot read books, fellowships or BSCs; pending accounts cannot write habits or Rhapsody reads; leaders cannot write other members' reads or declarations; cross-BSC and cross-fellowship structure reads are restricted; a teacher sees only the active student's enrolment; leadership prayers are visible only when the author is active; the confession count RPC returns nothing to pending or inactive callers.

## 4. Certification results (final state)

All runs against the final replay, the same database that produced the fingerprint, unless noted.

| Gate | Result | Notes |
|---|---|---|
| TypeScript (`npm run typecheck`) | **PASS** | exit 0 |
| Jest (`CI=true npm test`) | **279 passed, 1 failed, 11 skipped, 291 total**; 35 suites: 33 passed, 1 failed, 1 skipped | the 1 failure is the golden gate (section 7). The new confession test (4) and migration architecture (8) pass. |
| Production build | **PASS**, compiled successfully, 0 warnings | |
| Browser (Playwright, `npx playwright test`) | **PASS 11/11** | auth 5, release-smoke 6 |
| Replay `001`–`045` from empty | **PASS**, 46 migrations | run twice |
| Schema fingerprint determinism | **byte-identical** across two clean replays | |
| Schema contract (`check_schema_contract.mjs`, contract checks only; the golden comparison is the one open gate) | **29/29** | after adding the new function to `schema_contract.json` |
| Proposed golden parity | **30/30** | not written to the repo |
| SQL: release RLS and people | **33/33** | unchanged |
| SQL: guard and approval bootstrap | **32/32** | unchanged |
| SQL: active guard (cert 031/032) | **11/11** | one expectation changed (5.1) |
| SQL: meeting attendance | **9/9** | unchanged |
| SQL: real-schema BSC effective test | **37/37** | three expectations updated to the intended counts (5.1), see below |
| SQL: real-schema authorisation matrix (new) | **68/68** | |
| SQL: BSC access model (stand-ins) | **28/28** | still tests stand-in helpers; not evidence about real policies |
| Notification `notify-event` (transpiled) | **45/45** | |
| Edge security | **18/18** | host Deno 2.9.2, port 54391 (see note) |
| P0 behavioural | **123/123** | same |
| P0 boundary | **44/44** | same |
| Auth workflow | **12/12** | |
| Authorization | **61/61** | |
| Email and push | **36/36** | |
| Storage | **30/30** | |
| Notify-event Deno runtime (`NOTIFY_MODE=deno`) | **not run** | Docker host networking does not reach the Windows host here (round 1) |
| Hosted migration history, hosted golden, gateway JWT | **not run** | no hosted access, by design |

Note on the edge runs: the Deno router ran on host Deno (2.9.2) instead of the Docker image, for the same reason as round 1. Port 54321 is still held by another local project's Kong gateway.

Test-expectation changes made in this round, all listed in 5.1:
- `bsc_effective_rls_test.sql`: A1, A2 and B1 now expect the active members only (5, not 6), because pending members' activity is hidden under F4.
- `cert_031_032_active_guard.sql`: one check now expects a pending member **cannot** read their own confession declaration (0, not 1), because F5 restricts it.
- `authz_status_matrix_test.sql` is new and was written against the intended behaviour before the migration was tested. It caught the teacher-visibility problem above, and the count-scope issue, before those reached the final state.

## 5. Permission tradeoffs and regressions (for decision)

### 5.1 Changed expectations

- **T1 (changes an older certification).** Migration 032's check said a pending member can still read their own confession declaration. F5 treats a confession declaration as a protected devotional record, so under F5 a pending account cannot read it until it is active. I changed the certification to expect 0, with a comment that cites F5. **This changes an older certification. Confirm it.** The round-2 suite also had three expectations changed (T2). To keep the old behaviour instead, add an own-row read policy for `confession_declarations` with no status test. Then revert the expectation.
- **T2.** Three real-schema expectations (A1, A2, B1) changed from 6 to 5 to hide pending members' activity under F4 (section 4).

### 5.2 Behavioural tradeoffs

- **T3 (F4 scope).** Admins and coordinators can no longer see a pending member's devotional, habit, prayer or confession activity. Onboarding relies on profile fields only. This is the intended F4 result, but it is a change for staff who may have used the Rhapsody or confession views for new members.
- **T4 (F4 list).** BSC leaders now see the **name and email** of pending members assigned to their BSC (`bsc_members_visible`). That is the onboarding data F4 asks for. Confirm that leaders should see pending members' email.
- **T5 (F2 counts).** Community counts now include only active members' declarations. A pending member's declaration no longer raises the count. The count will read lower than the raw number of declaration rows during onboarding, and that is intentional.
- **T6 (Foundation School).** A coordinator cannot enrol, or record progress for, a pending student. Enrolment must wait until the student is active.
- **T7 (prayers).** Prayers by pending authors are not shown in the leadership feed, and pending members cannot create or edit their own prayers until active.
- **T8 (confession own status).** Consequence of T1. A pending member does not see their own declaration status.

### 5.3 Residual findings (not closed)

- **R1 (low).** Own-profile reads by rejected accounts are allowed, so they can show a status message. This is deliberate (F5), and it exposes only the user's own profile.
- **R2 (note).** `bsc_access_model_test.sql` still runs against stand-in helpers, not the real ones. The real-schema suites above are the evidence for this round.

## 6. Regression coverage and its limits

- **Database:** every affected policy and function has a real-schema check (matrix, effective BSC test, the four SQL harnesses, and the cert).
- **Application:** the confession query change has four unit tests (`confessionPrivacy.test.ts`). The behavioural suites cover the auth, email, push, storage, authorisation and edge paths.
- **Browser:** 11 Playwright tests cover sign-in and the release smoke path. **They do not cover every page.** Pages that depend on the changed policies but have no browser test: Daily Confessions and the dashboard confession card, the BSC page, Foundation School, prayers, habits, Book of the Month, cells, meetings, and the Rhapsody pages. For those, the database rules are tested but the UI is not.

Raw logs are in `docs/release-remediation/`:
`authz_status_matrix_run.txt`, `bsc_effective_rls_run.txt`, `cert_031_032_active_guard_run.txt`, `release_rls_people_run.txt`, `guard_approval_run.txt`, `meeting_attendance_run.txt`, `bsc_access_model_standin_run.txt`, `jest_run.txt`, `playwright_run.txt`.

## 7. Remaining blockers and recommendation

**Updated recommendation: NO-GO.** The remaining items are decisions and approvals. None is a failing test.

1. **Approve migration 045** (`supabase/migrations/045_authz_active_staff_and_confession_privacy.sql`) and the app change in `confessions.ts`. They must ship together: part 5 of the earlier draft needs the app change, and the app change needs the migration.
2. **Confirm T1 to T8** (section 5). T1 changes an existing certification. T4 exposes pending members' email to BSC leaders.
3. **Golden.** `docs/release-remediation/proposed_schema_fingerprint_045.golden.json` passes parity 30/30 against the final schema. Its diff from the current golden is the BSC schema, the policy changes in 045 and the new counts function. Approve, then copy it into `supabase/verification/`. The Jest schema-contract test fails until this is done. Approval command:
   ```bash
   cp docs/release-remediation/proposed_schema_fingerprint_045.golden.json supabase/verification/schema_fingerprint.golden.json
   ```
4. **Hosted state.** Hosted history, the hosted golden and the hand-applied `038` are still unverified. Run `docs/release-reconciliation/hosted_readonly_checks.md` and the history checker in round 2 before any hosted change. Hosted application of 045 is a separate approval.
5. **Notification Deno-runtime run and a hosted test project**, as in round 1.

**Remaining failures in the executed suites:** one (Jest `schemaContract.test.ts`, the golden gate). Nothing else fails.

## 8. Next steps I can take on your go-ahead

- Commit this branch (currently uncommitted), with a message that lists the tradeoffs.
- Write the golden once you approve it.
- Add browser coverage for the confession, BSC, Foundation School and prayer pages.
- Update `bsc_access_model_test.sql` to use the real helpers, so it stops being a stand-in test.
