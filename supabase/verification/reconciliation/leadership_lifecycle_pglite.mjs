// Cell leadership lifecycle (migration 065) on PGlite, full chain. Canonical authority is cells.leader_id. Checks direct
// RPC calls and table access, and that changes take effect at once (no sign-in is needed: every check runs a fresh query).
// Run: PGLITE_MODULE=file:///<path>/node_modules/@electric-sql/pglite/dist/index.js node supabase/verification/reconciliation/leadership_lifecycle_pglite.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openReplay, attempt } from '../pglite_replay.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { db } = await openReplay(path.join(here, '..', '..', 'migrations'));
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  [lead065] ${name}${detail ? ' :: ' + String(detail).slice(0, 150) : ''}`); };
const as = (uid, sql, params = []) => attempt(db, 'authenticated', uid, sql, params);
const owner = (sql, params = []) => db.query(sql, params);

const P = (n) => `fc000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const U = {
  admin: P(1), coord: P(2),
  leaderMember: P(3),      // active, ordinary member role, leads cell A
  leaderRole: P(4),        // active, cell_leader role, leads cell A
  unassignedRole: P(5),    // active, cell_leader role, in cell A, leads nothing
  leaderB: P(6),           // active, leads cell B
  memberA: P(7), memberB: P(8),
  pendingApplicant: P(9),  // pending, in cell A
  rejectedApplicant: P(10),
  inactiveLeader: P(11),   // inactive, recorded as leader of cell C
  cellC_member: P(12),
  removedLeader: P(13),    // was leader of cell A, then removed
  newLeader: P(14),        // reassigned leader of cell A (member role)
  memberD: P(15),          // member of cell D, led by the cell_leader-role account
};
const CELL = { A: P(101), B: P(102), C: P(103), D: P(104) };
const MEET_A = P(201), MEET_B = P(202), MEET_LEADERS_A = P(203), MEET_LEADERS_FRESH = P(204);
const BSC_A = P(301);

for (const [k, id] of Object.entries(U)) {
  await owner(`insert into auth.users (id,email,aud,role,created_at,raw_user_meta_data) values ($1,$2,'authenticated','authenticated',now(),jsonb_build_object('full_name',$3::text))`, [id, `${k}.lead065@website.invalid`, `Test ${k}`]);
}
await owner(`update public.profiles set role='admin', status='active' where id=$1`, [U.admin]);
await owner(`update public.profiles set role='coordinator', status='active' where id=$1`, [U.coord]);
await owner(`update public.profiles set role='member', status='active' where id in ($1,$2,$3,$4)`, [U.leaderMember, U.leaderB, U.memberA, U.memberB]);
await owner(`update public.profiles set role='cell_leader', status='active' where id in ($1,$2)`, [U.leaderRole, U.unassignedRole]);
await owner(`update public.profiles set role='member', status='pending' where id=$1`, [U.pendingApplicant]);
await owner(`update public.profiles set role='member', status='rejected' where id=$1`, [U.rejectedApplicant]);
await owner(`update public.profiles set role='member', status='inactive' where id=$1`, [U.inactiveLeader]);
await owner(`update public.profiles set role='member', status='active' where id in ($1,$2)`, [U.removedLeader, U.newLeader]);
await owner(`update public.profiles set role='member', status='active' where id=$1`, [U.cellC_member]);
await owner(`insert into public.cells (id,name,leader_id) values ($1,'A',$2),($3,'B',$4),($5,'C',$6),($7,'D',$8)`, [CELL.A, U.leaderMember, CELL.B, U.leaderB, CELL.C, U.inactiveLeader, CELL.D, U.leaderRole]);
await owner(`insert into public.user_profiles (user_id, first_name) values ($1,'Ada')`, [U.memberA]);
await owner(`update public.profiles set cell_id=$1, role='member', status='active' where id=$2`, [CELL.D, U.memberD]);
await owner(`insert into public.profiles (id, full_name, email, role, status, cell_id) values ($1,'Test memberD',$2,'member','active',$3)`, [U.memberD, 'memberD.lead065@website.invalid', CELL.D]).catch(() => null);
// cell A holds the leaders and members; the unassigned cell_leader-role account is in cell A too.
await owner(`update public.profiles set cell_id=$1 where id in ($2,$3,$4,$5,$6,$7)`, [CELL.A, U.leaderMember, U.unassignedRole, U.memberA, U.pendingApplicant, U.rejectedApplicant, U.removedLeader]);
await owner(`update public.profiles set cell_id=$1 where id=$2`, [CELL.A, U.newLeader]);
await owner(`update public.profiles set cell_id=$1 where id=$2`, [CELL.D, U.leaderRole]);
await owner(`update public.profiles set cell_id=$1 where id in ($2,$3)`, [CELL.B, U.leaderB, U.memberB]);
await owner(`update public.profiles set cell_id=$1 where id in ($2,$3)`, [CELL.C, U.inactiveLeader, U.cellC_member]);
const seeMembers = async (uid) => (await as(uid, `select member_key from public.v_cell_member_directory`)).rows.map((x) => x.member_key);
const K = async (id) => (await owner(`select public.member_roster_key($1) k`, [id])).rows[0].k;

