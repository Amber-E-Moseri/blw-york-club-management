# Round 3: approved decisions, Foundation School onboarding exception, compatibility review

This section extends `REMEDIATION_REPORT.md`. Earlier sections still describe rounds 1 and 2.

## 1. Approved decisions and where they are enforced

| Decision | Enforced by | Tested by |
|---|---|---|
| T1: pending users cannot read protected confession declaration rows until active | 045 `confession_declarations_read_scoped` (via `can_view_member`, active caller) | cert 032 (expectation 0), matrix C9, compat C9 |
| T2: pending member activity excluded from scoped leader activity | 045 `can_view_member` (member must be active) | matrix B1–B14, bsc_effective |
| T3: admins and coordinators access pending onboarding information, not protected activity | 045 `bsc_members_visible`; 046 staff enrolment read (section 2) | matrix B17; FS R1–R2 |
| T4: active authorised leaders view pending names and emails within scope | 045 `bsc_members_visible` (active caller, scope check) | matrix B12–B14 |
| T5: public-facing declaration counts include only active approved members | 045 `confession_declaration_counts` (`is_active_profile`) | matrix C4–C8; compat C1, C6, C8 |
| T6 (adjusted): staff enrol pending students; no protected access for them | **046** (section 2) | FS G1–G11, P1–P11 |
| T7: pending prayers excluded from the leadership feed | 045 `prayers_leadership_read` (author must be active) | matrix E3–E5 |

**T7 scope note.** The approval covers the leadership feed. `prayers_shared_read` still shows `shared` prayers to active members whatever the author's status. Under 045 a pending account cannot create prayers at all (`prayers_own` requires an active account), so this only affects an account that was active when it wrote a prayer and was later set back to pending. Tighten `prayers_shared_read` if you want that case closed too.

## 2. Foundation School: review and the narrowest exception (migration 046)

**Review findings.**
- No application code reads or writes the Foundation School tables. The enrolment workflow exists only at the database level. I found no UI, query or RPC that enrols anyone.
- `classes_read` (course content) already requires an active member.
- Before 046, `enrollments_coordinator` (ALL) required an active student for every operation, so staff could not enrol a pending student at all.
- The schema allows one enrolment per student (`UNIQUE (student_id)`), and has no per-group scoping.

**What 046 changes**, on `foundation_school_enrollments` only (forward-only; 045 is unchanged):

| Operation | Who | Student status |
|---|---|---|
| Read the enrolment row | active admin or coordinator | pending or active (onboarding); rejected and inactive excluded |
| Insert (enrol) | active admin or coordinator | pending or active |
| Update, delete | active admin or coordinator | **active only** (staff cannot change or remove a pending enrolment) |

