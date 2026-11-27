// Profile field sync (migration 062) on PGlite, full chain. Each path must reach the other; protected attributes and
// closed accounts must not be writable through either path.
// Run: PGLITE_MODULE=file:///<path>/node_modules/@electric-sql/pglite/dist/index.js node supabase/verification/reconciliation/profile_sync_pglite.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openReplay, attempt } from '../pglite_replay.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { db } = await openReplay(path.join(here, '..', '..', 'migrations'));
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  [sync062] ${name}${detail ? ' :: ' + String(detail).slice(0, 170) : ''}`); };
const as = (uid, sql, params = []) => attempt(db, 'authenticated', uid, sql, params);
const owner = (sql, params = []) => db.query(sql, params);

const U = { member: 'f5000000-0000-4000-8000-000000000001', other: 'f5000000-0000-4000-8000-000000000002', pending: 'f5000000-0000-4000-8000-000000000003', rejected: 'f5000000-0000-4000-8000-000000000004', coord: 'f5000000-0000-4000-8000-000000000005' };
for (const [k, id] of Object.entries(U)) {
  await owner(`insert into auth.users (id,email,aud,role,created_at,raw_user_meta_data) values ($1,$2,'authenticated','authenticated',now(),jsonb_build_object('full_name',$3::text))`, [id, `${k}.sync062@website.invalid`, `Test ${k}`]);
}
await owner(`update public.profiles set role='member', status='active' where id=$1`, [U.member]);
await owner(`update public.profiles set role='member', status='active' where id=$1`, [U.other]);
await owner(`update public.profiles set role='member', status='rejected' where id=$1`, [U.rejected]);
await owner(`update public.profiles set role='coordinator', status='active' where id=$1`, [U.coord]);
for (const id of [U.member, U.other, U.rejected]) await owner(`insert into public.user_profiles (user_id) values ($1) on conflict do nothing`, [id]);
const both = async (id) => ({ p: (await owner(`select student_number, avatar_url from public.profiles where id=$1`, [id])).rows[0], u: (await owner(`select student_number, avatar_url from public.user_profiles where user_id=$1`, [id])).rows[0] });
const same = async (id) => { const b = await both(id); return b.p.student_number === b.u.student_number && b.p.avatar_url === b.u.avatar_url; };

let r = await as(U.member, `update public.user_profiles set student_number='21111111', avatar_url='https://x.example/a.png' where user_id=$1`, [U.member]);
let b = await both(U.member);
check('a user_profiles save reaches the profiles row', r.ok && b.p.student_number === '21111111' && b.p.avatar_url === 'https://x.example/a.png', r.error ?? JSON.stringify(b));
r = await as(U.member, `update public.profiles set student_number='22222222' where id=$1`, [U.member]);
b = await both(U.member);
check('a profiles save reaches the user_profiles row', r.ok && b.u.student_number === '22222222' && (await same(U.member)), r.error ?? JSON.stringify(b));
r = await as(U.coord, `update public.user_profiles set avatar_url='https://x.example/c.png' where user_id=$1`, [U.member]);
check('a coordinator update keeps both rows equal', r.ok && (await same(U.member)) && (await both(U.member)).p.avatar_url === 'https://x.example/c.png', r.error);

// Protected attributes are not synchronised and not writable through either path.
const beforeP = (await owner(`select role,status,cell_id,admin_role,person_id,bsc_id from public.profiles where id=$1`, [U.member])).rows[0];
r = await as(U.member, `update public.profiles set role='admin', status='rejected', admin_role='admin' where id=$1`, [U.member]);
const afterP = (await owner(`select role,status,cell_id,admin_role,person_id,bsc_id from public.profiles where id=$1`, [U.member])).rows[0];
check('negative: protected profile attributes stay unchanged through the profiles path', JSON.stringify(beforeP) === JSON.stringify(afterP), r.error ?? JSON.stringify(afterP));
r = await as(U.member, `update public.user_profiles set student_number='9' where user_id=$1`, [U.other]);
check('negative: a member cannot sync or write another person’s row', (await both(U.other)).p.student_number == null, r.error ?? 'written');

// Negative: a rejected account cannot change either row, and a change to it does not reach the other row.
r = await as(U.rejected, `update public.user_profiles set student_number='777' where user_id=$1`, [U.rejected]);
check('negative: a rejected account cannot write its user_profiles row', (await both(U.rejected)).u.student_number == null, r.error ?? 'written');
r = await as(U.rejected, `update public.profiles set student_number='777' where id=$1`, [U.rejected]);
check('negative: a rejected account cannot write its profiles row', (await both(U.rejected)).p.student_number == null, r.error ?? 'written');

// No loop: a mirror that changes nothing terminates (value already equal), and the rows stay equal.
r = await as(U.member, `update public.user_profiles set bio='no shared change' where user_id=$1`, [U.member]);
check('an edit to an unshared field leaves the shared fields equal and terminates', r.ok && (await same(U.member)), r.error);

const failed = results.filter((x) => !x).length;
console.log(`\nPROFILE SYNC 062 TESTS: ${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
