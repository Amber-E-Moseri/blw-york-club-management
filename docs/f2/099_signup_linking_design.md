# N1 remediation design: signup must not link an unverified account to an existing person

Status: **design for approval. Not implemented.** Migration 099 is not written. N1 remains a release blocker.
Baseline reproduction: `supabase/verification/f2_suite_baseline_repro.sql`, checks N1a to N1f (pass on 096 = defect present).

## 1. What is confirmed

| Fact | Evidence |
|---|---|
| The signup trigger links a new profile to an existing person when the normalized email matches, with no verification check. | `handle_new_user` body (migrations 015/019/022). Checks N1b and N1c. |
| A linked profile is `pending`, so it hides the person from every ordinary member. | Check N1d: member reads the prospect before the link, 1 row; after, 0 rows. |
| A linked, pending account reads that person's name, email and phone before any approval. | Checks N1e and N1f on 096. |
| After 098, a linked account still reads the person's name, but not email or phone. | `people_read` uses `is_callers_person(id)`, which does not check status. Confirmed on `cert_f2`. |
| The trigger never reads email confirmation state. | Body contains no reference to `confirm`. |

## 2. What is not verified here

- **Real GoTrue behaviour.** Supabase GoTrue inserts the `auth.users` row at signup, before confirmation, and sends a confirmation mail. Sign-in is refused until confirmation when confirmations are enabled. The app maps `Email not confirmed` to a message, so the app expects that setting. None of this runs here. The local auth stub has no `email_confirmed_at` column.
- **Production configuration.** `supabase/config.toml` sets `enable_confirmations = false` under `[auth.email]`. That is the local development setting. The repo does not record production's value. If production matches the local value, an impostor can sign in immediately after the insert, and the pre-approval read in N1e and N1f is reachable over the API.
- **Duplicate-email response from GoTrue.** Unverified. It is an additional existence channel, outside this design.

Treat N1 as **exploitable until production's confirmation setting is recorded and verified**.

## 3. Proposed design (for approval)

### 3.1 Email ownership before any link
- The signup trigger no longer links to any existing person.
- An account is linked to a person only after the email is verified. Verification means `auth.users.email_confirmed_at` is set, which GoTrue records when the user clicks the confirmation link. Verification is detected by an `AFTER UPDATE OF email_confirmed_at` trigger on `auth.users`, and also by an `AFTER INSERT` path for accounts created already confirmed (`mailer_autoconfirm`).

### 3.2 Explicit staff approval for linking to existing people
- A verified account whose email matches an existing person does not link automatically. It enters `link_requested`, a state that a coordinator or administrator resolves with `approve_pending_member`, extended to accept a target person.
- A verified account whose email matches no person creates a new person with that email, as today. This preserves the registration path for new applicants.

### 3.3 Pending-account read restriction
- `is_callers_person(id)` is restricted to **active** callers. A pending or unlinked account reads no person row, its own profile excepted.
- Migration 098 already removes email and phone from authenticated reads. 099 removes the name read for pending accounts.

### 3.4 Existing profile and person links
- No automatic unlinking. Existing links are preserved, to avoid breaking records.
- A read-only audit finds every profile linked to a person by email before this change, and flags links where the profile was created unverified. The audit is run on production first, and staff decide each link.
- Links made before the change keep working. Only new signups change behaviour.

### 3.5 Rollback
- Keep a copy of the original `handle_new_user` and `is_callers_person` definitions in the migration. Rollback restores them. No profile or person row is changed by 099 itself, so rollback changes only future behaviour.

## 4. Dependencies and order
1. Record production's confirmation setting and GoTrue version (check the project settings directly).
2. Run the existing-link audit on production, read-only.
3. Approve this design, then approve migration 099.
4. Implement 099 with the approval UI for `link_requested`.
5. Test on a disposable clone that includes a GoTrue-shaped `auth.users` with `email_confirmed_at`.
6. Only then close N1.

Migration 099 does not depend on 097 or 098. It does depend on 098 for the email and phone read restriction, which 098 already provides.

## 5. Test plan (for 099, not yet written)
- Unverified signup with an existing person's email: no link, no person row created, profile `pending` and unlinked.
- Verified signup with an existing person's email: `link_requested`, no automatic link.
- Verified signup with a new email: person created with that email, profile linked. Regression for the registration path.
- Staff approval of a `link_requested` account: link created, audit row written.
- Pending or unlinked account: reads no person row (positive: own profile still readable).
- Existing link made before 099: still readable by its owner and still visible to staff.
- `autoconfirm` path: confirmed on insert behaves like verified.

## 6. Decisions needed before implementation
1. Approve the staff-approval step for linking to an existing person (3.2).
2. Confirm that a pending applicant should see no person row at all, not even their own linked name (3.3).
3. Confirm the existing-link audit and the rule that existing links are kept (3.4).
4. Confirm that production's confirmation setting is verified by someone with project access, and recorded here.
5. Set the retention period for the `link_requested` queue.
