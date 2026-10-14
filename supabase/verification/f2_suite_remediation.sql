-- F2 remediation certification. Executable assertions only. Loaded after f2_harness.sql and f2_fixture.sql by
-- run_f2_sql.sh. Requires psql variable :layer, which is 'policy' (096 + 097) or 'grants' (096 + 097 + 098).
-- Expectations that differ by layer use CASE on :layer. A failure, a missing check or a wrong SQLSTATE exits nonzero.

\echo '== A. submit_contact boundary'
SELECT pg_temp.chk('A01 member fresh submit', 'authenticated', pg_temp.u('a4'), $q$SELECT 1 FROM public.submit_contact('F2 Fresh', pg_temp.u('c1'), NULL, 'fresh.f2@example.test', false, '', '', '', NULL, NULL, false, 'k-a01')$q$, NULL, 1);
SELECT pg_temp.chk('A02 member hidden applicant email (case and whitespace variant)', 'authenticated', pg_temp.u('a4'), $q$SELECT 1 FROM public.submit_contact('F2 Hidden', pg_temp.u('c1'), NULL, '  APP.F2@Example.TEST ', false, '', '', '', NULL, NULL, false, 'k-a02')$q$, NULL, 1);
SELECT pg_temp.chk('A03 member visible prospect email', 'authenticated', pg_temp.u('a4'), $q$SELECT 1 FROM public.submit_contact('F2 Visible', pg_temp.u('c1'), NULL, 'prospect.f2@example.test', false, '', '', '', NULL, NULL, false, 'k-a03')$q$, NULL, 1);
SELECT pg_temp.chk('A04 member, nonexistent cell', 'authenticated', pg_temp.u('a4'), $q$SELECT 1 FROM public.submit_contact('F2 Ghost', pg_temp.u('ff'), NULL, NULL, false, '', '', '', NULL, NULL, false, 'k-a04')$q$, '42501', NULL);
SELECT pg_temp.chk('A05 member, other cell c2', 'authenticated', pg_temp.u('a4'), $q$SELECT 1 FROM public.submit_contact('F2 Other', pg_temp.u('c2'), NULL, NULL, false, '', '', '', NULL, NULL, false, 'k-a05')$q$, '42501', NULL);
SELECT pg_temp.chk('A06 leader submit in own cell c1', 'authenticated', pg_temp.u('a3'), $q$SELECT 1 FROM public.submit_contact('F2 Leader', pg_temp.u('c1'), NULL, NULL, false, '', '', '', NULL, NULL, false, 'k-a06')$q$, NULL, 1);
SELECT pg_temp.chk('A07 pending applicant submit', 'authenticated', pg_temp.u('a6'), $q$SELECT 1 FROM public.submit_contact('F2 Pending', pg_temp.u('c1'), NULL, NULL, false, '', '', '', NULL, NULL, false, 'k-a07')$q$, '42501', NULL);
SELECT pg_temp.chk('A08 anon submit', 'anon', NULL, $q$SELECT 1 FROM public.submit_contact('F2 Anon', pg_temp.u('c1'), NULL, NULL, false, '', '', '', NULL, NULL, false, 'k-a08')$q$, '42501', NULL);
SELECT pg_temp.chk('A09 one-character name', 'authenticated', pg_temp.u('a4'), $q$SELECT 1 FROM public.submit_contact('A', pg_temp.u('c1'), NULL, NULL, false, '', '', '', NULL, NULL, false, 'k-a09')$q$, '22023', NULL);
SELECT pg_temp.chk('A10 malformed email', 'authenticated', pg_temp.u('a4'), $q$SELECT 1 FROM public.submit_contact('F2 Bad', pg_temp.u('c1'), NULL, 'not-an-email', false, '', '', '', NULL, NULL, false, 'k-a10')$q$, '22023', NULL);
SELECT pg_temp.chk('A11 oversized idempotency key', 'authenticated', pg_temp.u('a4'), $q$SELECT 1 FROM public.submit_contact('F2 Key', pg_temp.u('c1'), NULL, NULL, false, '', '', '', NULL, NULL, false, repeat('k', 201))$q$, '22023', NULL);
SELECT pg_temp.chk('A12 unassigned cell (NULL) member submit', 'authenticated', pg_temp.u('a4'), $q$SELECT 1 FROM public.submit_contact('F2 Unassigned', NULL, NULL, NULL, false, '', '', '', NULL, NULL, false, 'k-a12')$q$, NULL, 1);

