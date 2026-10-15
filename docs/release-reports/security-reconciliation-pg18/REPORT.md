# Security reconciliation evidence (release SHA 60825c0)

> **SQL evidence relocation.** The executable SQL in this report's `sql/` and `proposed-test-only/` folders moved to `supabase/verification/evidence/pg18-security-reconciliation/` with the same sub-paths (history kept with `git mv`). This report, `out/`, `sql/README.txt`, the `.patch` files and `sql/audience_audit_authz_test_60825c0.mjs` stay here. Raw outputs in `out/` still show the original `psql:<file>` names and were not edited.
> Post-102 BSC fixture: `supabase/verification/evidence/rejected-member-privacy-102/proposed-test-only/bsc_test.corrected.sql`. Pre-102 BSC fixture: `supabase/verification/evidence/pg18-security-reconciliation/proposed-test-only/bsc_test.corrected.sql`. Both are kept unchanged.

Environment: PostgreSQL 18.3 on a private cluster (not PG17, not Supabase, not production). The database cert_full1 was replayed from the 000-101 migrations; the migration tree is byte-identical to 60825c0 (git diff of supabase/migrations between 4d4eb3d and 60825c0 is empty). Auth and storage are shims (auth.uid() reads request.jwt.claim.sub). Probes ran inside begin/rollback; nothing persisted.

## Results

| # | Probe | Result | SQLSTATE / rows | Post-state |
|---|---|---|---|---|
| 1 | audience_specs, ordinary member M3 | PASS | OK, 0 rows | n/a |
| 2 | audience_specs, invitee M1 | PASS | OK, 0 rows | n/a |
| 3 | audience_specs, cell leader CL1 | PASS | OK, 0 rows | n/a |
| 4 | audience_specs, administrator AD / coordinator CO | PASS | OK, 2 rows each | n/a |
| 5 | audience_snapshots, M3 / CL1 | PASS | OK, 0 rows | n/a |
| 6 | audience_snapshots, invitee M1 | PASS | OK, 1 row (own only) | n/a |
| 7 | audience_snapshots, AD / CO / anon | PASS | OK 1,1 ; anon 42501 | n/a |
| 8 | Pending applicant BSC: member, leader, direct writes, coordinator RPC | PASS | 42501 / P0001 | unchanged |
| 9 | Active to pending via set_member_status | PASS | P0001 | unchanged |
| 10 | Rejected to pending reopen (reject then reopen) | PASS | OK | bsc_id null |
| 11 | Six privilege refusals (B10, D11, D12, D14, F1, F2) | PASS (stricter) | 42501 permission denied for table profiles | target unchanged, each |
| 12 | A1 visibility (8 vs 9) | PASS (explained) | 8 visible; ninth profile is pending member d004 hidden by profiles_select_scoped | n/a |
| 13 | Inactive BSC leader BLI: sees bsc / roster rows | PASS | 0 rows | n/a |
| 14 | Inactive BSC leader BLI: rename B6 | PASS | OK, 0 rows | unchanged |
| 15 | Inactive BSC leader BLI: assign M3 via RPC / direct write | PASS | 42501 | unchanged |
| 16 | Rejected profile visible to cell leader CL1 (profiles) | FAIL (decision requirement 1) | OK, 1 row | rejected row exposed |
| 17 | Rejected profile visible to cell leader CL1 (member_directory) | FAIL (decision requirement 1) | OK, 1 row | rejected row exposed |
| 18 | Rejected profile, ordinary member M3 / invitee M1 | PASS | OK, 0 rows | n/a |
| 19 | Rejected profile, own row (MR) | PASS | OK, 1 row (self) | n/a |
| 20 | Rejected profile, administrator AD / coordinator CO | PASS | OK, 1 row each | n/a |
| 21 | user_profiles and memberships for rejected MR (CL1, CO) | NOT TESTED | OK, 0 rows | fixture has no such rows |
| 22 | PostgREST direct authenticated HTTP reads | NOT TESTED | n/a | SQL-role equivalent only |
| 23 | Member search functions, active counts | NOT TESTED | n/a | not probed |
| 24 | bsc_members_visible and cell-leader roster functions | NOT TESTED | n/a | call signature not probed |
| 25 | Corrected BSC test (62 checks) | PASS 62/62 | see out/bsc_corrected_out.txt | n/a |
| 26 | Original BSC test | 55 pass, 7 fail | 6 refusals are 42501; A1 is the pending-profile count | out/bsc_out.txt |
| 27 | Audience/audit baseline suite (15 checks, PGlite) | PASS 15/15 | n/a | not a PG18 result |

## Product decisions (recorded, not implemented)

- **Rejected-applicant visibility.** Decision: hide rejected members from ordinary members and cell leaders; keep them visible to administrators and coordinators. Current baseline: fails for cell leaders (rows 16, 17). profiles_select_scoped hides only pending rows from leaders. A forward migration after 101 would change that predicate to exclude 'rejected' as well. Not implemented; see the handoff.
- **Inactive BSC retention.** An account set inactive keeps its bsc_id and the bscs.leader_id row. Its leadership privileges are refused (rows 13-15), so the retained rows grant no access. Reactivation would restore the placement without a fresh staff assignment. Decision needed on whether reactivation should clear BSC placement.

## Proposed test-only patch

proposed-test-only/bsc-test-expectations.patch corrects A1 (9 to 8, with the reason), converts B10, D11 and F1 to the 42501 permission-denied message, and converts D12, D14 and F2 from zero-row expectations to 42501. Authorization assertions are unchanged. Running the corrected file: 62 of 62 pass.

## Confirmed blockers

1. Rejected profiles readable by cell leaders (rows 16 and 17). This contradicts the approved product decision. It is a confirmed RLS gap on the 000-101 baseline.

No other confirmed security blocker was found in this scope.

## Migration 102

Needed only to close blocker 1. Smallest form: change the leader predicate in profiles_select_scoped from `status IS DISTINCT FROM 'pending'` to `status NOT IN ('pending', 'rejected')`. member_directory is security_invoker, so it inherits the change. Requires behavioral tests for every role, including PostgREST. Not implemented.
