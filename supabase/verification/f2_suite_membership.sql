-- F2 membership and merge certification. Executable checks against the database, run by run_f2_sql.sh inside a transaction
-- that is rolled back. Every check states an exact SQLSTATE or row count, and every write is followed by a post-state
-- assertion. Grant layer only (096 + 097 + 098). A failed check, a wrong SQLSTATE, or a wrong count fails the run.

\echo '== MB0. setup: persons, a contact, prior history, a legacy account, and an active member with a membership'
SELECT pg_temp.chk('MB0a owner creates merge source person f3', NULL, NULL,
  $q$INSERT INTO public.people (id, full_name, email, phone) VALUES (pg_temp.u('f3'), 'Merge Source F2', 'src.f2@example.test', '+1 (647) 555-0141')$q$, NULL, 1);
SELECT pg_temp.chk('MB0b owner links contact d3 to merge source f3', NULL, NULL,
  $q$INSERT INTO public.contacts (id, contact_name, logged_by, cell_id, person_id, idempotency_key) VALUES (pg_temp.u('d3'), 'F2 Merge Contact', pg_temp.u('a4'), pg_temp.u('c1'), pg_temp.u('f3'), 'fixture-d3')$q$, NULL, 1);
SELECT pg_temp.chk('MB0c owner writes a pre-merge transition for the source', NULL, NULL,
  $q$INSERT INTO public.membership_transitions (person_id, from_type, to_type, performed_by, notes, transitioned_at) VALUES (pg_temp.u('f3'), 'contact', 'contact', pg_temp.u('a2'), 'F2 pre-merge transition', now() - interval '1 day')$q$, NULL, 1);
SELECT pg_temp.chk('MB0d owner creates a second person f4 with an ACTIVE membership', NULL, NULL,
  $q$WITH p AS (INSERT INTO public.people (id, full_name, email) VALUES (pg_temp.u('f4'), 'Other Member F2', 'other.f2@example.test') RETURNING id)
     INSERT INTO public.memberships (person_id, role, status) SELECT id, 'member', 'active' FROM p$q$, NULL, 1);
SELECT pg_temp.chk('MB0e owner creates a legacy account f5 (its profile is created by the signup trigger)', NULL, NULL,
  $q$INSERT INTO auth.users (id, email, raw_user_meta_data, created_at) VALUES (pg_temp.u('f5'), 'legacy.f2@example.test', '{"full_name":"Legacy F2"}', now())$q$, NULL, 1);
SELECT pg_temp.chk('MB0f owner links that profile to the merge source f3', NULL, NULL,
  $q$UPDATE public.profiles SET person_id = pg_temp.u('f3') WHERE id = pg_temp.u('f5')$q$, NULL, 1);
SELECT pg_temp.chk('MB0g owner writes two HISTORICAL memberships for f3 (inactive and rejected)', NULL, NULL,
  $q$INSERT INTO public.memberships (person_id, role, status) VALUES (pg_temp.u('f3'), 'member', 'inactive'), (pg_temp.u('f3'), 'member', 'rejected')$q$, NULL, 2);
SELECT pg_temp.chk('MB0h owner creates person f7 (a pending application)', NULL, NULL,
  $q$INSERT INTO public.people (id, full_name, email) VALUES (pg_temp.u('f7'), 'Pending Application F2', 'pending.f2@example.test')$q$, NULL, 1);
SELECT pg_temp.chk('MB0i owner creates person f9 with contact d4 (for the atomicity fault)', NULL, NULL,
  $q$WITH p AS (INSERT INTO public.people (id, full_name, email) VALUES (pg_temp.u('f9'), 'Fault Target F2', 'fault.f2@example.test') RETURNING id)
     INSERT INTO public.contacts (id, contact_name, logged_by, cell_id, person_id, idempotency_key) SELECT pg_temp.u('d4'), 'F2 Fault Contact', pg_temp.u('a4'), pg_temp.u('c1'), id, 'fixture-d4' FROM p$q$, NULL, 1);
SELECT pg_temp.cap('a4_person', NULL, NULL, $q$SELECT person_id::text FROM public.profiles WHERE id = pg_temp.u('a4')$q$);
SELECT pg_temp.chk('MB0j owner gives member a4 their own ACTIVE membership (for the own-row read check)', NULL, NULL,
  $q$INSERT INTO public.memberships (person_id, role, status) VALUES ((SELECT value::uuid FROM f2_values WHERE name = 'a4_person'), 'member', 'active')$q$, NULL, 1);
