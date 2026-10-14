-- F2 BASELINE reproduction, executable. Run on the 096 baseline (cert_a) with run_f2_sql.sh. Every check here asserts
-- the PRE-FIX behaviour. A PASS means the vulnerability or defect is reproduced. A FAIL means it did not reproduce, and
-- that the finding needs to be re-examined. Loaded after f2_harness.sql and f2_fixture.sql. Layer argument is ignored.

\echo '== R1. N1 signup link, reproduced on the baseline (modelled as the auth.users INSERT; no email is sent)'
SELECT pg_temp.cap('p_n1', NULL, NULL, $q$SELECT count(*)::text FROM public.people$q$);
SELECT pg_temp.chk('N1a member can read the prospect row before any impostor signs up', 'authenticated', pg_temp.u('a4'), $q$SELECT 1 FROM public.people WHERE email = 'prospect.f2@example.test'$q$, NULL, 1);
INSERT INTO auth.users (id, email, raw_user_meta_data, created_at) VALUES (pg_temp.u('b1'), 'prospect.f2@example.test', '{"full_name":"Impostor"}', now());
SELECT pg_temp.assert_true('N1b the impostor profile is linked to the existing prospect person (no verification)', $q$(SELECT count(*) = 1 FROM public.profiles WHERE id = pg_temp.u('b1') AND person_id = pg_temp.u('e2') AND status = 'pending')$q$);
SELECT pg_temp.assert_same('N1c no new person row was created by the link', $q$(SELECT count(*) FROM public.people)$q$, $q$(SELECT value::bigint FROM f2_values WHERE name = 'p_n1')$q$);
SELECT pg_temp.chk('N1d member can no longer read the prospect row (linked pending profile hides it)', 'authenticated', pg_temp.u('a4'), $q$SELECT 1 FROM public.people WHERE email = 'prospect.f2@example.test'$q$, NULL, 0);
SELECT pg_temp.chk('N1e impostor session reads the prospect email (pending, pre-approval)', 'authenticated', pg_temp.u('b1'), $q$SELECT 1 FROM public.people WHERE email = 'prospect.f2@example.test'$q$, NULL, 1);
SELECT pg_temp.chk('N1f impostor session reads the prospect phone (pending, pre-approval)', 'authenticated', pg_temp.u('b1'), $q$SELECT phone FROM public.people WHERE id = pg_temp.u('e2')$q$, NULL, 1);

\echo '== R2. N2 attribution by staff, reproduced on the baseline'
SELECT pg_temp.chk('N2a leader inserts a contact attributed to another user succeeds (VULNERABLE)', 'authenticated', pg_temp.u('a3'), $q$INSERT INTO public.contacts (contact_name, logged_by, cell_id, person_id) VALUES ('Repro N2a', pg_temp.u('a4'), pg_temp.u('c1'), pg_temp.u('e2'))$q$, NULL, 1);
SELECT pg_temp.chk('N2b coordinator inserts attributed to another user succeeds (VULNERABLE)', 'authenticated', pg_temp.u('a2'), $q$INSERT INTO public.contacts (contact_name, logged_by, cell_id, person_id) VALUES ('Repro N2b', pg_temp.u('a4'), pg_temp.u('c1'), pg_temp.u('e2'))$q$, NULL, 1);
SELECT pg_temp.chk('N2c member spoof is refused (control: the member branch was already correct)', 'authenticated', pg_temp.u('a4'), $q$INSERT INTO public.contacts (contact_name, logged_by, cell_id, person_id) VALUES ('Repro N2c', pg_temp.u('a2'), pg_temp.u('c1'), pg_temp.u('e2'))$q$, '42501', NULL);

\echo '== R3. N3 contact attribution and identity changes, reproduced on the baseline'
SELECT pg_temp.chk('N3a leader changes logged_by of a4''s contact succeeds (VULNERABLE)', 'authenticated', pg_temp.u('a3'), $q$UPDATE public.contacts SET logged_by = pg_temp.u('a3') WHERE id = pg_temp.u('d1')$q$, NULL, 1);
SELECT pg_temp.assert_true('N3b post-state: logged_by was really changed', $q$(SELECT logged_by = pg_temp.u('a3') FROM public.contacts WHERE id = pg_temp.u('d1'))$q$);
SELECT pg_temp.chk('N3c coordinator repoints person_id to another person succeeds (VULNERABLE)', 'authenticated', pg_temp.u('a2'), $q$UPDATE public.contacts SET person_id = (SELECT id FROM public.people WHERE email = 'app.f2@example.test') WHERE id = pg_temp.u('d1')$q$, NULL, 1);
SELECT pg_temp.chk('N3d member changes logged_by of own contact matches zero rows (control)', 'authenticated', pg_temp.u('a4'), $q$UPDATE public.contacts SET logged_by = pg_temp.u('a2') WHERE id = pg_temp.u('d2')$q$, NULL, 0);