\echo '== B. idempotency: a repeated key creates nothing; distinct keys stay independent'
SELECT pg_temp.cap('k_b', NULL, NULL, $q$SELECT count(*)::text FROM public.contacts$q$);
SELECT pg_temp.cap('c_b1', 'authenticated', pg_temp.u('a4'), $q$SELECT contact_id::text FROM public.submit_contact('Idem Name', pg_temp.u('c1'), NULL, NULL, false, '', '', '', NULL, NULL, false, 'k-b01')$q$);
SELECT pg_temp.cap('p_b', NULL, NULL, $q$SELECT count(*)::text FROM public.people$q$);
SELECT pg_temp.chk('B01a repeat name-only key: same contact returned', 'authenticated', pg_temp.u('a4'), $q$SELECT 1 FROM public.submit_contact('Idem Name', pg_temp.u('c1'), NULL, NULL, false, '', '', '', NULL, NULL, false, 'k-b01')$q$, NULL, 1);
SELECT pg_temp.assert_same('B01b one contact for the key, and no new person (people unchanged)', $q$(SELECT count(*) FROM public.people)$q$, $q$(SELECT value::bigint FROM f2_values WHERE name = 'p_b')$q$);
SELECT pg_temp.assert_true('B01c same contact id on retry', $q$(SELECT count(*) = 1 FROM public.contacts WHERE idempotency_key = 'k-b01')$q$);
SELECT pg_temp.chk('B02 repeat phone-only key with HIDDEN phone (retry)', 'authenticated', pg_temp.u('a4'), $q$SELECT 1 FROM public.submit_contact('Idem Hidden Phone', pg_temp.u('c1'), '+1 416 555 0177', NULL, false, '', '', '', NULL, NULL, false, 'k-b02')$q$, NULL, 1);
SELECT pg_temp.chk('B02r retry of the same phone-only key', 'authenticated', pg_temp.u('a4'), $q$SELECT 1 FROM public.submit_contact('Idem Hidden Phone', pg_temp.u('c1'), '+1 416 555 0177', NULL, false, '', '', '', NULL, NULL, false, 'k-b02')$q$, NULL, 1);
SELECT pg_temp.assert_true('B02s retry added no contact and no claim', $q$(SELECT count(*) = 1 FROM public.contacts WHERE idempotency_key = 'k-b02')$q$);
SELECT pg_temp.chk('B03 repeat email-only key with HIDDEN email, different payload', 'authenticated', pg_temp.u('a4'), $q$SELECT 1 FROM public.submit_contact('Idem Hidden Email', pg_temp.u('c1'), NULL, 'app.f2@example.test', false, '', '', '', NULL, NULL, false, 'k-b03')$q$, NULL, 1);
SELECT pg_temp.chk('B03r retry with a different name and identity', 'authenticated', pg_temp.u('a4'), $q$SELECT 1 FROM public.submit_contact('Changed Name', pg_temp.u('c1'), NULL, 'changed.f2@example.test', false, '', '', '', NULL, NULL, false, 'k-b03')$q$, NULL, 1);
SELECT pg_temp.assert_true('B03s retry kept the original contact (one row, original name)', $q$(SELECT count(*) = 1 AND bool_and(contact_name = 'Idem Hidden Email') FROM public.contacts WHERE idempotency_key = 'k-b03')$q$);
SELECT pg_temp.chk('B04 distinct keys, same phone-only identity: both succeed', 'authenticated', pg_temp.u('a4'), $q$SELECT 1 FROM public.submit_contact('Same Phone A', pg_temp.u('c1'), '+1 416 555 0166', NULL, false, '', '', '', NULL, NULL, false, 'k-b04a')$q$, NULL, 1);
SELECT pg_temp.chk('B04b second distinct key, same phone', 'authenticated', pg_temp.u('a4'), $q$SELECT 1 FROM public.submit_contact('Same Phone B', pg_temp.u('c1'), '+1 416 555 0166', NULL, false, '', '', '', NULL, NULL, false, 'k-b04b')$q$, NULL, 1);
SELECT pg_temp.assert_int('B04c two independent contacts for the shared phone', $q$(SELECT count(*) FROM public.contacts WHERE contact_phone = '+1 416 555 0166')$q$, 2);
SELECT pg_temp.chk('B05 same key used by a different member: independent', 'authenticated', pg_temp.u('a3'), $q$SELECT 1 FROM public.submit_contact('Shared Key', pg_temp.u('c1'), NULL, NULL, false, '', '', '', NULL, NULL, false, 'k-b05')$q$, NULL, 1);
SELECT pg_temp.chk('B05b same key from a second logger', 'authenticated', pg_temp.u('a4'), $q$SELECT 1 FROM public.submit_contact('Shared Key', pg_temp.u('c1'), NULL, NULL, false, '', '', '', NULL, NULL, false, 'k-b05')$q$, NULL, 1);
SELECT pg_temp.assert_int('B05c two rows, one per logger', $q$(SELECT count(*) FROM public.contacts WHERE idempotency_key = 'k-b05')$q$, 2);
SELECT pg_temp.chk('B06 no key (negative control): nothing is deduplicated', 'authenticated', pg_temp.u('a4'), $q$SELECT 1 FROM public.submit_contact('No Key', pg_temp.u('c1'), NULL, NULL, false, '', '', '', NULL, NULL, false, NULL)$q$, NULL, 1);
SELECT pg_temp.chk('B06b no key, second call', 'authenticated', pg_temp.u('a4'), $q$SELECT 1 FROM public.submit_contact('No Key', pg_temp.u('c1'), NULL, NULL, false, '', '', '', NULL, NULL, false, NULL)$q$, NULL, 1);
SELECT pg_temp.assert_int('B06c two rows for the keyless submissions', $q$(SELECT count(*) FROM public.contacts WHERE contact_name = 'No Key')$q$, 2);
SELECT pg_temp.chk('B07 pending applicant replays a member key (no leak)', 'authenticated', pg_temp.u('a6'), $q$SELECT 1 FROM public.submit_contact('Idem Name', pg_temp.u('c1'), NULL, NULL, false, '', '', '', NULL, NULL, false, 'k-b01')$q$, '42501', NULL);
SELECT pg_temp.cap('cell_b08', NULL, NULL, $q$SELECT set_config('app.cell_change_reason', 'F2 idempotency cell move', false)$q$);
UPDATE public.profiles SET cell_id = pg_temp.u('c2') WHERE id = pg_temp.u('a4');
SELECT pg_temp.chk('B08 retry after the member moved cell: original contact still returned', 'authenticated', pg_temp.u('a4'), $q$SELECT 1 FROM public.submit_contact('Idem Name', pg_temp.u('c1'), NULL, NULL, false, '', '', '', NULL, NULL, false, 'k-b01')$q$, NULL, 1);
SELECT pg_temp.assert_true('B08b the retry is the original contact row', $q$(SELECT count(*) = 1 FROM public.contacts WHERE idempotency_key = 'k-b01' AND cell_id = pg_temp.u('c1'))$q$);
SELECT pg_temp.cap('cell_b08r', NULL, NULL, $q$SELECT set_config('app.cell_change_reason', 'F2 idempotency cell restore', false)$q$);
UPDATE public.profiles SET cell_id = pg_temp.u('c1') WHERE id = pg_temp.u('a4');