SELECT pg_temp.cap('applicant_person', NULL, NULL, $q$SELECT person_id::text FROM public.profiles WHERE id = pg_temp.u('a6')$q$);
SELECT pg_temp.fixture('applicant profile is linked to a person', $q$(SELECT value IS NOT NULL FROM f2_values WHERE name = 'applicant_person')$q$);

\echo '== E. establishing a membership goes through establish_membership: staff only, one transaction'
SELECT pg_temp.chk('E01 coordinator establishes an active membership for prospect e2 (RPC)', 'authenticated', pg_temp.u('a2'),
  $q$SELECT public.establish_membership(pg_temp.u('e2'), 'active', 'member', NULL, 'F2 establishment')$q$, NULL, 1);
SELECT pg_temp.assert_int('E02 post-state: e2 has exactly one active membership',
  $q$SELECT count(*) FROM public.memberships WHERE person_id = pg_temp.u('e2') AND status = 'active'$q$, 1);
SELECT pg_temp.assert_true('E03 post-state: the transition records the coordinator as performed_by (attribution)',
  $q$EXISTS (SELECT 1 FROM public.membership_transitions WHERE person_id = pg_temp.u('e2') AND notes = 'F2 establishment' AND to_type = 'member' AND performed_by = pg_temp.u('a2'))$q$);
SELECT pg_temp.assert_int('E04 post-state: the contacts of e2 carry the membership flag (d1 and d2)',
  $q$SELECT count(*) FROM public.contacts WHERE person_id = pg_temp.u('e2') AND is_member = true$q$, 2);
SELECT pg_temp.chk('E05 member a4 cannot establish a membership', 'authenticated', pg_temp.u('a4'),
  $q$SELECT public.establish_membership(pg_temp.u('f3'), 'active', 'member', NULL, 'F2 member attempt')$q$, '42501', NULL);
SELECT pg_temp.chk('E06 cell leader a3 cannot establish a membership', 'authenticated', pg_temp.u('a3'),
  $q$SELECT public.establish_membership(pg_temp.u('f3'), 'active', 'member', NULL, 'F2 leader attempt')$q$, '42501', NULL);
SELECT pg_temp.chk('E07 pending applicant a6 cannot establish a membership', 'authenticated', pg_temp.u('a6'),
  $q$SELECT public.establish_membership(pg_temp.u('f3'), 'active', 'member', NULL, 'F2 applicant attempt')$q$, '42501', NULL);
SELECT pg_temp.chk('E08 an anonymous caller cannot establish a membership', 'anon', NULL,
  $q$SELECT public.establish_membership(pg_temp.u('f3'), 'active', 'member', NULL, 'F2 anon attempt')$q$, '42501', NULL);
SELECT pg_temp.chk('E09 establishing for a person that does not exist is refused', 'authenticated', pg_temp.u('a2'),
  $q$SELECT public.establish_membership(pg_temp.u('ff'), 'active', 'member', NULL, 'F2 ghost')$q$, 'P0002', NULL);
SELECT pg_temp.chk('E10 a second ACTIVE membership for e2 is refused (one active per person)', 'authenticated', pg_temp.u('a2'),
  $q$SELECT public.establish_membership(pg_temp.u('e2'), 'active', 'member', NULL, 'F2 duplicate')$q$, '23505', NULL);
SELECT pg_temp.assert_true('E11 post-state: the refused duplicate left no transition and still one active membership',
  $q$NOT EXISTS (SELECT 1 FROM public.membership_transitions WHERE notes = 'F2 duplicate') AND (SELECT count(*) = 1 FROM public.memberships WHERE person_id = pg_temp.u('e2') AND status = 'active')$q$);
SELECT pg_temp.chk('E12 a status other than active or pending is refused', 'authenticated', pg_temp.u('a2'),
  $q$SELECT public.establish_membership(pg_temp.u('f3'), 'rejected', 'member', NULL, 'F2 bad status')$q$, '22023', NULL);

\echo '== D. direct writes to memberships and transitions are refused for every API role'
SELECT pg_temp.chk('D01 coordinator cannot INSERT a membership directly', 'authenticated', pg_temp.u('a2'),
  $q$INSERT INTO public.memberships (person_id, role, status) VALUES (pg_temp.u('f3'), 'member', 'active')$q$, '42501', NULL);
SELECT pg_temp.chk('D02 coordinator cannot UPDATE a membership directly', 'authenticated', pg_temp.u('a2'),
  $q$UPDATE public.memberships SET status = 'inactive' WHERE person_id = pg_temp.u('f4')$q$, '42501', NULL);
