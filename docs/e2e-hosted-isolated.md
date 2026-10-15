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