\echo '== N2. contacts INSERT attribution by role (policy layer: RLS; grants layer: privilege)'
SELECT pg_temp.chk('N2a leader inserts a contact attributed to member a4', 'authenticated', pg_temp.u('a3'), $q$INSERT INTO public.contacts (contact_name, logged_by, cell_id, person_id) VALUES ('N2a', pg_temp.u('a4'), pg_temp.u('c1'), pg_temp.u('e2'))$q$, '42501', NULL);
SELECT pg_temp.chk('N2b coordinator inserts attributed to a4', 'authenticated', pg_temp.u('a2'), $q$INSERT INTO public.contacts (contact_name, logged_by, cell_id, person_id) VALUES ('N2b', pg_temp.u('a4'), pg_temp.u('c1'), pg_temp.u('e2'))$q$, '42501', NULL);
SELECT pg_temp.chk('N2c admin inserts attributed to a4', 'authenticated', pg_temp.u('a1'), $q$INSERT INTO public.contacts (contact_name, logged_by, cell_id, person_id) VALUES ('N2c', pg_temp.u('a4'), pg_temp.u('c1'), pg_temp.u('e2'))$q$, '42501', NULL);
SELECT pg_temp.chk('N2d member inserts attributed to coordinator a2', 'authenticated', pg_temp.u('a4'), $q$INSERT INTO public.contacts (contact_name, logged_by, cell_id, person_id) VALUES ('N2d', pg_temp.u('a2'), pg_temp.u('c1'), pg_temp.u('e2'))$q$, '42501', NULL);
SELECT pg_temp.chk('N2e leader direct insert, self (positive control for the layer)', 'authenticated', pg_temp.u('a3'), $q$INSERT INTO public.contacts (contact_name, logged_by, cell_id, person_id) VALUES ('N2e', pg_temp.u('a3'), pg_temp.u('c1'), pg_temp.u('e2'))$q$, CASE WHEN :'layer' = 'grants' THEN '42501' ELSE NULL END, CASE WHEN :'layer' = 'grants' THEN NULL ELSE 1 END);
SELECT pg_temp.chk('N2f member direct insert, self, own cell (positive control for the layer)', 'authenticated', pg_temp.u('a4'), $q$INSERT INTO public.contacts (contact_name, logged_by, cell_id, person_id) VALUES ('N2f', pg_temp.u('a4'), pg_temp.u('c1'), pg_temp.u('e2'))$q$, CASE WHEN :'layer' = 'grants' THEN '42501' ELSE NULL END, CASE WHEN :'layer' = 'grants' THEN NULL ELSE 1 END);
SELECT pg_temp.chk('N2g member, self, other cell c2 (negative control)', 'authenticated', pg_temp.u('a4'), $q$INSERT INTO public.contacts (contact_name, logged_by, cell_id, person_id) VALUES ('N2g', pg_temp.u('a4'), pg_temp.u('c2'), pg_temp.u('e2'))$q$, '42501', NULL);
SELECT pg_temp.assert_int('N2h no spoofed contact was written', $q$(SELECT count(*) FROM public.contacts WHERE contact_name IN ('N2a','N2b','N2c','N2d'))$q$, 0);

\echo '== N3. contacts UPDATE of logged_by and person_id'
SELECT pg_temp.chk('N3a leader changes logged_by of a4''s contact d1', 'authenticated', pg_temp.u('a3'), $q$UPDATE public.contacts SET logged_by = pg_temp.u('a3') WHERE id = pg_temp.u('d1')$q$, '42501', NULL);
SELECT pg_temp.chk('N3b coordinator changes logged_by of d1', 'authenticated', pg_temp.u('a2'), $q$UPDATE public.contacts SET logged_by = pg_temp.u('a2') WHERE id = pg_temp.u('d1')$q$, '42501', NULL);
SELECT pg_temp.chk('N3c coordinator repoints person_id of d1 to another person', 'authenticated', pg_temp.u('a2'), $q$UPDATE public.contacts SET person_id = (SELECT id FROM public.people WHERE email = 'app.f2@example.test') WHERE id = pg_temp.u('d1')$q$, '42501', NULL);
SELECT pg_temp.chk('N3d member changes logged_by of own contact d1', 'authenticated', pg_temp.u('a4'), $q$UPDATE public.contacts SET logged_by = pg_temp.u('a2') WHERE id = pg_temp.u('d1')$q$, CASE WHEN :'layer' = 'grants' THEN '42501' ELSE NULL END, CASE WHEN :'layer' = 'grants' THEN NULL ELSE 0 END);
SELECT pg_temp.chk('N3e leader edits notes of own-cell contact (positive control)', 'authenticated', pg_temp.u('a3'), $q$UPDATE public.contacts SET notes = 'F2 note' WHERE id = pg_temp.u('d1')$q$, NULL, 1);
SELECT pg_temp.chk('N3g leader moves own-cell contact into cell c2 (WITH CHECK: not a leader of c2)', 'authenticated', pg_temp.u('a3'), $q$UPDATE public.contacts SET cell_id = pg_temp.u('c2') WHERE id = pg_temp.u('d1')$q$, '42501', NULL);
SELECT pg_temp.assert_true('N3f post-state: d1 still logged by a4 and linked to e2', $q$(SELECT logged_by = pg_temp.u('a4') AND person_id = pg_temp.u('e2') FROM public.contacts WHERE id = pg_temp.u('d1'))$q$);