// Positive: an active assigned leader with the ordinary member role gets the cell's profile scope.
let vis = await seeMembers(U.leaderMember);
const kMem = await K(U.memberA), kUnassigned = await K(U.unassignedRole);
check('an assigned leader with the member role sees their cell members (member_key directory)', vis.includes(kMem) && vis.includes(kUnassigned), JSON.stringify(vis));
const kPend = await K(U.pendingApplicant), kRej = await K(U.rejectedApplicant);
check('an assigned leader does not see pending or rejected applicants in their cell', !vis.includes(kPend) && !vis.includes(kRej), JSON.stringify(vis));
let rpc = await as(U.leaderMember, `select public.is_cell_leader_for_profile($1) v`, [U.memberA]);
check('direct RPC: assigned leader (member role) is a leader for their member', rpc.ok && rpc.rows[0].v === true, rpc.error);
const uprof = await as(U.leaderMember, `select phone from public.v_cell_member_directory where member_key=$1`, [kMem]);
check('directory: assigned leader sees the cell member’s approved contact row', uprof.ok && uprof.rows.length === 1, uprof.error);
const direct = await as(U.leaderMember, `select user_id from public.user_profiles where user_id=$1`, [U.memberA]);
check('negative: assigned leader reads no other member’s user_profiles row directly', direct.ok && direct.rows.length === 0, direct.error ?? direct.rows.length);

// Negative: the role alone confers nothing. An unassigned cell_leader-role account has no cell authority.
rpc = await as(U.unassignedRole, `select public.is_cell_leader_for_profile($1) v`, [U.memberA]);
check('negative: an unassigned cell_leader-role account is not a leader (RPC false)', rpc.ok && rpc.rows[0].v === false, rpc.error);
let rolesSee = await seeMembers(U.unassignedRole);
check('negative: an unassigned cell_leader-role account sees no other member of the cell', !rolesSee.includes(U.memberA) && !rolesSee.includes(U.memberB), JSON.stringify(rolesSee));
const rolesCanBsc = await as(U.unassignedRole, `insert into public.bscs (id,cell_id,name) values ($1,$2,'role only')`, [P(401), CELL.A]);
check('negative: an unassigned cell_leader-role account cannot create a BSC', (await owner(`select count(*)::int n from public.bscs where id=$1`, [P(401)])).rows[0].n === 0, rolesCanBsc.error ?? 'created');

// Positive: the cell_leader role does not replace the assignment, and an assigned leader with that role keeps authority.
rpc = await as(U.leaderRole, `select public.is_cell_leader_for_profile($1) v`, [U.memberA]);
rpc = await as(U.leaderRole, `select public.is_cell_leader_for_profile($1) v`, [U.memberD]);
check('an assigned leader with the cell_leader role (leads cell D) is a leader for their cell member', rpc.ok && rpc.rows[0].v === true, rpc.error);

// Negative: leader of another cell.
rpc = await as(U.leaderB, `select public.is_cell_leader_for_profile($1) v`, [U.memberA]);
check('negative: the leader of cell B is not a leader for a cell A member (RPC)', rpc.ok && rpc.rows[0].v === false, rpc.error);
let bvis = await seeMembers(U.leaderB);
check('negative: the leader of cell B sees no cell A member', !bvis.includes(U.memberA), JSON.stringify(bvis));

