# Browser E2E against a hosted, isolated Supabase project

Scope: the Playwright release suites (`release-smoke`, `meeting-audience`, `affected-flows`) run locally in Chromium
against a disposable hosted Supabase project. Nothing here creates, resets or modifies a project.

## Prerequisites (owner authorization required for each item)
1. A dedicated, disposable Supabase project, not production and not a protected certification project.
2. Its migrations applied from the candidate SHA (000 through the frontier, 103 when integrated).
3. One coordinator account, provisioned by the owner bootstrap, and one existing cell id.
4. A service-role key for that project only. Never commit it, and never reuse a production key.

## Environment (set in the shell, never in a file)
| Variable | Value |
|---|---|
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `E2E_HOSTED_ISOLATED` | `1` (required for any non-loopback host) |
| `E2E_ISOLATED_HOST` | `<project-ref>.supabase.co` (must equal the URL host exactly) |
| `SUPABASE_ANON_KEY` | the project's anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | the project's service-role key |
| `E2E_COORDINATOR_EMAIL` / `E2E_COORDINATOR_PASSWORD` | the provisioned coordinator |
| `E2E_CELL_ID` | an existing cell id (meeting-audience only) |

The guard in `e2e/support/env.ts` refuses any other host. Loopback hosts need no extra variables.

## Run
1. Discovery (no network): `npx playwright test -c playwright.release.config.ts --list`
2. Execution: `npx playwright test -c playwright.release.config.ts`. The local dev server starts with the hosted URL.
3. Evidence: traces, screenshots and the list reporter output go to `test-results/` and must be attached to the
   certification record. Do not commit them.

## Cleanup
Each suite deletes the synthetic accounts it creates. A failed cleanup fails the run. Check the project's auth user
list afterwards for any leftover `@example.test` accounts from this run.

## Hosted CI workflow (review-only)
`.github/workflows/e2e-hosted-isolated.yml` runs only on `workflow_dispatch`. It has no push or pull-request trigger.

Required inputs: `candidate_sha` (full 40-character SHA). The job rejects anything else, checks out exactly that commit,
and fails if `HEAD` differs from the pin.

Required GitHub environment `Hub-Certification`:
- Protection rules: required reviewers from the owner, and "prevent self-review" enabled.
- Deployment branches: none. The environment is never used by a deploy job.

Secrets (names only; values come from the owner, never from a file in the repository):

| Secret | Purpose |
|---|---|
| `E2E_ISOLATED_HOST` | exact hostname of the isolated project, `<ref>.supabase.co` |
| `E2E_DENIED_HOSTS` | comma-separated production and Preview hostnames; must not be empty |
| `SUPABASE_URL` | `https://<ref>.supabase.co` (no path) |
| `SUPABASE_ANON_KEY` | the isolated project's anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | the isolated project's service-role key (synthetic data only) |
| `E2E_COORDINATOR_EMAIL` / `E2E_COORDINATOR_PASSWORD` | the provisioned synthetic coordinator |
| `E2E_CELL_ID` | an existing synthetic cell id |

Concurrency: the workflow uses the shared group `hub-certification-hosted`. The authentication certification workflow must use the same group string, so the two never run at once on the certification project.

Workflow permissions: `contents: read` only. No other token scopes are granted. Secrets are not echoed; the guard prints
only the reason for a refusal.

The guard (`scripts/e2e/check-target.mjs`) refuses: a non-https hosted URL, credentials or paths in the URL, a host that
is not `<20-char-ref>.supabase.co`, a host other than the named one, a missing or empty denylist, a denylisted host or
ref, a missing `E2E_HOSTED_ISOLATED=1`, a missing key or coordinator credential, and a candidate pin that is not a
full SHA. Its unit checks (`scripts/e2e/check-target.test.mjs`) need no network: `node --test scripts/e2e/check-target.test.mjs`.

## Synthetic data and cleanup
- All accounts use `@example.test` addresses and a random password per run. Names start with `e2e.`.
- `release-smoke` and `affected-flows` delete their accounts in `afterAll`. A failed deletion fails the run.
- `meeting-audience` deletes its meetings and attendance rows, then its accounts.
- `scripts/e2e/check-leftover-accounts.mjs` runs `if: always()` after the suite. It lists any `e2e.*@example.test`
  account created after `E2E_RUN_STARTED_AT` and fails the run. It reports only; it never deletes.
- Any leftover is removed only after the owner approves it.

## Before the first run (owner)
1. Pin the candidate SHA in the dispatch input. Do not use a branch name.
2. Action pins: the three actions are pinned to full commit SHAs (checkout, setup-node, upload-artifact at v4). Re-resolve them if the owner updates the actions.
3. Confirm the isolated project is separate from production and Preview, and that its hostname is in `E2E_ISOLATED_HOST`.
