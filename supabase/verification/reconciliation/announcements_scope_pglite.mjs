// Announcement authority by scope (migration 066) on PGlite, full chain. Positive and negative controls, direct table
// access and immediate effect of leadership changes (no sign-in needed).
// Run: PGLITE_MODULE=file:///<path>/node_modules/@electric-sql/pglite/dist/index.js node supabase/verification/reconciliation/announcements_scope_pglite.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openReplay, attempt } from '../pglite_replay.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { db } = await openReplay(path.join(here, '..', '..', 'migrations'));
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  [ann066] ${name}${detail ? ' :: ' + String(detail).slice(0, 150) : ''}`); };
const as = (uid, sql, params = [], role = 'authenticated') => attempt(db, role, uid, sql, params);
const owner = (sql, params = []) => db.query(sql, params);
const P = (n) => `fd000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const U = { admin: P(1), coord: P(2), leaderA: P(3), leaderB: P(4), roleOnly: P(5), memberA: P(6), pending: P(7), inactiveLeaderA: P(8) };
const CELL = { A: P(101), B: P(102) };
const ANN = { orgWide: P(201), cellA: P(202), cellB: P(203) };
for (const [k, id] of Object.entries(U)) await owner(`insert into auth.users (id,email,aud,role,created_at,raw_user_meta_data) values ($1,$2,'authenticated','authenticated',now(),jsonb_build_object('full_name',$3::text))`, [id, `${k}.ann066@website.invalid`, `Test ${k}`]);
await owner(`update public.profiles set role='admin', status='active' where id=$1`, [U.admin]);
await owner(`update public.profiles set role='coordinator', status='active' where id=$1`, [U.coord]);
await owner(`update public.profiles set role='member', status='active' where id in ($1,$2,$3)`, [U.leaderA, U.leaderB, U.memberA]);
await owner(`update public.profiles set role='cell_leader', status='active' where id=$1`, [U.roleOnly]);
await owner(`update public.profiles set role='member', status='pending' where id=$1`, [U.pending]);
await owner(`update public.profiles set role='member', status='inactive' where id=$1`, [U.inactiveLeaderA]);
await owner(`insert into public.cells (id,name,leader_id) values ($1,'A',$2),($3,'B',$4)`, [CELL.A, U.leaderA, CELL.B, U.leaderB]);
await owner(`insert into public.announcements (id,title,body,author_id,author_name,cell_id) values ($1,'Org-wide','Hello all',$2,'Admin',null),($3,'Cell A','Cell news',$4,'Leader A',$5),($6,'Cell B','Other news',$7,'Leader B',$8)`,
  [ANN.orgWide, U.admin, ANN.cellA, U.leaderA, CELL.A, ANN.cellB, U.leaderB, CELL.B]);

// Positive
let r = await as(U.leaderA, `insert into public.announcements (id,title,body,author_id,author_name,cell_id) values ($1,'New A','Hi',$2,'Leader A',$3)`, [P(301), U.leaderA, CELL.A]);
check('an assigned leader creates an announcement for their own cell', r.ok, r.error);
r = await as(U.leaderA, `update public.announcements set title='Cell A revised' where id=$1`, [ANN.cellA]);
check('an assigned leader updates an announcement in their own cell', (await owner(`select title from public.announcements where id=$1`, [ANN.cellA])).rows[0].title === 'Cell A revised', r.error);
r = await as(U.admin, `insert into public.announcements (id,title,body,author_id,author_name,cell_id) values ($1,'Staff org','All',$2,'Admin',null)`, [P(302), U.admin]);
check('an administrator creates an organization-wide announcement', r.ok, r.error);
r = await as(U.coord, `update public.announcements set title='Coordinator edit' where id=$1`, [ANN.cellB]);
check('a coordinator manages a cell announcement in any cell', (await owner(`select title from public.announcements where id=$1`, [ANN.cellB])).rows[0].title === 'Coordinator edit', r.error);
r = await as(U.memberA, `select id from public.announcements`);
check('active members still read all announcements (announcements_read unchanged)', r.ok && r.rows.length >= 3, r.error ?? r.rows.length);

