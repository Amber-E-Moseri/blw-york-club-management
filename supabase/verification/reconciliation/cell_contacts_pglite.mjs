// Cell member contact access (migration 068) on PGlite, full chain. Field-level: only the approved columns, only the leader's
// own cell, only active members. Run: PGLITE_MODULE=file:///<path>/node_modules/@electric-sql/pglite/dist/index.js node supabase/verification/reconciliation/cell_contacts_pglite.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openReplay, attempt } from '../pglite_replay.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { db } = await openReplay(path.join(here, '..', '..', 'migrations'));
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  [contact068] ${name}${detail ? ' :: ' + String(detail).slice(0, 150) : ''}`); };
const as = (uid, sql, params = [], role = 'authenticated') => attempt(db, role, uid, sql, params);
const owner = (sql, params = []) => db.query(sql, params);
const P = (n) => `ff000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const U = { admin: P(1), leaderA: P(2), leaderB: P(3), memberA: P(4), memberA2: P(5), pendingA: P(6), inactiveA: P(7), memberB: P(8), roleOnly: P(9) };
const CELL = { A: P(101), B: P(102) };
for (const [k, id] of Object.entries(U)) await owner(`insert into auth.users (id,email,aud,role,created_at,raw_user_meta_data) values ($1,$2,'authenticated','authenticated',now(),jsonb_build_object('full_name',$3::text))`, [id, `${k}.cont068@website.invalid`, `Test ${k}`]);
await owner(`update public.profiles set role='admin', status='active' where id=$1`, [U.admin]);
await owner(`update public.profiles set role='member', status='active', email=$2, cell_id=$3, admin_role='admin', student_number='21000001' where id=$1`, [U.leaderA, 'leaderA@x.invalid', CELL.A]);
await owner(`update public.profiles set role='member', status='active', email=$2, cell_id=$3 where id=$1`, [U.leaderB, 'leaderB@x.invalid', CELL.B]);
await owner(`update public.profiles set role='member', status='active', email=$2, cell_id=$3 where id=$1`, [U.memberA, 'a@x.invalid', CELL.A]);
await owner(`update public.profiles set role='member', status='active', email=$2, cell_id=$3 where id=$1`, [U.memberA2, 'a2@x.invalid', CELL.A]);
await owner(`update public.profiles set role='member', status='pending', email=$2, cell_id=$3 where id=$1`, [U.pendingA, 'p@x.invalid', CELL.A]);
await owner(`update public.profiles set role='member', status='inactive', email=$2, cell_id=$3 where id=$1`, [U.inactiveA, 'i@x.invalid', CELL.A]);
await owner(`update public.profiles set role='member', status='active', email=$2, cell_id=$3 where id=$1`, [U.memberB, 'b@x.invalid', CELL.B]);
await owner(`update public.profiles set role='cell_leader', status='active', cell_id=$2 where id=$1`, [U.roleOnly, CELL.A]);
await owner(`insert into public.cells (id,name,leader_id) values ($1,'A',$2),($3,'B',$4)`, [CELL.A, U.leaderA, CELL.B, U.leaderB]);
await owner(`insert into public.user_profiles (user_id, phone) values ($1,'416-555-0101'),($2,'416-555-0102')`, [U.memberA, U.memberB]);
const rows = async (uid) => { const r = await as(uid, `select member_id, email, phone, full_name, cell_id from public.v_cell_member_contacts`); return r; };

let r = await rows(U.leaderA);
const ids = r.ok ? r.rows.map((x) => x.member_id) : [];
check('an assigned leader sees contact details of active members in their cell', r.ok && ids.includes(U.memberA) && ids.includes(U.memberA2) && ids.includes(U.leaderA), r.error);
check('the leader sees a member’s phone number (from user_profiles)', r.ok && r.rows.find((x) => x.member_id === U.memberA)?.phone === '416-555-0101', r.error);
check('negative: a pending applicant in the cell is not shown', !ids.includes(U.pendingA), JSON.stringify(ids));
check('negative: an inactive member in the cell is not shown', !ids.includes(U.inactiveA), JSON.stringify(ids));
check('negative: another cell’s members are not shown', !ids.includes(U.memberB), JSON.stringify(ids));
const cols = (await owner(`select column_name from information_schema.columns where table_schema='public' and table_name='v_cell_member_contacts' order by 1`)).rows.map((x) => x.column_name);
check('field-level: only the approved columns exist in the view', JSON.stringify(cols) === JSON.stringify(['cell_id', 'email', 'full_name', 'member_id', 'phone']), JSON.stringify(cols));
check('field-level: the view exposes no admin_role, role, student_number, person_id or bsc_id', !r.ok || !Object.keys(r.rows[0] ?? {}).some((k) => ['admin_role', 'role', 'student_number', 'person_id', 'bsc_id', 'status'].includes(k)));
r = await rows(U.leaderB);
check('the leader of cell B sees only cell B members', r.ok && r.rows.every((x) => x.cell_id === CELL.B), JSON.stringify(r.rows?.map((x) => x.member_id)));
r = await rows(U.memberA);
check('negative: an ordinary member (not a leader) sees no contact rows', r.ok && r.rows.length === 0, r.error ?? r.rows.length);
r = await rows(U.roleOnly);
check('negative: a cell_leader-role account without an assignment sees no contact rows', r.ok && r.rows.length === 0, r.error ?? r.rows.length);
r = await rows(U.admin);
check('negative: the view grants no extra authority to administrators (table access is unchanged)', r.ok && r.rows.length === 0, r.error ?? r.rows.length);
r = await as(null, `select member_id from public.v_cell_member_contacts`, [], 'anon');
check('negative: anonymous visitors cannot read the view', !r.ok, r.error ?? 'read');
// Lifecycle: removal takes effect at once; reassignment grants at once.
await owner(`update public.cells set leader_id=$1 where id=$2`, [U.leaderB, CELL.A]);
r = await rows(U.leaderA);
check('removal: the former leader loses contact access immediately', r.ok && r.rows.length === 0, r.error ?? r.rows.length);
r = await rows(U.leaderB);
check('reassignment: the new leader of cell A sees the cell’s contacts immediately', r.ok && r.rows.some((x) => x.member_id === U.memberA), r.error ?? JSON.stringify(r.rows?.length));

const failed = results.filter((x) => !x).length;
console.log(`\nCELL CONTACTS 068 TESTS: ${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