SELECT pg_temp.chk('D03 coordinator cannot INSERT a transition directly', 'authenticated', pg_temp.u('a2'),
  $q$INSERT INTO public.membership_transitions (person_id, from_type, to_type, performed_by, notes) VALUES (pg_temp.u('e2'), 'contact', 'member', pg_temp.u('a2'), 'F2 direct')$q$, '42501', NULL);
SELECT pg_temp.chk('D04 coordinator cannot DELETE a membership directly', 'authenticated', pg_temp.u('a2'),
  $q$DELETE FROM public.memberships WHERE person_id = pg_temp.u('f4')$q$, '42501', NULL);
SELECT pg_temp.assert_true('D05 post-state: f4 still holds its active membership after the refused writes',
  $q$EXISTS (SELECT 1 FROM public.memberships WHERE person_id = pg_temp.u('f4') AND status = 'active')$q$);

\echo '== R. reading memberships: staff see all, an active member sees only their own, others see none'
SELECT pg_temp.chk('R01 coordinator reads the active membership of e2', 'authenticated', pg_temp.u('a2'),
  $q$SELECT 1 FROM public.memberships WHERE person_id = pg_temp.u('e2') AND status = 'active'$q$, NULL, 1);
SELECT pg_temp.chk('R02 active member a4 reads NO membership of another person (e2)', 'authenticated', pg_temp.u('a4'),
  $q$SELECT 1 FROM public.memberships WHERE person_id = pg_temp.u('e2')$q$, NULL, 0);
SELECT pg_temp.chk('R03 active member a4 reads their OWN membership', 'authenticated', pg_temp.u('a4'),
  $q$SELECT 1 FROM public.memberships WHERE person_id = (SELECT value::uuid FROM f2_values WHERE name = 'a4_person')$q$, NULL, 1);
SELECT pg_temp.chk('R04 pending applicant a6 reads NO membership at all', 'authenticated', pg_temp.u('a6'),
  $q$SELECT 1 FROM public.memberships$q$, NULL, 0);
SELECT pg_temp.chk('R05 owner marks a5 rejected', NULL, NULL,
  $q$UPDATE public.profiles SET status = 'rejected' WHERE id = pg_temp.u('a5')$q$, NULL, 1);
SELECT pg_temp.chk('R06 rejected account a5 reads NO membership at all', 'authenticated', pg_temp.u('a5'),
  $q$SELECT 1 FROM public.memberships$q$, NULL, 0);
SELECT pg_temp.chk('R07 owner restores a5 to active', NULL, NULL,
  $q$UPDATE public.profiles SET status = 'active' WHERE id = pg_temp.u('a5')$q$, NULL, 1);
SELECT pg_temp.chk('R08 active member a4 reads NO membership transition history', 'authenticated', pg_temp.u('a4'),
  $q$SELECT 1 FROM public.membership_transitions$q$, NULL, 0);
SELECT pg_temp.cap('e2_transitions', 'authenticated', pg_temp.u('a2'),
  $q$SELECT count(*)::text FROM public.membership_transitions WHERE person_id = pg_temp.u('e2')$q$);
SELECT pg_temp.assert_true('R09 positive control: the coordinator reads the transition history of e2',
  $q$(SELECT value::int > 0 FROM f2_values WHERE name = 'e2_transitions')$q$);

\echo '== H. history and attribution: transitions are made by the RPC, record the caller, and follow the allowed path'
SELECT pg_temp.chk('H01 coordinator establishes a PENDING application for f7', 'authenticated', pg_temp.u('a2'),
  $q$SELECT public.establish_membership(pg_temp.u('f7'), 'pending', 'member', NULL, 'F2 pending application')$q$, NULL, 1);
SELECT pg_temp.cap('f7_membership', 'authenticated', pg_temp.u('a2'),
  $q$SELECT id::text FROM public.memberships WHERE person_id = pg_temp.u('f7') AND status = 'pending'$q$);
SELECT pg_temp.chk('H02 coordinator approves the pending membership (pending -> active)', 'authenticated', pg_temp.u('a2'),
  $q$SELECT public.transition_membership((SELECT value::uuid FROM f2_values WHERE name = 'f7_membership'), 'active', 'F2 approved')$q$, NULL, 1);
-- Both transitions of this test run in one transaction, so now() is the same for both and ordering by time cannot separate
-- them. Each RPC call is its own transaction in production. The check therefore asserts the approval row itself.
SELECT pg_temp.assert_true('H03 post-state: f7 is active, and the approval row names the coordinator as performed_by',
  $q$(SELECT status = 'active' FROM public.memberships WHERE person_id = pg_temp.u('f7'))
     AND EXISTS (SELECT 1 FROM public.membership_transitions WHERE person_id = pg_temp.u('f7') AND to_type = 'active' AND notes = 'F2 approved' AND performed_by = pg_temp.u('a2'))$q$);
