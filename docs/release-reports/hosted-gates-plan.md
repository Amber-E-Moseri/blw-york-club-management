# Hosted certification gates: preparation plan (not executed)

Status: prepared only. No database-writing test has run against any hosted project. Production (`rjtstjmtddqhesexltbj`)
is out of scope for every gate below.

## Gate 0: identity and isolation (read-only)

Already on `main` via PR #7 (`hosted-certification.yml`, environment `Preview`). It checks the exact Preview project ID
(`yziuhtxtznginhdpqurb`), rejects the production ID, requires `CERT_SUPABASE_URL` to name the same project, and reads
aggregate counts (migrations recorded, public tables, auth users, profiles, people) inside one read-only transaction.

Still needed before any writing gate: confirm the project is isolated and safe to use. Specifically, the read-only result
must show the migration ledger state, and the data must be confirmed as disposable test data (not real members). Until a
human reviews that output, no writing gate runs.

Next manual step: a maintainer runs the `Hosted certification (Preview, read-only verification)` workflow from the Actions
tab on `main`. (Dispatch by the assistant was denied by tool permissions.)

## Gate 1: real GoTrue, JWT and PostgREST

Writes: creates throwaway auth users and rows. Requires migrations 000-101 applied to the Preview project, which is a
write (migration) and needs explicit approval first.

Plan: reuse `supabase/verification/auth_workflow_certification.mjs`, `authorization_certification.mjs`,
`storage_certification.mjs` and `email_push_certification.mjs` against `CERT_SUPABASE_URL` with the Preview anon and service
role keys. Each harness already refuses non-local URLs; a hosted run needs a reviewed change to that guard that allows only
the exact Preview project ID, with production refused by name. That change is not made yet.

## Gate 2: security regression

`security_gap_regression_test.mjs` and `edge_function_security_certification.mjs`. Same URL-guard requirement as Gate 1.
The edge-function gate also needs the Preview project's function secrets, which are not in the Preview environment.

## Gate 3: Playwright release smoke

`playwright.release.config.ts` and `e2e/release-smoke.spec.ts` need `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
`SUPABASE_SERVICE_ROLE_KEY`, and the spec asserts a local URL. A hosted run needs the same guard change as Gate 1. The
default `playwright.config.ts` specs also need the same keys.

## Authorization required before each writing gate

1. Approval to apply migrations 000-101 to the Preview project (write).
2. Approval of the URL-guard change that allows exactly the Preview project ID.
3. Approval to run the writing harnesses against the Preview project after Gate 0 output has been reviewed.

## Not in scope

Production (`rjtstjmtddqhesexltbj`), golden fingerprint overwrite, merges, deploys, Docker.