// Negative: pending, rejected and inactive accounts carry no leadership.
rpc = await as(U.pendingApplicant, `select public.is_cell_leader_for_profile($1) v`, [U.memberA]);
check('negative: a pending account is not a leader', rpc.ok && rpc.rows[0].v === false, rpc.error);
rpc = await as(U.rejectedApplicant, `select public.is_cell_leader_for_profile($1) v`, [U.memberA]);
check('negative: a rejected account is not a leader', rpc.ok && rpc.rows[0].v === false, rpc.error);
rpc = await as(U.inactiveLeader, `select public.is_cell_leader_for_profile($1) v`, [U.cellC_member]);
check('negative: an inactive account recorded as a cell leader is not a leader', rpc.ok && rpc.rows[0].v === false, rpc.error);
const inactiveBsc = await as(U.inactiveLeader, `insert into public.bscs (id,cell_id,name) values ($1,$2,'inactive leader')`, [P(402), CELL.C]);
check('negative: an inactive recorded leader cannot create a BSC', (await owner(`select count(*)::int n from public.bscs where id=$1`, [P(402)])).rows[0].n === 0, inactiveBsc.error ?? 'created');

// Meetings: visibility and management follow the cell leader, not the role.
await owner(`insert into public.meetings (id,title,date,time,visibility,cell_id,created_by,published_at,category) values ($1,'Cell A night','2026-12-01','19:00','cell',$2,$3,now(),'cell')`, [MEET_A, CELL.A, U.leaderMember]);
await owner(`insert into public.meetings (id,title,date,time,visibility,cell_id,created_by,published_at,category) values ($1,'Leaders A','2026-12-02','19:00','leaders',$2,$3,now(),'cell')`, [MEET_LEADERS_A, CELL.A, U.admin]);
await owner(`insert into public.meetings (id,title,date,time,visibility,cell_id,created_by,published_at,category) values ($1,'Leaders A (fresh)','2026-12-04','19:00','leaders',$2,$3,now(),'cell')`, [MEET_LEADERS_FRESH, CELL.A, U.admin]);
await owner(`insert into public.meetings (id,title,date,time,visibility,cell_id,created_by,published_at,category) values ($1,'Cell B night','2026-12-03','19:00','cell',$2,$3,now(),'cell')`, [MEET_B, CELL.B, U.leaderB]);

let m = await as(U.leaderMember, `update public.meetings set title='Cell A night (revised)' where id=$1`, [MEET_A]);
check('an assigned leader (member role) manages a meeting in their cell', (await owner(`select title from public.meetings where id=$1`, [MEET_A])).rows[0].title === 'Cell A night (revised)', m.error);
m = await as(U.unassignedRole, `update public.meetings set title='hijack' where id=$1`, [MEET_A]);
check('negative: an unassigned cell_leader-role account cannot manage a cell meeting', (await owner(`select title from public.meetings where id=$1`, [MEET_A])).rows[0].title !== 'hijack', m.error ?? 'changed');
m = await as(U.leaderB, `update public.meetings set title='hijack' where id=$1`, [MEET_A]);
check('negative: the leader of cell B cannot manage a cell A meeting', (await owner(`select title from public.meetings where id=$1`, [MEET_A])).rows[0].title !== 'hijack', m.error ?? 'changed');
const leadersRead = await as(U.leaderMember, `select id from public.meetings where id=$1`, [MEET_LEADERS_A]);
check("a 'leaders' meeting is visible to the leader of its cell", leadersRead.ok && leadersRead.rows.length === 1, leadersRead.error);
const unassignedRead = await as(U.unassignedRole, `select id from public.meetings where id=$1`, [MEET_LEADERS_A]);
check("negative: a 'leaders' meeting is hidden from an unassigned cell_leader-role account", unassignedRead.ok && unassignedRead.rows.length === 0, unassignedRead.error ?? unassignedRead.rows.length);
const leadersReadB = await as(U.leaderB, `select id from public.meetings where id=$1`, [MEET_LEADERS_A]);
check("negative: a 'leaders' meeting is hidden from the leader of another cell", leadersReadB.ok && leadersReadB.rows.length === 0, leadersReadB.error ?? leadersReadB.rows.length);

