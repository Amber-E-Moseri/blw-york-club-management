-- F2 submit_contact boundary: SQL certification (migrations 097 and 098).
-- Run against a DISPOSABLE clone only. Everything is rolled back. Fixture setup runs as supabase_admin, separately from
-- every actor check. Actor checks use SET LOCAL ROLE authenticated/anon/service_role with JWT claims inside a savepoint.
-- Each check prints its label, the actual outcome (SQLSTATE or result) and, for writes, the row-count delta.
\set ON_ERROR_STOP 1
\set VERBOSITY verbose
BEGIN;

\echo '== FIXTURE SETUP (supabase_admin)'
\set ADM '00000000-0000-4000-8000-0000000000a1'
\set COO '00000000-0000-4000-8000-0000000000a2'
\set LEA '00000000-0000-4000-8000-0000000000a3'
\set MEM '00000000-0000-4000-8000-0000000000a4'
\set MEM2 '00000000-0000-4000-8000-0000000000a5'
\set APP '00000000-0000-4000-8000-0000000000a6'
\set CX '00000000-0000-4000-8000-0000000000c1'
\set CY '00000000-0000-4000-8000-0000000000c2'

INSERT INTO auth.users (id, email, raw_user_meta_data, created_at) VALUES
  (:'ADM', 'adm.f2@example.test', '{"full_name":"F2 Admin"}', now()),
  (:'COO', 'coo.f2@example.test', '{"full_name":"F2 Coordinator"}', now()),
  (:'LEA', 'lea.f2@example.test', '{"full_name":"F2 Leader"}', now()),
  (:'MEM', 'mem.f2@example.test', '{"full_name":"F2 Member"}', now()),
  (:'MEM2', 'mem2.f2@example.test', '{"full_name":"F2 Member Two"}', now()),
  (:'APP', 'app.f2@example.test', '{"full_name":"F2 Applicant"}', now());
INSERT INTO public.cells (id, name) VALUES (:'CX', 'F2 Cell X'), (:'CY', 'F2 Cell Y');
UPDATE public.profiles SET role='admin', status='active' WHERE id=:'ADM';
UPDATE public.profiles SET role='coordinator', status='active' WHERE id=:'COO';
UPDATE public.profiles SET role='cell_leader', status='active' WHERE id=:'LEA';
UPDATE public.cells SET leader_id=:'LEA' WHERE id=:'CX';
SELECT set_config('app.cell_change_reason','F2 fixture',true);
UPDATE public.profiles SET cell_id=:'CX' WHERE id=:'LEA';
SELECT set_config('app.cell_change_reason','F2 fixture',true);
UPDATE public.profiles SET role='member', status='active', cell_id=:'CX' WHERE id=:'MEM';
SELECT set_config('app.cell_change_reason','F2 fixture',true);
UPDATE public.profiles SET role='member', status='active', cell_id=:'CY' WHERE id=:'MEM2';
-- APP keeps the default pending status from the signup trigger. Its person row holds a hidden identity.
UPDATE public.people SET phone='+1 (416) 555-0188' WHERE email='app.f2@example.test';
-- A visible prospect with no profile, and one existing contact logged by the member (so edit checks are not vacuous).
INSERT INTO public.people (full_name, email) VALUES ('F2 Prospect', 'prospect.f2@example.test');
INSERT INTO public.contacts (contact_name, logged_by, cell_id, person_id)
VALUES ('F2 Fixture Contact', :'MEM', :'CX', (SELECT id FROM public.people WHERE email = 'prospect.f2@example.test'));

-- Captured as the superuser: the applicant's canonical person id (members cannot select people.email to find it).
SELECT id AS f_app_person FROM public.people WHERE email = 'app.f2@example.test' \gset

-- Baselines, captured as psql variables so every delta below is relative to the real state.
SELECT count(*) AS p0 FROM public.people \gset
SELECT count(*) AS c0 FROM public.contacts \gset
SELECT count(*) AS k0 FROM public.identity_claims \gset
SELECT 'baseline: people=' || :p0 || ' contacts=' || :c0 || ' claims=' || :k0 AS baseline;

\set ON_ERROR_STOP 0

-- ---------------------------------------------------------------------------------------------------------------------
\echo ''
\echo '== A. FRESH, VISIBLE-MATCH AND HIDDEN-MATCH SUBMISSIONS: neutral outcome and identical write set'

