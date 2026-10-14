-- F2 idempotency certification for migration 097 (submit_contact). Run against a DISPOSABLE clone with 097 and 098
-- applied. Everything is rolled back. Each check starts from the same committed-free baseline and reports the change in
-- people, contacts and identity_claims that the retry caused. A repeated key must cause no change at all.
\set ON_ERROR_STOP 1
BEGIN;

\echo '== FIXTURE (supabase_admin)'
\set MEM '00000000-0000-4000-8000-0000000000e1'
\set COO '00000000-0000-4000-8000-0000000000e2'
\set APP '00000000-0000-4000-8000-0000000000e3'
\set CX  '00000000-0000-4000-8000-0000000000f1'
\set CY  '00000000-0000-4000-8000-0000000000f2'
INSERT INTO auth.users (id, email, raw_user_meta_data, created_at) VALUES
  (:'MEM', 'mem.idem@example.test', '{"full_name":"Idem Member"}', now()),
  (:'COO', 'coo.idem@example.test', '{"full_name":"Idem Coordinator"}', now()),
  (:'APP', 'app.idem@example.test', '{"full_name":"Idem Applicant"}', now());
INSERT INTO public.cells (id, name) VALUES (:'CX', 'Idem Cell X'), (:'CY', 'Idem Cell Y');
UPDATE public.profiles SET role='coordinator', status='active' WHERE id=:'COO';
UPDATE public.profiles SET role='member', status='active' WHERE id=:'MEM';
SELECT set_config('app.cell_change_reason','Idem fixture',true);
UPDATE public.profiles SET cell_id=:'CX' WHERE id=:'MEM';
-- A hidden applicant (pending) with an email and a phone held in canonical identity.
UPDATE public.people SET phone='+1 (416) 555-0177' WHERE email='app.idem@example.test';
-- A visible person with no profile, to show a visible match is also neutral.
INSERT INTO public.people (full_name, email, phone) VALUES ('Idem Prospect', 'prospect.idem@example.test', '+1 (905) 555-0123');

\set ON_ERROR_STOP 0

-- Helper pattern: a call as the member, a superuser snapshot, a second call, and the delta report.

\echo ''
\echo '== I01. NAME-ONLY RETRY: same key, same name, no identity'
SAVEPOINT i01;
SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
SELECT contact_id AS c1 FROM public.submit_contact('Idem Name Only', :'CX', NULL, NULL, false, '', '', '', NULL, NULL, false, 'i-name-1') \gset
RESET ROLE;
SELECT count(*) AS p1 FROM public.people \gset
SELECT count(*) AS k1 FROM public.contacts \gset
SELECT count(*) AS d1 FROM public.identity_claims \gset
SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
SELECT contact_id AS c2 FROM public.submit_contact('Idem Name Only', :'CX', NULL, NULL, false, '', '', '', NULL, NULL, false, 'i-name-1') \gset
RESET ROLE;
SELECT 'I01 same_contact=' || (:'c1'::uuid = :'c2'::uuid) || ' people_delta=' || ((SELECT count(*) FROM public.people) - :p1) || ' contacts_delta=' || ((SELECT count(*) FROM public.contacts) - :k1) || ' claims_delta=' || ((SELECT count(*) FROM public.identity_claims) - :d1) AS i01;
ROLLBACK TO SAVEPOINT i01;

\echo ''
\echo '== I02. PHONE-ONLY RETRY, unmatched phone'
SAVEPOINT i02;
SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
SELECT contact_id AS c1 FROM public.submit_contact('Idem Phone Only', :'CX', '+1 416 555 0144', NULL, false, '', '', '', NULL, NULL, false, 'i-phone-1') \gset
RESET ROLE;
SELECT count(*) AS p1 FROM public.people \gset
SELECT count(*) AS k1 FROM public.contacts \gset
SELECT count(*) AS d1 FROM public.identity_claims \gset
SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
SELECT contact_id AS c2 FROM public.submit_contact('Idem Phone Only', :'CX', '+1 416 555 0144', NULL, false, '', '', '', NULL, NULL, false, 'i-phone-1') \gset
RESET ROLE;
SELECT 'I02 same_contact=' || (:'c1'::uuid = :'c2'::uuid) || ' people_delta=' || ((SELECT count(*) FROM public.people) - :p1) || ' contacts_delta=' || ((SELECT count(*) FROM public.contacts) - :k1) || ' claims_delta=' || ((SELECT count(*) FROM public.identity_claims) - :d1) AS i02;
ROLLBACK TO SAVEPOINT i02;

