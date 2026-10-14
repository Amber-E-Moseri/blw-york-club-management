-- F2 CSV import identity: executable assertions. Loaded after f2_harness.sql and f2_fixture.sql by run_f2_sql.sh.
-- An import ATTEMPT is one user action. Its rows carry keys '<attempt>:<row>'. A retry of the same attempt replays
-- completed rows and never duplicates a contact, a tag or a follow-up. A new attempt with identical content is independent.
\echo '== I. import attempt identity'
SELECT pg_temp.cap('imp1_new', 'authenticated', pg_temp.u('a4'), $q$SELECT count(*)::text FROM public.submit_contacts_batch('[
  {"contact_name":"Imp One","cell_id":"00000000-0000-4000-8000-0000000000c1","tag_names":["vip","vip"," north "],"follow_up_assignee":"00000000-0000-4000-8000-0000000000a4","idempotency_key":"att-1:1"},
  {"contact_name":"Imp Two","cell_id":"00000000-0000-4000-8000-0000000000c1","tag_names":["x"],"idempotency_key":"att-1:2"},
  {"contact_name":"Imp Three","cell_id":"00000000-0000-4000-8000-0000000000c1","email":"imp3.f2@example.test","idempotency_key":"att-1:3"}
]'::jsonb) WHERE outcome = 'imported'$q$);
SELECT pg_temp.assert_int('I01 first attempt: three rows imported', $q$(SELECT value::bigint FROM f2_values WHERE name = 'imp1_new')$q$, 3);
SELECT pg_temp.assert_int('I02 first attempt: tags written once (vip deduplicated, trimmed north, x) = 3', $q$(SELECT count(*) FROM public.contact_tags t JOIN public.contacts c ON c.id = t.contact_id WHERE c.idempotency_key LIKE 'att-1:%')$q$, 3);
SELECT pg_temp.assert_int('I03 first attempt: one follow-up (row 1 only)', $q$(SELECT count(*) FROM public.contact_follow_ups f JOIN public.contacts c ON c.id = f.contact_id WHERE c.idempotency_key LIKE 'att-1:%')$q$, 1);
SELECT pg_temp.cap('imp1_snap', NULL, NULL, $q$SELECT (SELECT count(*) FROM public.contacts WHERE idempotency_key LIKE 'att-1:%')::text || ',' || (SELECT count(*) FROM public.contact_tags t JOIN public.contacts c ON c.id = t.contact_id WHERE c.idempotency_key LIKE 'att-1:%')::text || ',' || (SELECT count(*) FROM public.contact_follow_ups f JOIN public.contacts c ON c.id = f.contact_id WHERE c.idempotency_key LIKE 'att-1:%')::text$q$);

SELECT pg_temp.cap('imp1_replay', 'authenticated', pg_temp.u('a4'), $q$SELECT count(*)::text FROM public.submit_contacts_batch('[
  {"contact_name":"Imp One","cell_id":"00000000-0000-4000-8000-0000000000c1","tag_names":["vip","vip"," north "],"follow_up_assignee":"00000000-0000-4000-8000-0000000000a4","idempotency_key":"att-1:1"},
  {"contact_name":"Imp Two","cell_id":"00000000-0000-4000-8000-0000000000c1","tag_names":["x"],"idempotency_key":"att-1:2"},
  {"contact_name":"Imp Three","cell_id":"00000000-0000-4000-8000-0000000000c1","email":"imp3.f2@example.test","idempotency_key":"att-1:3"}
]'::jsonb) WHERE outcome = 'already_imported'$q$);
SELECT pg_temp.assert_int('I04 COMPLETE retry: all three rows reported as already imported (not imported again)', $q$(SELECT value::bigint FROM f2_values WHERE name = 'imp1_replay')$q$, 3);
SELECT pg_temp.assert_true('I05 COMPLETE retry: contacts, tags and follow-ups unchanged', $q$(SELECT (SELECT count(*) FROM public.contacts WHERE idempotency_key LIKE 'att-1:%')::text || ',' || (SELECT count(*) FROM public.contact_tags t JOIN public.contacts c ON c.id = t.contact_id WHERE c.idempotency_key LIKE 'att-1:%')::text || ',' || (SELECT count(*) FROM public.contact_follow_ups f JOIN public.contacts c ON c.id = f.contact_id WHERE c.idempotency_key LIKE 'att-1:%')::text) = (SELECT value FROM f2_values WHERE name = 'imp1_snap')$q$);

-- Partial retry after an uncertain response: rows 1 and 2 were completed, row 4 is new.
SELECT pg_temp.cap('imp1_partial_new', 'authenticated', pg_temp.u('a4'), $q$SELECT count(*)::text FROM public.submit_contacts_batch('[
  {"contact_name":"Imp One","cell_id":"00000000-0000-4000-8000-0000000000c1","tag_names":["vip","vip"," north "],"follow_up_assignee":"00000000-0000-4000-8000-0000000000a4","idempotency_key":"att-1:1"},
  {"contact_name":"Imp Two","cell_id":"00000000-0000-4000-8000-0000000000c1","tag_names":["x"],"idempotency_key":"att-1:2"},
  {"contact_name":"Imp Four","cell_id":"00000000-0000-4000-8000-0000000000c1","tag_names":["y"],"idempotency_key":"att-1:4"}
]'::jsonb) WHERE outcome = 'imported'$q$);
SELECT pg_temp.assert_int('I06 partial retry: only the new row is imported', $q$(SELECT value::bigint FROM f2_values WHERE name = 'imp1_partial_new')$q$, 1);
SELECT pg_temp.assert_int('I07 partial retry: exactly one new contact added (no duplicate of rows 1 and 2)', $q$(SELECT count(*) FROM public.contacts WHERE idempotency_key LIKE 'att-1:%')$q$, 4);
SELECT pg_temp.assert_int('I08 partial retry: the new row has its own tag, and completed rows gained none', $q$(SELECT count(*) FROM public.contact_tags t JOIN public.contacts c ON c.id = t.contact_id WHERE c.idempotency_key LIKE 'att-1:%')$q$, 4);

-- A second, intentionally new attempt with identical content is independent.
SELECT pg_temp.cap('imp2_new', 'authenticated', pg_temp.u('a4'), $q$SELECT count(*)::text FROM public.submit_contacts_batch('[
  {"contact_name":"Imp One","cell_id":"00000000-0000-4000-8000-0000000000c1","tag_names":["vip","vip"," north "],"follow_up_assignee":"00000000-0000-4000-8000-0000000000a4","idempotency_key":"att-2:1"},
  {"contact_name":"Imp Two","cell_id":"00000000-0000-4000-8000-0000000000c1","tag_names":["x"],"idempotency_key":"att-2:2"},
  {"contact_name":"Imp Three","cell_id":"00000000-0000-4000-8000-0000000000c1","email":"imp3.f2@example.test","idempotency_key":"att-2:3"}
]'::jsonb) WHERE outcome = 'imported'$q$);
SELECT pg_temp.assert_int('I09 independent attempt with identical content: three new rows imported', $q$(SELECT value::bigint FROM f2_values WHERE name = 'imp2_new')$q$, 3);
SELECT pg_temp.assert_int('I10 independent attempt: its own tags written (3 more)', $q$(SELECT count(*) FROM public.contact_tags t JOIN public.contacts c ON c.id = t.contact_id WHERE c.idempotency_key LIKE 'att-2:%')$q$, 3);
SELECT pg_temp.assert_int('I11 independent attempt: its own follow-up (1 more)', $q$(SELECT count(*) FROM public.contact_follow_ups f JOIN public.contacts c ON c.id = f.contact_id WHERE c.idempotency_key LIKE 'att-2:%')$q$, 1);

-- Atomicity: a row refused for an invisible follow-up assignee writes no contact, tag or follow-up.
SELECT pg_temp.cap('imp3_bad', 'authenticated', pg_temp.u('a4'), $q$SELECT count(*)::text FROM public.submit_contacts_batch('[
  {"contact_name":"Imp Hidden Assignee","cell_id":"00000000-0000-4000-8000-0000000000c1","tag_names":["never"],"follow_up_assignee":"00000000-0000-4000-8000-0000000000a5","idempotency_key":"att-3:1"}
]'::jsonb) WHERE outcome = 'rejected'$q$);
SELECT pg_temp.assert_int('I12 refused row reported as rejected', $q$(SELECT value::bigint FROM f2_values WHERE name = 'imp3_bad')$q$, 1);
SELECT pg_temp.assert_int('I13 refused row left no contact behind', $q$(SELECT count(*) FROM public.contacts WHERE idempotency_key = 'att-3:1')$q$, 0);
SELECT pg_temp.assert_int('I14 refused row left no orphan tag behind', $q$(SELECT count(*) FROM public.contact_tags WHERE tag_name = 'never')$q$, 0);

-- Cross-cell row in a batch is refused individually; the other rows of the same batch still import.
SELECT pg_temp.cap('imp4_mixed', 'authenticated', pg_temp.u('a4'), $q$SELECT count(*)::text FROM public.submit_contacts_batch('[
  {"contact_name":"Imp Mixed Ok","cell_id":"00000000-0000-4000-8000-0000000000c1","idempotency_key":"att-4:1"},
  {"contact_name":"Imp Mixed Denied","cell_id":"00000000-0000-4000-8000-0000000000c2","idempotency_key":"att-4:2"}
]'::jsonb) WHERE outcome = 'imported'$q$);
SELECT pg_temp.assert_int('I15 mixed batch: the authorized row imports, the other is refused', $q$(SELECT value::bigint FROM f2_values WHERE name = 'imp4_mixed')$q$, 1);

SELECT pg_temp.finish(15);
