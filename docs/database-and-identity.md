# Database, identity and migration rules

This document is the contract for the Club Management database. The migrations in `supabase/migrations/` are the
**only** way the schema changes. Nothing is ever fixed in the dashboard, and no SQL file outside `supabase/` is
executable (a test fails if one appears).

## Canonical identity model

| Identifier | Means | Used for |
|---|---|---|
| `user_id` | the authenticated account: `profiles.id`, which is `auth.users.id` | **account-owned state**: `email_preferences`, `push_subscriptions`, `push_notification_log`, `habit_entries`, `event_rsvps`, `user_profiles`, … |
| `person_id` | the human in the People model (`public.people`) | **human-owned state**: contacts, memberships, the lifecycle contact → member |
| membership | a person's relationship to the club (`public.memberships`) | status/role over time |

Rules:

- State that belongs to a **signed-in account** and is protected by `auth.uid()` is keyed by `user_id`.
- State that belongs to a **human who may not have an account** is keyed by `person_id`.
- `member_id` is **not** an account identifier. It survives only where it already has its own meaning
  (`email_log.member_id` = recipient of a sent email; `contacts.member_id` = the profile a contact converted into;
  `devotional_views` / `zoom_attendance`). Do not introduce it in new tables.
- `email_preferences` has one row per account (primary key `user_id`). `push_subscriptions` has one row per device
  (`id`; `endpoint` is unique; many per `user_id`). `push_notification_log` has one row per recipient and is written
  only by the backend (`service_role`); clients can read their own history.

## Approval is enforced by the database

A new signup is always `member` + `pending` (`handle_new_user()` ignores signup metadata). A pending or rejected
account:

- can read **only its own profile** (so the "awaiting approval" screen works);
- is refused by every policy that used to accept "any signed-in user" (they now require `is_active_member()`);
- holds no administrative power, even if it once did (`is_coordinator()` and friends require `status = 'active'`).

`role`, `status` and `admin_role` on `profiles` can be changed only by: a coordinator (role/admin_role), an
admin or coordinator (status, through `approve_pending_member` / `reject_pending_member`), or the backend/database
owner. A trigger enforces this even if a mistaken policy were added, and the release certification fails if
`profiles` or `user_profiles` carry any policy that is not on the allow-list.

Never authorize from `user_metadata`: signed-in users can edit it. Authorization reads the `profiles` table.

## Migration rules

1. **Forward-only.** Never edit a migration that has been applied anywhere. Add a new one.
2. **Protected migrations** `006_contact_enhancements.sql`, `007_testimonies_full.sql` and
   `008_email_notifications_additive.sql` are shared history and must stay byte-identical (a test checks their hash).
3. Numbers are contiguous (`000`, `001`, …). A test fails on a gap or duplicate.
4. No destructive statements (`drop table`, `drop schema`, table wipes) in the chain (a test enforces this).
5. A migration that converts existing data must **prove** the conversion or abort with a clear message. It never
   discards data silently (see `021`).
6. **Every new table must, in the same migration**, enable RLS, create its policies, and `GRANT` exactly the
   privileges those policies need. New tables receive **no** automatic API access. Then add the table to
   `supabase/verification/schema_contract.json` and regenerate the golden fingerprint.
7. **Every new function must** pin `search_path`, and `revoke … from public, anon, authenticated, service_role`
   followed by explicit `grant execute` to only the roles that need it. PostgreSQL gives new functions `PUBLIC`
   execute by default and a migration cannot change that default for Supabase-managed roles, so the certification
   fails on any function that is not on the allow-list in `schema_contract.json`.
8. Policies never rely on `auth.role() = 'authenticated'` alone; use `public.is_active_member()`.

## Privileges (final matrix)

- `anon`: no access to any table or sequence.
- `authenticated`: exactly the operations each table's RLS policies can allow; never `TRUNCATE`, `REFERENCES`,
  `TRIGGER` or `MAINTAIN`. The exact matrix is `authenticatedPrivileges` in `schema_contract.json`.
- `service_role`: `SELECT/INSERT/UPDATE/DELETE` on application tables; nothing on `admin_bootstrap_audit`.
- Default privileges for objects created by `postgres` in `public` grant the API roles nothing. The default
  privileges of the Supabase-managed role `supabase_admin` cannot be changed from a migration; the certification
  therefore also asserts that every table and function we create is owned by `postgres`.

## Scheduled email: decision

**Not an active product feature, so no scheduler is created.**

- Nothing creates `scheduled_emails` rows: `scheduleEmail()` in `src/lib/email/emailService.ts` has no callers, and no
  UI depends on delayed delivery. `send-email` supports a `schedule` action, but nothing invokes it.
- `process-scheduled-emails` would not work if scheduled today: it calls `send-email` with the service-role key, but
  `send-email` requires a signed-in user's JWT with permission, so every send would be refused. It also marks a row
  sent only after the send, so a crash in between would duplicate the message; there is no retry or backoff.
- Therefore: **do not deploy** `process-scheduled-emails`, do not set `EMAIL_CRON_SECRET`, and do not create a cron
  job. `scheduled_emails` stays a backend-only table (no API role can read or write it).
- To turn the feature on later, first design service-to-service authentication, a claim step (`for update skip
  locked`) for idempotency, retries, and a schedule, then add them as migrations and extend the certification.

## Identity of the sender and unsubscribe

`buildUnsubscribeUrl` links to the in-app preferences page, so no public unsubscribe link is generated and the
`unsubscribe` function is **not deployed** by default. If one-click links are introduced, deploy `unsubscribe` with
JWT verification disabled (the link is clicked by a browser with no token), set `UNSUBSCRIBE_SECRET`, and keep the
HMAC-signed, expiring `{ userId, notifType, exp }` token contract.

## Known limits (decisions for the product owner, not defects introduced here)

- **People directory visibility.** Every *active* member can read all `people` and `memberships` rows (names, emails
  and phone numbers of contacts included). Pending and rejected accounts cannot. Narrowing it to leaders and admins is a
  product decision that needs the People screens reviewed first.
- **Email preferences are stored but not yet enforced at send time.** `send-email` does not consult
  `email_preferences`. Today the only email sent is the transactional "account approved" message. Enforcement belongs
  in `send-email` before any marketing-style notification is added.
- **Shared device.** A push `endpoint` is globally unique and a row can only be changed by its owner, so a second
  account on the same browser cannot take over a subscription until the first account turns push off (which deletes
  the subscription). Merely signing out does not.
- **Push sending** is not implemented (there is no `send-push` function), so `push_notification_log` is empty by
  design until it is.

## Certification

See `supabase/verification/README.md`. In short: replay the migrations on an empty database, produce the schema
fingerprint, check it against the contract, run the behavioural harnesses, and replay a second time to prove the
fingerprint is byte-identical.