SAVEPOINT a01; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
\echo 'CHECK A01 | MEM | fresh email | expect outcome logged, +1 contact, +1 people, +1 claim (unique)'
SELECT outcome FROM public.submit_contact('F2 Fresh', :'CX', '416 555 0199', 'fresh.f2@example.test', false, '', '', '', NULL, NULL, false, 'f2-key-a01');
RESET ROLE;
SELECT 'delta people=' || ((SELECT count(*) FROM public.people) - :p0) || ' contacts=' || ((SELECT count(*) FROM public.contacts) - :c0) || ' claims=' || ((SELECT count(*) FROM public.identity_claims) - :k0) || ' unique_claims=' || (SELECT count(*) FROM public.identity_claims WHERE status='unique') AS a01_delta;
ROLLBACK TO SAVEPOINT a01;

SAVEPOINT a02; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
\echo 'CHECK A02 | MEM | HIDDEN applicant email (case and whitespace variant) | expect outcome logged, claim open with candidate, NO identity error'
SELECT outcome FROM public.submit_contact('F2 Hidden Email', :'CX', NULL, '  APP.F2@Example.TEST ', false, '', '', '', NULL, NULL, false, 'f2-key-a02');
RESET ROLE;
SELECT 'open claims=' || (SELECT count(*) FROM public.identity_claims WHERE status='open') || ' open candidates=' || (SELECT coalesce(max(cardinality(candidate_person_ids)),0) FROM public.identity_claims WHERE status='open') AS a02_state;
ROLLBACK TO SAVEPOINT a02;

SAVEPOINT a03; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
\echo 'CHECK A03 | MEM | VISIBLE prospect email | expect outcome logged, claim open (D1: no auto-merge)'
SELECT outcome FROM public.submit_contact('F2 Visible', :'CX', NULL, 'prospect.f2@example.test', false, '', '', '', NULL, NULL, false, 'f2-key-a03');
RESET ROLE;
SELECT 'open claims=' || (SELECT count(*) FROM public.identity_claims WHERE status='open') AS a03_state;
ROLLBACK TO SAVEPOINT a03;

SAVEPOINT a04; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
\echo 'CHECK A04 | MEM | HIDDEN applicant phone, exact digits, different formatting | expect logged, open claim'
SELECT outcome FROM public.submit_contact('F2 Hidden Phone', :'CX', '+1 416 555 0188', NULL, false, '', '', '', NULL, NULL, false, 'f2-key-a04');
RESET ROLE;
SELECT 'open claims=' || (SELECT count(*) FROM public.identity_claims WHERE status='open') AS a04_state;
ROLLBACK TO SAVEPOINT a04;

SAVEPOINT a05; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
\echo 'CHECK A05 | MEM | phone with country code omitted (documented normalization gap, D7) | record actual: logged, no claim'
SELECT outcome FROM public.submit_contact('F2 Phone Gap', :'CX', '416 555 0188', NULL, false, '', '', '', NULL, NULL, false, 'f2-key-a05');
RESET ROLE;
SELECT 'open claims=' || (SELECT count(*) FROM public.identity_claims WHERE status='open') AS a05_state;
ROLLBACK TO SAVEPOINT a05;

SAVEPOINT a06; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
\echo 'CHECK A06 | MEM | name-only Quick Add (no identity) | expect logged, unique claim, no conflict'
SELECT outcome FROM public.submit_contact('F2 Name Only', :'CX', NULL, NULL, false, '', '', '', NULL, NULL, false, 'f2-key-a06');
ROLLBACK TO SAVEPOINT a06;

-- ---------------------------------------------------------------------------------------------------------------------
\echo ''
\echo '== B. IDEMPOTENCY AND INDEPENDENT LOGS'

SAVEPOINT b01; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
\echo 'CHECK B01 | MEM | same key twice | expect same contact id returned, one contact row'
SELECT contact_id AS first_id FROM public.submit_contact('F2 Repeat', :'CX', NULL, 'repeat.f2@example.test', false, '', '', '', NULL, NULL, false, 'f2-key-b01');
SELECT contact_id AS second_id FROM public.submit_contact('F2 Repeat changed payload', :'CX', NULL, 'other.f2@example.test', false, '', '', '', NULL, NULL, false, 'f2-key-b01');
RESET ROLE;
SELECT 'contacts with key=' || (SELECT count(*) FROM public.contacts WHERE idempotency_key='f2-key-b01') AS b01_count;
ROLLBACK TO SAVEPOINT b01;

