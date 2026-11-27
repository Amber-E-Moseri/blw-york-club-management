// Attendance-state migration and authorization certification on an isolated PGlite replay.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openReplay, attempt } from './pglite_replay.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.join(here, '..', 'migrations');
const ids = {
  coordinator: '60000000-0000-4000-8000-000000000001',
  organizer: '60000000-0000-4000-8000-000000000002',
  member: '60000000-0000-4000-8000-000000000003',
  pending: '60000000-0000-4000-8000-000000000004',
};
const meeting = '61000000-0000-4000-8000-000000000001';
const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass, detail });

async function run() {
  const { db, applied } = await openReplay(MIGRATIONS);
  // 046 (attendance authority) must be in the chain, and only the approved forward website migrations (047-057) may follow it.
  const i046 = applied.indexOf('046_attendance_status_authority.sql');
  const after = i046 >= 0 ? applied.slice(i046 + 1) : [];
  // Approved after 046: the website migrations 047-059, plus reviewed reconciliation increments listed by exact name.
  const approvedAfter = /^((04[7-9]|05[0-9])_(web_|website_)|060_bsc_scoped_policies\.sql$|061_shared_audience_infrastructure\.sql$)/;
  check('full migration chain includes the attendance authority migration 046, followed only by the approved website migrations', i046 >= 0 && after.every((f) => approvedAfter.test(f)), after.filter((f) => !approvedAfter.test(f)).join(',') || applied.at(-1));
  const cols = await db.query(`select column_name, data_type, is_nullable from information_schema.columns
    where table_schema='public' and table_name='meeting_attendances'`);
  const status = cols.rows.find((row) => row.column_name === 'attendance_status');
  const legacy = cols.rows.find((row) => row.column_name === 'attended');
  check('attendance_status is required and authoritative', status?.data_type === 'text' && status?.is_nullable === 'NO', JSON.stringify(status));
  check('legacy attended boolean remains available', legacy?.data_type === 'boolean', JSON.stringify(legacy));

  for (const [label, id] of Object.entries(ids)) {
    await db.query(`insert into auth.users (id,email,aud,role,created_at,email_confirmed_at)
      values ($1,$2,'authenticated','authenticated',now(),now())`, [id, `${label}@example.test`]);
  }
  await db.query(`update public.profiles set role='coordinator', status='active' where id=$1`, [ids.coordinator]);
  await db.query(`update public.profiles set role='cell_leader', status='active' where id=$1`, [ids.organizer]);
  await db.query(`update public.profiles set status='active' where id=$1`, [ids.member]);
  await db.query(`update public.profiles set status='pending' where id=$1`, [ids.pending]);
  await db.query(`insert into public.meetings (id,title,date,time,visibility,created_by,published_at)
    values ($1,'Attendance test','2026-11-26','18:00','public',$2,now())`, [meeting, ids.organizer]);

  const confirmed = await attempt(db, 'authenticated', ids.member,
    `select public.respond_to_meeting_invitation($1,'confirmed') as response`, [meeting]);
  check('active member may confirm through the approved RPC', confirmed.ok && confirmed.rows[0].response === 'confirmed', JSON.stringify(confirmed));
  const selfOutcome = await attempt(db, 'authenticated', ids.member,
    `update public.meeting_attendances set attendance_status='attended' where meeting_id=$1 and user_id=$2`, [meeting, ids.member]);
  check('member cannot record own verified attendance', selfOutcome.ok && selfOutcome.rows.length === 0, JSON.stringify(selfOutcome));
  const managerOutcome = await attempt(db, 'authenticated', ids.organizer,
    `update public.meeting_attendances set attendance_status='attended' where meeting_id=$1 and user_id=$2 returning attendance_status, attended`, [meeting, ids.member]);
  check('authorized organizer records another member attended', managerOutcome.ok && managerOutcome.rows[0]?.attendance_status === 'attended' && managerOutcome.rows[0]?.attended === true, JSON.stringify(managerOutcome));
  const pendingResponse = await attempt(db, 'authenticated', ids.pending,
    `select public.respond_to_meeting_invitation($1,'confirmed')`, [meeting]);
  check('pending account cannot confirm', !pendingResponse.ok, JSON.stringify(pendingResponse));

  await db.query(`insert into public.meeting_attendances (meeting_id,user_id,user_name,attended)
    values ($1,$2,'Pending legacy boolean',false)`, [meeting, ids.pending]);
  const ambiguous = await db.query(`select attendance_status, attended from public.meeting_attendances where meeting_id=$1 and user_id=$2`, [meeting, ids.pending]);
  check('legacy false is not inferred as absence', ambiguous.rows[0]?.attendance_status === 'confirmed' && ambiguous.rows[0]?.attended === null, JSON.stringify(ambiguous.rows[0]));
  const absent = await attempt(db, 'authenticated', ids.organizer,
    `update public.meeting_attendances set attendance_status='absent' where meeting_id=$1 and user_id=$2 returning attended`, [meeting, ids.pending]);
  check('authorized absent status derives legacy attended=false', absent.ok && absent.rows[0]?.attended === false, JSON.stringify(absent));

  const failed = results.filter((r) => !r.pass);
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : `  ${r.detail}`}`);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed, ${results.length} total`);
  process.exitCode = failed.length ? 1 : 0;
}

run().catch((error) => { console.error('ERROR', error); process.exitCode = 2; });