\echo '== N3-corr. privileged correction (admin or coordinator, active target, reason, audit)'
SELECT pg_temp.chk('C01 leader calls correction', 'authenticated', pg_temp.u('a3'), $q$SELECT public.correct_contact_attribution(pg_temp.u('d2'), pg_temp.u('a4'), 'F2 leader attempt')$q$, '42501', NULL);
SELECT pg_temp.chk('C02 coordinator, reason too short', 'authenticated', pg_temp.u('a2'), $q$SELECT public.correct_contact_attribution(pg_temp.u('d2'), pg_temp.u('a4'), 'x')$q$, '22023', NULL);
SELECT pg_temp.chk('C03 coordinator, PENDING target a6', 'authenticated', pg_temp.u('a2'), $q$SELECT public.correct_contact_attribution(pg_temp.u('d2'), pg_temp.u('a6'), 'F2 pending target')$q$, '22023', NULL);
SELECT pg_temp.assert_true('C03b pending target left the contact unchanged', $q$(SELECT logged_by = pg_temp.u('a3') FROM public.contacts WHERE id = pg_temp.u('d2'))$q$);
SELECT pg_temp.chk('C04 coordinator, active target a4, valid reason', 'authenticated', pg_temp.u('a2'), $q$SELECT public.correct_contact_attribution(pg_temp.u('d2'), pg_temp.u('a4'), 'F2 duplicate logger correction')$q$, NULL, 1);
SELECT pg_temp.assert_true('C04b post-state: d2 now logged by a4', $q$(SELECT logged_by = pg_temp.u('a4') FROM public.contacts WHERE id = pg_temp.u('d2'))$q$);
SELECT pg_temp.assert_int('C04c one audit row written for the correction', $q$(SELECT count(*) FROM public.contact_attribution_audit WHERE contact_id = pg_temp.u('d2') AND actor_id = pg_temp.u('a2'))$q$, 1);
SELECT pg_temp.chk('C05 member calls correction', 'authenticated', pg_temp.u('a4'), $q$SELECT public.correct_contact_attribution(pg_temp.u('d2'), pg_temp.u('a3'), 'F2 member attempt')$q$, '42501', NULL);
SELECT pg_temp.chk('C06 coordinator reads the audit table directly', 'authenticated', pg_temp.u('a2'), $q$SELECT count(*) FROM public.contact_attribution_audit$q$, '42501', NULL);
SELECT pg_temp.chk('C07 owner tries to rewrite an audit row', NULL, NULL, $q$UPDATE public.contact_attribution_audit SET reason = 'tampered'$q$, '42501', NULL);
SELECT pg_temp.chk('C08 owner correction path is allowed to change logged_by', NULL, NULL, $q$UPDATE public.contacts SET logged_by = pg_temp.u('a3') WHERE id = pg_temp.u('d2')$q$, NULL, 1);

\echo '== P2-4. follow_up_assignee: nonexistent and hidden profiles are indistinguishable'
SELECT pg_temp.chk('F01 member submit, assignee nonexistent', 'authenticated', pg_temp.u('a4'), $q$SELECT 1 FROM public.submit_contact('FU nonexist', pg_temp.u('c1'), NULL, NULL, false, '', '', '', pg_temp.u('ff'), NULL, false, 'k-f01')$q$, '22023', NULL);
SELECT pg_temp.chk('F02 member submit, assignee hidden existing profile a5', 'authenticated', pg_temp.u('a4'), $q$SELECT 1 FROM public.submit_contact('FU hidden', pg_temp.u('c1'), NULL, NULL, false, '', '', '', pg_temp.u('a5'), NULL, false, 'k-f02')$q$, '22023', NULL);
SELECT pg_temp.chk('F03 member submit, assignee self (legitimate)', 'authenticated', pg_temp.u('a4'), $q$SELECT 1 FROM public.submit_contact('FU self', pg_temp.u('c1'), NULL, NULL, false, '', '', '', pg_temp.u('a4'), NULL, false, 'k-f03')$q$, NULL, 1);
SELECT pg_temp.chk('F04 leader submit, assignee member a4 of own cell (legitimate)', 'authenticated', pg_temp.u('a3'), $q$SELECT 1 FROM public.submit_contact('FU leader', pg_temp.u('c1'), NULL, NULL, false, '', '', '', pg_temp.u('a4'), NULL, false, 'k-f04')$q$, NULL, 1);
SELECT pg_temp.chk('F05 leader UPDATE follow_up_assignee to nonexistent profile', 'authenticated', pg_temp.u('a3'), $q$UPDATE public.contacts SET follow_up_assignee = pg_temp.u('ff') WHERE id = pg_temp.u('d1')$q$, '22023', NULL);
SELECT pg_temp.chk('F06 leader UPDATE follow_up_assignee to hidden profile a5', 'authenticated', pg_temp.u('a3'), $q$UPDATE public.contacts SET follow_up_assignee = pg_temp.u('a5') WHERE id = pg_temp.u('d1')$q$, '22023', NULL);
SELECT pg_temp.chk('F07 leader UPDATE follow_up_assignee to own-cell member a4 (legitimate)', 'authenticated', pg_temp.u('a3'), $q$UPDATE public.contacts SET follow_up_assignee = pg_temp.u('a4') WHERE id = pg_temp.u('d1')$q$, NULL, 1);
SELECT pg_temp.chk('F08 coordinator UPDATE follow_up_assignee to a5 (coordinator sees all)', 'authenticated', pg_temp.u('a2'), $q$UPDATE public.contacts SET follow_up_assignee = pg_temp.u('a5') WHERE id = pg_temp.u('d1')$q$, NULL, 1);