SAVEPOINT b02; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
\echo 'CHECK B02 | MEM | two distinct keys, same email | expect two independent contacts, second claim open'
SELECT contact_id FROM public.submit_contact('F2 Same One', :'CX', NULL, 'same.f2@example.test', false, '', '', '', NULL, NULL, false, 'f2-key-b02a');
SELECT contact_id FROM public.submit_contact('F2 Same Two', :'CX', NULL, 'same.f2@example.test', false, '', '', '', NULL, NULL, false, 'f2-key-b02b');
RESET ROLE;
SELECT 'contacts=' || (SELECT count(*) FROM public.contacts WHERE email='same.f2@example.test') || ' open=' || (SELECT count(*) FROM public.identity_claims WHERE status='open') AS b02_state;
ROLLBACK TO SAVEPOINT b02;

-- ---------------------------------------------------------------------------------------------------------------------
\echo ''
\echo '== C. CELL AUTHORIZATION (mirrors contacts_insert_scoped)'

SAVEPOINT c01; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
\echo 'CHECK C01 | MEM | log into other cell CY | expect 42501'
SELECT * FROM public.submit_contact('F2 Other Cell', :'CY', NULL, NULL, false, '', '', '', NULL, NULL, false, 'f2-key-c01');
ROLLBACK TO SAVEPOINT c01;

SAVEPOINT c02; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub',:'LEA','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'LEA',true);
\echo 'CHECK C02 | LEA (leader CX) | log into CX | expect logged'
SELECT outcome FROM public.submit_contact('F2 Leader Own', :'CX', NULL, NULL, false, '', '', '', NULL, NULL, false, 'f2-key-c02');
ROLLBACK TO SAVEPOINT c02;

SAVEPOINT c03; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub',:'LEA','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'LEA',true);
\echo 'CHECK C03 | LEA (leader CX) | log into CY | expect 42501'
SELECT * FROM public.submit_contact('F2 Leader Other', :'CY', NULL, NULL, false, '', '', '', NULL, NULL, false, 'f2-key-c03');
ROLLBACK TO SAVEPOINT c03;

SAVEPOINT c04; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub',:'COO','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'COO',true);
\echo 'CHECK C04 | COO | log into CY | expect logged (coordinator any cell)'
SELECT outcome FROM public.submit_contact('F2 Coord', :'CY', NULL, NULL, false, '', '', '', NULL, NULL, false, 'f2-key-c04');
ROLLBACK TO SAVEPOINT c04;

SAVEPOINT c05; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
\echo 'CHECK C05 | MEM | nonexistent cell | expect 42501 (no FK error, no existence signal)'
SELECT * FROM public.submit_contact('F2 Ghost Cell', '00000000-0000-4000-8000-0000000000ff', NULL, NULL, false, '', '', '', NULL, NULL, false, 'f2-key-c05');
ROLLBACK TO SAVEPOINT c05;

SAVEPOINT c06; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
\echo 'CHECK C06 | MEM | unassigned cell (NULL) | expect logged'
SELECT outcome FROM public.submit_contact('F2 Unassigned', NULL, NULL, NULL, false, '', '', '', NULL, NULL, false, 'f2-key-c06');
ROLLBACK TO SAVEPOINT c06;

SAVEPOINT c07; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub',:'APP','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'APP',true);
\echo 'CHECK C07 | APP (pending) | submit | expect 42501'
SELECT * FROM public.submit_contact('F2 Pending', :'CX', NULL, NULL, false, '', '', '', NULL, NULL, false, 'f2-key-c07');
ROLLBACK TO SAVEPOINT c07;

SAVEPOINT c08; SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
\echo 'CHECK C08 | anon | submit | expect 42501 (no EXECUTE)'
SELECT * FROM public.submit_contact('F2 Anon', :'CX', NULL, NULL, false, '', '', '', NULL, NULL, false, 'f2-key-c08');
ROLLBACK TO SAVEPOINT c08;

SAVEPOINT c09; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
\echo 'CHECK C09 | MEM | name of one character | expect 22023'
SELECT * FROM public.submit_contact('A', :'CX', NULL, NULL, false, '', '', '', NULL, NULL, false, 'f2-key-c09');
ROLLBACK TO SAVEPOINT c09;