\echo '== R4. follow_up_assignee foreign-key oracle, reproduced on the baseline'
SELECT pg_temp.chk('FK1 leader sets follow_up_assignee to a NONEXISTENT profile: foreign-key violation', 'authenticated', pg_temp.u('a3'), $q$UPDATE public.contacts SET follow_up_assignee = pg_temp.u('ff') WHERE id = pg_temp.u('d2')$q$, '23503', NULL);
SELECT pg_temp.chk('FK2 leader sets follow_up_assignee to a HIDDEN, EXISTING profile: succeeds (ORACLE)', 'authenticated', pg_temp.u('a3'), $q$UPDATE public.contacts SET follow_up_assignee = pg_temp.u('a5') WHERE id = pg_temp.u('d2')$q$, NULL, 1);
SELECT pg_temp.chk('FK3 the leader can not see that profile (so the success above was not a visibility grant)', 'authenticated', pg_temp.u('a3'), $q$SELECT 1 FROM public.profiles WHERE id = pg_temp.u('a5')$q$, NULL, 0);

\echo '== R5. pre-fix retry order (person before contact), reproduced on the baseline'
SELECT pg_temp.cap('p_r5', NULL, NULL, $q$SELECT count(*)::text FROM public.people$q$);
SELECT pg_temp.cap('k_r5', NULL, NULL, $q$SELECT count(*)::text FROM public.contacts$q$);
SELECT pg_temp.chk('R5a first attempt: person insert (name only)', NULL, NULL, $q$INSERT INTO public.people (full_name) VALUES ('Repro Retry Name')$q$, NULL, 1);
SELECT pg_temp.chk('R5b first attempt: contact insert with key', NULL, NULL, $q$INSERT INTO public.contacts (contact_name, logged_by, cell_id, person_id, idempotency_key, phone_hidden, is_member, archived) SELECT 'Repro Retry Name', pg_temp.u('a4'), pg_temp.u('c1'), id, 'k-r5', false, false, false FROM public.people WHERE full_name = 'Repro Retry Name'$q$, NULL, 1);
SELECT pg_temp.chk('R5c retry: person insert happens before the key is checked', NULL, NULL, $q$INSERT INTO public.people (full_name) VALUES ('Repro Retry Name')$q$, NULL, 1);
SELECT pg_temp.chk('R5d retry: the contact insert hits the idempotency index (the old code then looks up and returns)', NULL, NULL, $q$INSERT INTO public.contacts (contact_name, logged_by, cell_id, person_id, idempotency_key, phone_hidden, is_member, archived) SELECT 'Repro Retry Name', pg_temp.u('a4'), pg_temp.u('c1'), id, 'k-r5', false, false, false FROM public.people WHERE full_name = 'Repro Retry Name' LIMIT 1$q$, '23505', NULL);
SELECT pg_temp.assert_int('R5e ORPHAN: people grew by 2 while contacts grew by 1 (the retry left one orphan person row)', $q$(SELECT count(*) FROM public.people) - (SELECT value::bigint FROM f2_values WHERE name = 'p_r5')$q$, 2);

\echo '== R6. pre-fix phone-only retry, reproduced on the baseline'
SELECT pg_temp.chk('R6a phone-only first attempt: person with phone', NULL, NULL, $q$INSERT INTO public.people (full_name, phone) VALUES ('Repro Phone', '+1 416 555 0133')$q$, NULL, 1);
SELECT pg_temp.chk('R6b phone-only retry: the person insert is refused by the phone index (the user sees a phone error on a retry)', NULL, NULL, $q$INSERT INTO public.people (full_name, phone) VALUES ('Repro Phone', '+1 416 555 0133')$q$, '23505', NULL);

\echo ''
SELECT pg_temp.finish(23);
\echo '== END OF BASELINE REPRODUCTION (verdict above). A PASS here means the defect is present on 096.'
