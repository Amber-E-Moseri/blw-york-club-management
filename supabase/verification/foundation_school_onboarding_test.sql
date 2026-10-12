-- foundation_school_onboarding_test.sql
--
-- Real-schema tests for Foundation School enrolment and protected content (migrations 045 and 046). Runs on a database
-- replayed from empty. No stand-ins. Everything rolls back. A failed check is a finding, not a test to relax.
--
--   docker exec -i <db container> psql -U postgres -v ON_ERROR_STOP=1 < supabase/verification/foundation_school_onboarding_test.sql

begin;
set local session_replication_role = replica;  -- fixtures only

create schema fs_test;
grant usage on schema fs_test to authenticated, anon;
create table fs_test.results (name text, ok boolean, detail text);

-- ─── Fixtures ────────────────────────────────────────────────────────────────────────────────────────────────────
-- Staff:      CO coordinator active | AD admin active | COI coordinator inactive | COP coordinator pending | ADI admin inactive
-- Leaders:    CL cell leader active (no Foundation School role)
-- Teachers:   TCH active member, teacher of SA and SP
-- Students:   SA active | SP pending | SR rejected | SI inactive | SN pending (enrolled by staff in test G1)
-- Other:      MB active member, no role

insert into public.cells (id, name, leader_id) values ('c0000000-0000-0000-0000-0000000000c1', 'Cell C1', '00000000-0000-0000-0000-00000000f003');

insert into public.profiles (id, email, full_name, role, status, cell_id) values
  ('00000000-0000-0000-0000-00000000f001', 'co@t',   'Coordinator active',   'coordinator', 'active',   null),
  ('00000000-0000-0000-0000-00000000f002', 'ad@t',   'Admin active',         'admin',       'active',   null),
  ('00000000-0000-0000-0000-00000000f004', 'coi@t',  'Coordinator inactive', 'coordinator', 'inactive', null),
  ('00000000-0000-0000-0000-00000000f005', 'cop@t',  'Coordinator pending',  'coordinator', 'pending',  null),
  ('00000000-0000-0000-0000-00000000f006', 'adi@t',  'Admin inactive',       'admin',       'inactive', null),
  ('00000000-0000-0000-0000-00000000f003', 'cl@t',   'Cell leader active',   'cell_leader', 'active',   'c0000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-00000000f010', 'tch@t',  'Teacher active',       'member',      'active',   null),
  ('00000000-0000-0000-0000-00000000f011', 'mb@t',   'Member active',        'member',      'active',   null),
  ('00000000-0000-0000-0000-00000000f101', 'sa@t',   'Student active',       'member',      'active',   null),
  ('00000000-0000-0000-0000-00000000f102', 'sp@t',   'Student pending',      'member',      'pending',  null),
  ('00000000-0000-0000-0000-00000000f103', 'sr@t',   'Student rejected',     'member',      'rejected', null),
  ('00000000-0000-0000-0000-00000000f104', 'si@t',   'Student inactive',     'member',      'inactive', null),
  ('00000000-0000-0000-0000-00000000f105', 'sn@t',   'Student new pending',  'member',      'pending',  null),
  ('00000000-0000-0000-0000-00000000f106', 'sn2@t',  'Student new pending 2', 'member',    'pending',  null),
  ('00000000-0000-0000-0000-00000000f107', 'sr2@t',  'Student rejected 2',   'member',      'rejected', null),
  ('00000000-0000-0000-0000-00000000f108', 'sn3@t',  'Student pending 3',    'member',      'pending',  null);

insert into public.foundation_school_classes (id, class_number, title) values
  ('a0000000-0000-0000-0000-0000000000c1', 1, 'Class 1 (course content)'),
  ('a0000000-0000-0000-0000-0000000000c2', 2, 'Class 2 (course content)');

insert into public.foundation_school_enrollments (id, student_id, teacher_id) values
  ('e1000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000f101', '00000000-0000-0000-0000-00000000f010'),
  ('e1000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000f102', '00000000-0000-0000-0000-00000000f010'),
  ('e1000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000f103', null);

insert into public.foundation_school_progress (enrollment_id, class_id, completed_at) values
  ('e1000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000c1', now()),
  ('e1000000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-0000000000c1', now());

-- ─── Helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────
create function fs_test.as_user(p_user uuid) returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
  execute 'set local role authenticated';
end $fn$;

create function fs_test.as_owner() returns void language plpgsql as $fn$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
end $fn$;

create function fs_test.expect_count(p_name text, p_user uuid, p_sql text, p_expected bigint) returns void language plpgsql as $fn$
declare n bigint;
begin
  perform fs_test.as_user(p_user);
  execute 'select count(*) from (' || p_sql || ') q' into n;
  perform fs_test.as_owner();
  insert into fs_test.results values (p_name, n = p_expected, n || ' visible (expected ' || p_expected || ')');
end $fn$;

