-- N1, N2, N3 reproduction (Agent 2 findings). DISPOSABLE clone only. Synthetic example.test identities. No email is sent:
-- signup is modelled by inserting auth.users, which is what GoTrue does at signup. Everything is rolled back.
-- Run on the 096 baseline (cert_a) and on the 097/098 clone (cert_f2) to show the before and after state.
--
-- Environment limits, recorded in the report: the local auth stub has no email_confirmed_at column, so confirmation
-- state cannot be represented here. The trigger does not read confirmation state either (checked in its body). Whether
-- production requires confirmation is NOT verifiable from the repo.
\set ON_ERROR_STOP 0
\set VERBOSITY verbose
BEGIN;

\echo '== FIXTURE (supabase_admin)'
\set ADM '00000000-0000-4000-8000-0000000000a1'
\set COO '00000000-0000-4000-8000-0000000000a2'
\set LEA '00000000-0000-4000-8000-0000000000a3'
\set MEM '00000000-0000-4000-8000-0000000000a4'
\set MEM2 '00000000-0000-4000-8000-0000000000a5'
\set VIC '00000000-0000-4000-8000-0000000000e1'
\set CX '00000000-0000-4000-8000-0000000000c1'
\set CY '00000000-0000-4000-8000-0000000000c2'
\set CT_M '00000000-0000-4000-8000-0000000000d1'
INSERT INTO auth.users (id, email, raw_user_meta_data, created_at) VALUES
  (:'ADM', 'adm.n@example.test', '{"full_name":"N Admin"}', now()),
  (:'COO', 'coo.n@example.test', '{"full_name":"N Coordinator"}', now()),
  (:'LEA', 'lea.n@example.test', '{"full_name":"N Leader"}', now()),
  (:'MEM', 'mem.n@example.test', '{"full_name":"N Member"}', now()),
  (:'MEM2', 'mem2.n@example.test', '{"full_name":"N Member Two"}', now());
INSERT INTO public.cells (id, name) VALUES (:'CX', 'N Cell X'), (:'CY', 'N Cell Y');
UPDATE public.profiles SET role='admin', status='active' WHERE id=:'ADM';
UPDATE public.profiles SET role='coordinator', status='active' WHERE id=:'COO';
UPDATE public.profiles SET role='cell_leader', status='active' WHERE id=:'LEA';
UPDATE public.cells SET leader_id=:'LEA' WHERE id=:'CX';
SELECT set_config('app.cell_change_reason','N fixture',true);
UPDATE public.profiles SET cell_id=:'CX' WHERE id=:'LEA';
SELECT set_config('app.cell_change_reason','N fixture',true);
UPDATE public.profiles SET role='member', status='active', cell_id=:'CX' WHERE id=:'MEM';
SELECT set_config('app.cell_change_reason','N fixture',true);
UPDATE public.profiles SET role='member', status='active', cell_id=:'CY' WHERE id=:'MEM2';
-- The victim: an existing person with an email and phone. No profile is linked to it yet.
INSERT INTO public.people (id, full_name, email, phone) VALUES (:'VIC', 'N Victim', 'victim.n@example.test', '+1 (416) 555-0191');
-- A contact that ordinary member MEM logged in cell X. Target for N3.
INSERT INTO public.contacts (id, contact_name, logged_by, cell_id, person_id) VALUES (:'CT_M', 'N Contact M', :'MEM', :'CX', :'VIC');
SELECT 'fixture: people=' || (SELECT count(*) FROM public.people) || ' contacts=' || (SELECT count(*) FROM public.contacts) AS fixture;

