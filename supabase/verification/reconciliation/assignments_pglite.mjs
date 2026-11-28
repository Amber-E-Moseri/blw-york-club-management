// Individual assignments (migration 064) on PGlite, full chain. Positive and negative controls; every write is verified
// through the owner connection because RLS filters return zero rows without an error.
// Run: PGLITE_MODULE=file:///<path>/node_modules/@electric-sql/pglite/dist/index.js node supabase/verification/reconciliation/assignments_pglite.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openReplay, attempt } from '../pglite_replay.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { db } = await openReplay(path.join(here, '..', '..', 'migrations'));
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  [assign064] ${name}${detail ? ' :: ' + String(detail).slice(0, 160) : ''}`); };
const as = (uid, sql, params = [], role = 'authenticated') => attempt(db, role, uid, sql, params);
const owner = (sql, params = []) => db.query(sql, params);

const U = {
  admin: 'f9000000-0000-4000-8000-000000000001', coord: 'f9000000-0000-4000-8000-000000000002',
  leaderA: 'f9000000-0000-4000-8000-000000000003', memberA: 'f9000000-0000-4000-8000-000000000004',
  memberB: 'f9000000-0000-4000-8000-000000000005', leaderB: 'f9000000-0000-4000-8000-000000000006',
  pending: 'f9000000-0000-4000-8000-000000000007', inactive: 'f9000000-0000-4000-8000-000000000008',
};
const CELL_A = 'fa000000-0000-4000-8000-00000000000a', CELL_B = 'fa000000-0000-4000-8000-00000000000b';
const A1 = 'fb000000-0000-4000-8000-000000000001', A2 = 'fb000000-0000-4000-8000-000000000002';
for (const [k, id] of Object.entries(U)) {
  await owner(`insert into auth.users (id,email,aud,role,created_at,raw_user_meta_data) values ($1,$2,'authenticated','authenticated',now(),jsonb_build_object('full_name',$3::text))`, [id, `${k}.asg064@website.invalid`, `Test ${k}`]);
}
await owner(`update public.profiles set role='admin', status='active' where id=$1`, [U.admin]);
await owner(`update public.profiles set role='coordinator', status='active' where id=$1`, [U.coord]);
for (const k of ['leaderA', 'memberA', 'leaderB', 'memberB']) await owner(`update public.profiles set role='member', status='active' where id=$1`, [U[k]]);
await owner(`update public.profiles set role='member', status='inactive' where id=$1`, [U.inactive]);
await owner(`insert into public.cells (id,name,leader_id) values ($1,'A',$2),($3,'B',$4)`, [CELL_A, U.leaderA, CELL_B, U.leaderB]);
await owner(`update public.profiles set cell_id=$1 where id in ($2,$3)`, [CELL_A, U.leaderA, U.memberA]);
await owner(`update public.profiles set cell_id=$1 where id in ($2,$3)`, [CELL_B, U.leaderB, U.memberB]);
const row = async (id) => (await owner(`select title, status, completed_at, assigned_by, assigned_to, due_date from public.assignments where id=$1`, [id])).rows[0];

// Positive: creation by staff and by the cell leader for their own cell's member.
let r = await as(U.admin, `insert into public.assignments (id,title,assigned_to,assigned_by) values ($1,'Visit the new member',$2,$3)`, [A1, U.memberA, U.admin]);
check('an administrator assigns a task to an active member', r.ok && (await row(A1)) !== undefined, r.error);
r = await as(U.leaderA, `insert into public.assignments (id,title,assigned_to,assigned_by) values ($1,'Follow up',$2,$3)`, [A2, U.memberA, U.leaderA]);
check('a cell leader assigns a task to a member of their own cell', r.ok && (await row(A2)) !== undefined, r.error);

// Positive: the assignee moves their own task through the workflow; completion is stamped.
r = await as(U.memberA, `update public.assignments set status='in_progress' where id=$1`, [A1]);
check('the assignee moves their task to in_progress', r.ok && (await row(A1)).status === 'in_progress', r.error);
r = await as(U.memberA, `update public.assignments set status='completed' where id=$1`, [A1]);
check('the assignee completes the task and completed_at is stamped', r.ok && (await row(A1)).status === 'completed' && (await row(A1)).completed_at != null, r.error);

// Positive: visibility. The assignee and the cell leader see it; another member does not.
r = await as(U.memberA, `select id from public.assignments where id=$1`, [A1]);
check('the assignee sees their own assignment', r.ok && r.rows.length === 1, r.error);
r = await as(U.leaderA, `select id from public.assignments where id=$1`, [A2]);
check('the cell leader sees an assignment for their own cell member', r.ok && r.rows.length === 1, r.error);
r = await as(U.coord, `update public.assignments set title='Revised by coordinator' where id=$1`, [A2]);
check('a coordinator may revise any assignment', r.ok && (await row(A2)).title === 'Revised by coordinator', r.error);

// Negative: creation.
r = await as(U.memberA, `insert into public.assignments (title,assigned_to,assigned_by) values ('x',$1,$2)`, [U.memberA, U.memberA]);
check('negative: an ordinary member cannot create an assignment', (await owner(`select count(*)::int n from public.assignments where title='x'`)).rows[0].n === 0, r.error ?? 'created');
r = await as(U.leaderA, `insert into public.assignments (title,assigned_to,assigned_by) values ('wrong cell',$1,$2)`, [U.memberB, U.leaderA]);
check('negative: a cell leader cannot assign to a member of another cell', (await owner(`select count(*)::int n from public.assignments where title='wrong cell'`)).rows[0].n === 0, r.error ?? 'created');
r = await as(U.admin, `insert into public.assignments (title,assigned_to,assigned_by) values ('to pending',$1,$2)`, [U.pending, U.admin]);
check('negative: a task cannot be assigned to a pending account', (await owner(`select count(*)::int n from public.assignments where title='to pending'`)).rows[0].n === 0, r.error ?? 'created');
r = await as(U.leaderA, `insert into public.assignments (title,assigned_to,assigned_by) values ('spoofed author',$1,$2)`, [U.memberA, U.admin]);
check('negative: assigned_by must be the caller (no spoofed author)', (await owner(`select count(*)::int n from public.assignments where title='spoofed author'`)).rows[0].n === 0, r.error ?? 'created');

// Negative: the assignee cannot rewrite anything but status.
const before = await row(A2);
r = await as(U.memberA, `update public.assignments set title='hijack' where id=$1`, [A2]);
check('negative: an assignee cannot change the title', (await row(A2)).title === before.title, r.error ?? 'changed');
r = await as(U.memberA, `update public.assignments set assigned_by=$1 where id=$2`, [U.memberA, A2]);
check('negative: an assignee cannot change assigned_by (no spoofing)', (await row(A2)).assigned_by === before.assigned_by, r.error ?? 'changed');
r = await as(U.memberA, `update public.assignments set due_date='2030-01-01' where id=$1`, [A2]);
check('negative: an assignee cannot change the due date', (await row(A2)).due_date === before.due_date, r.error ?? 'changed');
r = await as(U.memberA, `update public.assignments set assigned_to=$1 where id=$2`, [U.memberB, A2]);
check('negative: an assignee cannot reassign the task to someone else', (await row(A2)).assigned_to === U.memberA || (await owner(`select assigned_to from public.assignments where id=$1`, [A2])).rows[0].assigned_to === U.memberA, r.error ?? 'reassigned');
r = await as(U.memberA, `update public.assignments set status='cancelled' where id=$1`, [A2]);
check('negative: an assignee cannot cancel a task (only managers may cancel)', (await row(A2)).status !== 'cancelled', r.error ?? 'cancelled');
r = await as(U.memberA, `update public.assignments set status='pending' where id=$1`, [A1]);
check('negative: a completed task cannot be reopened by the assignee', (await row(A1)).status === 'completed', r.error ?? 'reopened');

// Negative: visibility and privilege boundaries.
r = await as(U.memberB, `select id from public.assignments where id=$1`, [A2]);
check('negative: another member cannot read someone else’s assignment', r.ok && r.rows.length === 0, r.error ?? r.rows.length);
r = await as(U.leaderB, `select id from public.assignments where id=$1`, [A2]);
check('negative: a leader of another cell cannot read the assignment', r.ok && r.rows.length === 0, r.error ?? r.rows.length);
r = await as(U.pending, `select id from public.assignments`);
check('negative: a pending account reads no assignments', r.ok && r.rows.length === 0, r.error ?? r.rows.length);
r = await as(U.inactive, `select id from public.assignments`);
check('negative: an inactive account reads no assignments', r.ok && r.rows.length === 0, r.error ?? r.rows.length);
r = await as(null, `select id from public.assignments`, [], 'anon');
check('negative: anonymous visitors read no assignments', !r.ok || r.rows.length === 0, r.error ?? r.rows.length);
r = await as(U.admin, `delete from public.assignments where id=$1`, [A2]);
check('negative: assignments are never deleted (no delete policy)', (await owner(`select count(*)::int n from public.assignments where id=$1`, [A2])).rows[0].n === 1, r.error ?? 'deleted');

const failed = results.filter((x) => !x).length;
console.log(`\nASSIGNMENTS 064 TESTS: ${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