create function fs_test.expect_affected(p_name text, p_user uuid, p_sql text, p_expected bigint) returns void language plpgsql as $fn$
declare n bigint;
begin
  perform fs_test.as_user(p_user);
  execute 'with x as (' || p_sql || ' returning 1) select count(*) from x' into n;
  perform fs_test.as_owner();
  insert into fs_test.results values (p_name, n = p_expected, n || ' rows affected (expected ' || p_expected || ')');
end $fn$;

create function fs_test.expect_denied(p_name text, p_user uuid, p_sql text) returns void language plpgsql as $fn$
declare got text := 'allowed';
begin
  perform fs_test.as_user(p_user);
  begin
    execute p_sql;
  exception when others then
    got := sqlstate;
  end;
  perform fs_test.as_owner();
  insert into fs_test.results values (p_name, got in ('42501', '0A000'), 'got ' || got || ' (expected 42501 denied)');
end $fn$;

-- ─── G. Staff enrolment of pending students (T6) ─────────────────────────────────────────────────────────────────
select fs_test.expect_affected('G1 active coordinator enrols a PENDING student (onboarding)', '00000000-0000-0000-0000-00000000f001',
  $q$insert into public.foundation_school_enrollments (student_id, teacher_id) values ('00000000-0000-0000-0000-00000000f105', '00000000-0000-0000-0000-00000000f010')$q$, 1);
select fs_test.expect_affected('G2 active admin enrols a PENDING student (onboarding)', '00000000-0000-0000-0000-00000000f002',
  $q$insert into public.foundation_school_enrollments (student_id) values ('00000000-0000-0000-0000-00000000f106')$q$, 1);
select fs_test.expect_denied('G3 active coordinator cannot enrol a REJECTED student', '00000000-0000-0000-0000-00000000f001',
  $q$insert into public.foundation_school_enrollments (student_id) values ('00000000-0000-0000-0000-00000000f107')$q$);
select fs_test.expect_denied('G4 active coordinator cannot enrol an INACTIVE student', '00000000-0000-0000-0000-00000000f001',
  $q$insert into public.foundation_school_enrollments (student_id) values ('00000000-0000-0000-0000-00000000f104')$q$);
select fs_test.expect_denied('G5 INACTIVE coordinator cannot enrol a pending student', '00000000-0000-0000-0000-00000000f004',
  $q$insert into public.foundation_school_enrollments (student_id) values ('00000000-0000-0000-0000-00000000f108')$q$);
select fs_test.expect_denied('G6 PENDING coordinator cannot enrol a pending student', '00000000-0000-0000-0000-00000000f005',
  $q$insert into public.foundation_school_enrollments (student_id) values ('00000000-0000-0000-0000-00000000f108')$q$);
select fs_test.expect_denied('G7 INACTIVE admin cannot enrol a pending student', '00000000-0000-0000-0000-00000000f006',
  $q$insert into public.foundation_school_enrollments (student_id) values ('00000000-0000-0000-0000-00000000f108')$q$);
select fs_test.expect_denied('G8 active cell leader (no FS role) cannot enrol a pending student', '00000000-0000-0000-0000-00000000f003',
  $q$insert into public.foundation_school_enrollments (student_id) values ('00000000-0000-0000-0000-00000000f108')$q$);
select fs_test.expect_denied('G9 active teacher (member) cannot enrol a pending student', '00000000-0000-0000-0000-00000000f010',
  $q$insert into public.foundation_school_enrollments (student_id) values ('00000000-0000-0000-0000-00000000f108')$q$);
select fs_test.expect_denied('G10 pending student cannot enrol itself', '00000000-0000-0000-0000-00000000f102',
  $q$insert into public.foundation_school_enrollments (student_id) values ('00000000-0000-0000-0000-00000000f102')$q$);
select fs_test.expect_denied('G11 active member cannot enrol another member', '00000000-0000-0000-0000-00000000f011',
  $q$insert into public.foundation_school_enrollments (student_id) values ('00000000-0000-0000-0000-00000000f108')$q$);

-- ─── R. Visibility of enrolment rows (onboarding info) ───────────────────────────────────────────────────────────
select fs_test.expect_count('R1 active coordinator reads enrolments of pending AND active students (onboarding)', '00000000-0000-0000-0000-00000000f001',
  'select id from public.foundation_school_enrollments', 4);
select fs_test.expect_count('R2 active admin reads pending and active enrolments, not rejected/inactive', '00000000-0000-0000-0000-00000000f002',
  'select id from public.foundation_school_enrollments', 4);
select fs_test.expect_count('R3 inactive coordinator reads no enrolments', '00000000-0000-0000-0000-00000000f004',
  'select id from public.foundation_school_enrollments', 0);
select fs_test.expect_count('R4 pending coordinator reads no enrolments', '00000000-0000-0000-0000-00000000f005',
  'select id from public.foundation_school_enrollments', 0);
select fs_test.expect_count('R5 active cell leader reads no enrolments (no FS role)', '00000000-0000-0000-0000-00000000f003',
  'select id from public.foundation_school_enrollments', 0);
