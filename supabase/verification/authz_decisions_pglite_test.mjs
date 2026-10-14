// Offline authorization checks for the consolidated sequence 090-094, run on PGlite.
//
// Replays the real migrations through 094, then checks:
//   PD-1  pending applicant privacy across profiles, user_profiles, member_directory, bsc_members_visible, search and the
//         Cell Leader roster RPC. Leaders see only id, name and cell, and only for cells they actually lead.
//   093   cell changes: the two-argument transfer is refused without change; the three-argument transfer and the pending
//         placement are authorised, need a 3-500 character reason, and write exactly one audit row; the reason is consumed
//         by that row and cannot leak into a later change or a later transaction.
//   094   privileges: direct profile DELETE, status, cell_id and bsc_id writes are denied to every API role; the approved
//         workflows and self-service edits still work. Table-level and column-level grants are asserted separately.
//   092   contacts: active members log to their own cell or unassigned; pending and rejected members, and spoofed or
//         foreign-cell rows, are denied.
//
// Limits: PGlite is not a Supabase stack. This certifies the SQL, RLS, grants and SECURITY DEFINER paths, not the Auth or
// PostgREST layer. It touches no hosted or Docker database.
//
// Usage:
//   PGLITE_MODULE=file:///path/to/node_modules/@electric-sql/pglite/dist/index.js \
//     node supabase/verification/authz_decisions_pglite_test.mjs

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openReplay, asRole, attempt } from './pglite_replay.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.join(here, '..', 'migrations');
// Replays the whole sequence through 096 (095 people privacy, 096 profile INSERT boundary).
const LAST = process.env.DECISIONS_TEST_LAST ?? '096_profile_insert_boundary.sql';

