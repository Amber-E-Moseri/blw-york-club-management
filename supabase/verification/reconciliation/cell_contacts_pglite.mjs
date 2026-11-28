// Cell member contact and profile access (migrations 068 and 070) on PGlite, full chain. Leaders reach member data only
// through v_cell_member_directory (keyed by member_key) and get_cell_member_profile. Direct reads of other members' rows
// are refused. Run: PGLITE_MODULE=file:///<path>/node_modules/@electric-sql/pglite/dist/index.js node supabase/verification/reconciliation/cell_contacts_pglite.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openReplay, attempt } from '../pglite_replay.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { db } = await openReplay(path.join(here, '..', '..', 'migrations'));
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  [contact070] ${name}${detail ? ' :: ' + String(detail).slice(0, 150) : ''}`); };
const as = (uid, sql, params = [], role = 'authenticated') => attempt(db, role, uid, sql, params);
const owner = (sql, params = []) => db.query(sql, params);
const P = (n) => `ff000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const U = { admin: P(1), leaderA: P(2), leaderB: P(3), memberA: P(4), memberA2: P(5), pendingA: P(6), inactiveA: P(7), memberB: P(8), roleOnly: P(9) };
const CELL = { A: P(101), B: P(102) };
const key = (uid) => owner(`select public.member_roster_key($1) k`, [uid]).then((x) => x.rows[0].k);

for (const [k, id] of Object.entries(U)) await owner(`insert into auth.users (id,email,aud,role,created_at,raw_user_meta_data) values ($1,$2,'authenticated','authenticated',now(),jsonb_build_object('full_name',$3::text))`, [id, `${k}.cont070@website.invalid`, `Test ${k}`]);
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
await owner(`insert into public.user_profiles (user_id, phone, bio) values ($1,'416-555-0101','Likes choir'),($2,'416-555-0102',null)`, [U.memberA, U.memberB]);

const directory = (uid) => as(uid, `select member_key, full_name, cell_id, email, phone, bio, avatar_url from public.v_cell_member_directory`);
const keys = (r) => (r.rows ?? []).map((x) => x.member_key);

// ── Positive: the leader sees the active members of their cell, with contact details ──────────────────────────────────
let r = await directory(U.leaderA);
const kA = await key(U.memberA), kA2 = await key(U.memberA2), kB = await key(U.memberB), kPend = await key(U.pendingA), kInact = await key(U.inactiveA), kRole = await key(U.roleOnly);
check('an assigned leader sees the active members of their cell (by member_key)', r.ok && keys(r).includes(kA) && keys(r).includes(kA2), r.error);
check('the leader sees a member’s email and phone (approved contact)', r.ok && r.rows.find((x) => x.member_key === kA)?.phone === '416-555-0101' && r.rows.find((x) => x.member_key === kA)?.email === 'a@x.invalid', r.error);
check('the leader sees ordinary biography for the member', r.ok && r.rows.find((x) => x.member_key === kA)?.bio === 'Likes choir', r.error);
check('the active member who holds the cell_leader role is still a member of the cell', r.ok && keys(r).includes(kRole), r.error);
check('negative: pending and inactive members are not in the leader’s directory', r.ok && !keys(r).includes(kPend) && !keys(r).includes(kInact), r.error);
check('negative: the directory has no auth user id or person id, and no role, status, student number, bsc or admin column', r.ok && !(r.rows.length && Object.keys(r.rows[0]).some((c) => /^(id|user_id|person_id|role|status|student_number|bsc_id|admin_role)$/.test(c))), JSON.stringify(Object.keys(r.rows?.[0] ?? {})));
check('negative: the directory exposes no auth user id anywhere', r.ok && !r.rows.some((x) => Object.values(x).includes(U.memberA)), r.error);

r = await directory(U.leaderB);
check('the leader of cell B sees only cell B members', r.ok && keys(r).includes(kB) && !keys(r).includes(kA) && !keys(r).includes(kA2), r.error ?? keys(r).join(','));

// ── Negative: members without leadership ─────────────────────────────────────────────────────────────────────────────
r = await directory(U.memberA2);
check('negative: an ordinary member sees no directory rows', r.ok && r.rows.length === 0, r.error ?? r.rows.length);
r = await directory(U.roleOnly);
check('negative: a cell_leader-role account without an assignment sees no directory rows', r.ok && r.rows.length === 0, r.error ?? r.rows.length);

