// Profile editing boundary (Decision 1) on PGlite, full chain through 060. Every write is verified by reading the row
// through the owner connection, because RLS filtering returns zero rows and no error.
// Run: PGLITE_MODULE=file:///<path>/node_modules/@electric-sql/pglite/dist/index.js node supabase/verification/reconciliation/profile_boundary_pglite.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openReplay, attempt } from '../pglite_replay.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { db } = await openReplay(path.join(here, '..', '..', 'migrations'));
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  [profile-d4] ${name}${detail ? ' :: ' + String(detail).slice(0, 170) : ''}`); };
const as = (uid, sql, params = []) => attempt(db, 'authenticated', uid, sql, params);
const owner = (sql, params = []) => db.query(sql, params);

const U = {
  admin: 'e0000000-0000-4000-8000-000000000001', member: 'e0000000-0000-4000-8000-000000000002',
  other: 'e0000000-0000-4000-8000-000000000003', pending: 'e0000000-0000-4000-8000-000000000004',
  rejected: 'e0000000-0000-4000-8000-000000000005', inactive: 'e0000000-0000-4000-8000-000000000006',
};
const CELL = 'e1000000-0000-4000-8000-000000000001';
for (const [k, id] of Object.entries(U)) {
  await owner(`insert into auth.users (id,email,aud,role,created_at,raw_user_meta_data) values ($1,$2,'authenticated','authenticated',now(),jsonb_build_object('full_name',$3::text))`, [id, `${k}.d4@website.invalid`, `Test ${k}`]);
}
await owner(`update public.profiles set role='admin', status='active' where id=$1`, [U.admin]);
for (const k of ['member', 'other']) await owner(`update public.profiles set role='member', status='active', cell_id=null where id=$1`, [U[k]]);
await owner(`update public.profiles set role='member', status='rejected' where id=$1`, [U.rejected]);
await owner(`update public.profiles set role='member', status='inactive' where id=$1`, [U.inactive]);
await owner(`insert into public.cells (id,name) values ($1,'Cell 1')`, [CELL]);
for (const id of Object.values(U)) await owner(`insert into public.user_profiles (user_id) values ($1) on conflict do nothing`, [id]).catch(() => null);

const snap = async (id) => (await owner(`select role, status, admin_role, cell_id, person_id, bsc_id, full_name from public.profiles where id=$1`, [id])).rows[0];
const up = async (id) => (await owner(`select first_name, phone, bio from public.user_profiles where user_id=$1`, [id])).rows[0];

// Positive: approved ordinary personal fields, through the user_profiles path.
let r = await as(U.member, `update public.user_profiles set phone='416-555-0100', bio='Hello', first_name='Ada' where user_id=$1`, [U.member]);
let row = await up(U.member);
check('an active member edits their own ordinary personal fields in user_profiles', r.ok && row.phone === '416-555-0100' && row.bio === 'Hello' && row.first_name === 'Ada', r.error ?? JSON.stringify(row));

// Positive: a pending account completes onboarding details.
r = await as(U.pending, `update public.user_profiles set phone='416-555-0111' where user_id=$1`, [U.pending]);
check('a pending account saves its own onboarding details', r.ok && (await up(U.pending)).phone === '416-555-0111', r.error);

// Positive: a core administrator maintains another member's profile.
r = await as(U.admin, `update public.user_profiles set bio='Staff note' where user_id=$1`, [U.member]);
check('an administrator updates another member’s user_profiles', r.ok && (await up(U.member)).bio === 'Staff note', r.error);

// Boundary: privileged fields cannot change through the active member's profiles self-update path.
const before = await snap(U.member);
for (const [col, val] of [['role', "'admin'"], ['status', "'inactive'"], ['admin_role', "'admin'"], ['cell_id', `'${CELL}'`], ['person_id', "'e2000000-0000-4000-8000-000000000001'"], ['bsc_id', "'e3000000-0000-4000-8000-000000000001'"]]) {
  r = await as(U.member, `update public.profiles set ${col} = ${val} where id=$1`, [U.member]);
  const after = await snap(U.member);
  check(`an active member cannot change profiles.${col} (guarded)`, JSON.stringify(after) === JSON.stringify(before) || !r.ok, r.error ?? `changed to ${after[col]}`);
}
r = await as(U.member, `update public.profiles set full_name='Ordinary' where id=$1`, [U.member]);
check('an active member may change an ordinary profiles column (certified C4 path, unchanged)', r.ok && (await snap(U.member)).full_name === 'Ordinary', r.error);

// Boundary: a member cannot write another person's profile or user_profiles row, or reassign ownership.
r = await as(U.member, `update public.user_profiles set bio='hijack' where user_id=$1`, [U.other]);
check('a member cannot edit another person’s user_profiles', (await up(U.other)).bio !== 'hijack', r.error ?? 'edited');
r = await as(U.member, `update public.profiles set role='admin' where id=$1`, [U.other]);
check('a member cannot change another person’s profile role', (await snap(U.other)).role === 'member', r.error ?? 'changed');
r = await as(U.member, `update public.user_profiles set user_id=$1 where user_id=$2`, [U.other, U.member]);
check('a member cannot reassign their user_profiles row to another account', (await owner(`select count(*)::int n from public.user_profiles where user_id=$1`, [U.member])).rows[0].n === 1, r.error ?? 'reassigned');
r = await as(U.member, `insert into public.user_profiles (user_id, first_name) values ($1,'Forged')`, [U.other]);
check('a direct API insert of another person’s user_profiles row is refused', !(await owner(`select 1 from public.user_profiles where user_id=$1 and first_name='Forged'`, [U.other])).rows.length, r.error ?? 'inserted');

// Negative: rejected and inactive accounts have no editing access at all.
const rej = await snap(U.rejected);
r = await as(U.rejected, `update public.user_profiles set phone='x' where user_id=$1`, [U.rejected]);
check('a rejected account cannot edit its user_profiles', (await up(U.rejected)).phone == null, r.error ?? 'edited');
r = await as(U.rejected, `update public.profiles set full_name='x' where id=$1`, [U.rejected]);
check('a rejected account cannot edit its profiles row', (await snap(U.rejected)).full_name === rej.full_name, r.error ?? 'edited');
r = await as(U.inactive, `update public.user_profiles set phone='x' where user_id=$1`, [U.inactive]);
check('an inactive account cannot edit its user_profiles', (await up(U.inactive)).phone == null, r.error ?? 'edited');
r = await as(U.inactive, `update public.profiles set role='admin' where id=$1`, [U.inactive]);
check('an inactive account cannot change its role', (await snap(U.inactive)).role === 'member', r.error ?? 'changed');

// Negative: a pending account cannot change its own status (the path to becoming active).
r = await as(U.pending, `update public.profiles set status='active' where id=$1`, [U.pending]);
check('a pending account cannot approve itself by changing status', (await snap(U.pending)).status === 'pending', r.error ?? 'changed');

const failed = results.filter((x) => !x).length;
console.log(`\nPROFILE D4 BOUNDARY TESTS: ${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
