# Clean production deployment

How to stand up Club Management on a **brand-new Supabase project** from the repository alone, with no dashboard-only
steps that change the schema. The previous prototype project is kept (paused) as an archive and as the rollback target.

> Never run the behavioural harnesses against a hosted project. They create (and delete) throwaway accounts and are
> locked to `127.0.0.1` / `localhost`. Hosted verification is the read-only fingerprint query below.

## 0. Before you start

- The repository is on the certified commit and `supabase/verification/README.md` has been run end-to-end locally.
- You have decided who the first administrator is. They will sign up through the normal screen (section 6).
- Nothing below needs a secret value pasted into chat, a ticket or a commit. Secrets are listed **by name only**.

## 1. Create the project

Create a new Supabase project (same region as your users). Do not reuse the archived project. Note the project ref.
New projects ship with modern default privileges, but the certification does not depend on that.

## 2. Configure Auth (dashboard)

These are settings, not schema. Set them before anyone can sign up:

| Setting | Value | Why |
|---|---|---|
| Email provider | enabled; **Confirm email: ON** | the signup trigger links a new profile to an existing person by email, so the email must be proven |
| Email signup | enabled | public signup is how people request access; it can only ever create `member` + `pending` |
| Other providers | off unless you use them | smaller surface |
| Site URL | your production URL | password-reset and confirmation links |
| Redirect URLs | production URL(s) and Vercel preview URL pattern only | no open redirects |
| Minimum password length | 10 or more; leaked-password protection ON if available | |
| SMTP | configure a custom SMTP provider before launch | the built-in sender is heavily rate-limited |
| JWT / API keys | keep the service-role key out of the browser, out of Vercel `REACT_APP_*` and out of git | |

## 3. Apply the schema

```bash
npx supabase link --project-ref <NEW_PROJECT_REF>
npx supabase db push          # applies 000 .. latest, in order, to the empty database
```

The new project's ledger is clean: every row is a real, executed migration.

Then verify the result is exactly what was certified. In the dashboard SQL Editor run
`supabase/verification/schema_fingerprint.sql` (it is a single read-only `SELECT`), save the JSON result to a file and:

```bash
node supabase/verification/check_schema_contract.mjs <saved.json> --golden supabase/verification/schema_fingerprint.golden.json
```

Every line must be `PASS`. Do not continue otherwise.

## 4. Storage

Migration `025` creates the three buckets and their policies, so nothing is created by hand:

| Bucket | Public | Path | Who writes | Limit / types |
|---|---|---|---|---|
| `devotional-images` | yes | `{year}/{MM}/{devotionalId}/{file}.jpg` | admin / coordinator (active) | 10 MB, jpeg/png/webp |
| `testimony-images` | yes | `{userId}/{timestamp}.{ext}` | the owner of that folder; delete also by moderators | 5 MB, jpeg/png/webp |
| `user-media` | yes | `avatars/{userId}.{ext}` | that user only | 5 MB, jpeg/png/webp |

"Public" means an image renders from its URL; listing and writing need an **active** signed-in account. Confirm in
the dashboard that the three buckets exist with these limits (the fingerprint already asserts it).

## 5. Edge Functions and secrets

Deploy only what the product uses:

```bash
npx supabase functions deploy send-email        # JWT verification stays ON (it authorizes the caller itself)
```

Do **not** deploy `process-scheduled-emails` (scheduled email is not an active feature; see
`docs/database-and-identity.md`) or `unsubscribe` (no public unsubscribe link is generated). If one-click
unsubscribe is introduced later, deploy `unsubscribe` with JWT verification disabled and set `UNSUBSCRIBE_SECRET`.

Secrets, by name only (set with `npx supabase secrets set NAME=…`, or in the dashboard):

| Where | Name | Purpose |
|---|---|---|
| Supabase Edge | `EMAIL_RELAY_URL` | URL of the Vercel email relay (`api/email-relay`) |
| Supabase Edge | `EMAIL_RELAY_SECRET` | shared secret between `send-email` and the relay |
| Vercel (server) | `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `EMAIL_RELAY_SECRET` | the relay's Gmail SMTP login |
| Vercel (browser, public by design) | `REACT_APP_SUPABASE_URL`, `REACT_APP_SUPABASE_ANON_KEY`, `REACT_APP_PUBLIC_APP_URL`, `REACT_APP_VAPID_PUBLIC_KEY` | client configuration |
| Vercel (optional) | `REACT_APP_SENTRY_DSN`, `REACT_APP_GOOGLE_DRIVE_API_KEY`, `REACT_APP_GOOGLE_DRIVE_UPLOAD_ENDPOINT` | integrations |

Rules: never put anything secret behind a `REACT_APP_` name (CRA bundles it into the browser). Do not set
`REACT_APP_UNSUBSCRIBE_SECRET`. Generate fresh secrets for the new project; do not copy the archived project's.
Push *sending* is not implemented (there is no `send-push` function), so no VAPID private key is required yet; the
public key is only for browser subscription.

## 6. Create the first administrator (one time)

A clean project has no administrator, and public signup can only create `member` + `pending`. So the first
administrator is created by an explicit, audited action by the **database owner**:

1. The person signs up in the app with their real email and confirms it. They see "awaiting approval".
2. In the dashboard SQL Editor (you are connected as `postgres`) run:

   ```sql
   select public.bootstrap_first_administrator('their.real@email.example', 'initial coordinator');
   ```

   It promotes that existing account to `coordinator` + `active`, creates the matching person/membership records,
   writes a row to `admin_bootstrap_audit`, and refuses to run again (or while any active administrator exists). It
   creates no account and sets no password, and no API role can execute it.
3. Optionally remove it afterwards: `drop function public.bootstrap_first_administrator(text, text);`
4. From now on every role change goes through the normal workflow (coordinators in the app).

## 7. Deploy the app against the new project

1. In Vercel set the **Preview** environment variables to the new project and open a preview deployment.
2. Smoke test on the preview (below). Fix anything before touching Production.
3. Set the **Production** environment variables to the new project, merge, and let Vercel deploy.
4. Smoke test Production: sign in as the administrator, approve a second test signup, load People, Contacts,
   Meetings, Events; upload an avatar; save email preferences; confirm a pending account sees only the approval screen.

## 8. Rollback to the archived project

The archived project is untouched. To roll back: restore the previous Production environment variable values
(`REACT_APP_SUPABASE_URL` / `REACT_APP_SUPABASE_ANON_KEY`) in Vercel and redeploy. Un-pause the archived project first
if it is paused. Retire the archived project only after the new one has run cleanly and you explicitly approve.

## Schema fingerprint certification, in one line

`schema_fingerprint.sql` → JSON → `check_schema_contract.mjs [--golden …] [--same-as …]`. The same check works on a
local replay and on a hosted project, so "production equals what we certified" is a command, not an opinion.
