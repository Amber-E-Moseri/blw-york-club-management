// Scoped follow-up assignment and leader reading progress by member key (migration 071) on PGlite, full chain. The browser
// never receives or sends an auth user id: it sends a member key, and the database resolves it under the caller's
// authority. Positive and negative controls, stale keys, cross-cell attempts, removed leaders, direct table and RPC attempts.
// Run: PGLITE_MODULE=file:///<path>/node_modules/@electric-sql/pglite/dist/index.js node supabase/verification/reconciliation/assignment_progress_pglite.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openReplay, attempt } from '../pglite_replay.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { db } = await openReplay(path.join(here, '..', '..', 'migrations'));
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  [assign071] ${name}${detail ? ' :: ' + String(detail).slice(0, 160) : ''}`); };
const as = (uid, sql, params = [], role = 'authenticated') => attempt(db, role, uid, sql, params);
const owner = (sql, params = []) => db.query(sql, params);
const P = (n) => `f1000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const U = { admin: P(1), leaderA: P(2), leaderB: P(3), memberA1: P(4), memberA2: P(5), memberB: P(6), roleOnly: P(7), pendingA: P(8) };
const CELL = { A: P(101), B: P(102) };
const CONTACT = { c1: P(201), c2: P(202) };
const DEV = P(301);
for (const [k, id] of Object.entries(U)) await owner(`insert into auth.users (id,email,aud,role,created_at,raw_user_meta_data) values ($1,$2,'authenticated','authenticated',now(),jsonb_build_object('full_name',$3::text))`, [id, `${k}.asg071@website.invalid`, `Test ${k}`]);
await owner(`update public.profiles set role='admin', status='active' where id=$1`, [U.admin]);
await owner(`update public.profiles set role='member', status='active', cell_id=$2 where id=$1`, [U.leaderA, CELL.A]);
await owner(`update public.profiles set role='member', status='active', cell_id=$2 where id=$1`, [U.leaderB, CELL.B]);
await owner(`update public.profiles set role='member', status='active', cell_id=$2 where id in ($1)`, [U.memberA1, CELL.A]);
await owner(`update public.profiles set role='member', status='active', cell_id=$2 where id in ($1)`, [U.memberA2, CELL.A]);
await owner(`update public.profiles set role='member', status='active', cell_id=$2 where id in ($1)`, [U.memberB, CELL.B]);
await owner(`update public.profiles set role='cell_leader', status='active', cell_id=$2 where id=$1`, [U.roleOnly, CELL.A]);
await owner(`update public.profiles set role='member', status='pending', cell_id=$2 where id=$1`, [U.pendingA, CELL.A]);
await owner(`insert into public.cells (id,name,leader_id) values ($1,'A',$2),($3,'B',$4)`, [CELL.A, U.leaderA, CELL.B, U.leaderB]);
const PERSON = { c1: P(401), c2: P(402), ins: P(403) };
await owner(`insert into public.people (id, full_name) values ($1,'Visitor A'),($2,'Visitor B'),($3,'Insert')`, [PERSON.c1, PERSON.c2, PERSON.ins]);
await owner(`insert into public.contacts (id, person_id, contact_name, cell_id, logged_by, archived) values ($1,$2,'Visitor A',$3,$4,false),($5,$6,'Visitor B',$7,$8,false)`,
  [CONTACT.c1, PERSON.c1, CELL.A, U.leaderA, CONTACT.c2, PERSON.c2, CELL.B, U.leaderB]);
await owner(`insert into public.monthly_devotionals (id, month, year, title, book_title, total_days, total_pages, created_by) values ($1, 12, 2026, 'Advent', 'Book', 31, 100, $2)`, [DEV, U.admin]);
await owner(`insert into public.devotional_views (member_id, devotional_id, day_of_month, viewed_date) values ($1,$2,1,'2026-12-01'),($1,$2,2,'2026-12-02'),($3,$2,1,'2026-12-01')`, [U.memberA1, DEV, U.memberB]);