-- ---------------------------------------------------------------------------------------------------------------------
\echo ''
\echo '== N1. Signup with an existing person''s email, without any verification (modelled as the auth.users INSERT)'
SAVEPOINT n1;
SELECT count(*) AS p0 FROM public.people \gset
SAVEPOINT n1a; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
SELECT 'N1a member_sees_victim_before=' || count(*) FROM public.people WHERE id = :'VIC';
ROLLBACK TO SAVEPOINT n1a;
\echo 'N1b | attacker auth.users INSERT with the victim''s email (no verification in the model)'
\set ATT '00000000-0000-4000-8000-0000000000b6'
INSERT INTO auth.users (id, email, raw_user_meta_data, created_at) VALUES (:'ATT', 'victim.n@example.test', '{"full_name":"Impostor"}', now());
SELECT 'N1b profile_linked_to_victim=' || count(*) || ' status=' || (SELECT status FROM public.profiles WHERE id = :'ATT') FROM public.profiles WHERE id = :'ATT' AND person_id = :'VIC';
SELECT 'N1c people_rows_added=' || ((SELECT count(*) FROM public.people) - :p0) || ' (0 means linked, not created)' AS n1c;
SAVEPOINT n1d; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
SELECT 'N1d member_sees_victim_after=' || count(*) FROM public.people WHERE id = :'VIC';
ROLLBACK TO SAVEPOINT n1d;
\echo 'N1e | impostor session (sign-in permitted, as the repo config allows with confirmations off): each column read in its own savepoint'
SAVEPOINT n1e_name; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'ATT','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'ATT',true);
SELECT 'N1e impostor_reads_name=' || full_name FROM public.people WHERE id = :'VIC';
ROLLBACK TO SAVEPOINT n1e_name;
SAVEPOINT n1e_email; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'ATT','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'ATT',true);
SELECT 'N1e impostor_reads_email=' || email FROM public.people WHERE id = :'VIC';
ROLLBACK TO SAVEPOINT n1e_email;
SAVEPOINT n1e_phone; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'ATT','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'ATT',true);
SELECT 'N1e impostor_reads_phone=' || phone FROM public.people WHERE id = :'VIC';
ROLLBACK TO SAVEPOINT n1e_phone;
\echo 'N1f | control: a fresh email still creates its own person and does not touch the victim'
INSERT INTO auth.users (id, email, raw_user_meta_data, created_at) VALUES ('00000000-0000-4000-8000-0000000000b7', 'fresh.n@example.test', '{"full_name":"Fresh"}', now());
SELECT 'N1f fresh_profile_person_is_new=' || count(*) FROM public.profiles pr JOIN public.people pe ON pe.id = pr.person_id WHERE pr.id = '00000000-0000-4000-8000-0000000000b7' AND pe.id <> :'VIC';
ROLLBACK TO SAVEPOINT n1;

-- ---------------------------------------------------------------------------------------------------------------------
\echo ''
\echo '== N2. contacts INSERT with logged_by set to ANOTHER user (policy contacts_insert_scoped, migration 092)'
\echo 'N2 columns: role | logged_by | expected | actual (SQLSTATE or row count)'
SAVEPOINT n2;
SET ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
\echo 'N2 | member | logged_by = self (control) | expect INSERT 1'
INSERT INTO public.contacts (contact_name, logged_by, cell_id, person_id) VALUES ('N2 member self', :'MEM', :'CX', :'VIC');
RESET ROLE;
ROLLBACK TO SAVEPOINT n2;
SAVEPOINT n2b; SET ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
\echo 'N2 | member | logged_by = COO (negative) | expect refused'
INSERT INTO public.contacts (contact_name, logged_by, cell_id, person_id) VALUES ('N2 member spoof', :'COO', :'CX', :'VIC');
RESET ROLE;
ROLLBACK TO SAVEPOINT n2b;
SAVEPOINT n2c; SET ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'LEA','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'LEA',true);
\echo 'N2 | cell leader | logged_by = self (control) | expect INSERT 1'
INSERT INTO public.contacts (contact_name, logged_by, cell_id, person_id) VALUES ('N2 leader self', :'LEA', :'CX', :'VIC');
RESET ROLE;
ROLLBACK TO SAVEPOINT n2c;
SAVEPOINT n2d; SET ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'LEA','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'LEA',true);
\echo 'N2 | cell leader | logged_by = MEM, own cell | expect refused (policy must derive logged_by from auth.uid())'
INSERT INTO public.contacts (contact_name, logged_by, cell_id, person_id) VALUES ('N2 leader spoof', :'MEM', :'CX', :'VIC');
RESET ROLE;
ROLLBACK TO SAVEPOINT n2d;
SAVEPOINT n2e; SET ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'COO','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'COO',true);
\echo 'N2 | coordinator | logged_by = MEM | expect refused'
INSERT INTO public.contacts (contact_name, logged_by, cell_id, person_id) VALUES ('N2 coord spoof', :'MEM', :'CX', :'VIC');
RESET ROLE;
ROLLBACK TO SAVEPOINT n2e;
SAVEPOINT n2f; SET ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'ADM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'ADM',true);
\echo 'N2 | admin | logged_by = MEM | expect refused'
INSERT INTO public.contacts (contact_name, logged_by, cell_id, person_id) VALUES ('N2 admin spoof', :'MEM', :'CX', :'VIC');
RESET ROLE;
ROLLBACK TO SAVEPOINT n2f;
SAVEPOINT n2g; SET ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
\echo 'N2 | member | logged_by = self, cell of another member (MEM2 cell CY) | expect refused'
INSERT INTO public.contacts (contact_name, logged_by, cell_id, person_id) VALUES ('N2 member other cell', :'MEM', :'CY', :'VIC');
RESET ROLE;
ROLLBACK TO SAVEPOINT n2g;

