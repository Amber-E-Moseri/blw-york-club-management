-- identity_link_103_checks.sql
--
-- Verification script for migration 103. NOT an executable migration. Run it only on a disposable database that has
-- migrations 000-103 applied and a GoTrue-shaped auth.users table. Never run it on production.
--
-- Status: WRITTEN, NOT EXECUTED. Every check below is NOT TESTED until a run records its output.
-- Each block is meant to run inside a transaction that is rolled back.
--
-- Fixtures (set up by the operator, not by this script): one administrator profile (ADMIN_ID), one member profile
-- that is pending and unlinked with a confirmed auth email equal to an existing person's email (LINK_ID, PERSON_ID),
-- and one pending account with a pending email change (CHANGE_ID). Replace the placeholders before running.

-- C1. Queue lists only pending, unlinked accounts whose email matches a person. Expect LINK_ID, not CHANGE_ID when that
--     account is already linked.
--     select * from public.list_identity_link_queue(50);

-- C2. Queue masks addresses. Expect no full email in any column.
--     select profile_masked_email, candidate_masked_email from public.list_identity_link_queue(50);

-- C3. Queue refuses a non-staff caller (member session). Expect SQLSTATE 42501.
--     set local role authenticated; set local request.jwt.claim.sub = '<MEMBER_ID>'; select * from public.list_identity_link_queue(50);

-- C4. Approval gate: approving an account that needs linking is refused. Expect 42501 with the linking message.
--     set local request.jwt.claim.sub = '<ADMIN_ID>'; select * from public.approve_pending_member('<LINK_ID>');

-- C5. Link succeeds for a confirmed, matching, non-changing account. Expect one row in profile_link_audit (action 'attach').
--     select public.link_pending_profile_to_person('<LINK_ID>', '<PERSON_ID>', 'Matched by staff review');

-- C6. After C5, approval succeeds and writes one profile_approval_audit row (action 'approve').
--     select * from public.approve_pending_member('<LINK_ID>');
--     select count(*) from public.profile_approval_audit where profile_id = '<LINK_ID>';   -- expect 1

-- C7. Link refuses a pending email change. Expect 42501 "pending email change". Requires new_email set on the fixture.
--     select public.link_pending_profile_to_person('<CHANGE_ID>', '<PERSON_ID_2>', 'Matched by staff review');

-- C8. Link refuses an unconfirmed email. Expect 42501 "not a confirmed match".

-- C9. Link refuses a reason shorter than three characters. Expect 22023.
--     select public.link_pending_profile_to_person('<LINK_ID>', '<PERSON_ID>', 'x');

-- C10. Audit rows are append-only: update and delete are refused on both audit tables.
--     -- Run against a row that exists (for example the C6 row). A where-clause that matches nothing never fires the trigger.
--     update public.profile_approval_audit set action = 'approve' where profile_id = '<LINK_ID>';   -- expect exception
--     delete from public.profile_link_audit where profile_id = '<LINK_ID>';                          -- expect exception

-- C11. Anonymous callers have no execute right on the queue, the link or the approval. Expect permission denied.
--     set local role anon; select * from public.list_identity_link_queue(1);