// Negative: scope and role
r = await as(U.leaderA, `insert into public.announcements (id,title,body,author_id,author_name,cell_id) values ($1,'Org by leader','x',$2,'L',null)`, [P(303), U.leaderA]);
check('negative: a cell leader cannot create an organization-wide announcement', (await owner(`select count(*)::int n from public.announcements where id=$1`, [P(303)])).rows[0].n === 0, r.error ?? 'created');
r = await as(U.leaderA, `insert into public.announcements (id,title,body,author_id,author_name,cell_id) values ($1,'Cross','x',$2,'L',$3)`, [P(304), U.leaderA, CELL.B]);
check('negative: a cell leader cannot create an announcement for another cell', (await owner(`select count(*)::int n from public.announcements where id=$1`, [P(304)])).rows[0].n === 0, r.error ?? 'created');
r = await as(U.leaderA, `update public.announcements set title='hijack' where id=$1`, [ANN.cellB]);
check('negative: a cell leader cannot edit another cell’s announcement', (await owner(`select title from public.announcements where id=$1`, [ANN.cellB])).rows[0].title !== 'hijack', r.error ?? 'edited');
r = await as(U.leaderA, `update public.announcements set cell_id=$1 where id=$2`, [CELL.B, ANN.cellA]);
check('negative: a cell leader cannot move their announcement to another cell', (await owner(`select cell_id from public.announcements where id=$1`, [ANN.cellA])).rows[0].cell_id === CELL.A, r.error ?? 'moved');
r = await as(U.leaderA, `update public.announcements set cell_id=null where id=$1`, [ANN.cellA]);
check('negative: a cell leader cannot make their announcement organization-wide', (await owner(`select cell_id from public.announcements where id=$1`, [ANN.cellA])).rows[0].cell_id === CELL.A, r.error ?? 'changed');
r = await as(U.roleOnly, `insert into public.announcements (id,title,body,author_id,author_name,cell_id) values ($1,'role only','x',$2,'R',$3)`, [P(305), U.roleOnly, CELL.A]);
check('negative: a cell_leader-role account without an assignment cannot announce for a cell', (await owner(`select count(*)::int n from public.announcements where id=$1`, [P(305)])).rows[0].n === 0, r.error ?? 'created');
r = await as(U.memberA, `update public.announcements set title='member hijack' where id=$1`, [ANN.cellA]);
check('negative: an ordinary member cannot edit an announcement', (await owner(`select title from public.announcements where id=$1`, [ANN.cellA])).rows[0].title !== 'member hijack', r.error ?? 'edited');
r = await as(U.pending, `insert into public.announcements (id,title,body,author_id,author_name,cell_id) values ($1,'pending','x',$2,'P',$3)`, [P(306), U.pending, CELL.A]);
check('negative: a pending account cannot announce', (await owner(`select count(*)::int n from public.announcements where id=$1`, [P(306)])).rows[0].n === 0, r.error ?? 'created');
r = await as(U.inactiveLeaderA, `update public.announcements set title='inactive' where id=$1`, [ANN.cellA]);
check('negative: an inactive recorded leader cannot edit their cell announcement', (await owner(`select title from public.announcements where id=$1`, [ANN.cellA])).rows[0].title !== 'inactive', r.error ?? 'edited');
r = await as(null, `select id from public.announcements`, [], 'anon');
check('negative: anonymous visitors read no announcements', !r.ok || r.rows.length === 0, r.error ?? r.rows.length);

// Lifecycle: removal takes effect immediately, reassignment grants at once (no sign-in).
await owner(`update public.cells set leader_id=$1 where id=$2`, [U.leaderB, CELL.A]);
r = await as(U.leaderA, `update public.announcements set title='after removal' where id=$1`, [ANN.cellA]);
check('removal: the former leader cannot edit the cell’s announcements immediately', (await owner(`select title from public.announcements where id=$1`, [ANN.cellA])).rows[0].title !== 'after removal', r.error ?? 'edited');
r = await as(U.leaderB, `update public.announcements set title='new leader' where id=$1`, [ANN.cellA]);
check('reassignment: the new leader manages the cell’s announcements immediately', (await owner(`select title from public.announcements where id=$1`, [ANN.cellA])).rows[0].title === 'new leader', r.error);

const failed = results.filter((x) => !x).length;
console.log(`\nANNOUNCEMENTS 066 TESTS: ${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