-- ---------------------------------------------------------------------------------------------------------------------
\echo ''
\echo '== N3. UPDATE of contacts.logged_by and contacts.person_id by staff and members'
\echo 'N3 columns: role | column | expected | actual (SQLSTATE or row count) | post-state'
SAVEPOINT n3a; SET ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'LEA','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'LEA',true);
\echo 'N3 | cell leader | logged_by -> LEA (reattribute own cell contact) | expect refused'
UPDATE public.contacts SET logged_by = :'LEA' WHERE id = :'CT_M';
RESET ROLE;
SELECT 'N3 post-state logged_by=' || logged_by::text || ' (MEM=' || :'MEM' || ')' AS n3a_post FROM public.contacts WHERE id = :'CT_M';
ROLLBACK TO SAVEPOINT n3a;
SAVEPOINT n3b; SET ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'LEA','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'LEA',true);
\echo 'N3 | cell leader | person_id -> another person (repoint contact identity) | expect refused'
UPDATE public.contacts SET person_id = (SELECT id FROM public.people WHERE email = 'mem2.n@example.test') WHERE id = :'CT_M';
RESET ROLE;
SELECT 'N3 post-state person_id=' || CASE WHEN person_id = :'VIC' THEN 'victim (unchanged)' ELSE 'CHANGED' END AS n3b_post FROM public.contacts WHERE id = :'CT_M';
ROLLBACK TO SAVEPOINT n3b;
SAVEPOINT n3c; SET ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'COO','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'COO',true);
\echo 'N3 | coordinator | logged_by -> COO | expect refused'
UPDATE public.contacts SET logged_by = :'COO' WHERE id = :'CT_M';
RESET ROLE;
SELECT 'N3 post-state logged_by=' || logged_by::text AS n3c_post FROM public.contacts WHERE id = :'CT_M';
ROLLBACK TO SAVEPOINT n3c;
SAVEPOINT n3d; SET ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'ADM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'ADM',true);
\echo 'N3 | admin | person_id -> another person | expect refused'
UPDATE public.contacts SET person_id = (SELECT id FROM public.people WHERE email = 'mem2.n@example.test') WHERE id = :'CT_M';
RESET ROLE;
SELECT 'N3 post-state person_id=' || CASE WHEN person_id = :'VIC' THEN 'victim (unchanged)' ELSE 'CHANGED' END AS n3d_post FROM public.contacts WHERE id = :'CT_M';
ROLLBACK TO SAVEPOINT n3d;
SAVEPOINT n3e; SET ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
\echo 'N3 | member (logger) | logged_by -> COO on own contact | expect 0 rows (no edit right)'
UPDATE public.contacts SET logged_by = :'COO' WHERE id = :'CT_M';
RESET ROLE;
SELECT 'N3 post-state logged_by=' || logged_by::text AS n3e_post FROM public.contacts WHERE id = :'CT_M';
ROLLBACK TO SAVEPOINT n3e;
SAVEPOINT n3f; SET ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'LEA','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'LEA',true);
\echo 'N3 | cell leader | notes edit on own-cell contact (permitted control) | expect UPDATE 1'
UPDATE public.contacts SET notes = 'N3 control note' WHERE id = :'CT_M';
ROLLBACK TO SAVEPOINT n3f;

ROLLBACK;
\echo '== END: rolled back'
SELECT 'leftover n users=' || count(*) FROM auth.users WHERE email LIKE '%.n@example.test';