SELECT pg_temp.assert_int('H04 post-state: f7 has exactly two transitions (establishment and approval)',
  $q$SELECT count(*) FROM public.membership_transitions WHERE person_id = pg_temp.u('f7')$q$, 2);
SELECT pg_temp.chk('H05 member a4 cannot transition a membership', 'authenticated', pg_temp.u('a4'),
  $q$SELECT public.transition_membership((SELECT value::uuid FROM f2_values WHERE name = 'f7_membership'), 'inactive', 'F2 member')$q$, '42501', NULL);
SELECT pg_temp.chk('H06 an active membership cannot go back to pending (not an allowed change)', 'authenticated', pg_temp.u('a2'),
  $q$SELECT public.transition_membership((SELECT value::uuid FROM f2_values WHERE name = 'f7_membership'), 'pending', 'F2 invalid')$q$, '22023', NULL);
SELECT pg_temp.assert_true('H07 post-state: the refused changes left f7 active, with no extra transition',
  $q$(SELECT status = 'active' FROM public.memberships WHERE person_id = pg_temp.u('f7')) AND NOT EXISTS (SELECT 1 FROM public.membership_transitions WHERE notes IN ('F2 invalid', 'F2 member'))$q$);
SELECT pg_temp.assert_true('H08 attribution: every transition of f7 names a real staff account (performed_by is never empty)',
  $q$NOT EXISTS (SELECT 1 FROM public.membership_transitions WHERE person_id = pg_temp.u('f7') AND performed_by IS NULL)$q$);
SELECT pg_temp.chk('H09 owner-context constraint check: a pending row can coexist with the active membership of e2', NULL, NULL,
  $q$INSERT INTO public.memberships (person_id, role, status) VALUES (pg_temp.u('e2'), 'member', 'pending')$q$, NULL, 1);
SELECT pg_temp.chk('H10 owner-context constraint check: rejected history rows may repeat for e2', NULL, NULL,
  $q$INSERT INTO public.memberships (person_id, role, status) VALUES (pg_temp.u('e2'), 'member', 'rejected'), (pg_temp.u('e2'), 'member', 'rejected')$q$, NULL, 2);

\echo '== F. atomicity: a failure after the membership row is written rolls the whole establishment back'
SELECT pg_temp.chk('F00 owner installs a fault that fails only the transition of the F2 fault test', NULL, NULL,
  $q$CREATE FUNCTION public._f2_fault_injection() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'F2 injected fault' USING ERRCODE = 'P0001'; END $f$$q$, NULL, NULL);
SELECT pg_temp.chk('F01 owner attaches the fault to transitions noted F2 fault injection', NULL, NULL,
  $q$CREATE TRIGGER f2_fault BEFORE INSERT ON public.membership_transitions FOR EACH ROW WHEN (NEW.notes = 'F2 fault injection') EXECUTE FUNCTION public._f2_fault_injection()$q$, NULL, NULL);
SELECT pg_temp.chk('F02 the establishment that hits the fault fails with the injected SQLSTATE', 'authenticated', pg_temp.u('a2'),
  $q$SELECT public.establish_membership(pg_temp.u('f9'), 'active', 'member', NULL, 'F2 fault injection')$q$, 'P0001', NULL);
SELECT pg_temp.assert_int('F03 post-state: the membership row written before the fault was rolled back (f9 has none)',
  $q$SELECT count(*) FROM public.memberships WHERE person_id = pg_temp.u('f9')$q$, 0);
SELECT pg_temp.assert_true('F04 post-state: the contact flag on f9 was not set by the failed establishment',
  $q$EXISTS (SELECT 1 FROM public.contacts WHERE id = pg_temp.u('d4') AND is_member = false)$q$);
SELECT pg_temp.assert_true('F05 post-state: no transition for the failed establishment survived',
  $q$NOT EXISTS (SELECT 1 FROM public.membership_transitions WHERE notes = 'F2 fault injection')$q$);

\echo '== M. merge: refusal and authorization'
SELECT pg_temp.chk('M01 member a4 cannot merge the source into e2', 'authenticated', pg_temp.u('a4'),
  $q$SELECT public.merge_people(pg_temp.u('e2'), pg_temp.u('f3'), 'F2 member merge')$q$, 'P0001', NULL);
SELECT pg_temp.assert_true('M02 post-state: the refused merge left the source person and its contact untouched',
  $q$EXISTS (SELECT 1 FROM public.people WHERE id = pg_temp.u('f3')) AND (SELECT person_id = pg_temp.u('f3') FROM public.contacts WHERE id = pg_temp.u('d3'))$q$);
