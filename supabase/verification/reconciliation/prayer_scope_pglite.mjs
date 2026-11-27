// Prayer request visibility by scope (migration 067) on PGlite, full chain. Each visibility mode is checked for each
// reader. Run: PGLITE_MODULE=file:///<path>/node_modules/@electric-sql/pglite/dist/index.js node supabase/verification/reconciliation/prayer_scope_pglite.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openReplay, attempt } from '../pglite_replay.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { db } = await openReplay(path.join(here, '..', '..', 'migrations'));
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  [pray067] ${name}${detail ? ' :: ' + String(detail).slice(0, 150) : ''}`); };
const as = (uid, sql, params = [], role = 'authenticated') => attempt(db, role, uid, sql, params);
const owner = (sql, params = []) => db.query(sql, params);
const P = (n) => `fe000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const U = { admin: P(1), coord: P(2), leaderA: P(3), leaderB: P(4), roleOnly: P(5), memberA: P(6), memberB: P(7), pending: P(8) };
const CELL = { A: P(101), B: P(102) };
const PR = { privA: P(201), leadA: P(202), leadAnon: P(203), sharedA: P(204), leadB: P(205), inactiveLeadA: P(206) };
for (const [k, id] of Object.entries(U)) await owner(`insert into auth.users (id,email,aud,role,created_at,raw_user_meta_data) values ($1,$2,'authenticated','authenticated',now(),jsonb_build_object('full_name',$3::text))`, [id, `${k}.pray067@website.invalid`, `Test ${k}`]);
await owner(`update public.profiles set role='admin', status='active' where id=$1`, [U.admin]);
await owner(`update public.profiles set role='coordinator', status='active' where id=$1`, [U.coord]);
await owner(`update public.profiles set role='member', status='active' where id in ($1,$2,$3,$4)`, [U.leaderA, U.leaderB, U.memberA, U.memberB]);
await owner(`update public.profiles set role='cell_leader', status='active' where id=$1`, [U.roleOnly]);
await owner(`update public.profiles set role='member', status='pending' where id=$1`, [U.pending]);
await owner(`insert into public.cells (id,name,leader_id) values ($1,'A',$2),($3,'B',$4)`, [CELL.A, U.leaderA, CELL.B, U.leaderB]);
await owner(`update public.profiles set cell_id=$1 where id in ($2,$3,$4)`, [CELL.A, U.leaderA, U.memberA, U.roleOnly]);
await owner(`update public.profiles set cell_id=$1 where id in ($2,$3)`, [CELL.B, U.leaderB, U.memberB]);
const ins = (id, author, vis, anon = false, active = true) => owner(`insert into public.prayer_requests (id,content,author_id,author_name,is_anonymous,is_active,visibility) values ($1,'Please pray',$2,'Author',$3,$4,$5)`, [id, author, anon, active, vis]);
await ins(PR.privA, U.memberA, 'private');
await ins(PR.leadA, U.memberA, 'leadership');
await ins(PR.leadAnon, U.memberA, 'leadership', true);
await ins(PR.sharedA, U.memberA, 'shared');
await ins(PR.leadB, U.memberB, 'leadership');
await ins(PR.inactiveLeadA, U.memberA, 'leadership', false, false);
const readIds = async (uid) => { const r = await as(uid, `select id from public.prayer_requests`); return r.ok ? new Set(r.rows.map((x) => x.id)) : { error: r.error }; };

// Positive
let s = await readIds(U.leaderA);
check('an assigned cell leader reads a leadership request from a member of their cell', s instanceof Set && s.has(PR.leadA), s.error);
check('a cell leader reads a shared request (shared is readable by active members)', s instanceof Set && s.has(PR.sharedA), s.error);
s = await readIds(U.coord);
check('a coordinator reads leadership requests (staff authority)', s instanceof Set && s.has(PR.leadA) && s.has(PR.leadAnon) && s.has(PR.leadB), s.error);
s = await readIds(U.admin);
check('an administrator reads leadership requests (staff authority)', s instanceof Set && s.has(PR.leadA), s.error);
s = await readIds(U.memberB);
check('an ordinary member reads shared requests', s instanceof Set && s.has(PR.sharedA), s.error);

// Negative: private rows are never exposed to leaders or staff through this policy.
s = await readIds(U.leaderA);
check('negative: a cell leader does not read a PRIVATE request of a member of their cell', s instanceof Set && !s.has(PR.privA), s.error ?? 'exposed');
s = await readIds(U.coord);
check('negative: staff do not read another author’s PRIVATE request through leadership policy', s instanceof Set && !s.has(PR.privA), s.error ?? 'exposed');
s = await readIds(U.memberB);
check('negative: an ordinary member does not read a PRIVATE request', s instanceof Set && !s.has(PR.privA), s.error ?? 'exposed');
// Negative: anonymity, cross-cell, role-only, inactive rows, pending accounts.
s = await readIds(U.leaderA);
check('negative: a cell leader does not read an ANONYMOUS leadership request', s instanceof Set && !s.has(PR.leadAnon), s.error ?? 'exposed');
check('negative: a cell leader does not read a leadership request from another cell', s instanceof Set && !s.has(PR.leadB), s.error ?? 'exposed');
check('negative: a deactivated leadership request is not read by a cell leader', s instanceof Set && !s.has(PR.inactiveLeadA), s.error ?? 'exposed');
s = await readIds(U.leaderB);
check('negative: the leader of cell B does not read cell A leadership requests', s instanceof Set && !s.has(PR.leadA), s.error ?? 'exposed');
s = await readIds(U.roleOnly);
check('negative: a cell_leader-role account without an assignment reads no leadership request', s instanceof Set && !s.has(PR.leadA) && !s.has(PR.leadB), s.error ?? 'exposed');
s = await readIds(U.pending);
check('negative: a pending account reads no leadership or private request', s instanceof Set && !s.has(PR.leadA) && !s.has(PR.privA), s.error ?? 'exposed');
const anon = await as(null, `select id from public.prayer_requests`, [], 'anon');
check('negative: anonymous visitors read no prayer requests', !anon.ok || anon.rows.length === 0, anon.error ?? anon.rows.length);

// Lifecycle: reassignment and removal take effect at once.
await owner(`update public.cells set leader_id=$1 where id=$2`, [U.leaderB, CELL.A]);
s = await readIds(U.leaderA);
check('removal: the former leader loses leadership-request access immediately', s instanceof Set && !s.has(PR.leadA), s.error ?? 'retained');
s = await readIds(U.leaderB);
check('reassignment: the new leader reads the cell’s leadership requests immediately', s instanceof Set && s.has(PR.leadA), s.error ?? 'not visible');

const failed = results.filter((x) => !x).length;
console.log(`\nPRAYER SCOPE 067 TESTS: ${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
