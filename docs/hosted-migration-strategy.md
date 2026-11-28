# Migration chain versus hosted upgrade

Two different things share the number space and must not be confused.

## 1. Fresh-install chain

`supabase/migrations/000` to `072` is the replayable chain for a fresh database. Every file replays on a clean database
(verified on PGlite and on PostgreSQL 17 by the reconciliation and rehearsal suites). Replay success is evidence about the
chain only. It says nothing about any hosted database.

## 2. Hosted upgrade

Hosted databases already record some of these numbers in their migration ledgers, and the candidate files 060 to 072 were
written against the reconciled lineage, not against what each hosted project has applied. Therefore:

- No candidate migration is applied to a hosted environment because it replays on a fresh database.
- Hosted ledgers and data are not repaired, reset, or re-numbered by this work.
- Each hosted project needs its own reviewed plan: a read-only inventory of applied versions and policies, a dry run on
  a copy, a backup, and an explicit owner approval before any statement runs.
- Migrations that rewrite historical rows (none in 060 to 072) would need a snapshot first. The attendance trigger fix in
  071 is a function change only; it updates no row.

## Status

Production: HOLD. Hosted writes: none authorised. The read-only inventory query and the per-project upgrade plan are open
items for the owner.
