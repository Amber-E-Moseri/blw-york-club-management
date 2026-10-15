# Email verification with a six-digit code (Supabase Auth + Resend SMTP)

Status: **implementation branch `feat/branded-email-otp-103`. Not deployed. Production remains NO-GO.**

This document is the owner runbook for the sign-up verification change. It contains no secrets. Never paste a Resend API
key, SMTP password, Supabase service key or any OTP into this file, a commit, an issue or a chat.

## 1. What the application does

| Step | Who acts | Mechanism |
|---|---|---|
| Request access | Member | `supabase.auth.signUp` (email + password + name). Supabase creates the auth user and sends the code email. |
| Enter code | Member, on `/verify-email` | `supabase.auth.verifyOtp({ email, token, type: 'signup' })`. Supabase checks the code. |
| Resend code | Member | `supabase.auth.resend({ type: 'signup', email })`. Supabase applies its own throttle. |
| Verified | Supabase Auth | `auth.users.email_confirmed_at` is set. The app never sets it. |
| Identity linking (if needed) | Administrator or coordinator | `/admin/identity-review`, section "Accounts waiting for identity linking". |
| Approval | Administrator or coordinator | `/admin/pending`. Refused until the account is linked when a link is required (migration 103). |

No custom OTP generation, storage or comparison exists in the repository. Supabase Auth is the only security authority.

### Installed contracts (verified against the installed packages)

- `@supabase/supabase-js` and `@supabase/auth-js` **2.116.0** (`node_modules`).
- `verifyOtp` accepts `{ email, token, type }`; the sign-up type is `'signup'` (`EmailOtpType`).
- `resend` accepts `{ type: 'signup' | 'email_change', email }` (`ResendParams`).
- `AuthApiError` carries `status` and `code`. The client maps `otp_expired` (403) to "invalid, expired or already used"
  because GoTrue returns the same answer for all three. It maps `over_request_rate_limit` (429) and
  `over_email_send_rate_limit` (429) to rate-limit messages.

Re-check these against the Supabase version pinned at release time before go-live. Do not assume they are unchanged.

## 2. Supabase Auth settings (owner action in the hosted project)

Do these in the Supabase dashboard for the **production** project. The repository's `supabase/config.toml` is local only.

1. **Authentication → Sign In / Providers → Email**
   - Enable **Confirm email** (`enable_confirmations = true`). Without it, a new account signs in with no verification.
   - Keep **Email OTP length** at 6 (`otp_length = 6`).
   - Keep OTP expiry at the default one hour, or set it deliberately (`otp_expiry = 3600`).
2. **Authentication → Emails → Confirm signup**
   - Subject: `Your BLW York Hub verification code`
   - Body: paste `supabase/templates/confirmation-otp.html`.
   - The body **must** contain `{{ .Token }}`. The default Supabase template contains only `{{ .ConfirmationURL }}`,
     which sends a link instead of a code. Confirm the saved template contains `{{ .Token }}` before enabling confirmations.
3. **Authentication → Emails → SMTP Settings** (see section 3 for the values)
4. **Authentication → Rate Limits**
   - Review the email-sent limit. Supabase's SMTP limits apply to every Auth email, including password resets.
   - Set the minimum time between sign-up emails (`max_frequency`) to match the 60-second resend cooldown on the page.
5. **Site URL and redirect allow-list**: confirm the production URL. The code-entry flow does not use a redirect.

**Before enabling "Confirm email" in production:** existing accounts that were never confirmed will be unable to sign in
until they verify. List them first (`auth.users` where `email_confirmed_at is null`, read-only) and decide what to do.
This is a change to production authentication behaviour and needs the release owner's approval.

## 3. Resend configuration (owner action)

Temporary sender: display name **BLW York Hub**, address **info@lwcanada.org**, domain **lwcanada.org**.
Resend is used only as Supabase Auth's SMTP provider. The application never calls Resend directly for codes.

1. **Domain.** In the Resend dashboard, add `lwcanada.org`. Resend shows the DNS records to publish. Publish them yourself,
   in the DNS host you control. Do not share DNS credentials with this project. Wait for Resend to show the domain as verified.
   - Confirm the owner of `lwcanada.org` authorises Resend as a sender.
   - Use the exact record values Resend displays. Do not copy values from this document; they are per-domain.
