-- Reproduction of the PRE-F2 retry order (9a267bb src/lib/queries/contacts.ts createContact + people.ts resolvePersonId),
-- run on the 096 baseline (cert_a). Run as the database owner, which simulates the old client's writes row for row. RLS
-- is not what is being tested here: the old code's ORDER is. Everything is rolled back.
--
-- Old order per submission: (1) resolvePersonId: email lookup, then createPerson (person INSERT), then (2) contacts INSERT
-- with the idempotency key, then (3) on a unique violation, a lookup of the existing contact.
\set ON_ERROR_STOP 0
BEGIN;
\set MEM '00000000-0000-4000-8000-0000000000d1'
\set CX  '00000000-0000-4000-8000-0000000000d2'
INSERT INTO auth.users (id, email, raw_user_meta_data, created_at) VALUES (:'MEM', 'mem.repro@example.test', '{"full_name":"Repro Member"}', now());
UPDATE public.profiles SET role='member', status='active' WHERE id=:'MEM';
INSERT INTO public.cells (id, name) VALUES (:'CX', 'Repro Cell');
SELECT count(*) AS p0 FROM public.people \gset
SELECT count(*) AS k0 FROM public.contacts \gset

\echo ''
\echo 'R1 NAME-ONLY retry, old order'
SAVEPOINT r1;
INSERT INTO public.people (full_name) VALUES ('Repro Name') RETURNING id AS r1_p1 \gset
INSERT INTO public.contacts (contact_name, logged_by, cell_id, person_id, idempotency_key, phone_hidden, is_member, archived)
  VALUES ('Repro Name', :'MEM', :'CX', :'r1_p1', 'r-name', false, false, false);
\echo 'R1 first attempt: contacts +1 expected'
SELECT 'R1 after first attempt: people_delta=' || ((SELECT count(*) FROM public.people) - :p0) || ' contacts_delta=' || ((SELECT count(*) FROM public.contacts) - :k0) AS r1a;
\echo 'R1 retry: person INSERT happens BEFORE the contact INSERT that detects the duplicate key'
INSERT INTO public.people (full_name) VALUES ('Repro Name') RETURNING id AS r1_p2 \gset
SAVEPOINT r1c;
INSERT INTO public.contacts (contact_name, logged_by, cell_id, person_id, idempotency_key, phone_hidden, is_member, archived)
  VALUES ('Repro Name', :'MEM', :'CX', :'r1_p2', 'r-name', false, false, false);
ROLLBACK TO SAVEPOINT r1c;
SELECT 'R1 after retry: people_delta=' || ((SELECT count(*) FROM public.people) - :p0) || ' contacts_delta=' || ((SELECT count(*) FROM public.contacts) - :k0) || ' (ORPHAN PERSON if people_delta > contacts_delta)' AS r1b;
ROLLBACK TO SAVEPOINT r1;

\echo ''
\echo 'R2 PHONE-ONLY retry, old order: resolvePersonId has no email to match, so it INSERTs the phone again'
SAVEPOINT r2;
INSERT INTO public.people (full_name, phone) VALUES ('Repro Phone', '+1 416 555 0133') RETURNING id AS r2_p1 \gset
INSERT INTO public.contacts (contact_name, logged_by, cell_id, person_id, idempotency_key, contact_phone, phone_hidden, is_member, archived)
  VALUES ('Repro Phone', :'MEM', :'CX', :'r2_p1', 'r-phone', '+1 416 555 0133', false, false, false);
\echo 'R2 retry (expect a unique violation on the PERSON phone, before the contact is ever checked):'
SAVEPOINT r2p;
INSERT INTO public.people (full_name, phone) VALUES ('Repro Phone', '+1 416 555 0133');
ROLLBACK TO SAVEPOINT r2p;
SELECT 'R2 contacts for key r-phone = ' || count(*) || ' (the first attempt succeeded; the retry surfaces a phone error to the user)' AS r2 FROM public.contacts WHERE idempotency_key = 'r-phone';
ROLLBACK TO SAVEPOINT r2;

\echo ''
\echo 'R3 EMAIL-ONLY retry, visible person, old order: the email lookup finds the person, the contact INSERT hits the key, the fallback returns the original'
SAVEPOINT r3;
INSERT INTO public.people (full_name, email) VALUES ('Repro Email', 'repro.email@example.test') RETURNING id AS r3_p1 \gset
INSERT INTO public.contacts (contact_name, logged_by, cell_id, person_id, idempotency_key, email, phone_hidden, is_member, archived)
  VALUES ('Repro Email', :'MEM', :'CX', :'r3_p1', 'r-email', 'repro.email@example.test', false, false, false);
\echo 'R3 retry (expect a unique violation on the CONTACT key, which the old code converts into a successful lookup):'
INSERT INTO public.contacts (contact_name, logged_by, cell_id, person_id, idempotency_key, email, phone_hidden, is_member, archived)
  VALUES ('Repro Email', :'MEM', :'CX', :'r3_p1', 'r-email', 'repro.email@example.test', false, false, false);
ROLLBACK TO SAVEPOINT r3;

ROLLBACK;
\echo '== END: rolled back'
