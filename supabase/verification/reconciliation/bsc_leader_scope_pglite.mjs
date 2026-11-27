// Scoped BSC leadership helper (migration 063) on PGlite, full chain. The helper must be true only for an active member
// who leads the BSC and belongs to its cell.
// Run: PGLITE_MODULE=file:///<path>/node_modules/@electric-sql/pglite/dist/index.js node supabase/verification/reconciliation/bsc_leader_scope_pglite.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openReplay, attempt } from '../pglite_replay.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { db } = await openReplay(path.join(here, '..', '..', 'migrations'));
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  [bscleader063] ${name}${detail ? ' :: ' + String(detail).slice(0, 160) : ''}`); };
const owner = (sql, params = []) => db.query(sql, params);
const helper = async (uid, bsc) => {
  const r = await attempt(db, 'authenticated', uid, `select public.is_bsc_leader_of($1) as v`, [bsc]);
  return r.ok ? r.rows[0].v : { error: r.error };
};

const U = { leader: 'f6000000-0000-4000-8000-000000000001', outsider: 'f6000000-0000-4000-8000-000000000002', inactiveLeader: 'f6000000-0000-4000-8000-000000000003', member: 'f6000000-0000-4000-8000-000000000004' };
const CELL_A = 'f7000000-0000-4000-8000-00000000000a', CELL_B = 'f7000000-0000-4000-8000-00000000000b';
const BSC = 'f8000000-0000-4000-8000-00000000000a', BSC_NO_LEADER = 'f8000000-0000-4000-8000-00000000000b';
for (const [k, id] of Object.entries(U)) {
  await owner(`insert into auth.users (id,email,aud,role,created_at,raw_user_meta_data) values ($1,$2,'authenticated','authenticated',now(),jsonb_build_object('full_name',$3::text))`, [id, `${k}.bscl063@website.invalid`, `Test ${k}`]);
}
await owner(`insert into public.cells (id,name) values ($1,'A'),($2,'B')`, [CELL_A, CELL_B]);
await owner(`update public.profiles set role='member', status='active', cell_id=$1 where id=$2`, [CELL_A, U.leader]);
await owner(`update public.profiles set role='member', status='active', cell_id=$1 where id=$2`, [CELL_B, U.outsider]);
await owner(`update public.profiles set role='member', status='inactive', cell_id=$1 where id=$2`, [CELL_A, U.inactiveLeader]);
await owner(`update public.profiles set role='member', status='active', cell_id=$1 where id=$2`, [CELL_A, U.member]);
await owner(`insert into public.bscs (id,cell_id,name,leader_id) values ($1,$2,'BSC A',$3),($4,$2,'BSC unled',null)`, [BSC, CELL_A, U.leader, BSC_NO_LEADER]);
await owner(`insert into public.bscs (id,cell_id,name,leader_id) values ($1,$2,'BSC for inactive',$3)`, ['f8000000-0000-4000-8000-00000000000c', CELL_A, U.inactiveLeader]);
// A cell-B account leads a cell-A BSC: a leader outside the BSC's cell must be refused.
await owner(`insert into public.bscs (id,cell_id,name,leader_id) values ($1,$2,'BSC led from outside',$3)`, ['f8000000-0000-4000-8000-00000000000d', CELL_A, U.outsider]);

check('the active leader of a BSC in their own cell is a BSC leader', (await helper(U.leader, BSC)) === true);
check('an active member who leads no BSC is not a BSC leader', (await helper(U.member, BSC)) === false);
check('negative: a leader who is not in the BSC cell is refused (cell scope)', (await helper(U.outsider, 'f8000000-0000-4000-8000-00000000000d')) === false);
check('negative: an inactive leader is refused even when assigned and in the cell', (await helper(U.inactiveLeader, 'f8000000-0000-4000-8000-00000000000c')) === false);
check('negative: an unassigned BSC (no leader) grants no leadership to anyone', (await helper(U.leader, BSC_NO_LEADER)) === false);
check('negative: a helper call for a nonexistent BSC is false', (await helper(U.leader, 'f8000000-0000-4000-8000-0000000000ff')) === false);
const anon = await attempt(db, 'anon', null, `select public.is_bsc_leader_of($1) as v`, [BSC]);
check('negative: anonymous callers cannot execute the helper', !anon.ok, anon.error ?? 'executed');

const failed = results.filter((x) => !x).length;
console.log(`\nBSC LEADER SCOPE 063 TESTS: ${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
