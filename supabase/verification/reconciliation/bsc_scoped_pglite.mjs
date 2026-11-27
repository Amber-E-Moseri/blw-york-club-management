// BSC scoped authorization (migration 060) on PGlite. Replays migrations 000-060, then checks each operation with real
// role switching. Writes filtered by RLS return zero rows and no error, so every write is verified by reading the row
// through the owner connection afterwards.
// Run: PGLITE_MODULE=file:///<path>/node_modules/@electric-sql/pglite/dist/index.js node supabase/verification/reconciliation/bsc_scoped_pglite.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openReplay, attempt } from '../pglite_replay.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { db } = await openReplay(path.join(here, '..', '..', 'migrations'));
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  [bsc060] ${name}${detail ? ' :: ' + String(detail).slice(0, 180) : ''}`); };
const as = (uid, sql, params = [], role = 'authenticated') => attempt(db, role, uid, sql, params);
const owner = (sql, params = []) => db.query(sql, params);

const U = {
  core: 'd0000000-0000-4000-8000-000000000001', coord: 'd0000000-0000-4000-8000-000000000002',
  leaderA: 'd0000000-0000-4000-8000-000000000003', leaderB: 'd0000000-0000-4000-8000-000000000004',
  inactiveLeader: 'd0000000-0000-4000-8000-000000000005', member: 'd0000000-0000-4000-8000-000000000006',
  pending: 'd0000000-0000-4000-8000-000000000007',
};
const CELL = { A: 'd1000000-0000-4000-8000-00000000000a', B: 'd1000000-0000-4000-8000-00000000000b', C: 'd1000000-0000-4000-8000-00000000000c' };
const BSC_A = 'd2000000-0000-4000-8000-00000000000a';
const BSC_B = 'd2000000-0000-4000-8000-00000000000b';

for (const [k, id] of Object.entries(U)) {
  await owner(`insert into auth.users (id,email,aud,role,created_at,raw_user_meta_data) values ($1,$2,'authenticated','authenticated',now(),jsonb_build_object('full_name',$3::text))`, [id, `${k}.bsc060@website.invalid`, `Test ${k}`]);
}
await owner(`update public.profiles set role='admin', status='active' where id=$1`, [U.core]);
await owner(`update public.profiles set role='coordinator', status='active' where id=$1`, [U.coord]);
for (const k of ['leaderA', 'leaderB', 'member']) await owner(`update public.profiles set role='member', status='active' where id=$1`, [U[k]]);
await owner(`update public.profiles set role='member', status='inactive' where id=$1`, [U.inactiveLeader]);
// U.pending keeps the signup default (pending).
await owner(`insert into public.cells (id,name,leader_id) values ($1,'Cell A',$2),($3,'Cell B',$4),($5,'Cell C',$6)`,
  [CELL.A, U.leaderA, CELL.B, U.leaderB, CELL.C, U.inactiveLeader]);
await owner(`insert into public.bscs (id,cell_id,name) values ($1,$2,'BSC A'),($3,$4,'BSC B')`, [BSC_A, CELL.A, BSC_B, CELL.B]);
const bscName = async (id) => (await owner(`select name from public.bscs where id=$1`, [id])).rows[0]?.name ?? null;
const exists = async (id) => (await owner(`select count(*)::int n from public.bscs where id=$1`, [id])).rows[0].n === 1;

// Positive controls: the scoped model still lets the right people do their jobs.
let r = await as(U.leaderA, `insert into public.bscs (id,cell_id,name) values ('d2000000-0000-4000-8000-0000000000aa',$1,'New in A') returning id`, [CELL.A]);
check('an active cell leader inserts a BSC in their own cell', r.ok && r.rows.length === 1, r.error);
r = await as(U.leaderA, `update public.bscs set name='BSC A renamed' where id=$1`, [BSC_A]);
check('an active cell leader updates a BSC in their own cell', r.ok && (await bscName(BSC_A)) === 'BSC A renamed', r.error ?? (await bscName(BSC_A)));
r = await as(U.coord, `delete from public.bscs where id='d2000000-0000-4000-8000-0000000000aa'`);
check('a coordinator deletes a BSC', r.ok && !(await exists('d2000000-0000-4000-8000-0000000000aa')), r.error);
r = await as(U.core, `insert into public.bscs (id,cell_id,name) values ('d2000000-0000-4000-8000-0000000000bb',$1,'Core made') returning id`, [CELL.B]);
check('a core administrator inserts a BSC in any cell', r.ok, r.error);
r = await as(U.core, `delete from public.bscs where id='d2000000-0000-4000-8000-0000000000bb'`);
check('a core administrator deletes a BSC', r.ok && !(await exists('d2000000-0000-4000-8000-0000000000bb')), r.error);
r = await as(U.member, `select id from public.bscs`);
check('an active member reads BSC rows (bscs_read unchanged)', r.ok && r.rows.length >= 2, r.error ?? r.rows.length);

// Negative controls: the broad policy is gone, and leaders cannot delete or leave their cell.
r = await as(U.leaderA, `delete from public.bscs where id=$1`, [BSC_A]);
check('negative: a cell leader cannot DELETE a BSC in their own cell (the broad ALL policy allowed this)', await exists(BSC_A), r.error ?? 'row removed');
r = await as(U.leaderA, `insert into public.bscs (id,cell_id,name) values ('d2000000-0000-4000-8000-0000000000cc',$1,'Wrong cell')`, [CELL.B]);
check('negative: a cell leader cannot insert a BSC into another cell', !(await exists('d2000000-0000-4000-8000-0000000000cc')), r.error ?? 'inserted');
r = await as(U.leaderA, `update public.bscs set name='hijack' where id=$1`, [BSC_B]);
check('negative: a cell leader cannot update a BSC in another cell', (await bscName(BSC_B)) === 'BSC B', r.error ?? (await bscName(BSC_B)));
r = await as(U.leaderA, `update public.bscs set cell_id=$1 where id=$2`, [CELL.B, BSC_A]);
check('negative: a cell leader cannot move their BSC into another cell', (await owner(`select cell_id from public.bscs where id=$1`, [BSC_A])).rows[0].cell_id === CELL.A, r.error ?? 'moved');
r = await as(U.inactiveLeader, `insert into public.bscs (id,cell_id,name) values ('d2000000-0000-4000-8000-0000000000dd',$1,'Inactive')`, [CELL.C]);
check('negative: an inactive leader cannot insert a BSC', !(await exists('d2000000-0000-4000-8000-0000000000dd')), r.error ?? 'inserted');
r = await as(U.member, `delete from public.bscs where id=$1`, [BSC_B]);
check('negative: an ordinary member cannot delete a BSC', await exists(BSC_B), r.error ?? 'removed');
r = await as(U.member, `insert into public.bscs (id,cell_id,name) values ('d2000000-0000-4000-8000-0000000000ee',$1,'Member')`, [CELL.A]);
check('negative: an ordinary member cannot insert a BSC', !(await exists('d2000000-0000-4000-8000-0000000000ee')), r.error ?? 'inserted');
r = await as(U.pending, `select id from public.bscs`);
check('negative: a pending account reads no BSC rows', r.ok && r.rows.length === 0, r.error ?? r.rows.length);
r = await as(null, `select id from public.bscs`, [], 'anon');
check('negative: anonymous visitors read no BSC rows', !r.ok || r.rows.length === 0, r.error ?? r.rows.length);

// The broad policy must not come back.
const pols = (await owner(`select policyname from pg_policies where schemaname='public' and tablename='bscs' order by 1`)).rows.map((x) => x.policyname);
check('the scoped policies are present and the broad bscs_manage is absent', JSON.stringify(pols) === JSON.stringify(['bscs_delete_staff', 'bscs_insert_scoped', 'bscs_read', 'bscs_update_scoped']), JSON.stringify(pols));

const failed = results.filter((x) => !x).length;
console.log(`\nBSC SCOPED TESTS: ${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