// Direct RPC: respond to a 'leaders' meeting.
let resp = await as(U.leaderMember, `select public.respond_to_meeting_invitation($1,'confirmed') v`, [MEET_LEADERS_A]);
check('RPC: the assigned leader (member role) may respond to a leaders meeting in their cell', resp.ok, resp.error);
resp = await as(U.unassignedRole, `select public.respond_to_meeting_invitation($1,'confirmed') v`, [MEET_LEADERS_A]);
check('RPC negative: an unassigned cell_leader-role account cannot respond to a leaders meeting', !resp.ok, resp.error ?? 'responded');
resp = await as(U.admin, `select public.respond_to_meeting_invitation($1,'confirmed') v`, [MEET_LEADERS_A]);
check('RPC: an administrator may respond to a leaders meeting', resp.ok, resp.error);

// BSC and assignments: canonical scope.
let bsc = await as(U.leaderMember, `insert into public.bscs (id,cell_id,name) values ($1,$2,'BSC A')`, [BSC_A, CELL.A]);
check('an assigned leader (member role) creates a BSC in their cell', (await owner(`select count(*)::int n from public.bscs where id=$1`, [BSC_A])).rows[0].n === 1, bsc.error);
let asg = await as(U.leaderMember, `insert into public.assignments (title,assigned_to,assigned_by) values ('Visit',$1,$2)`, [U.memberA, U.leaderMember]);
check('an assigned leader assigns a task to a member of their cell', (await owner(`select count(*)::int n from public.assignments where title='Visit'`)).rows[0].n === 1, asg.error);

// Administrator and coordinator keep their access everywhere.
rpc = await as(U.admin, `select public.is_cell_leader_for_profile($1) v`, [U.memberA]);
const adminRow = await as(U.admin, `select id from public.profiles where id=$1`, [U.memberB]);
check('an administrator sees a member of any cell (admin path, unchanged)', adminRow.ok && adminRow.rows.length === 1, adminRow.error ?? 'administrator cannot see the member');
const coordRow = await as(U.coord, `select id from public.profiles where id=$1`, [U.memberB]);
check('a coordinator sees a member of any cell (admin path, unchanged)', coordRow.ok && coordRow.rows.length === 1, coordRow.error ?? 'coordinator cannot see the member');
const coordBsc = await as(U.coord, `insert into public.bscs (id,cell_id,name) values ($1,$2,'coord BSC')`, [P(403), CELL.B]);
check('a coordinator may create a BSC in any cell', (await owner(`select count(*)::int n from public.bscs where id=$1`, [P(403)])).rows[0].n === 1, coordBsc.error);

// Lifecycle: removal takes effect at once; reassignment grants the new leader at once; no sign-in needed.
await owner(`update public.cells set leader_id=$1 where id=$2`, [U.newLeader, CELL.A]);
check('reassignment: the new leader is a leader immediately', (await as(U.newLeader, `select public.is_cell_leader_for_profile($1) v`, [U.memberA])).rows[0].v === true);
check('removal: the former leader loses profile scope immediately (no sign-in)', (await as(U.leaderMember, `select public.is_cell_leader_for_profile($1) v`, [U.memberA])).rows[0].v === false);
m = await as(U.leaderMember, `update public.meetings set title='after removal' where id=$1`, [MEET_A]);
check('removal: the former leader cannot manage the meeting immediately', (await owner(`select title from public.meetings where id=$1`, [MEET_A])).rows[0].title !== 'after removal', m.error ?? 'changed');
resp = await as(U.leaderMember, `select public.respond_to_meeting_invitation($1,'excused') v`, [MEET_LEADERS_FRESH]);
check('removal: the former leader cannot respond to a leaders meeting they were never recorded against', !resp.ok, resp.error ?? 'responded');
asg = await as(U.leaderMember, `insert into public.assignments (title,assigned_to,assigned_by) values ('after removal',$1,$2)`, [U.memberA, U.leaderMember]);
check('removal: the former leader cannot assign tasks in the cell immediately', (await owner(`select count(*)::int n from public.assignments where title='after removal'`)).rows[0].n === 0, asg.error ?? 'created');
check('the new leader can assign tasks immediately', (await (async () => { const r = await as(U.newLeader, `insert into public.assignments (title,assigned_to,assigned_by) values ('new leader task',$1,$2)`, [U.memberA, U.newLeader]); return r.ok; })()));

const failed = results.filter((x) => !x).length;
console.log(`\nLEADERSHIP LIFECYCLE 065 TESTS: ${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
