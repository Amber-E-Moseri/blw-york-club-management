-- F2 membership and merge certification. Executable behavioural checks against the database. Loaded after f2_harness.sql
-- and f2_fixture.sql by run_f2_sql.sh, which rolls the whole run back. Post-state is asserted after every write, not only
-- the RPC reply. Expectations are exact SQLSTATEs or exact row counts. A wrong expectation fails the run.
-- Runs on the grant layer (096 + 097 + 098) only.

\echo '== MB0. setup: a source person with a contact and a transition, a second person with an active membership'
SELECT pg_temp.chk('MB0a owner creates merge source person f3 with identity', NULL, NULL,
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
SELECT pg_temp.cap('applicant_person', NULL, NULL, $q$SELECT person_id::text FROM public.profiles WHERE id = pg_temp.u('a6')$q$);
SELECT pg_temp.fixture('applicant profile is linked to a person', $q$(SELECT value IS NOT NULL FROM f2_values WHERE name = 'applicant_person')$q$);

\echo '== E. establishing a membership: coordinator may, members and leaders may not'
SELECT pg_temp.chk('E01 coordinator establishes an active membership for prospect e2', 'authenticated', pg_temp.u('a2'),
  $q$INSERT INTO public.memberships (person_id, role, status) VALUES (pg_temp.u('e2'), 'member', 'active')$q$, NULL, 1);
SELECT pg_temp.assert_int('E02 post-state: prospect e2 now has exactly one active membership',
  $q$SELECT count(*) FROM public.memberships WHERE person_id = pg_temp.u('e2') AND status = 'active'$q$, 1);
SELECT pg_temp.chk('E03 member a4 cannot establish a membership', 'authenticated', pg_temp.u('a4'),
  $q$INSERT INTO public.memberships (person_id, role, status) VALUES (pg_temp.u('f3'), 'member', 'active')$q$, '42501', NULL);
SELECT pg_temp.chk('E04 cell leader a3 cannot establish a membership', 'authenticated', pg_temp.u('a3'),
  $q$INSERT INTO public.memberships (person_id, role, status) VALUES (pg_temp.u('f3'), 'member', 'active')$q$, '42501', NULL);
SELECT pg_temp.chk('E05 pending applicant a6 cannot establish a membership', 'authenticated', pg_temp.u('a6'),
  $q$INSERT INTO public.memberships (person_id, role, status) VALUES (pg_temp.u('f3'), 'member', 'active')$q$, '42501', NULL);
SELECT pg_temp.assert_int('E06 post-state: refused attempts created no active or pending membership for f3',
  $q$SELECT count(*) FROM public.memberships WHERE person_id = pg_temp.u('f3') AND status IN ('active', 'pending')$q$, 0);
SELECT pg_temp.chk('E07 a second ACTIVE membership for e2 is refused (one active per person)', 'authenticated', pg_temp.u('a2'),
  $q$INSERT INTO public.memberships (person_id, role, status) VALUES (pg_temp.u('e2'), 'member', 'active')$q$, '23505', NULL);

\echo '== R. reading the active membership'
SELECT pg_temp.chk('R01 coordinator reads the active membership of e2', 'authenticated', pg_temp.u('a2'),
  $q$SELECT 1 FROM public.memberships WHERE person_id = pg_temp.u('e2') AND status = 'active'$q$, NULL, 1);
SELECT pg_temp.chk('R02 coordinator reads no active membership for the source f3 (none exists)', 'authenticated', pg_temp.u('a2'),
  $q$SELECT 1 FROM public.memberships WHERE person_id = pg_temp.u('f3') AND status = 'active'$q$, NULL, 0);

\echo '== H. membership transition history'
SELECT pg_temp.chk('H01 coordinator records a transition for e2 at an explicit later time', 'authenticated', pg_temp.u('a2'),
  $q$INSERT INTO public.membership_transitions (person_id, from_type, to_type, performed_by, notes, transitioned_at) VALUES (pg_temp.u('e2'), 'contact', 'member', pg_temp.u('a2'), 'F2 establishment', now() + interval '1 hour')$q$, NULL, 1);
SELECT pg_temp.assert_true('H02 post-state: the newest transition for e2 is the establishment, not the earlier record',
  $q$(SELECT to_type = 'member' AND notes = 'F2 establishment' FROM public.membership_transitions WHERE person_id = pg_temp.u('e2') ORDER BY transitioned_at DESC LIMIT 1)$q$);
SELECT pg_temp.chk('H03 member a4 cannot forge a transition row for e2', 'authenticated', pg_temp.u('a4'),
  $q$INSERT INTO public.membership_transitions (person_id, from_type, to_type, performed_by, notes) VALUES (pg_temp.u('e2'), 'contact', 'member', pg_temp.u('a4'), 'forged')$q$, '42501', NULL);
SELECT pg_temp.assert_int('H04 post-state: the forged row was not written',
  $q$SELECT count(*) FROM public.membership_transitions WHERE notes = 'forged'$q$, 0);
SELECT pg_temp.chk('H05 a pending application can coexist with the active membership of e2', 'authenticated', pg_temp.u('a2'),
  $q$INSERT INTO public.memberships (person_id, role, status) VALUES (pg_temp.u('e2'), 'member', 'pending')$q$, NULL, 1);
SELECT pg_temp.chk('H06 rejected applications are kept as history: two rejected rows for e2 are allowed', 'authenticated', pg_temp.u('a2'),
  $q$INSERT INTO public.memberships (person_id, role, status) VALUES (pg_temp.u('e2'), 'member', 'rejected'), (pg_temp.u('e2'), 'member', 'rejected')$q$, NULL, 2);

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

\echo '== G. merge: coordinator merge repoints contacts, transitions and memberships, then removes the source'
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

SELECT pg_temp.finish(38);
\echo '== END OF MEMBERSHIP SUITE (verdict above)'