const key = async (uid) => (await owner(`select public.member_roster_key($1) k`, [uid])).rows[0].k;
const K = { memberA1: await key(U.memberA1), memberA2: await key(U.memberA2), memberB: await key(U.memberB), pendingA: await key(U.pendingA), roleOnly: await key(U.roleOnly) };
const STALE = '0'.repeat(64);
const assignee = async (contact) => (await owner(`select follow_up_assignee a from public.contacts where id=$1`, [contact])).rows[0].a;
const assign = (uid, contact, memberKey) => as(uid, `select public.assign_contact_follow_up($1,$2) k`, [contact, memberKey]);

// ── Positive: an active leader assigns a follow-up within their cell, by key ──────────────────────────────────────────
let r = await assign(U.leaderA, CONTACT.c1, K.memberA2);
check('an assigned leader assigns a cell contact to an active member of the cell, by member key', r.ok && (await assignee(CONTACT.c1)) === U.memberA2, r.error);
check('the assignment returns the member key, never the auth user id', r.ok && r.rows[0].k === K.memberA2 && !JSON.stringify(r.rows).includes(U.memberA2), JSON.stringify(r.rows));
r = await assign(U.admin, CONTACT.c2, K.memberB);
check('staff assign a contact in any cell to an active member', r.ok && (await assignee(CONTACT.c2)) === U.memberB, r.error);
await owner(`update public.contacts set follow_up_assignee = null where id = $1`, [CONTACT.c2]);

// ── Stale and ineligible keys ─────────────────────────────────────────────────────────────────────────────────────────
const before = await assignee(CONTACT.c1);
r = await assign(U.leaderA, CONTACT.c1, STALE);
check('stale member key is refused and nothing changes', !r.ok && /P0002|not eligible/.test(r.error ?? '') && (await assignee(CONTACT.c1)) === before, r.error ?? 'assigned');
r = await assign(U.leaderA, CONTACT.c1, K.pendingA);
check('a pending member cannot be assigned (not eligible)', !r.ok, r.ok ? 'assigned' : r.error);
r = await assign(U.leaderA, CONTACT.c1, K.memberB);
check('negative: a member of another cell cannot be assigned to a contact in this cell', !r.ok && /cell|not eligible/.test(r.error ?? ''), r.ok ? 'assigned' : r.error);

// ── Cross-cell and authority ──────────────────────────────────────────────────────────────────────────────────────────
r = await assign(U.leaderA, CONTACT.c2, K.memberA2);
check('negative: a leader of cell A cannot assign a cell B contact', !r.ok && /42501|not authorised/.test(r.error ?? ''), r.ok ? 'assigned' : r.error);
r = await assign(U.memberA1, CONTACT.c1, K.memberA2);
check('negative: an ordinary member cannot assign follow-ups', !r.ok, r.ok ? 'assigned' : r.error);
r = await assign(U.roleOnly, CONTACT.c1, K.memberA2);
check('negative: a cell_leader-role account without an assignment cannot assign', !r.ok, r.ok ? 'assigned' : r.error);
r = await assign(null, CONTACT.c1, K.memberA2);
check('negative: an unauthenticated caller cannot assign', !r.ok, r.ok ? 'assigned' : r.error);

// ── Direct table writes: the trigger holds the same boundary ─────────────────────────────────────────────────────────
r = await as(U.leaderA, `update public.contacts set follow_up_assignee = $1 where id = $2`, [U.memberB, CONTACT.c1]);
check('direct table write: a leader cannot set a follow-up to a member of another cell', !r.ok && (await assignee(CONTACT.c1)) !== U.memberB, r.error ?? 'written');
r = await as(U.leaderA, `insert into public.contacts (person_id, contact_name, cell_id, logged_by, archived, follow_up_assignee) values ($4, 'Insert', $1, $2, false, $3)`, [CELL.A, U.leaderA, U.memberB, PERSON.ins]);
check('direct table insert: a leader cannot create a contact assigned outside their cell', !r.ok, r.ok ? 'inserted' : r.error);
r = await as(U.leaderA, `update public.contacts set follow_up_assignee = $1 where id = $2`, [U.memberA1, CONTACT.c1]);
check('direct table write: a leader may assign a member of their own cell', r.ok && (await assignee(CONTACT.c1)) === U.memberA1, r.error);