SAVEPOINT c10; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
\echo 'CHECK C10 | MEM | malformed email | expect 22023'
SELECT * FROM public.submit_contact('F2 Bad Email', :'CX', NULL, 'not-an-email', false, '', '', '', NULL, NULL, false, 'f2-key-c10');
ROLLBACK TO SAVEPOINT c10;

-- ---------------------------------------------------------------------------------------------------------------------
\echo ''
\echo '== D. BATCH IMPORT (per-row isolation)'

SAVEPOINT d01; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub',:'LEA','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'LEA',true);
\echo 'CHECK D01 | LEA | batch: valid, short name, other cell, hidden-identity row | expect logged, invalid, not_authorized, logged'
SELECT * FROM public.submit_contacts_batch(jsonb_build_array(
  jsonb_build_object('contact_name','F2 Batch Ok','cell_id',:'CX','email','batch.f2@example.test','idempotency_key','f2-batch-1'),
  jsonb_build_object('contact_name','A','cell_id',:'CX','idempotency_key','f2-batch-2'),
  jsonb_build_object('contact_name','F2 Batch Other','cell_id',:'CY','idempotency_key','f2-batch-3'),
  jsonb_build_object('contact_name','F2 Batch Hidden','cell_id',:'CX','email','app.f2@example.test','idempotency_key','f2-batch-4')
));
RESET ROLE;
SELECT 'batch contacts=' || (SELECT count(*) FROM public.contacts WHERE idempotency_key LIKE 'f2-batch-%') AS d01_state;
ROLLBACK TO SAVEPOINT d01;

-- ---------------------------------------------------------------------------------------------------------------------
\echo ''
\echo '== E. READ-BACK AND DIRECT WRITE BOUNDARY (ordinary member)'

SAVEPOINT e01; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
\echo 'CHECK E01 | MEM | select people.email of hidden applicant | expect 42501 (column not granted)'
SELECT email FROM public.people WHERE email='app.f2@example.test';
ROLLBACK TO SAVEPOINT e01;

SAVEPOINT e02; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
\echo 'CHECK E02 | MEM | select id,full_name of a row | expect 1 row (permitted columns)'
SELECT count(*) AS rows_seen FROM public.people WHERE id IS NOT NULL;
ROLLBACK TO SAVEPOINT e02;

SAVEPOINT e03; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
\echo 'CHECK E03 | MEM | select * on people (expands to revoked columns) | expect 42501'
SELECT * FROM public.people LIMIT 1;
ROLLBACK TO SAVEPOINT e03;

SAVEPOINT e04; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
\echo 'CHECK E04 | MEM | direct INSERT people | expect 42501'
INSERT INTO public.people (full_name, email) VALUES ('Probe', 'probe.f2@example.test');
ROLLBACK TO SAVEPOINT e04;

SAVEPOINT e05; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
\echo 'CHECK E05 | MEM | direct INSERT contacts | expect 42501'
INSERT INTO public.contacts (contact_name, logged_by, cell_id, person_id) VALUES ('Direct', :'MEM', :'CX', (SELECT id FROM public.people LIMIT 1));
ROLLBACK TO SAVEPOINT e05;

SAVEPOINT e06; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
\echo 'CHECK E06 | MEM | direct upsert (INSERT ... ON CONFLICT DO NOTHING RETURNING) people | expect 42501, no data-dependent outcome'
INSERT INTO public.people (full_name, email) VALUES ('Probe', 'app.f2@example.test') ON CONFLICT DO NOTHING RETURNING id;
ROLLBACK TO SAVEPOINT e06;

SAVEPOINT e07; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
\echo 'CHECK E07 | MEM | UPDATE own contact person_id | expect 42501 (column not granted)'
UPDATE public.contacts SET person_id = (SELECT id FROM public.people LIMIT 1) WHERE logged_by = :'MEM';
ROLLBACK TO SAVEPOINT e07;

SAVEPOINT e08; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
\echo 'CHECK E08 | MEM | UPDATE person_id to a nonexistent UUID | expect 42501 (identical to E07: no existence signal)'
UPDATE public.contacts SET person_id = '00000000-0000-4000-8000-0000000000fe' WHERE logged_by = :'MEM';
ROLLBACK TO SAVEPOINT e08;

SAVEPOINT e09; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
\echo 'CHECK E09 | MEM | UPDATE own contact logged_by | expect 42501'
UPDATE public.contacts SET logged_by = :'MEM2' WHERE logged_by = :'MEM';
ROLLBACK TO SAVEPOINT e09;

