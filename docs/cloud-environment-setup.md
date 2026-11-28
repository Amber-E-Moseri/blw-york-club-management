# Cloud environment setup and evidence handling

Companion to `docs/cloud-handover.md`. That file holds the project state and the blockers. This file holds the commands
and handling rules a cloud coding agent needs. It contains no credentials and no database exports.

## 1. Prerequisites

- Node 22.x (verified locally: v22.12.0, npm 10.9.0).
- Git.
- PostgreSQL 17 for authoritative checks. CI runs PG17. PGlite is preliminary only.
- Playwright browsers for the frontend suites.

## 2. Install (run from the repository root, in this order)

```powershell
npm ci
npm --prefix site ci
npx playwright install chromium webkit
```

On Git Bash, set `MSYS_NO_PATHCONV=1` for any command that passes `PUBLIC_URL=/` or `PROD_MOUNT=/hub`. Without it, MSYS
rewrites those values into Windows paths.

## 3. Database checks

PGlite-based (preliminary):

```powershell
npm run test:db:contract
npm run test:db:authz
npm run test:db:attendance
npm run test:db:membership
npm run test:db:website
```

The replay entry point is `openReplay(migrationsDir, { lastFile })` in `supabase/verification/pglite_replay.mjs`. The PGlite
module path must be set in `PGLITE_MODULE`.

PostgreSQL 17 rehearsal (authoritative, scratch database only, no Docker):

```powershell
.\supabase\verification\rehearsal\run-pg17-rehearsal.ps1 -PgBin "C:\Program Files\PostgreSQL\17\bin" -Port 54317 -Scratch "<scratch path outside the repository>"
```

The script replays `000` to `059` into a scratch database and runs the schema contract against the golden. It does not
touch a hosted project or the ledger.

Results conflict and must be re-run before anyone relies on them. The other handover records the contract at 29 of 30,
with a function-body hash parity failure (79 of 84 functions differ in `definition_md5`). An earlier summary recorded 29 of
29. Run the rehearsal once and record the actual output.

## 4. Frontend and browser checks

```powershell
npm run build:hub
npm run build:site
npm run verify:routes
npm run e2e:production
npx playwright test -c playwright.prefix.config.ts
```

`playwright.prefix.config.ts` sets `PROD_MOUNT=/hub`. Its WebKit project stalls on desktop Safari. That stall is an open
release blocker, documented in `docs/production-readiness.md` section 0a.

## 5. Migration lineage note

Two lineages exist. The ROR and BSC objects are in the HEAD lineage (039, 042 to 044). `e315ace` is a different lineage that
diverges at `a09adb8`. Its 039 is `039_event_audience_meeting_delete.sql`. A replay of one lineage cannot reproduce the other.
See `docs/db-reconciliation-phase-a.md`, "Source lineage correction".

## 6. Evidence files

Required for Phase A comparisons. They are not in the repository and must stay that way:

- `blwyork-preview-evidence.json`
- `blwyork-production-evidence.json`

Rules:

- Keep them in a location outside the repository. Do not copy them into the repository, a PR, an issue or chat.
- Do not commit them. `git add` must never pick them up.
- Load them from an explicit path passed as an argument. Do not place them in a directory the tests scan.
- Provide them to a cloud agent only through the owner's approved channel, with restricted access.

## 7. Secure access

- Hosted Supabase access (project URL, service keys, connection strings) is held by the owner. It is not in the repository.
  `.env.example` lists variable names only.
- A cloud agent must not use hosted credentials unless the owner grants a specific, time-limited task.
- Google OAuth client secrets, Sentry DSNs and SMTP credentials are owner-held.
- Do not commit `deno.lock` files. Remove stray lockfiles before committing.

## 8. Local process state at writing

- No scratch PostgreSQL cluster is running. `pg_ctl status` reports no server on this session's scratch data directory.
- The Windows services `postgresql-x64-17` and `postgresql-x64-18` are running. They are system services. Do not stop them.
- Two `node.exe` processes belong to the OpenAI Codex application. They are not part of this work and were left running.
- No development server is listening on ports 4173, 4174, 4183, 4184, 54317 or 54318.
