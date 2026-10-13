# Round 2: verification, security audit and migration readiness

**Candidate:** `rc/blwyork-combined-release` at `bd34e47`. Clean working tree at the start of this round.
**Nothing applied:** no hosted change, no migration added, no golden written into the repository, no merge to `main`, no push.
**Verdict: still NO-GO.** The reasons are in section 6.

---

## 1. Candidate verification and golden

| Check | Result |
|---|---|
| Branch clean at start | yes (0 entries) |
| Two independent clean replays (`db reset --local`, 44 migrations each) | **byte-identical** fingerprints, sha256 `30384fd8…` |
| Golden diff vs. the pre-merge golden, with `extensions` excluded | 15 entries, all BSC (see 1.1) |
| Golden diff, including `extensions` | additionally `pg_net` absent in this replay (see 1.2) |
| Proposed golden (`docs/release-reconciliation/proposed_schema_fingerprint.golden.json`) | parity **30/30** |

### 1.1 Every changed entry is BSC schema

- Tables added: `fellowships`, `bscs`.
- `cells`: column `fellowship_id`, index `cells_fellowship_idx`, foreign key to `fellowships`.
- `profiles`: column `bsc_id`, index `profiles_bsc_idx`, foreign key to `bscs`, trigger `profiles_guard_bsc_assignment`.
- Policies changed: `devotional_views` (`views_admin_read` replaced by `devotional_views_select_own_or_admin`) and `confession_declarations` (`confession_declarations_read_scoped` added, and the broad `confession_declarations_read` kept; see F2 in section 3).
- Functions added: `bsc_members_visible()`, `can_view_member(uuid)`, `is_bsc_leader_of(uuid)`, `guard_profile_bsc_assignment()`.

Nothing else changed. The `is_active_profile` and `find_person_by_email` hashes are unchanged, so the CRLF normalisation holds.

### 1.2 The `extensions` entry

The checker removes `extensions` before comparing (`check_schema_contract.mjs` line 139), because hosted projects pre-install extensions. This replay's Postgres image (`17.11.0.004`) does not create `pg_net`. The earlier replay, on an older image, did. The proposed golden keeps the certified `extensions` list so the approval diff is only the schema change.

**Approval command**, for the golden once you accept it:

```bash
cp docs/release-reconciliation/proposed_schema_fingerprint.golden.json supabase/verification/schema_fingerprint.golden.json
node supabase/verification/check_schema_contract.mjs docs/release-reconciliation/proposed_schema_fingerprint.golden.json --golden supabase/verification/schema_fingerprint.golden.json
```

The golden is not copied by this round. That needs your approval.

---

## 2. Security audit (real schema, effective policies)

Test: `supabase/verification/bsc_effective_rls_test.sql`. It runs on the replayed database with no stand-ins, reads `pg_policies` and the real helper bodies, and rolls back. Each check states the **intended** result. Log: `rls_run_baseline_candidate.txt`.

**Result on the candidate: 19 passed, 18 failed (37 checks).**

### 2.1 Helper bodies, as deployed

- `current_user_role()` is status-gated (`status = 'active'`). `is_admin_or_coordinator()`, `is_coordinator()`, `is_devotional_admin()`, `is_cell_leader_of()` and `is_active_member()` are status-gated through it or directly.
- `can_view_member(p)` is **not** status-gated: `p = auth.uid() or is_admin_or_coordinator() or (exists member m in a BSC whose leader_id = auth.uid() or is_cell_leader_of(cell))`. The BSC-leader branch checks neither the leader's nor the member's status.
- `is_bsc_leader_of()` is not status-gated (not used by any policy).

### 2.2 Results by actor

| Actor | Rhapsody reads (`devotional_views`) | Declarations (`confession_declarations`) | Notes |
|---|---|---|---|
| Coordinator, active | all (6) ✓ | all (6) ✓ | |
| Admin, active | all (6) ✓ | — | |
| **Coordinator, inactive** | **6, expected 0 ✗** (F1) | — | writes to books and cells also allowed (F1) |
| Cell leader of C1, active | 5, expected 4 ✗ (F4) | 6, expected 4 ✗ (F2) | includes the pending member |
| BSC leader B1, active | 2, expected 1 ✗ (F4) | 6, expected 1 ✗ (F2) | |
| Unrelated BSC leader B2 | 1 ✓ | 6, expected 1 ✗ (F2) | cross-BSC **view** of reads is restricted ✓ |
| Cross-fellowship leader B3 (F2) | 1 ✓ | 6, expected 1 ✗ (F2) | cross-fellowship leader's view restricted to its own member ✓ |
| **BSC leader, inactive** | **1, expected 0 ✗** (F3) | 1, expected 0 ✗ (F3) | |
| **BSC leader, pending** | **1, expected 0 ✗** (F3) | 1, expected 0 ✗ (F3) | |
| Active member | own only (1) ✓ | 6, expected 1 ✗ (F2) | |
| Member, no BSC | 0 ✓ | 6, expected 0 ✗ (F2) | |
| **Pending member** | **1 (own), expected 0 ✗** (F5) | 1 (own), expected 0 ✗ (F5) | |