SELECT pg_temp.chk('M03 coordinator cannot merge two people who both hold an ACTIVE membership', 'authenticated', pg_temp.u('a2'),
  $q$SELECT public.merge_people(pg_temp.u('e2'), pg_temp.u('f4'), 'F2 two actives')$q$, 'P0001', NULL);
SELECT pg_temp.assert_true('M04 post-state: both persons with active memberships still exist, unchanged',
  $q$EXISTS (SELECT 1 FROM public.people WHERE id = pg_temp.u('f4')) AND EXISTS (SELECT 1 FROM public.people WHERE id = pg_temp.u('e2'))$q$);

\echo '== P. pending applicant identity is not changed by a merge or a direct write'
SELECT pg_temp.chk('P01 coordinator cannot write the applicant identity directly', 'authenticated', pg_temp.u('a2'),
  $q$UPDATE public.people SET phone = '+1 (000) 000-0000' WHERE id = (SELECT value::uuid FROM f2_values WHERE name = 'applicant_person')$q$, '42501', NULL);
SELECT pg_temp.chk('P02 member cannot merge the pending applicant away', 'authenticated', pg_temp.u('a4'),
  $q$SELECT public.merge_people(pg_temp.u('e2'), (SELECT value::uuid FROM f2_values WHERE name = 'applicant_person'), 'F2 applicant')$q$, 'P0001', NULL);
SELECT pg_temp.assert_true('P03 post-state: the applicant person still holds the hidden email and phone',
  $q$(SELECT email = 'app.f2@example.test' AND phone = '+1 (416) 555-0177' FROM public.people WHERE id = (SELECT value::uuid FROM f2_values WHERE name = 'applicant_person'))$q$);

\echo '== G. merge: a coordinator merge repoints contacts, transitions, memberships and profiles, then removes the source'
SELECT pg_temp.chk('G01 coordinator merges source f3 into prospect e2', 'authenticated', pg_temp.u('a2'),
  $q$SELECT public.merge_people(pg_temp.u('e2'), pg_temp.u('f3'), 'F2 merge notes')$q$, NULL, 1);
SELECT pg_temp.assert_true('G02 post-state: the source person row is gone', $q$NOT EXISTS (SELECT 1 FROM public.people WHERE id = pg_temp.u('f3'))$q$);
SELECT pg_temp.assert_true('G03 post-state: the contact moved from the source to e2', $q$(SELECT person_id = pg_temp.u('e2') FROM public.contacts WHERE id = pg_temp.u('d3'))$q$);
SELECT pg_temp.assert_true('G04 post-state: the pre-merge transition moved to e2 and kept its original notes',
  $q$EXISTS (SELECT 1 FROM public.membership_transitions WHERE person_id = pg_temp.u('e2') AND notes = 'F2 pre-merge transition')$q$);
SELECT pg_temp.assert_true('G05 post-state: a merge transition is recorded against e2 with the given notes',
  $q$EXISTS (SELECT 1 FROM public.membership_transitions WHERE person_id = pg_temp.u('e2') AND from_type = 'merge' AND notes = 'F2 merge notes')$q$);
SELECT pg_temp.assert_int('G06 post-state: the original contacts of e2 (d1, d2) are untouched',
  $q$SELECT count(*) FROM public.contacts WHERE id IN (pg_temp.u('d1'), pg_temp.u('d2')) AND person_id = pg_temp.u('e2')$q$, 2);
SELECT pg_temp.assert_int('G07 post-state: e2 has exactly one active membership after the merge',
  $q$SELECT count(*) FROM public.memberships WHERE person_id = pg_temp.u('e2') AND status = 'active'$q$, 1);
SELECT pg_temp.assert_true('G08 post-state: the source historical memberships moved to e2 (1 inactive, 3 rejected in total)',
  $q$(SELECT count(*) = 1 FROM public.memberships WHERE person_id = pg_temp.u('e2') AND status = 'inactive')
     AND (SELECT count(*) = 3 FROM public.memberships WHERE person_id = pg_temp.u('e2') AND status = 'rejected')$q$);
SELECT pg_temp.assert_true('G09 post-state: the linked profile now points at e2 and no row points at the removed source',
  $q$(SELECT person_id = pg_temp.u('e2') FROM public.profiles WHERE id = pg_temp.u('f5'))
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE person_id = pg_temp.u('f3'))$q$);

SELECT pg_temp.finish(68);
\echo '== END OF MEMBERSHIP SUITE (verdict above)'