// ── Removed leader ────────────────────────────────────────────────────────────────────────────────────────────────────
await owner(`update public.cells set leader_id=$1 where id=$2`, [U.leaderB, CELL.A]);
r = await assign(U.leaderA, CONTACT.c1, K.memberA2);
check('removed leader: a former leader cannot assign in the cell they no longer lead', !r.ok, r.ok ? 'assigned' : r.error);
r = await assign(U.leaderB, CONTACT.c1, K.memberA2);
check('reassigned-in leader can assign immediately', r.ok, r.error);
await owner(`update public.cells set leader_id=$1 where id=$2`, [U.leaderA, CELL.A]);

// ── Reading progress: only dates, only for members the caller may review ───────────────────────────────────────────
r = await as(U.leaderA, `select viewed_date, day_of_month from public.get_cell_member_read_dates($1,$2)`, [K.memberA1, DEV]);
check('a leader reviews reading progress for a member of their cell (dates only)', r.ok && r.rows.length === 2 && Object.keys(r.rows[0]).sort().join() === 'day_of_month,viewed_date', r.error ?? JSON.stringify(r.rows));
r = await as(U.leaderA, `select viewed_date from public.get_cell_member_read_dates($1,$2)`, [K.memberB, DEV]);
check('negative: a leader gets no reading progress for a member of another cell', r.ok && r.rows.length === 0, r.error ?? r.rows.length);
r = await as(U.leaderA, `select viewed_date from public.get_cell_member_read_dates($1,$2)`, [STALE, DEV]);
check('stale key returns no rows and does not reveal existence', r.ok && r.rows.length === 0, r.error ?? r.rows.length);
r = await as(U.memberA1, `select viewed_date from public.get_cell_member_read_dates($1,$2)`, [K.memberA1, DEV]);
check('negative: an ordinary member cannot review another member’s reading by key (self reads its own table)', r.ok && r.rows.length === 0, r.error ?? r.rows.length);
r = await as(U.admin, `select viewed_date from public.get_cell_member_read_dates($1,$2)`, [K.memberB, DEV]);
check('staff review reading progress for any active member by key', r.ok && r.rows.length === 1, r.error ?? r.rows.length);
r = await as(U.memberA1, `select viewed_date from public.devotional_views where member_id=$1`, [U.memberA1]);
check('self: a member still reads their own reading progress from the table', r.ok && r.rows.length === 2, r.error);