\echo ''
\echo '== I03. PHONE-ONLY RETRY, phone held by a HIDDEN applicant (first call creates an open claim; retry must add nothing)'
SAVEPOINT i03;
SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
SELECT contact_id AS c1, outcome AS o1 FROM public.submit_contact('Idem Hidden Phone', :'CX', '+1 416 555 0177', NULL, false, '', '', '', NULL, NULL, false, 'i-hphone-1') \gset
RESET ROLE;
SELECT count(*) AS p1 FROM public.people \gset
SELECT count(*) AS k1 FROM public.contacts \gset
SELECT count(*) AS d1 FROM public.identity_claims WHERE status='open' \gset
SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
SELECT contact_id AS c2, outcome AS o2 FROM public.submit_contact('Idem Hidden Phone', :'CX', '+1 416 555 0177', NULL, false, '', '', '', NULL, NULL, false, 'i-hphone-1') \gset
RESET ROLE;
SELECT 'I03 same_contact=' || (:'c1'::uuid = :'c2'::uuid) || ' outcome=' || :'o1' || '/' || :'o2' || ' people_delta=' || ((SELECT count(*) FROM public.people) - :p1) || ' contacts_delta=' || ((SELECT count(*) FROM public.contacts) - :k1) || ' open_claims_delta=' || ((SELECT count(*) FROM public.identity_claims WHERE status='open') - :d1) AS i03;
ROLLBACK TO SAVEPOINT i03;

\echo ''
\echo '== I04. EMAIL-ONLY RETRY, email held by a HIDDEN applicant'
SAVEPOINT i04;
SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
SELECT contact_id AS c1 FROM public.submit_contact('Idem Hidden Email', :'CX', NULL, 'APP.Idem@Example.TEST', false, '', '', '', NULL, NULL, false, 'i-hemail-1') \gset
RESET ROLE;
SELECT count(*) AS p1 FROM public.people \gset
SELECT count(*) AS k1 FROM public.contacts \gset
SELECT count(*) AS d1 FROM public.identity_claims \gset
SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
SELECT contact_id AS c2 FROM public.submit_contact('Idem Hidden Email', :'CX', NULL, 'APP.Idem@Example.TEST', false, '', '', '', NULL, NULL, false, 'i-hemail-1') \gset
RESET ROLE;
SELECT 'I04 same_contact=' || (:'c1'::uuid = :'c2'::uuid) || ' people_delta=' || ((SELECT count(*) FROM public.people) - :p1) || ' contacts_delta=' || ((SELECT count(*) FROM public.contacts) - :k1) || ' claims_delta=' || ((SELECT count(*) FROM public.identity_claims) - :d1) AS i04;
ROLLBACK TO SAVEPOINT i04;

\echo ''
\echo '== I05. EMAIL-ONLY RETRY, email held by a VISIBLE prospect (visible match must be neutral too)'
SAVEPOINT i05;
SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
SELECT contact_id AS c1 FROM public.submit_contact('Idem Visible Email', :'CX', NULL, 'prospect.idem@example.test', false, '', '', '', NULL, NULL, false, 'i-vemail-1') \gset
RESET ROLE;
SELECT count(*) AS p1 FROM public.people \gset
SELECT count(*) AS k1 FROM public.contacts \gset
SELECT count(*) AS d1 FROM public.identity_claims \gset
SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
SELECT contact_id AS c2 FROM public.submit_contact('Idem Visible Email', :'CX', NULL, 'prospect.idem@example.test', false, '', '', '', NULL, NULL, false, 'i-vemail-1') \gset
RESET ROLE;
SELECT 'I05 same_contact=' || (:'c1'::uuid = :'c2'::uuid) || ' people_delta=' || ((SELECT count(*) FROM public.people) - :p1) || ' contacts_delta=' || ((SELECT count(*) FROM public.contacts) - :k1) || ' claims_delta=' || ((SELECT count(*) FROM public.identity_claims) - :d1) AS i05;
ROLLBACK TO SAVEPOINT i05;

