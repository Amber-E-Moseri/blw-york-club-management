# Email Setup — Gmail via App Password

BLW York Hub sends transactional email through a small Vercel serverless function (`api/email-relay.ts`) that relays messages via Gmail SMTP. This avoids the need for a third-party provider (Resend, SendGrid) and lets you send from `club-sender@example.com` directly.

## Architecture

```
React app
  └── Supabase Edge Function (send-email)
        └── POST /api/email-relay  ← Vercel serverless function
              └── Gmail SMTP (smtp.gmail.com:587)
```

The Edge Function checks providers in order:
1. Gmail relay (if `EMAIL_RELAY_URL` + `EMAIL_RELAY_SECRET` are set)
2. Resend (if `RESEND_API_KEY` is set)
3. SendGrid (if `SENDGRID_API_KEY` is set)

## One-time Google setup

1. Sign in to [myaccount.google.com](https://myaccount.google.com) as `club-sender@example.com`.
2. Go to **Security → 2-Step Verification** and enable it (required for App Passwords).
3. Go to **Security → App Passwords** (search "App passwords" if not visible).
4. Create a new App Password:
   - App: **Mail** (or "Other" → type "BLW York Hub")
   - Device: **Other**
5. Copy the 16-character password shown (formatted as `xxxx xxxx xxxx xxxx`).

This is your `GMAIL_APP_PASSWORD`. Store it as described below — never your normal Gmail password.

## Vercel environment variables

In the Vercel dashboard → your project → **Settings → Environment Variables**, add:

| Variable | Value |
|---|---|
| `GMAIL_USER` | `club-sender@example.com` |
| `GMAIL_APP_PASSWORD` | The 16-char App Password from Google |
| `EMAIL_RELAY_SECRET` | A random 32-char secret (generate with `openssl rand -hex 16`) |

Set all three for **Production** (and optionally Preview).

## Supabase Edge Function secrets

In the Supabase dashboard → your project → **Edge Functions → Manage secrets**, add:

| Secret | Value |
|---|---|
| `EMAIL_RELAY_URL` | `https://<your-vercel-app>.vercel.app/api/email-relay` |
| `EMAIL_RELAY_SECRET` | Same token as the Vercel variable above |
| `EMAIL_FROM` | `BLW York Hub <club-sender@example.com>` |

## Verifying the relay is working

After deploying to Vercel, test the endpoint directly:

```bash
curl -X POST https://<your-app>.vercel.app/api/email-relay \
  -H "Authorization: Bearer <EMAIL_RELAY_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"to":"your@email.com","subject":"Relay test","html":"<p>It works!</p>"}'
```

Expected response: `{"messageId":"<...@smtp.gmail.com>"}` with HTTP 200.

## Security notes

- `GMAIL_APP_PASSWORD` is only ever read inside the Vercel serverless function; it never touches React or the browser.
- The relay requires a Bearer token (`EMAIL_RELAY_SECRET`) so only the Supabase Edge Function can call it.
- The `from` address is always forced to `GMAIL_USER` server-side — callers cannot spoof it.
- Revoke the App Password at any time via Google Account → Security → App Passwords without changing your normal Gmail password.
