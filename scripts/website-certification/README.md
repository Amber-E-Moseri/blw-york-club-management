# Website certification harness (test branch only)

This folder is the certification harness. It lives on `cert/website-d2-harness` and is never part of the release candidate.
The workflow checks out the candidate, verifies its SHA, and overlays this folder before running.

## What the workflows run

- `certify.mjs` (job `certify`): 87 live checks against a disposable local Supabase stack on a GitHub-hosted runner.
  Covers real password sign-in for test accounts, website roles, draft to publish to render, unauthorized access, blog,
  events, inquiries with consent and abuse limits, private media, signed Rhapsody delivery, analytics privacy, audit
  integrity, cleanup of abandoned uploads, and backup and restore into a second database.
- `turnstile-reject.mjs` (job `turnstile-rejection`): the same stack served with Cloudflare's published ALWAYS-FAIL test
  secret (`2x0000000000000000000000000000000AA`). Every public message must be refused and nothing may be stored.
- Turnstile's always-pass secret (`1x0000000000000000000000000000000AA`) is used only by `certify`.

No job uses production credentials, existing Supabase projects or the existing Docker VM.

## Google OAuth: what is and is not certified

Certified by the harness: the database rules for the administrator, editor, publisher, contributor, analyst and member roles,
using real GoTrue password accounts. The Google provider path itself is **not** exercised.

Required real sign-in test (manual, once, with a test OAuth client):

1. In a disposable Supabase project (never production), enable the Google provider with a test Google Cloud OAuth client.
   The authorised redirect URI is `https://<project-ref>.supabase.co/auth/v1/callback`.
2. Add the admin address (for example `https://<test-site>/admin`) to the project's allowed redirect URLs.
3. Create one test Google account, approve its profile as active, and assign it one website role.
4. Open `/admin`, choose "Continue with Google", and confirm the dashboard loads only the screens that role allows.
5. Confirm that a second Google account with no role sees no data and cannot write.
6. Record the date, the test account label (not the address) and the outcome. Do not use a member's real account.

The client code builds `…/auth/v1/authorize?provider=google` (see `site/src/admin/session.ts`). The token is read from the
URL fragment and kept in session storage only.

## Scheduled cleanup: not configured

`website-media-cleanup` is tested once by the certification. Nothing in this repository schedules it. Choosing the mechanism
(for example a Supabase cron job that calls the function with the service key from Vault, or a scheduled workflow with a
repository secret) needs a decision, and must not be done against production without approval.