const results = [];
const check = (name, ok, evidence = '') => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${evidence ? `  [${String(evidence).slice(0, 160)}]` : ''}`);
};
const denied = (r) => !r.ok && r.code === '42501';
const refused = (r, code) => !r.ok && r.code === code;

const { db, applied } = await openReplay(MIGRATIONS, { lastFile: LAST });
console.log(`replayed ${applied.length} migrations through ${applied[applied.length - 1]}`);
// Owner-run cell change with its reason set for that transaction only (as begin_cell_change does for the app).
const ownerCellChange = async (memberId, cellId, reason) => {
  await db.exec('begin');
  await db.query("select set_config('app.cell_change_reason', $1, true)", [reason]);
  await db.query('update public.profiles set cell_id = $2 where id = $1', [memberId, cellId]);
  await db.exec('commit');
};


// ─── fixtures (owner bypasses RLS and the privilege layer; it is the database owner, as in a real replay) ───────────────
const people = {
  admin: { role: 'admin', status: 'active' },
  coordinator: { role: 'coordinator', status: 'active' },
  leaderA: { role: 'member', status: 'active' },        // leads cell A
  leaderB: { role: 'member', status: 'active' },        // leads cell B
  bscLeaderA: { role: 'member', status: 'active' },     // leads BSC A in cell A; is not a cell leader
  memberA: { role: 'member', status: 'active' },        // active member of cell A and BSC A
  bscJoiner: { role: 'member', status: 'active' },      // active, cell A, no BSC: for the BSC assignment workflow
  spareMember: { role: 'member', status: 'active' },    // active, no BSC, leads nothing: for transfers
  spareTwo: { role: 'member', status: 'active' },       // active, for the set_member_status workflow
  unassigned: { role: 'member', status: 'active' },     // active, no cell
  pendingA: { role: 'member', status: 'pending' },      // pending applicant in cell A (name visible, email hidden)
  pendingUnplaced: { role: 'member', status: 'pending' }, // pending applicant with no cell
  pendingB: { role: 'member', status: 'pending' },      // pending applicant in cell B
  pendingReject: { role: 'member', status: 'pending' }, // pending applicant, later placed then rejected
  pendingApprove: { role: 'member', status: 'pending' }, // pending applicant, approved through the RPC
  inactiveMember: { role: 'member', status: 'inactive' },
};
const id = {};
for (const label of Object.keys(people)) id[label] = crypto.randomUUID();
for (const [label, p] of Object.entries(people)) {
  await db.query('insert into auth.users (id, email, aud, role, created_at) values ($1, $2, $3, $4, now())',
    [id[label], `${label}@decisions.test`, 'authenticated', 'authenticated']);
  await db.query('update public.profiles set full_name = $2, email = $3, role = $4, status = $5 where id = $1',
    [id[label], label, `${label}@decisions.test`, p.role, p.status]);
}

const cellA = crypto.randomUUID();
const cellB = crypto.randomUUID();
await db.query("insert into public.cells (id, name) values ($1, 'Cell A'), ($2, 'Cell B')", [cellA, cellB]);
await db.query('update public.cells set leader_id = $2 where id = $1', [cellA, id.leaderA]);
await db.query('update public.cells set leader_id = $2 where id = $1', [cellB, id.leaderB]);
// Owner fixture placement. The owner-run cell change needs a reason (093), set for the fixture transaction.
for (const m of [id.leaderA, id.bscLeaderA, id.memberA, id.bscJoiner, id.pendingA, id.spareMember, id.spareTwo]) await ownerCellChange(m, cellA, 'owner fixture setup');
for (const m of [id.leaderB, id.pendingB]) await ownerCellChange(m, cellB, 'owner fixture setup');
const bscA = crypto.randomUUID();
await db.query('insert into public.bscs (id, cell_id, name, leader_id) values ($1, $2, $3, $4)',
  [bscA, cellA, 'BSC A', id.bscLeaderA]);
await db.query('update public.profiles set bsc_id = $2 where id = $1', [id.memberA, bscA]);
// Owner-set state for the defensive BSC privacy rule. A pending applicant with a BSC has no authorised path (see the
// BLOCKED states in bsc_access_session_test.mjs); this only proves the rule holds if such a row ever exists.
await db.query('update public.profiles set bsc_id = $2 where id = $1', [id.pendingA, bscA]);

await db.query(`insert into public.user_profiles (user_id, phone) values ($1, '555-0100'), ($2, '555-0101'), ($3, '555-0102')`,
  [id.memberA, id.pendingA, id.leaderA]);

const rowsOf = async (uid, sql, params = []) => {
  const r = await attempt(db, 'authenticated', uid, sql, params);
  return r.ok ? r.rows : [];
};
const count = async (sql, params = []) => Number((await db.query(sql, params)).rows[0].n);


// ─── PD-1: pending applicant privacy ────────────────────────────────────────────────────────────────────────────────
const directA = await rowsOf(id.leaderA, 'select id, email from public.profiles where id = $1', [id.pendingA]);
check('PD-1 cell leader cannot read a pending applicant row (no email) through profiles', directA.length === 0, `rows=${directA.length}`);

const rosterA = await rowsOf(id.leaderA, 'select * from public.cell_leader_pending_roster()');
check('PD-1 leader roster contains the own-cell pending applicant', rosterA.some((r) => r.id === id.pendingA && r.full_name === 'pendingA' && r.cell_id === cellA), `rows=${rosterA.length}`);
check('PD-1 leader roster returns exactly id, full_name and cell_id',
  rosterA.length > 0 && JSON.stringify(Object.keys(rosterA[0]).sort()) === JSON.stringify(['cell_id', 'full_name', 'id']),
  Object.keys(rosterA[0] ?? {}).join(','));
check('PD-1 leader roster excludes active members', !rosterA.some((r) => r.id === id.memberA));
check('PD-1 leader roster excludes the caller themselves', !rosterA.some((r) => r.id === id.leaderA));

const rosterB = await rowsOf(id.leaderB, 'select * from public.cell_leader_pending_roster()');
check('PD-1 leader of cell B sees only cell B pending (cross-cell denial)',
  rosterB.length > 0 && rosterB.every((r) => r.cell_id === cellB) && !rosterB.some((r) => r.id === id.pendingA), `rows=${rosterB.length}`);

const rosterBsc = await rowsOf(id.bscLeaderA, 'select * from public.cell_leader_pending_roster()');
check('PD-1 BSC-only leader gets no pending roster', rosterBsc.length === 0, `rows=${rosterBsc.length}`);

const rosterMember = await rowsOf(id.memberA, 'select * from public.cell_leader_pending_roster()');
check('PD-1 ordinary member gets no pending roster', rosterMember.length === 0, `rows=${rosterMember.length}`);

const bscLeaderMembers = await rowsOf(id.bscLeaderA, 'select id from public.bsc_members_visible()');
check('PD-1 BSC-only leader sees no pending member of their BSC', !bscLeaderMembers.some((r) => r.id === id.pendingA));
const bscLeaderA = await rowsOf(id.leaderA, 'select id, full_name, email from public.bsc_members_visible()');
check('PD-1 bsc_members_visible hides pending applicants from the cell leader (rule 088/091)',
  !bscLeaderA.some((r) => r.id === id.pendingA), `rows=${bscLeaderA.length}`);
const bscLeaderActive = bscLeaderA.find((r) => r.id === id.memberA);
check('PD-1 bsc_members_visible still shows an active member email to the leader (unchanged)',
  bscLeaderActive?.email === 'memberA@decisions.test', JSON.stringify(bscLeaderActive));
const bscAdmin = await rowsOf(id.admin, 'select id, email from public.bsc_members_visible()');
check('PD-1 admin sees the pending applicant through bsc_members_visible (onboarding access preserved)',
  bscAdmin.some((r) => r.id === id.pendingA), `rows=${bscAdmin.length}`);

const dirA = await rowsOf(id.leaderA, 'select id, email from public.member_directory where id = $1', [id.pendingA]);
check('PD-1 member_directory returns no pending applicant row (and so no email) to the cell leader', dirA.length === 0, JSON.stringify(dirA));
const dirAdmin = await rowsOf(id.admin, 'select id, email from public.member_directory where id = $1', [id.pendingA]);
check('PD-1 admin reads the pending applicant email through member_directory', dirAdmin[0]?.email === 'pendingA@decisions.test');

const searchLeader = await rowsOf(id.leaderA, `select id from public.profiles where full_name ilike '%pendingA%' or email ilike '%pendingA%'`);
check('PD-1 search by name or email returns no pending applicant to the cell leader', searchLeader.length === 0, `rows=${searchLeader.length}`);
const searchAdmin = await rowsOf(id.admin, `select id, email from public.profiles where email ilike '%pendingA%'`);
check('PD-1 admin search finds the pending applicant', searchAdmin.some((r) => r.id === id.pendingA));

const ulLeaderPending = await rowsOf(id.leaderA, 'select user_id, phone from public.user_profiles where user_id = $1', [id.pendingA]);
check('PD-1 cell leader cannot read a pending applicant user_profiles row (phone, bio, student_number)',
  ulLeaderPending.length === 0, `rows=${ulLeaderPending.length}`);
const ulLeaderActive = await rowsOf(id.leaderA, 'select user_id from public.user_profiles where user_id = $1', [id.memberA]);
check('PD-1 cell leader still reads an active own-cell member user_profiles row (unchanged)', ulLeaderActive.length === 1);
const ulAdmin = await rowsOf(id.admin, 'select user_id from public.user_profiles where user_id = $1', [id.pendingA]);
check('PD-1 admin reads the pending applicant user_profiles row', ulAdmin.length === 1);

const ownPending = await rowsOf(id.pendingA, 'select id, email from public.profiles where id = $1', [id.pendingA]);
check('PD-1 pending applicant reads their own onboarding row', ownPending[0]?.email === 'pendingA@decisions.test');
const memberPending = await rowsOf(id.memberA, 'select id from public.profiles where id = any($1::uuid[])', [[id.pendingA, id.pendingB]]);
check('PD-1 ordinary active member sees no other pending applicant', memberPending.length === 0, `rows=${memberPending.length}`);

// ─── 093: cell changes, reasons and audit ───────────────────────────────────────────────────────────────────────────
const place = (actor, member, cell, reason) =>
  attempt(db, 'authenticated', actor, 'select * from public.assign_pending_applicant_to_cell($1, $2, $3)', [member, cell, reason]);
const transfer3 = (actor, member, cell, reason) =>
  attempt(db, 'authenticated', actor, 'select * from public.transfer_member_cell($1, $2, $3)', [member, cell, reason]);

const leaderPlace = await place(id.leaderA, id.pendingUnplaced, cellA, 'walk-in');
check('093 cell leader cannot place a pending applicant', denied(leaderPlace), leaderPlace.error);
const coordPlace = await place(id.coordinator, id.pendingUnplaced, cellA, 'Coordinator placement');
check('093 coordinator can place a pending applicant (approved role)', coordPlace.ok, coordPlace.error);
await ownerCellChange(id.pendingUnplaced, null, 'owner reset');

const blankPlace = await place(id.admin, id.pendingUnplaced, cellA, '   ');
check('093 pending placement with a blank reason is refused (P0001)', refused(blankPlace, 'P0001'), blankPlace.error);
const longPlace = await place(id.admin, id.pendingUnplaced, cellA, 'x'.repeat(501));
check('093 pending placement with a 501-character reason is refused (P0001)', refused(longPlace, 'P0001'), longPlace.error);
const activeTarget = await place(id.admin, id.spareMember, cellB, 'should be transfer');
check('093 assign_pending refuses an active member (P0001)', refused(activeTarget, 'P0001'), activeTarget.error);

const placeCountBefore = await count('select count(*)::int n from public.member_cell_audit where member_id = $1', [id.pendingUnplaced]);
const adminPlace = await place(id.admin, id.pendingUnplaced, cellA, 'Attended the welcome evening');
check('093 admin places a pending applicant through the RPC', adminPlace.ok, adminPlace.error);
check('093 pending placement writes exactly one member_cell_audit row',
  (await count('select count(*)::int n from public.member_cell_audit where member_id = $1', [id.pendingUnplaced])) === placeCountBefore + 1);
const placeRow = (await db.query(
  'select actor_id, from_cell_id, to_cell_id, reason, changed_at from public.member_cell_audit where member_id = $1 order by id desc limit 1',
  [id.pendingUnplaced])).rows[0];
check('093 placement audit row records actor, previous cell (null), new cell, reason and timestamp',
  placeRow?.actor_id === id.admin && placeRow?.from_cell_id === null && placeRow?.to_cell_id === cellA
    && placeRow?.reason === 'Attended the welcome evening' && placeRow?.changed_at != null, JSON.stringify(placeRow));

// The two-argument transfer is refused and changes nothing (clear error, no placement, no audit row).
const memberCellBefore = (await db.query('select cell_id from public.profiles where id = $1', [id.spareMember])).rows[0].cell_id;
const auditBefore2 = await count('select count(*)::int n from public.member_cell_audit where member_id = $1', [id.spareMember]);
const twoArg = await attempt(db, 'authenticated', id.admin, 'select * from public.transfer_member_cell($1, $2)', [id.spareMember, cellB]);
check('093 two-argument transfer_member_cell is refused with a clear error', !twoArg.ok, twoArg.error);
check('093 a refused two-argument transfer changes no placement',
  (await db.query('select cell_id from public.profiles where id = $1', [id.spareMember])).rows[0].cell_id === memberCellBefore);
check('093 a refused two-argument transfer writes no audit row',
  (await count('select count(*)::int n from public.member_cell_audit where member_id = $1', [id.spareMember])) === auditBefore2);

const leaderTransfer = await transfer3(id.leaderA, id.spareMember, cellB, 'leader attempt');
check('093 cell leader cannot transfer a member (42501)', denied(leaderTransfer), leaderTransfer.error);
const blankTransfer = await transfer3(id.admin, id.spareMember, cellB, '  ');
check('093 transfer with a blank reason is refused (P0001)', refused(blankTransfer, 'P0001'), blankTransfer.error);
check('093 a refused blank-reason transfer changes no placement',
  (await db.query('select cell_id from public.profiles where id = $1', [id.spareMember])).rows[0].cell_id === memberCellBefore);

const transferBefore = await count('select count(*)::int n from public.member_cell_audit where member_id = $1', [id.spareMember]);
const transferOk = await transfer3(id.admin, id.spareMember, cellB, 'Moved to cell B for the new group');
check('093 admin transfer with a reason succeeds', transferOk.ok, transferOk.error);
check('093 transfer writes exactly one audit row',
  (await count('select count(*)::int n from public.member_cell_audit where member_id = $1', [id.spareMember])) === transferBefore + 1);
const transferRow = (await db.query(
  'select actor_id, from_cell_id, to_cell_id, reason from public.member_cell_audit where member_id = $1 order by id desc limit 1',
  [id.spareMember])).rows[0];
check('093 transfer audit row records actor, previous cell, new cell and its own reason',
  transferRow?.actor_id === id.admin && transferRow?.from_cell_id === cellA && transferRow?.to_cell_id === cellB
    && transferRow?.reason === 'Moved to cell B for the new group', JSON.stringify(transferRow));
await ownerCellChange(id.spareMember, cellA, 'owner restore');

// The reason is consumed by its row. A second cell change in the same transaction must state its own reason.
await db.exec('begin');
await db.query("select public.begin_cell_change('First change in the transaction')");
await db.query('update public.profiles set cell_id = $2 where id = $1', [id.unassigned, cellA]);
let stale = null;
try {
  await db.query('update public.profiles set cell_id = $2 where id = $1', [id.spareTwo, cellB]);
} catch (e) {
  stale = e;
}
await db.exec('rollback');
check('093 a second cell change in the same transaction without its own reason is refused (no stale reason)',
  stale !== null && /needs a recorded reason/.test(stale.message), stale?.message ?? 'no error');

const leakCheck = (await db.query("select nullif(current_setting('app.cell_change_reason', true), '') as r")).rows[0].r;
check('093 the transaction-local reason does not persist into a later transaction', leakCheck === null, `value=${leakCheck}`);

// Owner cell change with no reason in its own transaction: refused by the audit trigger, not silently recorded.
let noReason = null;
try { await db.query('update public.profiles set cell_id = $2 where id = $1', [id.unassigned, cellB]); } catch (e) { noReason = e; }
check('093 any cell change without a reason is refused by the audit trigger', noReason !== null && /needs a recorded reason/.test(noReason.message), noReason?.message ?? 'no error');


// Rejection keeps the placement history.
await place(id.admin, id.pendingReject, cellA, 'Placed for onboarding');
const historyBeforeReject = await count('select count(*)::int n from public.member_cell_audit where member_id = $1', [id.pendingReject]);
const rejected = await attempt(db, 'authenticated', id.admin, 'select * from public.reject_pending_member($1)', [id.pendingReject]);
check('093 rejecting an applicant succeeds', rejected.ok, rejected.error);
check('093 rejecting an applicant keeps their placement history',
  (await count('select count(*)::int n from public.member_cell_audit where member_id = $1', [id.pendingReject])) === historyBeforeReject);

// The pending applicant cannot approve themselves or place themselves.
const selfApprove = await attempt(db, 'authenticated', id.pendingApprove, 'select * from public.approve_pending_member($1)', [id.pendingApprove]);
check('093 a pending applicant cannot approve themselves', !selfApprove.ok, selfApprove.error);
const selfPlace = await place(id.pendingUnplaced, id.pendingUnplaced, cellA, 'self placement');
check('093 a pending applicant cannot place themselves', !selfPlace.ok, selfPlace.error);

// ─── 094: direct writes denied; workflows and self-service still work ───────────────────────────────────────────────
const del = [
  ['admin', id.admin], ['coordinator', id.coordinator], ['service_role', null],
];
for (const [label, uid] of del) {
  const role = label === 'service_role' ? 'service_role' : 'authenticated';
  const r = await attempt(db, role, uid, 'delete from public.profiles where id = $1', [id.inactiveMember]);
  check(`094 ${label} direct profile DELETE is denied`, denied(r), r.error);
}

const statusWrites = [
  ['admin', 'authenticated', id.admin], ['coordinator', 'authenticated', id.coordinator],
  ['member (own status)', 'authenticated', id.memberA], ['service_role', 'service_role', null],
];
for (const [label, role, uid] of statusWrites) {
  const target = label.startsWith('member') ? id.memberA : id.spareTwo;
  const r = await attempt(db, role, uid, "update public.profiles set status = 'inactive' where id = $1", [target]);
  check(`094 ${label} direct status UPDATE is denied`, denied(r), r.error);
}
const cellWrites = [
  ['admin', 'authenticated', id.admin], ['coordinator', 'authenticated', id.coordinator], ['service_role', 'service_role', null],
];
for (const [label, role, uid] of cellWrites) {
  const r = await attempt(db, role, uid, 'update public.profiles set cell_id = $2 where id = $1', [id.spareTwo, cellB]);
  check(`094 ${label} direct cell_id UPDATE is denied`, denied(r), r.error);
}
const pendingCell = await attempt(db, 'service_role', null, 'update public.profiles set cell_id = $2 where id = $1', [id.pendingB, cellA]);
check('094 service_role direct placement of a pending applicant is denied', denied(pendingCell), pendingCell.error);
const bscWrites = [['admin', 'authenticated', id.admin], ['service_role', 'service_role', null]];
for (const [label, role, uid] of bscWrites) {
  const r = await attempt(db, role, uid, 'update public.profiles set bsc_id = $2 where id = $1', [id.spareTwo, bscA]);
  check(`094 ${label} direct bsc_id UPDATE is denied`, denied(r), r.error);
}

const selfName = await attempt(db, 'authenticated', id.memberA, "update public.profiles set full_name = 'Member A edited' where id = $1 returning full_name", [id.memberA]);
check('094 self-service profile edit (full_name) still succeeds', selfName.ok && selfName.rows?.[0]?.full_name === 'Member A edited', selfName.error);
const selfStudent = await attempt(db, 'authenticated', id.memberA, "update public.profiles set student_number = 'S-100' where id = $1 returning id", [id.memberA]);
check('094 self-service student_number edit still succeeds', selfStudent.ok && selfStudent.rows.length === 1, selfStudent.error);

const approve = await attempt(db, 'authenticated', id.admin, 'select * from public.approve_pending_member($1)', [id.pendingApprove]);
check('094 approve_pending_member RPC still succeeds for an admin', approve.ok, approve.error);
const setStatus = await attempt(db, 'authenticated', id.admin, "select * from public.set_member_status($1, 'inactive', 'left the fellowship')", [id.spareTwo]);
check('094 set_member_status RPC still succeeds for an admin', setStatus.ok, setStatus.error);
const bscAssign = await attempt(db, 'authenticated', id.coordinator, 'select * from public.assign_member_to_bsc($1, $2)', [id.bscJoiner, bscA]);
check('094 assign_member_to_bsc RPC still succeeds for a coordinator', bscAssign.ok, bscAssign.error);

// Grants: table-level and column-level, asserted separately. PUBLIC and anon are checked explicitly.
const tg = (await db.query(`
  select
    has_table_privilege('public', 'public.profiles', 'INSERT') as pub_insert,
    has_table_privilege('public', 'public.profiles', 'UPDATE') as pub_update,
    has_table_privilege('public', 'public.profiles', 'DELETE') as pub_delete,
    has_table_privilege('anon', 'public.profiles', 'INSERT') as anon_insert,
    has_table_privilege('anon', 'public.profiles', 'UPDATE') as anon_update,
    has_table_privilege('anon', 'public.profiles', 'DELETE') as anon_delete,
    has_table_privilege('authenticated', 'public.profiles', 'SELECT') as auth_select,
    has_table_privilege('authenticated', 'public.profiles', 'INSERT') as auth_insert,
    has_table_privilege('authenticated', 'public.profiles', 'UPDATE') as auth_update,
    has_table_privilege('authenticated', 'public.profiles', 'DELETE') as auth_delete,
    has_table_privilege('service_role', 'public.profiles', 'SELECT') as svc_select,
    has_table_privilege('service_role', 'public.profiles', 'INSERT') as svc_insert,
    has_table_privilege('service_role', 'public.profiles', 'UPDATE') as svc_update,
    has_table_privilege('service_role', 'public.profiles', 'DELETE') as svc_delete`)).rows[0];
console.log(`        table-level grants on profiles: ${JSON.stringify(tg)}`);
check('094 PUBLIC has no UPDATE or DELETE on profiles (table-level)', tg.pub_update === false && tg.pub_delete === false);
check('094 anon has no INSERT, UPDATE or DELETE on profiles (table-level)', tg.anon_insert === false && tg.anon_update === false && tg.anon_delete === false);
check('094 authenticated has no table-level UPDATE or DELETE on profiles', tg.auth_update === false && tg.auth_delete === false);
check('096 authenticated keeps table-level SELECT only (INSERT removed; reviewed matrix SELECT)', tg.auth_select === true && tg.auth_insert === false);
check('094 service_role has no table-level UPDATE or DELETE on profiles', tg.svc_update === false && tg.svc_delete === false);
check('096 service_role keeps table-level SELECT only (INSERT removed; reviewed matrix SELECT)', tg.svc_select === true && tg.svc_insert === false);

const cg = async (role, col, priv) =>
  (await db.query('select has_column_privilege($1, $2, $3, $4) as v', [role, 'public.profiles', col, priv])).rows[0].v;
for (const col of ['email', 'full_name', 'role', 'admin_role', 'avatar_url', 'joined_at', 'person_id', 'student_number']) {
  check(`094 column UPDATE on profiles.${col} is granted to authenticated (self-service and staff edits)`, (await cg('authenticated', col, 'UPDATE')) === true);
}
for (const col of ['status', 'cell_id', 'bsc_id', 'id']) {
  check(`094 column UPDATE on profiles.${col} is NOT granted to authenticated`, (await cg('authenticated', col, 'UPDATE')) === false);
  check(`094 column UPDATE on profiles.${col} is NOT granted to service_role`, (await cg('service_role', col, 'UPDATE')) === false);
}
check('094 anon has no column UPDATE on profiles.full_name', (await cg('anon', 'full_name', 'UPDATE')) === false);

// ─── 092: contact logging ───────────────────────────────────────────────────────────────────────────────────────────
// The app creates a people row first (createContactPerson), then the contact that points at it.
const insertContact = async (actor, cell, loggedBy, label) => {
  const person = (await db.query('insert into public.people (full_name) values ($1) returning id', [label])).rows[0].id;
  return attempt(db, 'authenticated', actor,
    'insert into public.contacts (contact_name, cell_id, logged_by, person_id) values ($1, $2, $3, $4) returning id', [label, cell, loggedBy, person]);
};
const ownCell = await insertContact(id.memberA, cellA, id.memberA, 'own-cell contact');
check('092 active member logs a contact to their own cell', ownCell.ok, ownCell.error);
const unassigned = await insertContact(id.unassigned, null, id.unassigned, 'unassigned contact');
check('092 active member logs an unassigned contact', unassigned.ok, unassigned.error);
const otherCell = await insertContact(id.memberA, cellB, id.memberA, 'foreign-cell contact');
check('092 active member cannot log a contact to another cell', denied(otherCell), otherCell.error);
const spoof = await insertContact(id.memberA, cellA, id.leaderA, 'spoofed owner');
check('092 contact ownership spoofing (logged_by another member) is denied', denied(spoof), spoof.error);
const pendingContact = await insertContact(id.pendingA, cellA, id.pendingA, 'pending outreach');
check('092 pending applicant cannot insert an outreach contact', denied(pendingContact), pendingContact.error);
const rejectedContact = await insertContact(id.pendingReject, cellA, id.pendingReject, 'rejected outreach');
check('092 rejected applicant cannot insert an outreach contact', denied(rejectedContact), rejectedContact.error);
const inactiveContact = await insertContact(id.inactiveMember, cellA, id.inactiveMember, 'inactive outreach');
check('092 inactive member cannot insert an outreach contact', denied(inactiveContact), inactiveContact.error);

// ─── summary ────────────────────────────────────────────────────────────────────────────────────────────────────────
await asRole(db, 'owner');
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log('FAILED:');
  for (const f of failed) console.log(`  - ${f.name}`);
  process.exit(1);
}