\echo ''
\echo '== I06. RETRY WITH A DIFFERENT PAYLOAD: same key, new name and new identity. Must return the original, add nothing.'
SAVEPOINT i06;
SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
SELECT contact_id AS c1 FROM public.submit_contact('Idem First', :'CX', NULL, NULL, false, '', '', '', NULL, NULL, false, 'i-diff-1') \gset
RESET ROLE;
SELECT count(*) AS p1 FROM public.people \gset
SELECT count(*) AS k1 FROM public.contacts \gset
SELECT count(*) AS d1 FROM public.identity_claims \gset
SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
SELECT contact_id AS c2 FROM public.submit_contact('Idem Changed', :'CX', '+1 416 555 0199', 'changed.idem@example.test', false, '', '', '', NULL, NULL, false, 'i-diff-1') \gset
RESET ROLE;
SELECT 'I06 same_contact=' || (:'c1'::uuid = :'c2'::uuid) || ' people_delta=' || ((SELECT count(*) FROM public.people) - :p1) || ' contacts_delta=' || ((SELECT count(*) FROM public.contacts) - :k1) || ' claims_delta=' || ((SELECT count(*) FROM public.identity_claims) - :d1) AS i06;
ROLLBACK TO SAVEPOINT i06;

\echo ''
\echo '== I07. RETRY AFTER THE CELL CHANGED: the original contact is still returned, not a 42501'
SAVEPOINT i07;
SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
SELECT contact_id AS c1 FROM public.submit_contact('Idem Cell Move', :'CX', NULL, NULL, false, '', '', '', NULL, NULL, false, 'i-cell-1') \gset
RESET ROLE;
SELECT set_config('app.cell_change_reason','Idem fixture move',true);
UPDATE public.profiles SET cell_id=:'CY' WHERE id=:'MEM';
SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
\echo 'I07 expect the same contact id (retry of CX submission after the member moved to CY)'
SELECT contact_id AS c2 FROM public.submit_contact('Idem Cell Move', :'CX', NULL, NULL, false, '', '', '', NULL, NULL, false, 'i-cell-1') \gset
RESET ROLE;
SELECT 'I07 same_contact=' || (:'c1'::uuid = :'c2'::uuid) AS i07;
ROLLBACK TO SAVEPOINT i07;

\echo ''
\echo '== I08. DISTINCT KEYS, SAME PHONE-ONLY: two independent logs, the second recorded for review'
SAVEPOINT i08;
SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
SELECT contact_id AS c1 FROM public.submit_contact('Idem Same Phone A', :'CX', '+1 416 555 0166', NULL, false, '', '', '', NULL, NULL, false, 'i-dist-a') \gset
SELECT contact_id AS c2 FROM public.submit_contact('Idem Same Phone B', :'CX', '+1 416 555 0166', NULL, false, '', '', '', NULL, NULL, false, 'i-dist-b') \gset
RESET ROLE;
SELECT 'I08 distinct_contacts=' || (:'c1'::uuid <> :'c2'::uuid) || ' contacts_for_phone=' || (SELECT count(*) FROM public.contacts WHERE contact_phone = '+1 416 555 0166') || ' open_claims=' || (SELECT count(*) FROM public.identity_claims ic JOIN public.contacts c ON c.id = ic.contact_id WHERE c.contact_phone = '+1 416 555 0166' AND ic.status = 'open') AS i08;
ROLLBACK TO SAVEPOINT i08;