Writes by leaders: cannot update a member's reads ✓, cannot insert a declaration for a member ✓, cannot edit BSC structure ✓. A cell leader can rename a BSC in their own cell ✓.

Structure reads: pending member cannot read BSCs or fellowships ✓. Active members can ✓.

### 2.3 Findings

**F1 HIGH, pre-existing on `main`.** Role-only inline checks with no status test. An account that is deactivated but keeps `role = coordinator` or `admin` keeps the access:
- reads all Rhapsody reads (`views_admin_read`, migration 010, carried by 014);
- inserts or updates the monthly book (`books_manage`, migration 010, carried by 014) — **this is the `books_of_month` concern you asked about, confirmed**;
- creates cells (`cells_manage`, migration 005).

The same pattern appears in about 17 more policies (section 4). I did not draft a remedy for those, because each needs a per-table decision.

**F2 HIGH (privacy), pre-existing on `main`.** `confession_declarations_read` (migration 017) lets every active member read **every** declaration (who declared which confession, and when). Policies combine with OR, so the BSC leader scope cannot restrict it. This means "cross-BSC restriction for confessions" does not hold today. Confession text is not exposed, because it lives in `confessions`. The app depends on the broad read: `declaration_count` is computed from every member's rows (`src/lib/queries/confessions.ts` lines 9 and 33). Removing it needs an app change (see PROPOSED_045 part 5).

**F3 MEDIUM, introduced by the BSC branch (`040`).** `can_view_member`'s leader branch has no status check. A deactivated or pending account that is still `bscs.leader_id` keeps read access to its members' reads and declarations until someone clears the leader field. That is exactly the access a removed leader should lose.

**F4 MEDIUM, introduced by the BSC branch.** `can_view_member` does not require the member to be active. Pending members' reads and declarations are visible to their leaders. Whether that is wrong is a product decision. This test expects it to be hidden.

**F5 LOW, pre-existing.** Own-row reads are not status-gated (`views_own` is `FOR ALL` on `auth.uid() = member_id`, and `confession_declarations_read_own`). A pending account can read its own rows. The proposed remedy does not fix this, because `views_own` is separate. Decision needed.

**Not a finding:** cross-BSC and cross-fellowship **writes** and **reads of structure** are restricted as intended. Leaders cannot write other members' data.

---

## 3. Remedies (drafted, tested, not applied)

`PROPOSED_045_rls_remedies.md` contains parts 1 to 5. Tested inside one rolled-back transaction, with the same test body, on the replay (`rls_run_with_proposed_045.txt`).

**Result with the draft: 36 passed, 1 failed.**

| Finding | Closed by | Remaining |
|---|---|---|
| F1 (books, Rhapsody admin read, cells) | parts 1, 2, 3 | — |
| F3 (inactive or pending leaders) | part 4 | — |
| F4 (pending members visible to leaders) | part 4 | — (this is a decision: part 4 chooses to hide them) |
| F2 (broad declarations read) | part 5 | **needs the app change** before it can ship |
| F5 (pending own rows) | not closed | `views_own` needs its own status gate (decision) |

Part 5 drops the broad read. Without the app change, the community declaration count shows only the caller's own row. Do not ship part 5 alone.

Affected tests, if you approve parts 1 to 4 and the app change for part 5:
- the new real-schema RLS test (expected all but the F5 check to pass);
- `bsc_access_model_test.sql`, which uses stand-ins and must be updated to match the real helpers (it currently tests the stand-ins, so it is not evidence about the real policies);
- the Jest, Playwright and edge suites, once the app change lands.

---

## 4. Other role-only policies (same class as F1, not drafted)

`email_log_admin_manage`, `email_log_admin_read`, `meetings_manage_scoped` (cell-leader branch), `meetings_leaders_read`, `people_delete`, `prayer_requests_coordinator_manage`, `prayer_requests_leadership_read`, `foundation_school_classes`, `foundation_school_enrollments`, `foundation_school_progress`, `devotional_daily_pages.daily_pages_manage`, `monthly_devotionals.devotional_manage`, `admin_role_assignments`, `admin_role_permissions`, `admin_roles`.