SAVEPOINT e10; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
\echo 'CHECK E10 | MEM | UPDATE own contact notes (permitted column) | expect UPDATE 0 or 1 by ownership, no privilege error'
UPDATE public.contacts SET notes = 'F2 note' WHERE logged_by = :'MEM';
ROLLBACK TO SAVEPOINT e10;

SAVEPOINT e11; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
\echo 'CHECK E11 | MEM | select identity_claims | expect 42501'
SELECT count(*) FROM public.identity_claims;
ROLLBACK TO SAVEPOINT e11;

SAVEPOINT e12; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
\echo 'CHECK E12 | MEM | call find_person_by_email | expect 42501 (execute revoked)'
SELECT public.find_person_by_email('app.f2@example.test');
ROLLBACK TO SAVEPOINT e12;

SAVEPOINT e13; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
\echo 'CHECK E13 | MEM | call internal helper _f2_submit_contact_row directly | expect 42501 (no EXECUTE)'
SELECT * FROM public._f2_submit_contact_row(:'MEM'::uuid, 'F2 Bypass', :'CX'::uuid, NULL, NULL, false, '', '', '', NULL, NULL, false, 'f2-key-e13');
ROLLBACK TO SAVEPOINT e13;

SAVEPOINT e14; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
\echo 'CHECK E14 | MEM | call _f2_active_actor directly | expect 42501 (no EXECUTE)'
SELECT public._f2_active_actor();
ROLLBACK TO SAVEPOINT e14;

SAVEPOINT e15; SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
\echo 'CHECK E15 | service_role (holds table UPDATE, bypasses RLS) | UPDATE contacts.person_id | expect 42501 from guard trigger'
UPDATE public.contacts SET person_id = (SELECT id FROM public.people WHERE email='mem2.f2@example.test') WHERE contact_name = 'F2 Fixture Contact';
ROLLBACK TO SAVEPOINT e15;

-- ---------------------------------------------------------------------------------------------------------------------
\echo ''
\echo '== F. STAFF REVIEW AND IDENTITY READ (admin, coordinator, members)'

-- Create ONE open claim as a member in the main transaction (not in a savepoint), so every review check below sees it.
-- Each review check runs in its own savepoint and rolls back, so the claim survives for the next check.
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
SELECT contact_id AS f_contact FROM public.submit_contact('F2 Review Subject', :'CX', NULL, 'app.f2@example.test', false, '', '', '', NULL, NULL, false, 'f2-key-f00') \gset
RESET ROLE;
SELECT id AS f_claim FROM public.identity_claims WHERE status = 'open' \gset
SELECT candidate_person_ids[1] AS f_cand FROM public.identity_claims WHERE id = :'f_claim' \gset
SELECT 'pre-claim open=' || count(*) AS f_pre FROM public.identity_claims WHERE status = 'open';

SAVEPOINT f01; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
\echo 'CHECK F01 | MEM | list_identity_claims | expect 42501'
SELECT * FROM public.list_identity_claims('open', 10);
ROLLBACK TO SAVEPOINT f01;

SAVEPOINT f02; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub',:'LEA','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'LEA',true);
\echo 'CHECK F02 | LEA (cell leader) | get_person_identity | expect 42501 (staff only, D2)'
SELECT * FROM public.get_person_identity(:'f_app_person', 'F2 leader attempt');
ROLLBACK TO SAVEPOINT f02;

SAVEPOINT f03; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub',:'COO','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'COO',true);
\echo 'CHECK F03 | COO | list_identity_claims(open) | expect >=1 row, names only, no identity'
SELECT count(*) AS open_claims FROM public.list_identity_claims('open', 50);
ROLLBACK TO SAVEPOINT f03;

SAVEPOINT f04; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub',:'COO','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'COO',true);
\echo 'CHECK F04 | COO | get_claim_identity with short reason | expect 22023'
SELECT * FROM public.get_claim_identity(:'f_claim', 'x');
ROLLBACK TO SAVEPOINT f04;

SAVEPOINT f05; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub',:'COO','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'COO',true);
\echo 'CHECK F05 | COO | get_claim_identity with valid reason | expect the submitted email, audit row +1'
SELECT * FROM public.get_claim_identity(:'f_claim', 'Resolve duplicate for F2 test');
RESET ROLE;
SELECT 'read audit rows=' || (SELECT count(*) FROM public.identity_read_audit) AS f05_audit;
ROLLBACK TO SAVEPOINT f05;