\echo ''
\echo '== I09. SAME KEY, DIFFERENT MEMBERS: idempotency is per logger, so both succeed independently (negative control)'
SAVEPOINT i09;
SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
SELECT contact_id AS c1 FROM public.submit_contact('Idem Shared Key', :'CX', NULL, NULL, false, '', '', '', NULL, NULL, false, 'i-shared') \gset
RESET ROLE;
SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'COO','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'COO',true);
SELECT contact_id AS c2 FROM public.submit_contact('Idem Shared Key', :'CY', NULL, NULL, false, '', '', '', NULL, NULL, false, 'i-shared') \gset
RESET ROLE;
SELECT 'I09 distinct_contacts=' || (:'c1'::uuid <> :'c2'::uuid) || ' rows_with_key=' || (SELECT count(*) FROM public.contacts WHERE idempotency_key = 'i-shared') AS i09;
ROLLBACK TO SAVEPOINT i09;

\echo ''
\echo '== I10. NO KEY (negative control): without a key nothing is deduplicated, by design'
SAVEPOINT i10;
SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
SELECT contact_id AS c1 FROM public.submit_contact('Idem No Key', :'CX', NULL, NULL, false, '', '', '', NULL, NULL, false, NULL) \gset
SELECT contact_id AS c2 FROM public.submit_contact('Idem No Key', :'CX', NULL, NULL, false, '', '', '', NULL, NULL, false, NULL) \gset
RESET ROLE;
SELECT 'I10 distinct_contacts=' || (:'c1'::uuid <> :'c2'::uuid) AS i10;
ROLLBACK TO SAVEPOINT i10;

\echo ''
\echo '== I11. NEGATIVE: a pending applicant replaying a member key gets 42501 and no contact'
SAVEPOINT i11;
SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
SELECT contact_id AS c1 FROM public.submit_contact('Idem Owned', :'CX', NULL, NULL, false, '', '', '', NULL, NULL, false, 'i-owned') \gset
RESET ROLE;
SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'APP','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'APP',true);
\echo 'I11 expect 42501 (pending account cannot log, and cannot read the member replay)'
SELECT * FROM public.submit_contact('Idem Owned', :'CX', NULL, NULL, false, '', '', '', NULL, NULL, false, 'i-owned');
ROLLBACK TO SAVEPOINT i11;

\echo ''
\echo '== I12. NEGATIVE: a malformed key is refused with a data-independent error'
SAVEPOINT i12;
SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
\echo 'I12 expect 22023'
SELECT * FROM public.submit_contact('Idem Bad Key', :'CX', NULL, NULL, false, '', '', '', NULL, NULL, false, repeat('k', 201));
ROLLBACK TO SAVEPOINT i12;

\echo ''
\echo '== I13. OUTCOME IS THE SAME FOR HIDDEN, VISIBLE AND FRESH IDENTITY (member-visible response only)'
SAVEPOINT i13;
SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub',:'MEM','role','authenticated')::text, true), set_config('request.jwt.claim.sub',:'MEM',true);
SELECT 'hidden=' || outcome AS hidden_out FROM public.submit_contact('Idem Cmp H', :'CX', NULL, 'app.idem@example.test', false, '', '', '', NULL, NULL, false, 'i-cmp-h');
SELECT 'visible=' || outcome AS visible_out FROM public.submit_contact('Idem Cmp V', :'CX', NULL, 'prospect.idem@example.test', false, '', '', '', NULL, NULL, false, 'i-cmp-v');
SELECT 'fresh=' || outcome AS fresh_out FROM public.submit_contact('Idem Cmp F', :'CX', NULL, 'fresh.idem@example.test', false, '', '', '', NULL, NULL, false, 'i-cmp-f');
RESET ROLE;
ROLLBACK TO SAVEPOINT i13;

ROLLBACK;
\echo '== END: rolled back'
SELECT 'leftover idem users=' || count(*) FROM auth.users WHERE email LIKE '%.idem@example.test';
