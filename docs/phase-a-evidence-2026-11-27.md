# Phase A evidence: baseline reconstruction (2026-11-27)

Checkpoint: remote `remediation/blw-york-wave1-5` at `281737e` (verified; the expected checkpoint). This note records
what was reproduced in the cloud environment, what the 29/30 discrepancy is, and the lineage map. It contains no
credentials, no database exports and no hosted data. Hosted evidence files were not available and nothing here claims
equivalence with them.

## 1. Reproducible PostgreSQL 17 environment (no Docker)

- Binaries: `@embedded-postgres/linux-x64@17.11.0-beta.19` (PostgreSQL 17.11), installed from npm into a scratch folder
  outside the repository. The matching handover run used 17.11.
- Server run as an unprivileged user (initdb refuses root). Scratch data directory outside the repository.
- Client: the system `psql` (version 16). Server and client were compatible for every statement used.
- Harness: `supabase/verification/rehearsal/run-pg17-rehearsal.sh` (new, Linux and macOS). It refuses CRLF migrations and
  refuses a scratch folder inside the repository. The Windows script is unchanged.

## 2. Replay results

| Run | Migrations | Contract | Notes |
|---|---|---|---|
| LF migrations (repository state, `i/lf`) | 60 of 60 applied | **30 of 30 pass** | Parity with the golden passes. |
| LF migrations, bash harness (repeat) | 60 of 60 | 30 of 30 | Same result from the committed script. |
| CRLF copies of the same migrations | 60 of 60 | **29 of 30** | Parity fails in the `functions` section only. |

Reproducing the failure: replay CRLF copies (`sed 's/$/\r/'`) of the 60 migrations. All 84 functions then differ from the
golden in `definition_md5`, and in nothing else (owner, EXECUTE grants, security mode, search_path and volatility match).
This is the failure mode the handover describes.

## 3. The 29/30 versus 29/29 discrepancy and the 79 hashes

- The LF replay passes all 30 checks. A CRLF working copy reproduces the reported failure exactly, with the same section
  and the same field.
- The handover reports 79 of 84 functions differing. The CRLF experiment gives 84 of 84. Five functions are unexplained by
  a uniform CRLF copy. A mixed-ending working copy would give a count between 0 and 84 that depends on which migrations
  were CRLF, so the handover's count is consistent with mixed endings.
- Root cause (mechanism proven): the function body text, which `pg_get_functiondef` hashes, contains the line endings of
  the migration file. A Windows checkout with `core.autocrlf` produces CRLF migration files.
- Repository fix (no weakening): `.gitattributes` sets `supabase/migrations/*.sql text eol=lf`, so every checkout is LF.
  `scripts/__tests__/migration-eol.test.cjs` fails on any CR byte in a migration on disk. The bash harness refuses CRLF.
  The golden and the contract are unchanged.

Owner action to close the count question: on the originating Windows clone, run `git ls-files --eol supabase/migrations`
and `git config core.autocrlf`, and report the output. If the working copy shows `w/crlf` for any migration, that confirms
the mechanism. The golden must not be regenerated to match a CRLF working copy.

## 4. Settled checks that the chain reproduces

- Replay from empty: 60 of 60 (LF).
- Authorization-relevant checks in the contract: all pass (RLS on every table, anon grants, default ACLs, the profile
  policy allow-list, identity keys, function EXECUTE grants, storage policies, the signup trigger).
- Limits, stated honestly: the contract's parity step deliberately excludes `extensions` and `default_privileges`
  (`check_schema_contract.mjs`, `stable()`). The golden lists `supabase_vault` and `pg_stat_statements`, which a plain
  PostgreSQL 17 install does not provide. Extension parity therefore cannot be checked locally, and is not checked by the
  parity step.

## 5. Lineage map (no migration written)

The two lineages are identical through migration 038 (39 of 39 files byte-identical). They diverge at 039.

- Unified sequence (`supabase/migrations`, 000-059): 60 files.
- Cert lineage (`origin/cert/website-d2-50f8aaa`, 000-110): 111 files.
- Names only in the unified sequence: 21 (`039_ror_reading_streaks` through `059_web_role_non_empty_permissions`). These
  are the ROR, the scoped BSC model, the membership and attendance authority migrations and the website CMS.
- Names only in the cert lineage: 72. From 039 they include `039_event_audience_meeting_delete` through `059_shared_audience_infrastructure`,
  then 060-110 (audience, assignments, communications, membership and identity). Some of the same numbers mean different
  things in the two lineages (for example 039, 040, 045 and 046).

These are two independent histories after 038. They cannot be replayed together, and a number collision cannot be
resolved by renaming alone. Per the handover (step 3), the lineage map needs owner approval before any reconciliation
migration is written. No reconciliation migration has been written in this pass.

## 6. Not proven in this pass

- Hosted Preview and Production comparison: the evidence files are not in the environment, and the transfer is an owner
  action. No equivalence with either hosted schema is claimed.
- Representative data fixtures and the starting baselines: depend on the hosted evidence.
- Phase B reconciliation migrations: blocked on owner approval of the lineage map.
- Phase C certification (fresh, Preview-shaped and Production-shaped upgrades): not run. The chain replays from empty;
  the upgrade paths need the baselines above.
- The 11 environment-gated Supabase tests: need an isolated project.
- Desktop WebKit service-worker stall: open release blocker; not changed here.
- Hotfix branch `hotfix/p0-login-null-response` (`25e9673`, PR #98) is now on the remote. It is independent of this branch,
  and is not merged here.

## 7. Production

Production remains on HOLD. Nothing here runs against a hosted project. No ledger, migration, reset or deployment was
performed.