SAVEPOINT f06; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub',:'ADM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'ADM',true);
\echo 'CHECK F06 | ADM | get_person_identity | expect canonical identity returned, audit row +1 (D2)'
SELECT full_name, email IS NOT NULL AS has_email FROM public.get_person_identity(:'f_app_person', 'Admin review of applicant');
ROLLBACK TO SAVEPOINT f06;

SAVEPOINT f07; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub',:'COO','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'COO',true);
\echo 'CHECK F07 | COO | resolve attach to a candidate NOT in the claim | expect 22023'
SELECT public.resolve_identity_claim(:'f_claim', 'attach', :'MEM', 'Attach wrong candidate');
ROLLBACK TO SAVEPOINT f07;

SAVEPOINT f08; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub',:'COO','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'COO',true);
\echo 'CHECK F08 | COO | attach to matching candidate | expect attached; contact moved to candidate; subject removed; claim identity nulled'
SELECT public.resolve_identity_claim(:'f_claim', 'attach', :'f_cand', 'Confirmed same person') AS outcome;
RESET ROLE;
SELECT 'claim status='|| (SELECT status FROM public.identity_claims WHERE id = :'f_claim')
       || ' raw_email_remaining=' || (SELECT count(*) FROM public.identity_claims WHERE id = :'f_claim' AND submitted_email IS NOT NULL)
       || ' contact_moved_to_candidate=' || (SELECT count(*) FROM public.contacts WHERE id = :'f_contact' AND person_id = :'f_cand')
       || ' subject_removed=' || (SELECT count(*) FROM public.people WHERE id = (SELECT subject_person_id FROM public.identity_claims WHERE id = :'f_claim')) AS f08_state;
ROLLBACK TO SAVEPOINT f08;

SAVEPOINT f09; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub',:'COO','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'COO',true);
\echo 'CHECK F09 | COO | resolve the same claim twice | expect second call P0001 (once only)'
SELECT public.resolve_identity_claim(:'f_claim', 'keep_separate', NULL, 'Keep separate once');
SELECT public.resolve_identity_claim(:'f_claim', 'keep_separate', NULL, 'Keep separate twice');
ROLLBACK TO SAVEPOINT f09;

SAVEPOINT f10; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub',:'COO','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'COO',true);
\echo 'CHECK F10 | COO | keep_separate | expect kept_separate, raw identity nulled, no contact moved'
SELECT public.resolve_identity_claim(:'f_claim', 'keep_separate', NULL, 'Different people');
RESET ROLE;
SELECT 'status=' || (SELECT status FROM public.identity_claims WHERE id = :'f_claim')
       || ' raw=' || (SELECT count(*) FROM public.identity_claims WHERE id = :'f_claim' AND (submitted_email IS NOT NULL OR submitted_phone IS NOT NULL))
       || ' contact_unmoved=' || (SELECT count(*) FROM public.contacts WHERE id = :'f_contact' AND person_id <> :'f_cand') AS f10_state;
ROLLBACK TO SAVEPOINT f10;

SAVEPOINT f11; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub',:'COO','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'COO',true);
\echo 'CHECK F11 | COO | update identity_review_audit directly | expect 42501 (no privilege)'
UPDATE public.identity_review_audit SET reason = 'tampered';
ROLLBACK TO SAVEPOINT f11;

SAVEPOINT f12; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub',:'COO','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'COO',true);
\echo 'CHECK F12 | COO | select identity_read_audit directly | expect 42501 (no privilege)'
SELECT count(*) FROM public.identity_read_audit;
ROLLBACK TO SAVEPOINT f12;

-- ---------------------------------------------------------------------------------------------------------------------
\echo ''
\echo '== H. WORKFLOWS THAT MUST STILL WORK AFTER 098 (positive controls and one negative)'

SAVEPOINT h01; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub',:'LEA','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'LEA',true);
\echo 'CHECK H01 | LEA (leader CX) | edit notes of a CX contact (contact edit workflow) | expect UPDATE 1'
UPDATE public.contacts SET notes = 'F2 leader edit' WHERE contact_name = 'F2 Fixture Contact';
ROLLBACK TO SAVEPOINT h01;

SAVEPOINT h02; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub',:'LEA','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'LEA',true);
\echo 'CHECK H02 | LEA | reassign follow-up (granted follow_up_assignee column) | expect UPDATE 1'
UPDATE public.contacts SET follow_up_assignee = :'MEM' WHERE contact_name = 'F2 Fixture Contact';
ROLLBACK TO SAVEPOINT h02;