select fs_test.expect_count('R6 pending student reads own enrolment: none (F5)', '00000000-0000-0000-0000-00000000f102',
  'select id from public.foundation_school_enrollments', 0);
select fs_test.expect_count('R7 active student reads own enrolment', '00000000-0000-0000-0000-00000000f101',
  'select id from public.foundation_school_enrollments', 1);
select fs_test.expect_count('R8 teacher reads ACTIVE student enrolment only', '00000000-0000-0000-0000-00000000f010',
  'select id from public.foundation_school_enrollments', 1);
select fs_test.expect_count('R9 rejected student reads no enrolment', '00000000-0000-0000-0000-00000000f103',
  'select id from public.foundation_school_enrollments', 0);

-- ─── U. Changes to enrolments: active students only for staff ───────────────────────────────────────────────────
select fs_test.expect_affected('U1 active coordinator updates an ACTIVE student enrolment', '00000000-0000-0000-0000-00000000f001',
  $q$update public.foundation_school_enrollments set teacher_id = '00000000-0000-0000-0000-00000000f010' where id = 'e1000000-0000-0000-0000-0000000000a1'$q$, 1);
select fs_test.expect_affected('U2 active coordinator cannot change a PENDING student enrolment', '00000000-0000-0000-0000-00000000f001',
  $q$update public.foundation_school_enrollments set teacher_id = null where id = 'e1000000-0000-0000-0000-0000000000b1'$q$, 0);
select fs_test.expect_affected('U3 active coordinator cannot remove a PENDING student enrolment', '00000000-0000-0000-0000-00000000f001',
  $q$delete from public.foundation_school_enrollments where id = 'e1000000-0000-0000-0000-0000000000b1'$q$, 0);
select fs_test.expect_affected('U4 pending student cannot change own enrolment', '00000000-0000-0000-0000-00000000f102',
  $q$update public.foundation_school_enrollments set teacher_id = null where id = 'e1000000-0000-0000-0000-0000000000b1'$q$, 0);

-- ─── P. Protected course content and progress: never granted by a pending enrolment ─────────────────────────────
select fs_test.expect_count('P1 pending student reads no course content (classes)', '00000000-0000-0000-0000-00000000f102',
  'select id from public.foundation_school_classes', 0);
select fs_test.expect_count('P2 active student reads course content', '00000000-0000-0000-0000-00000000f101',
  'select id from public.foundation_school_classes', 2);
select fs_test.expect_count('P3 pending student reads no progress (own)', '00000000-0000-0000-0000-00000000f102',
  'select id from public.foundation_school_progress', 0);
select fs_test.expect_count('P4 coordinator reads no progress of a PENDING student (F4)', '00000000-0000-0000-0000-00000000f001',
  'select id from public.foundation_school_progress where enrollment_id = ''e1000000-0000-0000-0000-0000000000b1''', 0);
select fs_test.expect_count('P5 teacher reads no progress of a PENDING student', '00000000-0000-0000-0000-00000000f010',
  'select id from public.foundation_school_progress where enrollment_id = ''e1000000-0000-0000-0000-0000000000b1''', 0);
select fs_test.expect_count('P6 active teacher reads progress of an ACTIVE student', '00000000-0000-0000-0000-00000000f010',
  'select id from public.foundation_school_progress where enrollment_id = ''e1000000-0000-0000-0000-0000000000a1''', 1);
select fs_test.expect_count('P7 active coordinator reads progress of an ACTIVE student', '00000000-0000-0000-0000-00000000f001',
  'select id from public.foundation_school_progress where enrollment_id = ''e1000000-0000-0000-0000-0000000000a1''', 1);
select fs_test.expect_denied('P8 coordinator cannot record progress for a PENDING student', '00000000-0000-0000-0000-00000000f001',
  $q$insert into public.foundation_school_progress (enrollment_id, class_id) values ('e1000000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-0000000000c1')$q$);
select fs_test.expect_denied('P9 pending student cannot record own progress', '00000000-0000-0000-0000-00000000f102',
  $q$insert into public.foundation_school_progress (enrollment_id, class_id) values ('e1000000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-0000000000c1')$q$);
select fs_test.expect_affected('P10 active coordinator records progress for an ACTIVE student', '00000000-0000-0000-0000-00000000f001',
  $q$insert into public.foundation_school_progress (enrollment_id, class_id) values ('e1000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000c2')$q$, 1);

-- ─── Rows for the newly enrolled pending student (G1) cannot be used for content either ──────────────────────────
select fs_test.expect_count('P11 coordinator enrolled pending student has no visible progress', '00000000-0000-0000-0000-00000000f001',
  'select p.id from public.foundation_school_progress p join public.foundation_school_enrollments e on e.id = p.enrollment_id where e.student_id = ''00000000-0000-0000-0000-00000000f105''', 0);

select * from fs_test.results order by name;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from fs_test.results;

rollback;
