-- identity_link_103_checks.sql
--
-- Verification script for migration 103. NOT an executable migration. Run it only on a disposable database that has
-- migrations 000-103 applied and a GoTrue-shaped auth.users table. Never run it on production.
--
-- Status: the same checks are executed by identity_link_103_pglite_checks.mjs (in-process PGlite, 37/37 PASS).
This SQL file is the reference wording for a hosted or Docker run, which is still NOT TESTED.
-- Each block is meant to run inside a transaction that is rolled back.
--
-- Fixtures (set up by the operator, not by this script): one administrator profile (ADMIN_ID), one member profile
-- that is pending and unlinked with a confirmed auth email equal to an existing person's email (LINK_ID, PERSON_ID),
-- and one pending account with a pending email change (CHANGE_ID). Replace the placeholders before running.

-- C1. Queue lists only confirmed, pending, unlinked accounts, with the exact-match candidate id and name. Expect LINK_ID.
--     Requires a valid reason; every call writes an identity_read_audit row (target kind 'account_link').
--     select * from public.list_account_link_queue('Desk check of applicant identity');

-- C2. Queue returns no email field. Expect only profile_id, display_name, created_at, person_id, person_name.
--     select * from public.list_account_link_queue('Desk check of applicant identity') limit 0;

-- C3. Queue refuses a non-staff caller (member session). Expect SQLSTATE 42501.
--     set local role authenticated; set local request.jwt.claim.sub = '<MEMBER_ID>'; select * from public.list_account_link_queue('Desk check of applicant identity');

-- C4. Approval gate: approving any pending account with no linked person is refused. Expect 42501 with the linking message.
--     set local request.jwt.claim.sub = '<ADMIN_ID>'; select * from public.approve_pending_member('<LINK_ID>');

-- C5. Link succeeds for a confirmed, matching, non-changing account. Expect one row in profile_link_audit (action 'attach').
--     select public.link_pending_profile_to_person('<LINK_ID>', '<PERSON_ID>', 'Matched by staff review');

-- C6. After C5, approval succeeds and writes one profile_approval_audit row (action 'approve').
--     select * from public.approve_pending_member('<LINK_ID>');
--     select count(*) from public.profile_approval_audit where profile_id = '<LINK_ID>';   -- expect 1

-- C7. Link refuses a pending email change. Expect 42501 "pending email change". Requires email_change set on the fixture (GoTrue column).
--     select public.link_pending_profile_to_person('<CHANGE_ID>', '<PERSON_ID_2>', 'Matched by staff review');

-- C8. Link refuses an unconfirmed email. Expect 42501 "not a confirmed match".

-- C9. Link refuses a reason shorter than three characters. Expect 22023.
--     select public.link_pending_profile_to_person('<LINK_ID>', '<PERSON_ID>', 'x');

-- C10. Audit rows are append-only: update and delete are refused on both audit tables.
--     -- Run against a row that exists (for example the C6 row). A where-clause that matches nothing never fires the trigger.
--     update public.profile_approval_audit set action = 'approve' where profile_id = '<LINK_ID>';   -- expect exception
--     delete from public.profile_link_audit where profile_id = '<LINK_ID>';                          -- expect exception

-- C11. Anonymous callers have no execute right on the queue, the link or the approval. Expect permission denied.
--     set local role anon; select * from public.list_account_link_queue('Desk check of applicant identity');