SAVEPOINT h03; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub',:'LEA','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'LEA',true);
\echo 'CHECK H03 | LEA (leader CX) | move a CX contact into cell CY | expect 42501 (WITH CHECK: leader is not leader of CY)'
UPDATE public.contacts SET cell_id = :'CY' WHERE contact_name = 'F2 Fixture Contact';
ROLLBACK TO SAVEPOINT h03;

SAVEPOINT h04; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
SELECT contact_id AS h_subject_contact FROM public.submit_contact('F2 Merge Subject', :'CX', NULL, 'merge.subject.f2@example.test', false, '', '', '', NULL, NULL, false, 'f2-key-h04') \gset
RESET ROLE;
SELECT person_id AS h_subject_person FROM public.contacts WHERE id = :'h_subject_contact' \gset
SELECT id AS h_prospect FROM public.people WHERE email = 'prospect.f2@example.test' \gset
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub',:'COO','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'COO',true);
\echo 'CHECK H04 | COO | merge_people (existing prospect merge) of a submitted subject into the prospect | expect merged id returned, contact re-linked'
SELECT public.merge_people(:'h_prospect', :'h_subject_person', 'F2 merge workflow check') AS merged_into;
RESET ROLE;
SELECT 'contact re-linked to prospect=' || (SELECT count(*) FROM public.contacts WHERE id = :'h_subject_contact' AND person_id = :'h_prospect') || ' subject removed=' || (SELECT count(*) FROM public.people WHERE id = :'h_subject_person') AS h04_state;
ROLLBACK TO SAVEPOINT h04;

\echo '== G. CATALOG AND PRIVILEGE CHECKS'
SELECT 'G01 authenticated INSERT people=' || has_table_privilege('authenticated','public.people','INSERT')
    || ' INSERT contacts=' || has_table_privilege('authenticated','public.contacts','INSERT')
    || ' SELECT people.email=' || has_column_privilege('authenticated','public.people','email','SELECT')
    || ' SELECT people.full_name=' || has_column_privilege('authenticated','public.people','full_name','SELECT')
    || ' UPDATE contacts.person_id=' || has_column_privilege('authenticated','public.contacts','person_id','UPDATE')
    || ' UPDATE contacts.notes=' || has_column_privilege('authenticated','public.contacts','notes','UPDATE') AS g01;
SELECT 'G02 execute submit_contact (auth)=' || has_function_privilege('authenticated','public.submit_contact(text,uuid,text,text,boolean,text,text,text,uuid,date,boolean,text)','EXECUTE')
    || ' (anon)=' || has_function_privilege('anon','public.submit_contact(text,uuid,text,text,boolean,text,text,text,uuid,date,boolean,text)','EXECUTE') AS g02;
SELECT 'G03 execute find_person_by_email (auth)=' || has_function_privilege('authenticated','public.find_person_by_email(text)','EXECUTE') AS g03;
SELECT 'G04 helpers executable by authenticated=' || (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname LIKE '\_f2\_%' AND has_function_privilege('authenticated', p.oid, 'EXECUTE')) AS g04;
SELECT 'G05 SECURITY DEFINER functions without pinned search_path=' || (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.prosecdef AND p.proname IN ('submit_contact','submit_contacts_batch','list_identity_claims','get_claim_identity','get_person_identity','resolve_identity_claim','_f2_submit_contact_row','_f2_active_actor','_f2_staff_actor')
   AND NOT (coalesce(p.proconfig::text,'') LIKE '%search_path%')) AS g05;
SELECT 'G06 trigger present=' || (SELECT count(*) FROM pg_trigger WHERE tgname='contacts_guard_person_reassignment') AS g06;
SELECT 'G07 idempotency index present=' || (SELECT count(*) FROM pg_indexes WHERE indexname='contacts_logged_by_idempotency_key_unique') AS g07;
SELECT 'G08 identity unique indexes unchanged=' || (SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND tablename='people' AND indexname IN ('people_email_unique','people_email_normalized_unique','people_phone_unique','people_phone_normalized_unique')) AS g08;

ROLLBACK;
\echo ''
\echo '== END: rolled back'
SELECT 'leftover f2 users=' || count(*) FROM auth.users WHERE email LIKE '%.f2@example.test';
