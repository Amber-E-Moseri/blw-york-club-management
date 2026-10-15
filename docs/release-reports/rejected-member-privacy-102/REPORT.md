# Migration 102: rejected-member privacy (evidence)

Baseline: 60825c0. Evidence base: 4fff731. Migration: supabase/migrations/102_rejected_profile_privacy.sql.

## Change
- profiles_select_scoped: the cell-leader branch now excludes status 'rejected' as well as 'pending'.
- user_profiles_select_scoped: the cell-leader branch requires the profile to be neither pending nor rejected (read through the caller's RLS). The owner, staff and self branches are unchanged.
- No function, table, grant or column added; no historical migration edited.
- member_directory (security_invoker) inherits the profiles rule.

## Results (PostgreSQL 18 private cluster, not PG17, not Supabase)

| Suite | Baseline 60825c0 | After 102 |
|---|---|---|
| Focused rejected-privacy test (rejected_profile_privacy_test.sql) | 24 PASS / 4 FAIL (P4, P5, D2, U1: cell-leader exposure) | 28 PASS / 0 FAIL |
| BSC suite, corrected expectations (A1 = 7 after 102) | not run against baseline (A1 would be 8) | 62 PASS / 0 FAIL |
| People-privacy suite (PGlite, 000-102 migrations) | n/a | 35 PASS / 0 FAIL |
| Membership SQL suite (68 checks, grants layer, 100-frontier DB) | n/a | 68 PASS / 0 FAIL |
| Schema contract structure checks (no golden) | 33/33 | 33/33 |
| Migration replay 000-102 | n/a | 103 files applied (ledger 103) |
| Schema fingerprint parity vs golden | fails (stale golden, pre-existing) | not re-run; golden not regenerated |
| PG17 replay 000-102 | NOT TESTED | NOT TESTED |
| PostgREST real JWT reads | NOT TESTED | NOT TESTED |

## Authorization results (after 102)
- Ordinary member: own profile only (P1), no rejected rows (P2, D1), no rejected user_profiles (U6). PASS.
- Invitee: no rejected rows (P3). PASS.
- Cell leader: no rejected rows in profiles, member_directory or user_profiles (P4, D2, U1); active C1 members still visible (P5: 2 of 2; U2). PASS.
- Rejected member: own profile and own user_profiles only (P6, D5, U5). PASS.
- Administrator and coordinator: see rejected profiles and rows (P7, P8, D3, D4, U3, U4). PASS.
- Anonymous: 42501 on profiles, member_directory and user_profiles (P10, D6, U7). PASS.
- Rejected -> pending reopen through set_member_status: OK; reopened account hidden from leader (W3) and visible to administrator (W4). PASS.
- Rejected row preserved (R1). PASS.

## Equivalent paths reviewed
- member_directory: inherits profiles rule; PASS (D2 after 102).
- cell_leader_pending_roster (091): returns pending applicants only; not changed; rejected rows not tested: NOT TESTED.
- bsc_members_visible: call signature not probed: NOT TESTED. Rejected accounts cannot hold a BSC assignment (assignment requires active), so exposure is not expected.
- memberships and audience_snapshots: no leader path to rejected profiles found; memberships leader/coordinator rows NOT TESTED (fixture has no row).

## Not tested / open
- PostgREST with real authenticated JWTs (no disposable Supabase in this environment).
- PG17 replay of 000-102.
- Member search and active-count functions.
- Golden fingerprint replacement (not done; not requested).

## Proposed test-only patch
proposed-test-only/bsc-test-expectations-after-102.patch changes A1 to 7 (pending MP and rejected MR hidden), and converts the six privilege refusals to the stricter 42501 expectation. Authorization assertions are unchanged.

## Phase 2: read paths (supabase/verification/rejected_profile_readpaths_test.sql)

Synthetic fixture: a rejected member with a linked person row, a rejected membership row, and a BSC placement injected by the owner (the workflow never creates one).

| Path | 000-101 baseline | 000-102 |
|---|---|---|
| Cell leader active-count and name search | FAIL (C2, S2, S3: leader sees the rejected member) | PASS |
| member_directory search by name (cell leader) | FAIL (S3) | PASS |
| Ordinary member and cell leader membership reads of the rejected row | PASS | PASS |
| Rejected member reads own membership row | FAIL (existing migration 100 rule: self-read only while active) | FAIL (unchanged by 102; decision needed) |
| people row for rejected member (cell leader, ordinary member) | PASS (095) | PASS |
| bsc_members_visible, cell_leader_pending_roster | PASS | PASS |
| Export (member, cell leader refused with 42501) | PASS | PASS |
| find_person_by_email, get_person_identity refusals | PASS | PASS |
| Administrator, coordinator and staff reads | PASS | PASS |

Counts: baseline 18 PASS / 4 FAIL; after 102 21 PASS / 1 FAIL (the membership self-read, recorded as a decision, not weakened).
Files: out/rp_baseline_out.txt, out/rp_r102_out.txt.
Candidate fingerprint (NOT the golden): out/schema_fingerprint.candidate-102-NOT-GOLDEN.json.
