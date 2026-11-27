# Reconciliation plan: converging the two lineages into one schema

Decision (owner, approved): the common prefix through 038 is accepted, and divergence from 039 is accepted. The target is
one unified application schema containing the complete approved feature set of both lineages. Sources:

- Current remediation lineage: migrations 000-059 (the base, unchanged).
- Original lineage `origin/feat/website-cms-integ-106`: migrations 000-116. This is the feature source.
- `origin/cert/website-d2-50f8aaa` (ends at 110): supporting material only. It is not a replacement for the 116 lineage.

Nothing is concatenated and nothing is replayed blindly. Each target object is taken from a verified definition, adapted
to the base, and tested. Forward-only numbering starts at 060. Migrations 000-059 are not edited, renumbered or
re-recorded in any ledger.

## 1. Object mapping (measured, PostgreSQL 17.11)

Method: the base chain (000-059) is replayed on PostgreSQL 17.11 and fingerprinted. The original lineage's 039-106 files
are then applied cumulatively, each in its own transaction, and the result is fingerprinted. The two fingerprints are
diffed by object. All 68 original files (039-106) apply without error on the base in that order. The result is a
measured superset: it shows what the original lineage adds or changes, not whether each change is correct.

| Kind | Count | Notes |
|---|---|---|
| Tables added | 23 | Assignments, saved groups and members, audience specs and snapshots, communication messages, recipients, deliveries and audit, identity and profile-link audit tables, fellowships, member and cell audit tables, BSC assignment audit |
| Tables changed | 34 | Policies, triggers, privileges, columns and constraints, not just definitions |
| Views changed | 0 | |
| Functions added | 87 | Audience resolution and snapshots, assignments, communications, identity audit, BSC assignment and visibility, ROR and cell progress helpers, contact attribution |
| Functions changed (same name and signature) | 72 | Includes the website functions (which are the same CMS objects, adapted) and shared authorization helpers |
| Storage buckets and policies | unchanged | |

Which tables changed, and how (policies unless stated):

- `bscs`: `bscs_manage` (broad ALL) removed; scoped insert, update and delete added; `bscs_read` predicate changed.
- `profiles`: `profiles_select_scoped` predicate changed (pending and rejected rows hidden from leaders); `profiles_self_update_active`
  added (see decision D4 below); four triggers added (cell placement guard and audit, BSC and cell leadership release on deactivation).
- `meeting_attendances`: all four policies predicate-changed (the scoped attendance model).
- `memberships`: `memberships_read` predicate changed.
- Other changed tables are listed by the diff script; most are trigger or policy additions.

## 2. Disposition by group

| Group | Original source | Disposition | Target |
|---|---|---|---|
| BSC scoped authorization | 055, 058 (and 040/044 history) | **Adopt the scoped model.** Retire the broad `bscs_manage` (base 040/044). | 060 (done, tested) |
| Website CMS (047-059 on base) | 107-116 (CMS lineage) | Already adapted and converged on the base (047-059). Verified equal by 216 CMS tests and 35 role tests. | none further |
| Profile self-edit (D4) | 051 `profiles_self_update_active` | **Security decision required** (see section 4). The base uses the guarded `user_profiles` path and forbids direct `profiles` UPDATE for active members. | pending |
| Attendance five-state (D3) | 046-era and 074 | Preserve values. Flag ambiguous rows for review. Do not fabricate or reclassify. | pending evidence |
| Membership directory and reconciliation | 052 (directory), 080 | The directory must not expose email or phone to ordinary members (handover rule 8). | pending |
| Assignments, saved groups, targeted communications, audience infrastructure (060-106 of the original) | 059-106 | New objects; adopt after dependency and fixture tests. | next increments |
| Identity protections and duplicate detection | 087-103 | Detect and report only. No automatic merge. | next increments |

## 3. Increments (each bounded, tested, committed and pushed)

1. **060 BSC scoped policies** (done). Tests: `supabase/verification/reconciliation/bsc_scoped_pglite.mjs`, 16/16 positive and
   negative. Negative control: the same checks against the base chain fail on "cell leader can DELETE their own BSC". The
   attendance guard admits 060 by exact name.
2. Object-by-object adoption of the 23 new tables and their functions, with dependency order and per-object tests.
3. Audience infrastructure and assignments, then saved groups and targeted communications.
4. Identity protections and the duplicate report (report only).
5. Membership directory (privacy-preserving) and administrative reconciliation.
6. Attendance five-state migration with a precondition check that reports ambiguous rows and blocks only if the constraint cannot validate.

## 4. Decisions escalated (security and material)