Each needs a decision about which role should keep access. Replacing the inline check with `is_admin_or_coordinator()`, `is_coordinator()`, `is_devotional_admin()` or `is_active_member()` gates by status. I'd review all of them in one pass before applying.

---

## 5. Migration readiness (Phase 3)

### 5.1 Hosted history

I have no access to the hosted project and did not contact it. Prepared:
- `docs/release-reconciliation/hosted_readonly_checks.md`: SELECT-only checks, including `supabase_migrations.schema_migrations`.
- `supabase/verification/check_migration_history.mjs`: takes the saved result and reports `PENDING`, `UNKNOWN`, `RENAMED`, `GAP` and `BSC-OLD` against the canonical set, and exits non-zero on any problem. It never connects anywhere. Tested on three known cases:
  - legacy `038` recorded, rest pending: exit 0 (correct);
  - BSC recorded under its old numbers: flags `RENAMED` and `BSC-OLD`, exit 1 (correct);
  - a gap (`040` recorded without `038`): flags `GAP`, exit 1 (correct).

### 5.2 Compatibility with a manually applied event 038

I built a legacy-history project (`001`–`037` plus `main`'s original `038` with the meeting-audience check) and reproduced the production state.

1. **Reproduced the problem.** Deleting a meeting that an event targets is blocked by `events_meeting_audience_requires_meeting` (check violation `23514`).
2. **Applied `039` as a forward fix.** The same delete now succeeds.
3. **Applied `040`–`044` by hand**, as the SQL editor would. All succeeded.
4. **Compared the result with a clean replay.** The fingerprint is **byte-identical** (0 differences).
5. **Re-ran canonical `038` and `039` on that database.** Both succeed and leave the schema unchanged. So if the hosted history lacks a `038` record, a later `db push` is safe to re-run.

Conclusion: the canonical sequence works for a database where `038` was applied by hand. The hosted state is still unverified, so the decision stays with the read-only checks (case A, B or C in `RC_REPORT.md` section 2.4).

### 5.3 Nothing applied

No hosted migration is applied, renumbered or repaired. The steps above ran on a local scratch project only.

---

## 6. Phase 4 and recommendation

| Gate | Result this round |
|---|---|
| Affected by this round's changes: migration architecture (Jest) | **8/8 passed** |
| Affected: schema contract (Jest, `schemaContract.test.ts`) | 25 passed, 1 failed. The failure is the golden gate, unchanged. |
| Second clean replay, determinism | **byte-identical** |
| Proposed golden parity | **30/30** (not written to the repo) |
| Real-schema RLS test, candidate | **19 passed, 18 failed** |
| Real-schema RLS test, with draft 045 (part 5 without app change) | **36 passed, 1 failed** |
| Upgrade-path fingerprint vs clean replay | **byte-identical** |
| Migration history checker (3 synthetic cases) | 3/3 as expected |

Not re-run this round, because nothing they test changed: TypeScript, build, Playwright, SQL authorisation harnesses (33/32/11/9), notification (45/45), edge (18/123/44). Results from round 1 stand for the unchanged code.

**Recommendation: NO-GO.**

Blockers, in order:
1. **F1 (HIGH): inactive or pending coordinators and admins retain access.** Needs a decision on which role-only policies to gate, then migration 045.
2. **F2 (HIGH, privacy): every active member can read everyone's declarations.** Needs a product decision on counts, then the app change and migration 045 part 5.
3. **F3 (MEDIUM): inactive or pending BSC leaders keep access.** Fixed by 045 part 4 once approved.
4. **F4 and F5: decisions** on pending members.
5. **Golden approval.** The proposed golden is ready; write it only when you approve.
6. **Hosted history.** Run `hosted_readonly_checks.md`, save the result, and run `check_migration_history.mjs` on it.
7. **Deno-runtime notification run and hosted smoke test.** As in round 1.

Do not approve migration 045 without the app change for part 5. Do not approve the golden before 045 is decided, because 045 changes policy definitions and the golden would then need regenerating.

---

## 7. What was run, and changes made

- Added to the candidate branch (uncommitted at the time of writing; see the commit that carries this file): `supabase/verification/bsc_effective_rls_test.sql`, `supabase/verification/check_migration_history.mjs`, this audit, `PROPOSED_045_rls_remedies.md`, `proposed_schema_fingerprint.golden.json`, the two RLS run logs.
- Local database only: two clean replays; one legacy-history reset with `--workdir` in a scratch folder (`%TEMP%\...\scratchpad\upgrade`); the manual `039`–`044` upgrade; a rolled-back remedy transaction.
- Nothing in `supabase/migrations/` changed. The golden is unchanged. The main checkout was not touched.
