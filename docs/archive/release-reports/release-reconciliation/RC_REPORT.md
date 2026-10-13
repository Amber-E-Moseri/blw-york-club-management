# BLW York Hub: release reconciliation report

**Candidate branch:** `rc/blwyork-combined-release` (worktree `BLW York-rc`)
**Candidate commit:** `f67e9fe` (merge), plus the follow-up commit that carries this report and two small fixes.
**Base:** `origin/integration/blwyork-release-reconciliation` at `0daa284` (PR #5).
**Verdict: NO-GO for production.** See section 7.

Nothing was pushed, merged into `main`, force-pushed, deployed, or run against the hosted database. No branch was overwritten.

---

## 1. Branch-difference report (Phase 1)

### 1.1 Heads and ancestry (after `git fetch origin`)

| Name in brief | Ref | Head | Relation |
|---|---|---|---|
| PR #5 | `origin/integration/blwyork-release-reconciliation` | `0daa284` | Contains `main` (`a09adb8`) plus 12 commits. |
| Notification hardening | `origin/claude/blw-york-hub-interview-n0pu2a` | `0b0722d` | Based on `1026740`. Shares `main` ancestry only through `a09adb8`. |
| Notification prompt | `origin/feat/calendar-notify-recovery` | `dfd6b2a` | One commit on `main`. |
| BSC / mobile UI | `origin/mobile-ui-polish` | `112d13d` | Merge-base with `main` is `25a839a` (older). 23 unique commits. |
| (local only) | `integration/blwyork-release-reconciliation` | `021c3e8` | **Not on origin.** Login dark-mode fix and seed-script change. Origin has three commits local lacks (`1026740`, `e0ded50`, `0daa284`). |

No head is an ancestor of another head. Each candidate had to be merged, not fast-forwarded.

### 1.2 What is unique to each branch

- **Integration (`0daa284`) over `main`:** migration `038` edited in place and `039` added; `notify-event` hardening (`1026740`, `e0ded50`); golden fingerprint regenerated after `039`; CI on Node 22; devotional and confession imports; service-worker update-loop fix; dark-mode work.
- **Notification hardening (`0b0722d`) over `1026740`:** its own commit adds the CRLF-normalised fingerprint (`schema_fingerprint.sql`), `.gitattributes` LF rule for `supabase/**/*.sql|json|mjs`, the Deno edge router (`supabase/verification/edge/`), `scripts/certify-edge-deno.sh`, the Add Event modal footer and dark-mode fixes, and `docs/notification-deployment.md`. **Integration already has `1026740`.** Taking `0b0722d` as a tip would delete integration's features (its base predates devotional and confession imports), so it has to be merged at commit level.
- **Notification prompt (`dfd6b2a`):** `src/lib/pushPrompt.ts` (seven-day "Maybe Later" snooze, permission and subscription rules), `PushPermissionPrompt.tsx`, `src/__tests__/pushPrompt.test.ts`. Self-contained.
- **BSC / mobile (`112d13d`):** BSC migrations `038`–`042` (`bsc_hierarchy_access`, `bsc_member_views`, `bsc_grants`, `bsc_function_grants`, `bsc_policy_and_search_path`); BSC verification; a regenerated golden "post-042"; the mobile UI overhaul (dark mode, tokens, page headers, "Daily Bread" renamed "Rhapsody of Realities", emoji replaced with icons, phone reader).

### 1.3 Pairwise dry-run merges (`git merge-tree`, in memory)

| Pair | Textual conflicts |
|---|---|
| integration + `dfd6b2a` | none |
| integration + `0b0722d` | `Button.tsx` |
| integration + `112d13d` | `ContactFilters.tsx`, `Button.tsx`, `DailyConfessions.tsx`, `Login.tsx`, golden |
| `dfd6b2a` + `112d13d` | `PushPermissionPrompt.tsx` |
| `0b0722d` + `112d13d` | `Button.tsx`, `Modal.tsx`, golden |

The real merge produced 7 conflicting files, because the earlier merges changed the base.

### 1.4 Regressions and overwritten fixes found

1. **Golden and fingerprint.** The golden blob on integration (`44aa2b9`) is identical to the one on `0b0722d`. Integration lacks `0b0722d`'s CRLF normalisation, so the two function hashes (`is_active_profile`, `find_person_by_email`) would mismatch on a Windows checkout. The candidate takes the normalisation.
2. **`notify-event` is not the code the notification doc verified.** Integration's `notify-event/index.ts` differs from `1026740` by +12/−2 lines: it retries the delivery-log insert once more and adds `log_saved`, `members_sent` and `members_failed` to the response. The candidate keeps integration's version. Its transpiled harness (45/45) runs on that file, so the shipped code is covered. The Deno-runtime run is not (see section 5).
3. **Mobile `PushPermissionPrompt` would undo the prompt branch's accessibility work.** The mobile side replaces the dialog with a `role="banner"` element and drops focus handling and the snooze-aware rules. The candidate keeps `dfd6b2a`.
4. **Mobile `DailyConfessions` drops the Bulk Import button** that integration added. The candidate keeps integration's header.
5. **Mobile `Login` removes the dark-mode text colour** on the "York University" line and uses a lighter background than the integration fix. The candidate keeps integration's values.
6. **Golden on the mobile branch was regenerated from its own database output**, not from a replay of the combined history. It cannot be used as-is (section 3).

---

## 2. Migration identity (Phase 2)

### 2.1 Inventory

| Number | Main | Integration / notification | Mobile (BSC) | Candidate |
|---|---|---|---|---|
| 001–037 | yes | yes | yes | identical on all heads (verified by `git diff --name-status`) |
| 038 | `038_event_audience_and_notifications` (**with** meeting-audience check) | `038_event_audience_and_notifications` (check removed, edited in place) | `038_bsc_hierarchy_access` | `038_event_audience_and_notifications` (unchanged from integration) |
| 039 | none | `039_event_audience_meeting_delete` | `039_bsc_member_views` | `039_event_audience_meeting_delete` |
| 040 | none | none | `040_bsc_grants` | `040_bsc_hierarchy_access` |
| 041 | none | none | `041_bsc_function_grants` | `041_bsc_member_views` |
| 042 | none | none | `042_bsc_policy_and_search_path` | `042_bsc_grants` |
| 043 | none | none | none | `043_bsc_function_grants` |
| 044 | none | none | none | `044_bsc_policy_and_search_path` |

### 2.2 The collision

The notification branch and the BSC branch both use versions `038` and `039` for different SQL. Git sees different filenames, so the collision is only in the version number. Supabase tracks migrations by version, so this must be resolved before any deployment.

### 2.3 Facts that decide the plan

- The hosted project (`rjtstjmtddqhesexltbj`, named in the notification runbook) reportedly has event `038` **applied by hand from the SQL editor, including the meeting-audience check**. That is recorded only as a claim in PR #5 and the runbook. It has not been verified.
- The runbook's remedy for that state is to apply **039 only**.
- The BSC migrations do not depend on the event-notification columns (they use `profiles`, `cells`, `meetings`, and helpers from `001`–`037`). They can move to `040`–`044` without changing behaviour.
- The BSC branch's `044` fixes a real problem: BSC and fellowship read policies used `auth.role() = 'authenticated'`, which admits any signed-in account. `044` restricts them to active members.
- **Whether BSC `038`–`042` were ever applied to hosted is unknown.** If they were applied under those names, renumbering them would be a silent renumber of applied history, which the brief forbids. That must be checked first (`hosted_readonly_checks.md`, check 1).

### 2.4 Canonical forward-only sequence

```
001–037  unchanged
038      event audience and notifications (integration version). Do not edit again.
039      drop events_meeting_audience_requires_meeting (forward fix)
040      bsc_hierarchy_access        (was BSC 038)
041      bsc_member_views            (was BSC 039)
042      bsc_grants                  (was BSC 040)
043      bsc_function_grants         (was BSC 041)
044      bsc_policy_and_search_path  (was BSC 042, plus the read-policy fix)
```

Applied-state cases for hosted, to be confirmed by the read-only checks:

- **A.** 038 applied by hand with the check, no BSC applied. Apply 039, then 040–044. Record 038 in the history table only if the human approves that history write.
- **B.** 038 not applied. Apply 038, 039, then 040–044 through the normal migration path.
- **C.** Any BSC migration already applied under its old name. Stop. The history must be reconciled by a person before anything else.

Nothing here runs without explicit approval.

### 2.5 Golden: what it must change to

Replaying `001`–`044` from empty on a local Postgres and fingerprinting it gives a document that differs from the current golden **only** by:

- new tables `fellowships` and `bscs`;
- `cells.fellowship_id` and its index and foreign key;
- `profiles.bsc_id`, its index, foreign key and `profiles_guard_bsc_assignment` trigger;
- policies on `devotional_views` (`views_admin_read` becomes `devotional_views_select_own_or_admin`, which adds BSC and cell-leader reads through `can_view_member`) and on `confession_declarations`;
- functions `bsc_members_visible()`, `can_view_member(uuid)`, `is_bsc_leader_of(uuid)`, `guard_profile_bsc_assignment()`.

**The policy change widens read access for leaders.** It is intended, but it is an authorisation change and needs a security review before the golden is approved.

The golden was **not** regenerated in this session. Writing the new golden was denied by the auto-mode classifier, and the brief forbids editing the golden merely to make a check pass. The golden is at its pre-merge content. A person needs to approve the regeneration (command in section 6).

---

## 3. Candidate: what is in it (Phase 3)

Commits on `rc/blwyork-combined-release`:

1. Merge of `021c3e8` (local login fix and seed script; not previously on origin).
2. Merge of `0b0722d` (conflict: `Button.tsx`, verified dark-mode values kept).
3. Merge of `dfd6b2a` (clean).
4. Merge of `112d13d` (BSC): 7 conflicts resolved, BSC migrations renumbered to `040`–`044`, BSC test updated, golden **not** regenerated (`f67e9fe`).
5. Follow-up commit: this report, `e2e/auth.spec.ts` selector update, `bsc_access_checks.sql` migration-number corrections.

Conflict decisions (integration side kept in every case):

| File | Mobile side not taken | Why |
|---|---|---|
| `components/foundation/Button.tsx` | `bg-york-50` secondary colours | `0b0722d` dark-mode values verified against WCAG 4.5:1 |
| `components/foundation/Modal.tsx` | `dark:border-slate-800` | verified dialog contrast |
| `pages/Login.tsx` | `dark:bg-slate-800` wrapper; no dark text on subtitle | `021c3e8` fix; contrast |
| `components/feature/ContactFilters.tsx` | `dark:bg-slate-800`, no text colour | integration has explicit dark text |
| `components/feature/PushPermissionPrompt.tsx` | banner with no focus or dialog semantics | `dfd6b2a` accessibility work |
| `pages/DailyConfessions.tsx` | `PageHeader` without Bulk Import | Bulk Import is an integration feature |

Non-conflicting mobile changes in those files were kept by the merge.

**Design review needed:** the mobile UI overhaul (colour tokens, icon set, page headers, "Rhapsody of Realities" label) was only partly taken. Where it was not taken, the integration styling is in the candidate.

**Label change taken from mobile:** the dashboard button "Daily Bread" is now "Rhapsody of Realities". `e2e/auth.spec.ts` was updated to match. Confirm that label is the approved text.

---

## 4. Certification results (Phase 4)

All runs were on the candidate tree, against the **local** Supabase stack only. The hosted project was not contacted.

| Gate | Result | Notes |
|---|---|---|
| TypeScript (`npm run typecheck`) | **PASS** | exit 0 |
| Jest (`CI=true npm test`) | **275 passed, 1 failed, 11 skipped, 287 total** (32 of 34 suites passed, 1 failed, 1 skipped) | The failure is `schemaContract.test.ts` "certified golden passes every check", which is the golden gate. |
| Production build (`npm run build`) | **PASS**, compiled successfully, 0 warnings | |
| Fresh replay `001`–`044` (`supabase db reset --local`) | **PASS** | Second independent replay for determinism **not run**: that step was in the denied command. Needed before the golden is approved. |
| Schema fingerprint parity vs golden | **FAIL 29/30** | Expected: only the BSC schema differs (section 2.5). |
| SQL authorisation: `release_rls_people` | **PASS 33/33** | matches documented count |
| SQL authorisation: `guard_approval_bootstrap` | **PASS 32/32** | matches |
| SQL authorisation: `cert_031_032_active_guard` | **PASS 11/11** | matches |
| SQL authorisation: `meeting_attendance_access` | **PASS 9/9** | matches |
| BSC behavioural access model | **PASS 28/28** | Run in a throwaway database. Needed a missing `is_active_member()` stand-in, added. Now includes `044`, which the test did not cover before. |
| Notification `notify-event`, in-process (transpiled) | **PASS 45/45** | Reads the candidate's own `notify-event/index.ts`. |
| Notification `notify-event`, Deno runtime (`NOTIFY_MODE=deno`) | **NOT RUN (blocked)** | The harness starts Deno in Docker with `--network host`. On this Docker Desktop for Windows, host networking does not reach the Windows host (probed; no response). |
| Edge security | **PASS 18/18** | Run in host Deno 2.9.2 on port 54391 (see below) |
| P0 behavioural | **PASS 123/123** | same |
| P0 boundary | **PASS 44/44** | same |
| Browser (Playwright, `npx playwright test`) | **PASS 11/11** | auth 5, release-smoke 6. Brief's "14/14" is from another branch state. |
| Hosted migration history / hosted fingerprint | **NOT RUN (blocked)** | Not authorised; prepared as `docs/release-reconciliation/hosted_readonly_checks.md`. |
| Gateway JWT check (`verify_jwt`) | **NOT RUN (blocked)** | Needs a hosted smoke test. |

Deviations from the script, recorded so the numbers are not over-read:

- **Edge harnesses ran on host Deno (2.9.2), not `denoland/deno:alpine` in Docker.** The docker run uses host networking, which does not work on this machine. The router code, import map, flags and env file are the same as `scripts/certify-edge-deno.sh`. The Docker image version may differ.
- **Port 54321 is held by another local project's Kong gateway** (`supabase_kong_clickup`). The first attempts hit that gateway and gave 0/18 and 23/44 results. Those results were discarded and are not reported. The harnesses were re-run on port 54391.
- The `scripts/certify-edge-deno.sh` script needs `TMPDIR` and `MSYS_NO_PATHCONV` on Git Bash for Windows. The script itself was not changed.

---

## 5. Missing changes and conflicts (summary)

1. **Golden not regenerated.** Blocks CI parity and the schema gate. Needs approval (section 6).
2. **Local integration commit `021c3e8` was not on origin.** Now in the candidate. The local `integration` branch is unchanged and still diverged from origin.
3. **`notify-event` Deno-runtime certification not run** (Docker host networking). The transpiled 45/45 covers the code, not the runtime.
4. **Hosted state unverified.** Migration history, the hand-applied `038`, the hosted golden, `notify-event` deployment and secrets, and `verify_jwt` all need the read-only checks and a test project.
5. **BSC migrations unverified on hosted.** Renumbering is safe only if they were never applied under `038`–`042`.
6. **Design deltas from mobile not taken** (section 3). Need a design decision.
7. **Authorisation change** to `devotional_views` and `confession_declarations` read policies (section 2.5). Needs a security review.
8. **Label change** "Daily Bread" to "Rhapsody of Realities". Needs confirmation.
9. **`AGENTS.md` in the Downloads folder** describes a different project (`raf-platform`: Next.js, Prisma-free Supabase, financial rules). Its rules were not applied to this repository.

---

## 6. Blockers and decisions needed

| # | Blocker | Who clears it | How |
|---|---|---|---|
| 1 | Approve regenerating the golden from the combined replay, then run a second replay and confirm the fingerprint is byte-identical. The diff is the BSC set in section 2.5. | You | Run `docker exec -i supabase_db_BLW_York psql -U postgres -At -q < supabase/verification/schema_fingerprint.sql > golden.json` in the `BLW York-rc` worktree, check it with `node supabase/verification/check_schema_contract.mjs golden.json --golden supabase/verification/schema_fingerprint.golden.json`, then copy it over the golden and commit. Review the diff first. |
| 2 | Run the read-only hosted checks and return the output. | You | `docs/release-reconciliation/hosted_readonly_checks.md`, SQL editor, SELECT only. |
| 3 | Decide the hosted sequence (case A, B or C in section 2.4). | You, after 2 | |
| 4 | Security review of the BSC read-policy change. | You or a reviewer | section 2.5 |
| 5 | Approve the mobile design deltas and the "Rhapsody of Realities" label. | You | section 3 |
| 6 | Notification Deno-runtime run. | Needs a machine where Docker host networking works, or a Linux runner (CI). | `NOTIFY_MODE=deno` harness |
| 7 | Hosted test project for browser and push checks, plus a real device. | You | runbook step 7 |
| 8 | Approval to deploy. | You | Not given. |

---

## 7. GO / NO-GO

**NO-GO for production.**

Reasons, in order:

1. Schema parity is red (29/30). CI would fail the same way.
2. Hosted migration history and hosted schema have not been verified.
3. The BSC migrations may need renumbering on hosted history, which depends on item 2.
4. The Deno-runtime notification run has not been done.
5. A BSC authorisation change needs a security review.
6. No approval to deploy.

**What is ready:** the candidate builds, typechecks, passes 275 Jest tests and 11 browser tests, passes all four SQL authorisation harnesses, the BSC behavioural test (28/28), the transpiled notification harness (45/45), and the edge security, P0 behavioural and P0 boundary suites (18, 123 and 44). It is a reasonable base for a controlled rollout to a test project once blockers 1–7 are cleared.

---

## 8. Environment changes made during this work

- Created worktree `C:/Users/moser/Downloads/BLW York-rc` on new branch `rc/blwyork-combined-release`. Upstream unset, so nothing pushes to `integration` by accident.
- Ran `supabase db reset --local` against the **local** stack `supabase_db_BLW_York`. This replaced the local database that the main worktree also uses.
- The Supabase CLI stopped the local `imgproxy` and `pooler` containers during the run. They are not needed for these tests.
- Created and dropped the scratch database `bsc_scratch` on the local stack.
- Installed dependencies in the worktree with `npm ci`. The main checkout's `node_modules` is missing `web-push`, which is declared in `package.json`. Not fixed there.
- Pulled `denoland/deno:alpine`.
- Stopped the local dev server (port 3100) and the host Deno router (port 54391) after use.
- The classifier denied one write to the golden. Nothing else was denied.
