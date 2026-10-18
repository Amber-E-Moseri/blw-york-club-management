# Certification status: migrations 040–042 (Bible study classes)

Status as of 2026-10-18, based on the GitHub Actions runs listed below.

## Summary

The `build-test` job passes on `main`. The `certification` job fails on the last completed run. It fails because migrations 040–042 add Bible study class (BSC) objects that the reviewed schema contract does not include yet, and one BSC read policy does not meet the project's authorization rule.

This document records the failure. It does not change any policy, the schema contract, or the golden fingerprint. Those changes need review first.

## Evidence

| Item | Value |
|---|---|
| Latest run on `main` | [39096170295](https://github.com/Amber-E-Moseri/club_management/actions/runs/39096170295) (commit `656c517`): `build-test` passed, `certification` failed |
| Previous runs on `main` | [39095096132](https://github.com/Amber-E-Moseri/club_management/actions/runs/39095096132) (commit `8fb1697`), [39095081560](https://github.com/Amber-E-Moseri/club_management/actions/runs/39095081560) (commit `70d8341`): same pattern. [39092723147](https://github.com/Amber-E-Moseri/club_management/actions/runs/39092723147) (commit `fb1ed2c`): same pattern, and the log below was checked |
| Check script | `scripts/certify-local.sh` (replays all migrations on a local Supabase stack) |
| Result reported by the script on the failing run | 23 of 30 checks passed |

## Failing checks (log of run 39092723147)

The log below was checked for run 39092723147. The newer runs also fail the `certification` job. Their logs were not reviewed in this document.

| Check | Result on the run | What it means |
|---|---|---|
| inventory: exact table list | FAIL: extra `bscs` | The reviewed contract does not list the new table |
| inventory: exact view list | FAIL: extra `contacts_bsc_view` | The reviewed contract does not list the new view |
| grants: authenticated privileges match the reviewed matrix | FAIL on `bscs`: has `DELETE, INSERT, SELECT, UPDATE` | The grant matrix in the contract has no entry for `bscs` |
| grants: `service_role` has only the allowed privileges | FAIL on `bscs` | Same cause |
| authorization: no policy accepts "any signed-in account" | FAIL: `bscs.bscs_read` | The read policy must require an active, approved account, as the project's rules require |
| functions: exact allow-list | FAIL: extra `is_bsc_peer_of_logger(uuid)`, `is_bsc_leader_for_logger(uuid)` | The reviewed function list does not include the two new helper functions |
| parity: schema fingerprint equals the golden fingerprint | FAIL: differs in `views`, `tables`, `functions` | Follows from the four items above |

All other checks passed on that run, including RLS on every public table, anon having no table privileges, storage, and profile privilege guards.

## Why the check exists

The schema contract is the list of objects and grants that have been reviewed. The golden fingerprint is the schema as it was certified. A migration that adds an object must come with a contract change that a reviewer approves. Without that step, the database can drift from the certified schema without anyone noticing. This job caught that drift.

## What must change before the job can pass

These are the required changes. They are not done.

1. **Read policy.** `bscs_read` must require an active, approved account, through the same identity check the other policies use. It must not accept any signed-in account.
2. **Grants.** The grant matrix must state exactly which privileges the application needs on `bscs`. Any privilege not needed should be revoked in a new migration, not by editing 040.
3. **Contract.** `supabase/verification/schema_contract.json` must list `bscs`, `contacts_bsc_view`, and the two helper functions, with the exact grants and owners that a reviewer approves.
4. **Golden fingerprint.** `supabase/verification/schema_fingerprint.golden.json` must be regenerated only after items 1–3 are reviewed and merged.

Migrations 040–042 are already on `main`. The rules say migrations are forward-only. So the fix should be a new migration plus contract updates, not an edit to any applied migration.

## Production and development databases

- The production project's CLI migration history lists 040–042 as applied. Read-only checks in the production SQL Editor confirmed the `bscs` table, `profiles.bsc_id`, and `member_directory.bsc_id`.
- The development project was missing 040–042 when last checked on 2026-10-17. That check showed the People page error and the Daily Confessions error. The Daily Confessions error had a separate cause in the code (fixed on `fix/confession-declarations-embed`).

## How to verify the current state (read-only)

```bash
gh run list --branch main --limit 5
gh run view 39092723147 --log-failed
```

For the database, use the read-only query in the README's manual verification section and the schema fingerprint in `supabase/verification/`. Do not run `db push` or any write statement against production for this issue.

## Decisions needed

- Approve the policy change for `bscs_read` and its exact rule.
- Approve the grant set for `bscs` and the two helper functions.
- Approve the contract and golden fingerprint update. This should be a separate, reviewed change.