2. **SPF, DKIM, DMARC.** After Resend verifies the domain, check with a DNS lookup tool that:
   - SPF (`TXT` at the root) includes Resend's include mechanism. Only one SPF record may exist for the domain.
   - DKIM (Resend's selector `TXT`/`CNAME` records) resolves.
   - DMARC (`_dmarc` `TXT`) exists. Start with `p=none` and a reporting address you control, then tighten after reports are clean.
3. **SMTP credentials.** In Resend, create an SMTP-capable API key with the **sending** permission only, restricted to the
   `lwcanada.org` domain. Keep it in a password manager and in the Supabase dashboard only.
   - Host: `smtp.resend.com`. Port: `465` (implicit TLS) or `587` (STARTTLS), confirm both in the current Resend documentation.
   - Username: `resend`. Password: the API key.
4. **Supabase SMTP settings**
   - Sender email: `info@lwcanada.org`. Sender name: `BLW York Hub`.
   - Host, port and username as above. Password: the Resend key.
   - Save and use **Send test email** to a synthetic test mailbox you control (see section 6).
5. **Future switch to a dedicated BLW Hub domain.** Change only: the sender address, the sender name, the Resend domain,
   its DNS records, and the Supabase SMTP sender. No code change is required. Keep the `info@` address as the sender until
   the new domain is verified.

### Delivery limits and throttling

- Resend plan limits (per day and per second) and Supabase's Auth email-sent limit both apply. Check the current numbers in
  both dashboards; this document does not record them because they change by plan.
- The page enforces a 60-second cooldown and shows Supabase's rate-limit messages. The cooldown is UI convenience, not security.
- Sign-up volume at launch should be checked against the lower of the two limits before a publicised launch.

## 4. Security notes

- The six-digit code is validated only by Supabase Auth. Expired, wrong and already-used codes are refused by Supabase.
- A failed or rejected code never marks the account verified. The page reads no verification state from the browser.
- The pending email address is kept in `sessionStorage` only so a refresh keeps the page usable. It is not authoritative.
- Nothing logs the OTP, a password, or an access token. The auth helpers log only a user id and a status line.
- Identity linking requires a confirmed email equal to the person's email, a non-empty reason, an explicit confirmation,
  and refuses an account with a pending email change (migration 103). Automatic linking from name or email similarity is not
  permitted and is not implemented.
- Approval writes an append-only audit row (`profile_approval_audit`). Linking writes `profile_link_audit`. Candidate
  detail reveals write `identity_read_audit` through `get_person_identity`.

## 5. Sample email

`supabase/templates/confirmation-otp.html` is a branded HTML sample with `{{ .Token }}`. Preview it in a browser with the token
replaced by a dummy value before pasting it into Supabase. Do not send a preview to real members.

## 6. Tests and what is NOT yet proven

| Area | Status | Where |
|---|---|---|
| Code input helpers, masking, cooldown, error classification | Unit tested (Jest) | `src/__tests__/emailOtp.test.ts` |
| `/verify-email` behaviour with mocked Auth functions | Component tested (Jest, mocked auth, no real GoTrue) | `src/__tests__/verifyEmailPage.test.tsx` |
| Identity queue client calls and reason gating | Unit tested (Jest, mocked RPC client) | `src/__tests__/identityLinkQueue.test.ts` |
| Migration 103 SQL behaviour (approval gate, link refusal incl. pending email change, queue masking, audit append-only) | PASS 29/29 on in-process PGlite with a GoTrue-shaped auth shim (includes client and owner UPDATE, DELETE and TRUNCATE refusals) (`supabase/verification/identity_link_103_pglite_checks.mjs`). **NOT TESTED** on real GoTrue, PostgREST or a hosted/Docker stack | — |
| Real GoTrue: signup → code email → `verifyOtp` → pending → approval | **NOT TESTED.** Requires an authorised isolated Supabase stack | — |
| Resend delivery, SPF/DKIM/DMARC, inbox placement | **NOT TESTED.** Requires domain verification and a synthetic mailbox | — |
| Existing password login, Google OAuth, password reset | **NOT TESTED** against a live project in this change | — |
| Browser E2E on a running app | **NOT TESTED** in this change | — |

Do not record any NOT TESTED item as PASS. Run the real-authentication checks before any release decision.

## 7. Release blockers

1. Migration 103 has not been applied or certified on a database. The schema fingerprint and the golden file are unchanged by this branch, so the schema contract gate must be re-run and its result reviewed before any release decision.
2. Real GoTrue certification of the full journey is not done.
3. Resend domain verification and SPF/DKIM/DMARC are owner actions and are not done.
4. Production `enable_confirmations` is owner-controlled and must be changed only after the unverified-account review in section 2.
5. The repository is a Create React App with Vercel Functions in `api/`, not Next.js. The App Router guidance in `AGENTS.md`
   does not apply to this code; the implementation follows the existing React Router setup.
