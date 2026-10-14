-- N2 and N3 remediation certification (migration 097, section 5b). DISPOSABLE clone only; everything rolled back.
-- Run on two clones:
--   cert_n  : 096 + 097 only. Isolates the POLICY and the TRIGGER (privileges are still table-level here).
--   cert_f2 : 096 + 097 + 098. Adds the PRIVILEGE layer. Denials here are 42501 from grants, not from the policy.
\set ON_ERROR_STOP 0
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
  (:'ADM', 'adm.nr@example.test', '{"full_name":"NR Admin"}', now()),
  (:'COO', 'coo.nr@example.test', '{"full_name":"NR Coordinator"}', now()),
  (:'LEA', 'lea.nr@example.test', '{"full_name":"NR Leader"}', now()),
  (:'MEM', 'mem.nr@example.test', '{"full_name":"NR Member"}', now()),
  (:'MEM2', 'mem2.nr@example.test', '{"full_name":"NR Member Two"}', now());
INSERT INTO public.cells (id, name) VALUES (:'CX', 'NR Cell X'), (:'CY', 'NR Cell Y');
UPDATE public.profiles SET role='admin', status='active' WHERE id=:'ADM';
UPDATE public.profiles SET role='coordinator', status='active' WHERE id=:'COO';
UPDATE public.profiles SET role='cell_leader', status='active' WHERE id=:'LEA';
UPDATE public.cells SET leader_id=:'LEA' WHERE id=:'CX';
SELECT set_config('app.cell_change_reason','NR fixture',true);
UPDATE public.profiles SET cell_id=:'CX' WHERE id=:'LEA';
SELECT set_config('app.cell_change_reason','NR fixture',true);
UPDATE public.profiles SET role='member', status='active', cell_id=:'CX' WHERE id=:'MEM';
SELECT set_config('app.cell_change_reason','NR fixture',true);
UPDATE public.profiles SET role='member', status='active', cell_id=:'CY' WHERE id=:'MEM2';
INSERT INTO public.people (id, full_name, email) VALUES (:'VIC', 'NR Victim', 'victim.nr@example.test');
INSERT INTO public.contacts (id, contact_name, logged_by, cell_id, person_id) VALUES (:'CT_M', 'NR Contact M', :'MEM', :'CX', :'VIC');

-- ---------------------------------------------------------------------------------------------------------------------
\echo ''
\echo '== N2. contacts INSERT attribution, by role. Expect: logged_by must equal the caller.'
\echo 'N2 | role | logged_by | expect | actual (SQLSTATE or row count) | post-state'
SAVEPOINT n2a; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'LEA','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'LEA',true);
\echo 'N2a | cell leader | MEM (other user), own cell | refused'
INSERT INTO public.contacts (contact_name, logged_by, cell_id, person_id) VALUES ('NR N2a', :'MEM', :'CX', :'VIC');
ROLLBACK TO SAVEPOINT n2a;
SAVEPOINT n2b; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'COO','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'COO',true);
\echo 'N2b | coordinator | MEM (other user) | refused'
INSERT INTO public.contacts (contact_name, logged_by, cell_id, person_id) VALUES ('NR N2b', :'MEM', :'CX', :'VIC');
ROLLBACK TO SAVEPOINT n2b;
SAVEPOINT n2c; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'ADM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'ADM',true);
\echo 'N2c | admin | MEM (other user) | refused'
INSERT INTO public.contacts (contact_name, logged_by, cell_id, person_id) VALUES ('NR N2c', :'MEM', :'CX', :'VIC');
ROLLBACK TO SAVEPOINT n2c;
SAVEPOINT n2d; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
\echo 'N2d | member | COO (other user) | refused'
INSERT INTO public.contacts (contact_name, logged_by, cell_id, person_id) VALUES ('NR N2d', :'COO', :'CX', :'VIC');
ROLLBACK TO SAVEPOINT n2d;
SAVEPOINT n2e; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'LEA','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'LEA',true);
\echo 'N2e | cell leader | self, own cell (POSITIVE CONTROL) | INSERT 1'
INSERT INTO public.contacts (contact_name, logged_by, cell_id, person_id) VALUES ('NR N2e', :'LEA', :'CX', :'VIC');
ROLLBACK TO SAVEPOINT n2e;
SAVEPOINT n2f; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'COO','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'COO',true);
\echo 'N2f | coordinator | self, cell CY (POSITIVE CONTROL) | INSERT 1'
INSERT INTO public.contacts (contact_name, logged_by, cell_id, person_id) VALUES ('NR N2f', :'COO', :'CY', :'VIC');
ROLLBACK TO SAVEPOINT n2f;
SAVEPOINT n2g; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
\echo 'N2g | member | self, own cell (POSITIVE CONTROL) | INSERT 1'
INSERT INTO public.contacts (contact_name, logged_by, cell_id, person_id) VALUES ('NR N2g', :'MEM', :'CX', :'VIC');
ROLLBACK TO SAVEPOINT n2g;
SAVEPOINT n2h; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
\echo 'N2h | member | self, cell CY of another member (negative control, unchanged) | refused'
INSERT INTO public.contacts (contact_name, logged_by, cell_id, person_id) VALUES ('NR N2h', :'MEM', :'CY', :'VIC');
ROLLBACK TO SAVEPOINT n2h;