// ── Direct reads of other members’ rows are refused (the table policies, not only the view, are the boundary) ──────────
r = await as(U.leaderA, `select id from public.profiles where id=$1`, [U.memberA]);
check('negative: a leader reads no other member’s profile row directly', r.ok && r.rows.length === 0, r.error ?? r.rows.length);
r = await as(U.leaderA, `select id from public.profiles`);
check('negative: a leader’s direct profile query returns only their own row', r.ok && r.rows.length === 1 && r.rows[0].id === U.leaderA, r.error ?? r.rows.length);
r = await as(U.leaderA, `select user_id from public.user_profiles where user_id=$1`, [U.memberA]);
check('negative: a leader reads no other member’s user_profiles row directly', r.ok && r.rows.length === 0, r.error ?? r.rows.length);
r = await as(U.memberA2, `select id from public.profiles where id=$1`, [U.memberA]);
check('negative: an ordinary member reads no other member’s profile row', r.ok && r.rows.length === 0, r.error ?? r.rows.length);
r = await as(U.memberA2, `select id from public.profiles where id=$1`, [U.memberA2]);
check('self: an ordinary member still reads their own profile row', r.ok && r.rows.length === 1, r.error);
r = await as(U.memberA2, `select * from public.organizational_member_directory`);
check('negative: an ordinary member reads no organizational directory rows', r.ok && r.rows.length === 0, r.error ?? r.rows.length);
const PERSON_A = P(50);
await owner(`insert into public.people (id, full_name, email, phone) values ($1,'Person A','a@x.invalid','416-555-0101')`, [PERSON_A]);
await owner(`update public.profiles set person_id=$1 where id=$2`, [PERSON_A, U.memberA]);
const ownPerson = async (uid) => (await owner(`select person_id from public.profiles where id=$1`, [uid])).rows[0].person_id;
const ownLeaderPerson = await ownPerson(U.leaderA);
r = await as(U.leaderA, `select id from public.people`);
check('negative: a leader reads only their own identity row, never another member’s', r.ok && r.rows.every((x) => x.id === ownLeaderPerson) && r.rows.every((x) => x.id !== PERSON_A), r.error);
r = await as(U.memberA2, `select id from public.people`);
check('negative: an ordinary member reads only their own identity row, never another member’s', r.ok && r.rows.every((x) => x.id !== PERSON_A), r.error ?? 'exposed');
r = await as(U.memberA, `select id from public.people`);
check('self: a member reads their own linked identity row', r.ok && r.rows.length === 1, r.error ?? r.rows.length);
r = await as(U.leaderA, `select id from public.memberships`);
check('negative: a leader reads no membership rows of other members', r.ok && r.rows.length === 0, r.error ?? r.rows.length);

// ── Detail for one roster member: only inside the leader’s cell ──────────────────────────────────────────────────────────
r = await as(U.leaderA, `select full_name, phone from public.get_cell_member_profile($1)`, [kA]);
check('the leader opens one member’s detail by member_key', r.ok && r.rows.length === 1 && r.rows[0].phone === '416-555-0101', r.error ?? r.rows.length);
r = await as(U.leaderA, `select full_name from public.get_cell_member_profile($1)`, [kB]);
check('negative: the leader cannot open a cell B member’s detail', r.ok && r.rows.length === 0, r.error ?? r.rows.length);

// ── Anonymous and removal ───────────────────────────────────────────────────────────────────────────────────────────
r = await as(null, `select member_key from public.v_cell_member_directory`, [], 'anon');
check('negative: anonymous visitors cannot read the directory', !r.ok, r.ok ? 'read' : r.error);
await owner(`update public.cells set leader_id=$1 where id=$2`, [U.leaderB, CELL.A]);
r = await directory(U.leaderA);
check('removal: the former leader loses directory access immediately, without sign-out', r.ok && r.rows.length === 0, r.error ?? r.rows.length);
await owner(`update public.cells set leader_id=$1 where id=$2`, [U.leaderA, CELL.A]);

// ── Staff keep their authority ────────────────────────────────────────────────────────────────────────────────────────
r = await as(U.admin, `select id from public.profiles`);
check('staff: an administrator still reads every profile row', r.ok && r.rows.length >= 9, r.error ?? r.rows.length);

const failed = results.filter((x) => !x).length;
console.log(`\nCELL CONTACTS 070 TESTS: ${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