// ── Reassignment (072): one transaction; previous follow-up closed; audit written; same authority ─────────────────────
await owner(`insert into public.contact_follow_ups (contact_id, assigned_to, assigned_by, status) values ($1,$2,$3,'active')`, [CONTACT.c1, U.memberA1, U.leaderA]).catch(() => null);
r = await as(U.leaderA, `select public.reassign_contact_follow_up($1,$2,$3) k`, [CONTACT.c1, K.memberA2, 'handover']);
check('a leader reassigns a cell contact by member key', r.ok && r.rows[0].k === K.memberA2 && (await assignee(CONTACT.c1)) === U.memberA2, r.error);
const fu = (await owner(`select status, assigned_to from public.contact_follow_ups where contact_id=$1 order by assigned_on`, [CONTACT.c1])).rows;
check('reassignment closes the previous active follow-up and opens one for the new assignee', fu.some((x) => x.status === 'reassigned') && fu.some((x) => x.status === 'active' && x.assigned_to === U.memberA2), JSON.stringify(fu));
const audit = (await owner(`select action from public.contact_audit_log where contact_id=$1 and action='reassigned'`, [CONTACT.c1])).rows.length;
check('reassignment writes an audit entry', audit >= 1, audit);
check('the reassignment returns the member key, not an auth id', r.ok && !JSON.stringify(r.rows).includes(U.memberA2));
r = await as(U.leaderA, `select public.reassign_contact_follow_up($1,$2,null)`, [CONTACT.c2, K.memberB]);
check('negative: a leader cannot reassign a cell B contact', !r.ok, r.ok ? 'reassigned' : r.error);
r = await as(U.leaderA, `select public.reassign_contact_follow_up($1,$2,null)`, [CONTACT.c1, STALE]);
check('stale key on reassignment is refused and the follow-up is unchanged', !r.ok && (await assignee(CONTACT.c1)) === U.memberA2, r.error ?? 'changed');
r = await as(U.memberA1, `select public.reassign_contact_follow_up($1,$2,null)`, [CONTACT.c1, K.memberA2]);
check('negative: an ordinary member cannot reassign', !r.ok, r.ok ? 'reassigned' : r.error);

// Direct inserts into contact_follow_ups are held to the same boundary.
r = await as(U.leaderA, `insert into public.contact_follow_ups (contact_id, assigned_to, assigned_by, status) values ($1,$2,$3,'active')`, [CONTACT.c1, U.memberB, U.leaderA]);
check('direct follow-up insert: a leader cannot assign a member of another cell', !r.ok, r.ok ? 'inserted' : r.error);
r = await as(U.leaderA, `insert into public.contact_follow_ups (contact_id, assigned_to, assigned_by, status) values ($1,$2,$3,'active')`, [CONTACT.c1, U.memberA1, U.leaderA]);
check('direct follow-up insert: a leader may assign a member of their own cell', r.ok, r.error);

// ── Cell names and leader names: active members only, no ids beyond the cell ──────────────────────────────────────
r = await as(U.memberA1, `select cell_id, cell_name, leader_name from public.list_cell_leaders()`);
check('an active member sees each cell with its leader name', r.ok && r.rows.length === 2 && r.rows.some((x) => x.leader_name), r.error ?? JSON.stringify(r.rows));
r = await as(U.pendingA, `select cell_id from public.list_cell_leaders()`);
check('negative: a pending account sees no cell list', r.ok && r.rows.length === 0, r.error ?? r.rows.length);
r = await as(null, `select cell_id from public.list_cell_leaders()`, [], 'anon');
check('negative: anonymous callers see no cell list', !r.ok, r.ok ? 'read' : r.error);

// ── Direct API and RPC attempts ───────────────────────────────────────────────────────────────────────────────────────
r = await as(U.leaderA, `select public.resolve_cell_member_user($1,$2)`, [K.memberA1, U.leaderA]);
check('direct RPC: resolve_cell_member_user is not executable by clients (no id can be harvested)', !r.ok, r.ok ? 'executed' : r.error);
r = await as(U.leaderA, `select public.begin_announcement_send($1,$2)`, [P(999), U.leaderA]);
check('direct RPC: dispatch lifecycle is service-only', !r.ok, r.ok ? 'executed' : r.error);
r = await as(U.leaderA, `select public.get_cell_member_read_dates(null, $1)`, [DEV]);
check('direct RPC: a null key returns no rows, never every member', r.ok && r.rows.length === 0, r.error ?? r.rows.length);
r = await as(null, `select public.get_cell_member_read_dates($1,$2)`, [K.memberA1, DEV], 'anon');
check('direct RPC: anonymous callers cannot read reading progress', !r.ok, r.ok ? 'executed' : r.error);

const failed = results.filter((x) => !x).length;
console.log(`\nASSIGNMENT AND PROGRESS 071 TESTS: ${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