- **D4, active-member profile self-edit.** The original lineage (051) lets an active member UPDATE their own `profiles` row,
  with privileged columns guarded by the trigger. The base forbids this and routes self-edits through `user_profiles`. The
  owner's D4 says active members may edit permitted personal fields; it does not say which table. Recommendation: keep the
  base's `user_profiles` path, because the privileged-column guard on `profiles` cannot cover every future column, and the
  contract's profile allow-list stays exact. Owner to confirm.
- **Attendance ambiguity.** Rows that cannot satisfy the five-state check are to be flagged and preserved. Which records
  count as ambiguous needs the hosted evidence (section 5).
- **Duplicate identities.** Detect and report only; no merge is authorised.

## 5. Golden and contract policy

- The committed golden describes 000-059. Adding 060 changes the BSC policies, so the parity check fails on `tables` at
  061 files. This is expected and is not weakened: the PostgreSQL 17 rehearsal with the canonical replay (000-059) still
  passes 30/30.
- Regenerating the golden is done only by the owner-reviewed CI artifact (`update-golden-fingerprint.yml`, now expecting
  61 migrations ending at 060). It must not be generated locally with PGlite, and it is not committed by the workflow.
- Hosted evidence: the Preview and Production catalog files are authorised for secure transfer. They are not committed.
  Hosted equivalence is not claimed until those files are compared.

## 6. What this plan does not claim

- No hosted baseline equivalence. No hosted migration, reset or ledger change. No production action.
- No full convergence yet. Increments 2-6 are open.

## 7. Increment log (authoritative; newest last)

| Migration | Scope | Tests | Status |
|---|---|---|---|
| 060 | Scoped BSC write policies; `bscs_manage` removed | bsc_scoped 16/16 | committed |
| 061 | Shared audience infrastructure; read and resolver restricted | audience 18/18 | committed |
| 062 | Profile shared-field mirror (student_number, avatar_url) between profiles and user_profiles | profile_sync 8/8; D4 boundary 19/19 | committed |
| 063 | Scoped `is_bsc_leader_of` (active, leads the BSC, in the BSC's cell) | bsc_leader_scope 7/7 | committed |
| 064 | Individual assignments; assignee may change only status (guard); cell-leader scope via `is_cell_leader_of_user` | assignments 23/23, including a control that shows the guard is what refuses title, author and due-date changes | committed |

| 065 | Canonical cell leadership: `cells.leader_id` is the authority. `is_cell_leader_for_profile` rewritten (active caller who leads the target's cell; pending and rejected applicants excluded); `meetings_leaders_read` and `meetings_manage_scoped` and `respond_to_meeting_invitation` use the canonical check | leadership_lifecycle 34/34; control without 065: 23/34 | committed |

Golden: the PostgreSQL 17 golden for 061 is the CI artifact of run `45950530304` (artifact `15176716644`), not yet committed.
The golden guards expect 66 migrations ending at 065. Structural contract on the 065 replay: 29/29.
Schema diff 064 to 065 (PG17): `is_cell_leader_for_profile`, `respond_to_meeting_invitation` (definition), `meetings` (policies). Nothing else.

### Resolved: cell leadership authority (owner decision, implemented in 065)

The authority is `cells.leader_id`. The profile role `cell_leader` confers no cell authority. The earlier open question is closed.

### Pending owner decisions (not cell-specific, left unchanged)

- `announcements_manage` grants posting to any active `cell_leader`-role account. Not cell-specific. Application: the nav and `canPost` use the role. Decide whether posting should be coordinator and admin only, or should require a leadership assignment.
- `prayers_leadership_read` lets any `cell_leader`-role account read leadership-visible prayer requests across cells. Decide whether it should be scoped to the reader's cell.
- `user_profiles` leader visibility includes phone and bio for the cell's members. Decide whether leaders need those fields.
- Historical records: run `supabase/verification/reconciliation/leadership_inconsistency_report.sql` (read-only) on each target project and review. No roles or leadership assignments are rewritten automatically.

### Previously open: which profile role means "cell leader" (closed)

The base has two definitions of a cell leader:

- `is_cell_leader_of(cell_id)` (used by the BSC policies, and now by assignments) is true when `cells.leader_id = auth.uid()`.
- `is_cell_leader_for_profile(target)` (used by profile and user_profiles visibility) requires `profiles.role = 'cell_leader'`.

A leader who is recorded only in `cells.leader_id` can lead BSCs and assign tasks, but cannot see the members' profile rows.
Assignments avoid this with the definer helper `is_cell_leader_of_user`. The profile policies are unchanged. Owner decision needed:
which definition is authoritative, and whether the profile visibility policy should follow `cells.leader_id`.