-- ---------------------------------------------------------------------------------------------------------------------
\echo ''
\echo '== N3. contacts UPDATE of logged_by and person_id'
SAVEPOINT n3a; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'LEA','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'LEA',true);
\echo 'N3a | cell leader | logged_by -> LEA | refused'
UPDATE public.contacts SET logged_by = :'LEA' WHERE id = :'CT_M';
RESET ROLE;
SELECT 'N3a post-state logged_by unchanged=' || (logged_by = :'MEM') FROM public.contacts WHERE id = :'CT_M';
ROLLBACK TO SAVEPOINT n3a;
SAVEPOINT n3b; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'COO','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'COO',true);
\echo 'N3b | coordinator | person_id -> another person | refused'
UPDATE public.contacts SET person_id = (SELECT id FROM public.people WHERE email='mem2.nr@example.test') WHERE id = :'CT_M';
SELECT 'N3b post-state person unchanged=' || (person_id = :'VIC') FROM public.contacts WHERE id = :'CT_M';
ROLLBACK TO SAVEPOINT n3b;
SAVEPOINT n3c; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'LEA','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'LEA',true);
\echo 'N3c | cell leader | notes edit, own cell (POSITIVE CONTROL) | UPDATE 1'
UPDATE public.contacts SET notes = 'NR note' WHERE id = :'CT_M';
ROLLBACK TO SAVEPOINT n3c;
SAVEPOINT n3d; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
\echo 'N3d | member (logger) | logged_by -> COO | 0 rows or refused'
UPDATE public.contacts SET logged_by = :'COO' WHERE id = :'CT_M';
RESET ROLE;
SELECT 'N3d post-state logged_by unchanged=' || (logged_by = :'MEM') FROM public.contacts WHERE id = :'CT_M';
ROLLBACK TO SAVEPOINT n3d;

-- ---------------------------------------------------------------------------------------------------------------------
\echo ''
\echo '== N3 correction path: correct_contact_attribution (admin or coordinator, reason, audit)'
SAVEPOINT n4a; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'LEA','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'LEA',true);
\echo 'N4a | cell leader | correct attribution | refused (42501)'
SELECT public.correct_contact_attribution(:'CT_M', :'LEA', 'NR leader correction');
ROLLBACK TO SAVEPOINT n4a;
SAVEPOINT n4b; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'COO','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'COO',true);
\echo 'N4b | coordinator | reason too short | refused (22023)'
SELECT public.correct_contact_attribution(:'CT_M', :'LEA', 'x');
ROLLBACK TO SAVEPOINT n4b;
SAVEPOINT n4c; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'COO','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'COO',true);
\echo 'N4c | coordinator | correct to LEA with reason (POSITIVE CONTROL) | applied'
SELECT public.correct_contact_attribution(:'CT_M', :'LEA', 'NR correction, duplicate logger');
RESET ROLE;
SELECT 'N4c post-state logged_by=LEA: ' || (logged_by = :'LEA') || ' | audit rows=' || (SELECT count(*) FROM public.contact_attribution_audit WHERE contact_id = :'CT_M' AND actor_id = :'COO') FROM public.contacts WHERE id = :'CT_M';
ROLLBACK TO SAVEPOINT n4c;
SAVEPOINT n4d; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
\echo 'N4d | member | correct attribution | refused (42501)'
SELECT public.correct_contact_attribution(:'CT_M', :'COO', 'NR member attempt');
ROLLBACK TO SAVEPOINT n4d;
SAVEPOINT n4e; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'COO','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'COO',true);
\echo 'N4e | coordinator | audit table read (direct) | refused (42501)'
SELECT count(*) FROM public.contact_attribution_audit;
ROLLBACK TO SAVEPOINT n4e;

-- ---------------------------------------------------------------------------------------------------------------------
\echo ''
\echo '== OWNER GUARD: the trigger, reached as the owner role (correction path is the only owner writer)'
SAVEPOINT n5a;
UPDATE public.contacts SET logged_by = :'COO' WHERE id = :'CT_M';
SELECT 'N5a owner correction allowed=' || (logged_by = :'COO') FROM public.contacts WHERE id = :'CT_M';
ROLLBACK TO SAVEPOINT n5a;

ROLLBACK;
\echo '== END: rolled back'
SELECT 'leftover nr users=' || count(*) FROM auth.users WHERE email LIKE '%.nr@example.test';