\echo '== P2-3. SECURITY DEFINER search_path and shadowing'
SELECT pg_temp.assert_true('S01 every definer function pins search_path to pg_catalog, public, with no pg_temp', $q$(SELECT NOT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prosecdef
     AND (p.proname LIKE 'submit\_%' OR p.proname LIKE '\_f2\_%' OR p.proname IN ('list_identity_claims','get_claim_identity','get_person_identity','resolve_identity_claim','correct_contact_attribution','merge_people'))
     AND (coalesce(array_to_string(p.proconfig, ','), '') NOT LIKE '%search_path=pg_catalog, public%'
          OR coalesce(array_to_string(p.proconfig, ','), '') LIKE '%pg_temp%')))$q$);
SELECT pg_temp.chk('S02 owner plants a temp function shadowing the normaliser', NULL, NULL, $q$CREATE FUNCTION pg_temp.normalize_identity_email(text) RETURNS text LANGUAGE sql AS $body$ SELECT 'SHADOW'::text $body$$q$, NULL, NULL);
SELECT pg_temp.chk('S03 member submit with an email, with the shadow in place', 'authenticated', pg_temp.u('a4'), $q$SELECT 1 FROM public.submit_contact('Shadow One', pg_temp.u('c1'), NULL, 'sh1.f2@example.test', false, '', '', '', NULL, NULL, false, 'k-s03')$q$, NULL, 1);
SELECT pg_temp.chk('S04 member submit with a different email, with the shadow in place', 'authenticated', pg_temp.u('a4'), $q$SELECT 1 FROM public.submit_contact('Shadow Two', pg_temp.u('c1'), NULL, 'sh2.f2@example.test', false, '', '', '', NULL, NULL, false, 'k-s04')$q$, NULL, 1);
SELECT pg_temp.assert_true('S05 the shadow was not used: the second email is a fresh identity (claim unique)', $q$(SELECT ic.status = 'unique' FROM public.identity_claims ic JOIN public.contacts c ON c.id = ic.contact_id WHERE c.idempotency_key = 'k-s04')$q$);

\echo '== R. identity review: authorization, audit, once-only resolution'
SELECT pg_temp.chk('R01 member lists identity claims', 'authenticated', pg_temp.u('a4'), $q$SELECT * FROM public.list_identity_claims('open', 10)$q$, '42501', NULL);
SELECT pg_temp.chk('R02 leader lists identity claims', 'authenticated', pg_temp.u('a3'), $q$SELECT * FROM public.list_identity_claims('open', 10)$q$, '42501', NULL);
SELECT pg_temp.chk('R03 coordinator lists open claims', 'authenticated', pg_temp.u('a2'), $q$SELECT * FROM public.list_identity_claims('open', 10)$q$, NULL, NULL);
SELECT pg_temp.cap('claim_r', NULL, NULL, $q$SELECT ic.id::text FROM public.identity_claims ic JOIN public.contacts c ON c.id = ic.contact_id WHERE c.idempotency_key = 'k-b02' AND ic.status = 'open'$q$);
SELECT pg_temp.chk('R04 member reveals a claim identity', 'authenticated', pg_temp.u('a4'), $q$SELECT * FROM public.get_claim_identity((SELECT value::uuid FROM f2_values WHERE name = 'claim_r'), 'member attempt reason')$q$, '42501', NULL);
SELECT pg_temp.chk('R05 coordinator reveals with a short reason', 'authenticated', pg_temp.u('a2'), $q$SELECT * FROM public.get_claim_identity((SELECT value::uuid FROM f2_values WHERE name = 'claim_r'), 'x')$q$, '22023', NULL);
SELECT pg_temp.chk('R06 coordinator reveals with a valid reason', 'authenticated', pg_temp.u('a2'), $q$SELECT * FROM public.get_claim_identity((SELECT value::uuid FROM f2_values WHERE name = 'claim_r'), 'Resolve duplicate for F2 suite')$q$, NULL, 1);
SELECT pg_temp.assert_true('R06b the reveal wrote a read-audit row', $q$(SELECT count(*) >= 1 FROM public.identity_read_audit WHERE actor_id = pg_temp.u('a2') AND target_kind = 'claim')$q$);
SELECT pg_temp.chk('R07 admin reveals a person identity', 'authenticated', pg_temp.u('a1'), $q$SELECT * FROM public.get_person_identity(pg_temp.u('e2'), 'Admin review of prospect')$q$, NULL, 1);
SELECT pg_temp.chk('R08 leader reveals a person identity', 'authenticated', pg_temp.u('a3'), $q$SELECT * FROM public.get_person_identity(pg_temp.u('e2'), 'Leader attempt reason')$q$, '42501', NULL);
SELECT pg_temp.chk('R09 coordinator attaches to a candidate that is not in the claim', 'authenticated', pg_temp.u('a2'), $q$SELECT public.resolve_identity_claim((SELECT value::uuid FROM f2_values WHERE name = 'claim_r'), 'attach', pg_temp.u('a5'), 'Wrong candidate')$q$, '22023', NULL);
SELECT pg_temp.chk('R10 coordinator keeps the claim separate', 'authenticated', pg_temp.u('a2'), $q$SELECT public.resolve_identity_claim((SELECT value::uuid FROM f2_values WHERE name = 'claim_r'), 'keep_separate', NULL, 'Different person')$q$, NULL, 1);
SELECT pg_temp.assert_true('R10b post-state: claim kept_separate, raw identity removed', $q$(SELECT status = 'kept_separate' AND submitted_email IS NULL AND submitted_phone IS NULL FROM public.identity_claims WHERE id = (SELECT value::uuid FROM f2_values WHERE name = 'claim_r'))$q$);
SELECT pg_temp.chk('R11 coordinator resolves the same claim again', 'authenticated', pg_temp.u('a2'), $q$SELECT public.resolve_identity_claim((SELECT value::uuid FROM f2_values WHERE name = 'claim_r'), 'keep_separate', NULL, 'Again')$q$, 'P0001', NULL);
SELECT pg_temp.chk('R12 owner tampers with the review audit', NULL, NULL, $q$UPDATE public.identity_review_audit SET reason = 'tampered'$q$, '42501', NULL);
SELECT pg_temp.chk('R13 member reads identity_claims directly', 'authenticated', pg_temp.u('a4'), $q$SELECT count(*) FROM public.identity_claims$q$, '42501', NULL);
SELECT pg_temp.chk('R14 coordinator reads the read-audit directly', 'authenticated', pg_temp.u('a2'), $q$SELECT count(*) FROM public.identity_read_audit$q$, '42501', NULL);

