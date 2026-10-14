-- F2 shared fixture. Synthetic example.test identities only. Owner context. Runs inside the suite transaction, which is
-- rolled back at the end. Every precondition is asserted. A missing precondition stops the run.
--   a1 admin, a2 coordinator, a3 cell leader of cell c1, a4 member in c1, a5 member in c2,
--   a6 pending applicant (hidden identity: app.f2@example.test, phone +1 (416) 555-0177).
--   Visible prospect: person e2 (prospect.f2@example.test). Contacts: d1 logged by a4 in c1, d2 logged by a3 in c1.

INSERT INTO auth.users (id, email, raw_user_meta_data, created_at) VALUES
  (pg_temp.u('a1'), 'adm.f2@example.test', '{"full_name":"F2 Admin"}', now()),
  (pg_temp.u('a2'), 'coo.f2@example.test', '{"full_name":"F2 Coordinator"}', now()),
  (pg_temp.u('a3'), 'lea.f2@example.test', '{"full_name":"F2 Leader"}', now()),
  (pg_temp.u('a4'), 'mem.f2@example.test', '{"full_name":"F2 Member"}', now()),
  (pg_temp.u('a5'), 'mem2.f2@example.test', '{"full_name":"F2 Member Two"}', now()),
  (pg_temp.u('a6'), 'app.f2@example.test', '{"full_name":"F2 Applicant"}', now());

INSERT INTO public.cells (id, name) VALUES (pg_temp.u('c1'), 'F2 Cell X'), (pg_temp.u('c2'), 'F2 Cell Y');

UPDATE public.profiles SET role = 'admin', status = 'active' WHERE id = pg_temp.u('a1');
UPDATE public.profiles SET role = 'coordinator', status = 'active' WHERE id = pg_temp.u('a2');
UPDATE public.profiles SET role = 'cell_leader', status = 'active' WHERE id = pg_temp.u('a3');
UPDATE public.cells SET leader_id = pg_temp.u('a3') WHERE id = pg_temp.u('c1');
SELECT set_config('app.cell_change_reason', 'F2 fixture placement', true);
UPDATE public.profiles SET cell_id = pg_temp.u('c1') WHERE id = pg_temp.u('a3');
SELECT set_config('app.cell_change_reason', 'F2 fixture placement', true);
UPDATE public.profiles SET role = 'member', status = 'active', cell_id = pg_temp.u('c1') WHERE id = pg_temp.u('a4');
SELECT set_config('app.cell_change_reason', 'F2 fixture placement', true);
UPDATE public.profiles SET role = 'member', status = 'active', cell_id = pg_temp.u('c2') WHERE id = pg_temp.u('a5');

UPDATE public.people SET phone = '+1 (416) 555-0177' WHERE email = 'app.f2@example.test';
INSERT INTO public.people (id, full_name, email, phone)
  VALUES (pg_temp.u('e2'), 'F2 Prospect', 'prospect.f2@example.test', '+1 (905) 555-0123');
INSERT INTO public.contacts (id, contact_name, logged_by, cell_id, person_id, idempotency_key) VALUES
  (pg_temp.u('d1'), 'F2 Contact Member', pg_temp.u('a4'), pg_temp.u('c1'), pg_temp.u('e2'), 'fixture-d1'),
  (pg_temp.u('d2'), 'F2 Contact Leader', pg_temp.u('a3'), pg_temp.u('c1'), pg_temp.u('e2'), 'fixture-d2');

-- Preconditions. Each must hold, or the suite stops before any check runs.
SELECT pg_temp.fixture('six synthetic accounts exist', $q$(SELECT count(*) = 6 FROM auth.users WHERE email LIKE '%.f2@example.test')$q$);
SELECT pg_temp.fixture('hidden applicant is pending and holds the phone', $q$(SELECT p.status = 'pending' AND pe.phone = '+1 (416) 555-0177' FROM public.profiles p JOIN public.people pe ON pe.id = p.person_id WHERE p.id = pg_temp.u('a6'))$q$);
SELECT pg_temp.fixture('member a4 is active in cell c1', $q$(SELECT status = 'active' AND cell_id = pg_temp.u('c1') FROM public.profiles WHERE id = pg_temp.u('a4'))$q$);
SELECT pg_temp.fixture('leader a3 leads cell c1', $q$(SELECT leader_id = pg_temp.u('a3') FROM public.cells WHERE id = pg_temp.u('c1'))$q$);
SELECT pg_temp.fixture('contacts d1 and d2 exist', $q$(SELECT count(*) = 2 FROM public.contacts WHERE id IN (pg_temp.u('d1'), pg_temp.u('d2')))$q$);