**Unchanged, deliberately narrow:**
- `enrollments_own` (the student's own row) still requires an active account (F5). A pending student does not see its own enrolment.
- `enrollments_teacher_read` still requires an active teacher and an active student.
- `classes_read` (course content) still requires an active member.
- Every `foundation_school_progress` policy still requires an active student, for staff, teachers and students alike.

**Why the exception is safe.** An enrolment for a pending student unlocks nothing. Course content is closed to pending accounts, progress is closed to everyone except active students, and the student cannot read the enrolment row. The new insert policy does not widen what staff can read or change beyond the onboarding row. The RETURNING clause of an insert is covered by the read policy for pending and active students.

**Cross-role isolation (tested).** Cell leaders, teachers, members, and pending or inactive staff cannot enrol anyone. A rejected or inactive student cannot be enrolled.

## 3. Compatibility review: migration 045 with `src/lib/queries/confessions.ts`

Reviewed together. Each app statement was run against the real schema as the actor that issues it (`confession_app_compat_test.sql`, 10/10):

| App statement | Active member | Pending member |
|---|---|---|
| `rpc confession_declaration_counts` | returns the count (C1, C6) | returns no rows, no error (C8) |
| own-row select for `declared_by_me` | returns own row only (C2, C5) | returns nothing (C9, T1) |
| other member's row | not returned (C3) | n/a |
| `upsert` in `declareConfession` (insert on conflict update) | succeeds (C4) | refused with 42501 (C10) |
| `delete` in `undeclareConfession` | succeeds (C7) | n/a (cannot have declared) |

Findings:
- The app treats an empty count result as 0, so pending users see zero counts without an error.
- `declared_by_me` comes from the caller's own row, which an active member can always read. The optimistic updates in `useConfessions` therefore stay consistent.
- `fetchDeclarations` in `confessions.ts` returns the caller's rows only after 045. Nothing in the UI calls it.
- No change to `confessions.ts` was needed in this round.

## 4. Permission expectations changed in this round

| Test | Before | Now | Why |
|---|---|---|---|
| `authz_status_matrix_test.sql` E1 (coordinator enrolments) | 1 | 2 | T6: staff read pending and active enrolments for onboarding |
| `foundation_school_onboarding_test.sql` P2 (active student course content) | new check | 2 | the fixture contains two classes (not a permission change) |

Earlier changes are unchanged: `bsc_effective_rls_test` A1, A2, B1 (active members only, round 2); `cert_031_032_active_guard` (pending cannot read own declaration, T1, round 2).

## 5. Results (final state: 000–046 replayed from empty)

| Gate | Result |
|---|---|
| Replay `000`–`046` | PASS, 47 migrations |
| Real-schema authorisation matrix | **68/68** |
| Real-schema BSC effective test | **37/37** |
| Foundation School onboarding (new) | **35/35** |
| Confession app compatibility (new) | **10/10** |
| SQL: release RLS and people | 33/33 |
| SQL: guard and approval bootstrap | 32/32 |
| SQL: active guard (cert 031/032) | 11/11 |
| SQL: meeting attendance | 9/9 |
| BSC access model (stand-ins; not evidence about real policies) | 28/28 |
| Schema contract checks | 29/29 |
| Proposed golden (046) parity | 30/30 (not written to the repository) |
| Notify-event (transpiled) | 45/45 |
| Edge security / P0 behavioural / P0 boundary | 18 / 123 / 44 |
| Auth workflow / authorisation / email and push / storage | 12 / 61 / 36 / 30 |
| Jest | **279 passed, 1 failed (golden gate), 11 skipped, 291 total**. Suites: 33 passed, 1 failed, 1 skipped, 35 total. |
| TypeScript (`npm run typecheck`) | PASS, exit 0 |
| Production build | PASS, compiled successfully, 0 warnings |
| Playwright | **11/11** |

Not run this round: the Deno-runtime notification test, and anything hosted (both unchanged from round 1).

Raw logs: `docs/release-remediation/r3_*.txt`.

## 6. Files changed in this round

| Status | File |
|---|---|
| new | `supabase/migrations/046_foundation_school_onboarding_enrollment.sql` |
| new | `supabase/verification/foundation_school_onboarding_test.sql` |
| new | `supabase/verification/confession_app_compat_test.sql` |
| modified | `supabase/verification/authz_status_matrix_test.sql` (E1 expectation and label) |
| replaced | `docs/release-remediation/proposed_schema_fingerprint_045.golden.json` replaced by `proposed_schema_fingerprint_046.golden.json` (not written to the repository golden) |
| new | `docs/release-remediation/ROUND3_REPORT.md` and `r3_*.txt` run logs |

No earlier migration file was edited. Migration 045 is unchanged from commit `3c504db`.

## 7. Is migration 045 ready for release review?

**Yes, for release review, with the conditions below. Not yet for production.**

Ready:
- 045 and 046 are forward-only, and no earlier migration was changed.
- Every approved decision (T1–T7) is implemented and tested across active, pending, rejected and inactive accounts.
- The real-schema suites pass: 68/68, 37/37, 35/35 and 10/10, plus the existing SQL harnesses.
- Behavioural suites, Jest (apart from the golden gate), typecheck, build and browser tests all pass.

Conditions before production:
1. Approve the golden (`docs/release-remediation/proposed_schema_fingerprint_046.golden.json`). Jest's schema-contract test fails until it is written to the repository.
2. Approve the T7 scope note (`prayers_shared_read`), or tighten it.
3. Confirm the T1 expectation change to cert 032.
4. Hosted application of 045 and 046 needs its own approval, with the history checks from round 2 run first.
5. Run the Deno-runtime notification test and set up a hosted test project, as in round 1.
6. UI coverage: nothing in the app uses Foundation School, and the confession, BSC, prayer and habit pages still have no browser tests.