\echo '== M. existing merge behaviour, restored (merge_people)'
SELECT pg_temp.cap('app_p', NULL, NULL, $q$SELECT id::text FROM public.people WHERE email = 'app.f2@example.test'$q$);
SELECT pg_temp.chk('M01 member calls merge_people', 'authenticated', pg_temp.u('a4'), $q$SELECT public.merge_people(pg_temp.u('e2'), (SELECT value::uuid FROM f2_values WHERE name = 'app_p'), 'Member merge attempt')$q$, 'P0001', NULL);
SELECT pg_temp.chk('M02 leader calls merge_people', 'authenticated', pg_temp.u('a3'), $q$SELECT public.merge_people(pg_temp.u('e2'), (SELECT value::uuid FROM f2_values WHERE name = 'app_p'), 'Leader merge attempt')$q$, 'P0001', NULL);
SELECT pg_temp.chk('M03 merge a person into itself', 'authenticated', pg_temp.u('a2'), $q$SELECT public.merge_people(pg_temp.u('e2'), pg_temp.u('e2'), 'Self merge')$q$, 'P0001', NULL);
SELECT pg_temp.cap('subj_m', NULL, NULL, $q$SELECT p.id::text FROM public.people p WHERE p.email = 'sh1.f2@example.test'$q$);
SELECT pg_temp.chk('M04 coordinator merges a duplicate person into the prospect', 'authenticated', pg_temp.u('a2'), $q$SELECT public.merge_people(pg_temp.u('e2'), (SELECT value::uuid FROM f2_values WHERE name = 'subj_m'), 'Duplicate of prospect')$q$, NULL, 1);
SELECT pg_temp.assert_true('M04b post-state: the merged contact now points at the prospect and the source person is removed', $q$(SELECT count(*) = 0 FROM public.people WHERE id = (SELECT value::uuid FROM f2_values WHERE name = 'subj_m')) AND (SELECT count(*) >= 1 FROM public.contacts WHERE contact_name = 'Shadow One' AND person_id = pg_temp.u('e2'))$q$);
SELECT pg_temp.chk('M05 owner-only merge_people cannot be called by anon', 'anon', NULL, $q$SELECT public.merge_people(pg_temp.u('e2'), pg_temp.u('e2'), 'anon merge')$q$, '42501', NULL);

\echo '== E. direct write and read bypass, by layer'
SELECT pg_temp.chk('E01 member direct INSERT into people', 'authenticated', pg_temp.u('a4'), $q$INSERT INTO public.people (full_name, email) VALUES ('Probe', 'probe.f2@example.test')$q$, CASE WHEN :'layer' = 'grants' THEN '42501' ELSE NULL END, CASE WHEN :'layer' = 'grants' THEN NULL ELSE 1 END);
SELECT pg_temp.chk('E02 member reads people.email of the hidden applicant', 'authenticated', pg_temp.u('a4'), $q$SELECT email FROM public.people WHERE email = 'app.f2@example.test'$q$, CASE WHEN :'layer' = 'grants' THEN '42501' ELSE NULL END, CASE WHEN :'layer' = 'grants' THEN NULL ELSE 0 END);
SELECT pg_temp.chk('E03 member reads id and full_name', 'authenticated', pg_temp.u('a4'), $q$SELECT id, full_name FROM public.people$q$, NULL, NULL);
SELECT pg_temp.chk('E04 member calls find_person_by_email', 'authenticated', pg_temp.u('a4'), $q$SELECT public.find_person_by_email('app.f2@example.test')$q$, CASE WHEN :'layer' = 'grants' THEN '42501' ELSE NULL END, NULL);
SELECT pg_temp.chk('E05 member UPDATE contacts.person_id', 'authenticated', pg_temp.u('a4'), $q$UPDATE public.contacts SET person_id = (SELECT id FROM public.people WHERE email = 'app.f2@example.test') WHERE id = pg_temp.u('d1')$q$, CASE WHEN :'layer' = 'grants' THEN '42501' ELSE NULL END, CASE WHEN :'layer' = 'grants' THEN NULL ELSE 0 END);
SELECT pg_temp.chk('E06 service_role UPDATE contacts.person_id (guard trigger, both layers)', 'service_role', NULL, $q$UPDATE public.contacts SET person_id = (SELECT id FROM public.people WHERE email = 'app.f2@example.test') WHERE id = pg_temp.u('d1')$q$, '42501', NULL);
SELECT pg_temp.chk('E07 anon reads people', 'anon', NULL, $q$SELECT count(*) FROM public.people$q$, '42501', NULL);

\echo ''

\echo '== FO. follow_up_assignee: nonexistent and hidden profiles produce IDENTICAL messages, not only equal SQLSTATEs'
SELECT pg_temp.assert_true('FO1 direct update: nonexistent and hidden assignee raise the same message (and both are refused)', $q$(pg_temp.errmsg('authenticated', pg_temp.u('a3'), $s$UPDATE public.contacts SET follow_up_assignee = pg_temp.u('ff') WHERE id = pg_temp.u('d2')$s$) = pg_temp.errmsg('authenticated', pg_temp.u('a3'), $s$UPDATE public.contacts SET follow_up_assignee = pg_temp.u('a5') WHERE id = pg_temp.u('d2')$s$)) AND pg_temp.errmsg('authenticated', pg_temp.u('a3'), $s$UPDATE public.contacts SET follow_up_assignee = pg_temp.u('a5') WHERE id = pg_temp.u('d2')$s$) <> 'NO ERROR'$q$);
SELECT pg_temp.assert_true('FO2 submit: nonexistent and hidden assignee raise the same message', $q$(pg_temp.errmsg('authenticated', pg_temp.u('a4'), $s$SELECT 1 FROM public.submit_contact('FO nonexist', pg_temp.u('c1'), NULL, NULL, false, '', '', '', pg_temp.u('ff'), NULL, false, 'k-fo2a')$s$) = pg_temp.errmsg('authenticated', pg_temp.u('a4'), $s$SELECT 1 FROM public.submit_contact('FO hidden', pg_temp.u('c1'), NULL, NULL, false, '', '', '', pg_temp.u('a5'), NULL, false, 'k-fo2b')$s$))$q$);

\echo '== X. inactive accounts: no contact reads through logged_by; correction refuses an inactive target'
SELECT pg_temp.chk('X01 owner deactivates member a4', NULL, NULL, $q$UPDATE public.profiles SET status = 'inactive' WHERE id = pg_temp.u('a4')$q$, NULL, 1);
SELECT pg_temp.chk('X02 deactivated member reads the contacts they logged (negative)', 'authenticated', pg_temp.u('a4'), $q$SELECT 1 FROM public.contacts WHERE logged_by = pg_temp.u('a4')$q$, NULL, 0);
SELECT pg_temp.chk('X03 owner reactivates a4', NULL, NULL, $q$UPDATE public.profiles SET status = 'active' WHERE id = pg_temp.u('a4')$q$, NULL, 1);
SELECT pg_temp.cap('x_cnt', 'authenticated', pg_temp.u('a4'), $q$SELECT count(*)::text FROM public.contacts WHERE logged_by = pg_temp.u('a4')$q$);
SELECT pg_temp.assert_true('X04 positive control: the reactivated member reads their contacts again', $q$(SELECT value::bigint > 0 FROM f2_values WHERE name = 'x_cnt')$q$);
SELECT pg_temp.chk('X05 owner deactivates account a5', NULL, NULL, $q$UPDATE public.profiles SET status = 'inactive' WHERE id = pg_temp.u('a5')$q$, NULL, 1);
SELECT pg_temp.chk('X06 correction to an INACTIVE target is refused', 'authenticated', pg_temp.u('a2'), $q$SELECT public.correct_contact_attribution(pg_temp.u('d2'), pg_temp.u('a5'), 'F2 inactive target')$q$, '22023', NULL);
SELECT pg_temp.chk('X07 owner reactivates a5', NULL, NULL, $q$UPDATE public.profiles SET status = 'active' WHERE id = pg_temp.u('a5')$q$, NULL, 1);
SELECT pg_temp.chk('X08 owner marks a5 rejected', NULL, NULL, $q$UPDATE public.profiles SET status = 'rejected' WHERE id = pg_temp.u('a5')$q$, NULL, 1);
SELECT pg_temp.chk('X09 correction to a REJECTED target is refused', 'authenticated', pg_temp.u('a2'), $q$SELECT public.correct_contact_attribution(pg_temp.u('d2'), pg_temp.u('a5'), 'F2 rejected target')$q$, '22023', NULL);
SELECT pg_temp.chk('X10 owner marks a5 pending', NULL, NULL, $q$UPDATE public.profiles SET status = 'pending' WHERE id = pg_temp.u('a5')$q$, NULL, 1);
SELECT pg_temp.chk('X11 correction to a PENDING target is refused', 'authenticated', pg_temp.u('a2'), $q$SELECT public.correct_contact_attribution(pg_temp.u('d2'), pg_temp.u('a5'), 'F2 pending target')$q$, '22023', NULL);
SELECT pg_temp.chk('X12 owner reactivates a5 after the status checks', NULL, NULL, $q$UPDATE public.profiles SET status = 'active' WHERE id = pg_temp.u('a5')$q$, NULL, 1);
SELECT pg_temp.chk('X13 positive control: correction to an ACTIVE target succeeds (d2 to a4)', 'authenticated', pg_temp.u('a2'), $q$SELECT public.correct_contact_attribution(pg_temp.u('d2'), pg_temp.u('a4'), 'F2 positive control')$q$, NULL, 1);
SELECT pg_temp.assert_true('X14 post-state: d2 now logged by a4', $q$(SELECT logged_by = pg_temp.u('a4') FROM public.contacts WHERE id = pg_temp.u('d2'))$q$);
SELECT pg_temp.chk('X15 restore d2 to a3', 'authenticated', pg_temp.u('a2'), $q$SELECT public.correct_contact_attribution(pg_temp.u('d2'), pg_temp.u('a3'), 'F2 restore')$q$, NULL, 1);
SELECT pg_temp.assert_true('X16 post-state: d2 restored to a3', $q$(SELECT logged_by = pg_temp.u('a3') FROM public.contacts WHERE id = pg_temp.u('d2'))$q$);

\echo '== P. canonical identity: direct writes restricted; audited staff RPC is the only edit path'
SELECT pg_temp.chk('P00 owner inserts a disposable person for the delete check', NULL, NULL, $q$INSERT INTO public.people (id, full_name, email) VALUES (pg_temp.u('f1'), 'Delete Me F2', 'delete.f2@example.test')$q$, NULL, 1);
SELECT pg_temp.chk('P01 coordinator direct UPDATE of canonical identity', 'authenticated', pg_temp.u('a2'), $q$UPDATE public.people SET updated_at = now() WHERE id = pg_temp.u('e2')$q$, CASE WHEN :'layer' = 'grants' THEN '42501' ELSE NULL END, CASE WHEN :'layer' = 'grants' THEN NULL ELSE 1 END);
SELECT pg_temp.chk('P02 coordinator direct DELETE of canonical identity', 'authenticated', pg_temp.u('a2'), $q$DELETE FROM public.people WHERE id = pg_temp.u('f1')$q$, CASE WHEN :'layer' = 'grants' THEN '42501' ELSE NULL END, CASE WHEN :'layer' = 'grants' THEN NULL ELSE 1 END);
SELECT pg_temp.chk('P03 coordinator RPC with a valid reason (phone correction)', 'authenticated', pg_temp.u('a2'), $q$SELECT public.update_person_identity(pg_temp.u('e2'), 'F2 Prospect', 'prospect.f2@example.test', '+1 (905) 555-0199', 'F2 phone correction')$q$, NULL, 1);
SELECT pg_temp.assert_true('P04 post-state: the phone changed and exactly one audit row records the field, not the value', $q$(SELECT phone = '+1 (905) 555-0199' FROM public.people WHERE id = pg_temp.u('e2')) AND (SELECT count(*) = 1 FROM public.person_identity_audit WHERE person_id = pg_temp.u('e2') AND changed_fields = ARRAY['phone']::text[])$q$);
SELECT pg_temp.chk('P05 RPC with a short reason is refused', 'authenticated', pg_temp.u('a2'), $q$SELECT public.update_person_identity(pg_temp.u('e2'), 'F2 Prospect', 'prospect.f2@example.test', '+1 (905) 555-0198', 'x')$q$, '22023', NULL);
SELECT pg_temp.chk('P06 RPC to an email that belongs to another person is refused', 'authenticated', pg_temp.u('a2'), $q$SELECT public.update_person_identity(pg_temp.u('e2'), 'F2 Prospect', 'mem.f2@example.test', '+1 (905) 555-0199', 'F2 duplicate attempt')$q$, 'P0001', NULL);
SELECT pg_temp.chk('P07 member calls the identity RPC', 'authenticated', pg_temp.u('a4'), $q$SELECT public.update_person_identity(pg_temp.u('e2'), 'F2 Prospect', 'prospect.f2@example.test', '+1 (905) 555-0197', 'F2 member attempt')$q$, '42501', NULL);
SELECT pg_temp.chk('P08 RPC with no change is refused', 'authenticated', pg_temp.u('a2'), $q$SELECT public.update_person_identity(pg_temp.u('e2'), 'F2 Prospect', 'prospect.f2@example.test', '+1 (905) 555-0199', 'F2 no change')$q$, 'P0001', NULL);
SELECT pg_temp.chk('P09 RPC to a phone that belongs to another person is refused', 'authenticated', pg_temp.u('a2'), $q$SELECT public.update_person_identity(pg_temp.u('e2'), 'F2 Prospect', 'prospect.f2@example.test', '+1 (416) 555-0177', 'F2 duplicate phone')$q$, 'P0001', NULL);
SELECT pg_temp.chk('P10 authenticated direct INSERT into the identity audit is refused', 'authenticated', pg_temp.u('a2'), $q$INSERT INTO public.person_identity_audit (person_id) SELECT person_id FROM public.person_identity_audit WHERE false$q$, '42501', NULL);
SELECT pg_temp.chk('P11 owner UPDATE of an identity audit row is refused (append-only)', NULL, NULL, $q$UPDATE public.person_identity_audit SET reason = 'tampered' WHERE person_id = pg_temp.u('e2')$q$, '42501', NULL);
SELECT pg_temp.chk('P12 owner DELETE of an identity audit row is refused (append-only)', NULL, NULL, $q$DELETE FROM public.person_identity_audit WHERE person_id = pg_temp.u('e2')$q$, '42501', NULL);

\echo '== S. definer functions: every one pins the path without pg_temp, and none is executable by anon or PUBLIC'
SELECT pg_temp.assert_true('S07 every SECURITY DEFINER function in public pins search_path to pg_catalog, public (no pg_temp)', $q$(SELECT NOT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prosecdef
     AND (coalesce(array_to_string(p.proconfig, ','), '') NOT LIKE '%search_path=pg_catalog, public%'
          OR coalesce(array_to_string(p.proconfig, ','), '') LIKE '%pg_temp%')))$q$);
SELECT pg_temp.assert_true('S08 no SECURITY DEFINER function in public is executable by anon or PUBLIC', $q$(SELECT NOT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prosecdef
     AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('public', p.oid, 'EXECUTE'))))$q$);

SELECT pg_temp.finish(134);
\echo '== END OF SUITE (verdict above)'
