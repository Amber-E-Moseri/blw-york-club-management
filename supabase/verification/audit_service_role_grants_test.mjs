// Audit-table write-privilege tests (migration 086), run on PGlite.
//
// The four candidate audit tables may be written only by SECURITY DEFINER triggers and RPCs that run as the owner.
// service_role must have no direct privilege on them: no SELECT, INSERT, UPDATE or DELETE. This replays the migrations,
// then checks:
//   1. positive controls: authorised workflows (RPCs and triggers) still write their audit rows, including when the
//      workflow is started by service_role;
//   2. negative controls: service_role cannot insert, update, delete or read any of the four tables, including rows the
//      owner has just written, and those rows are unchanged afterwards.
//
// Set AUDIT_TEST_LAST=085_saved_group_members_active_only.sql to run the same negative checks against the frozen
// sequence before 086 (they must FAIL there, which proves the finding).
//
// Limits: PGlite is not a Supabase stack. This certifies the SQL grants and definer paths, not the Auth or PostgREST layer.
//
// Usage:
//   PGLITE_MODULE=file:///path/to/node_modules/@electric-sql/pglite/dist/index.js \
//     node supabase/verification/audit_service_role_grants_test.mjs

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openReplay, attempt } from './pglite_replay.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.join(here, '..', 'migrations');
const LAST = process.env.AUDIT_TEST_LAST ?? '086_audit_tables_no_service_access.sql';

const results = [];
const check = (name, ok, evidence = '') => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${evidence ? `  [${String(evidence).slice(0, 140)}]` : ''}`);
};
const denied = (r) => !r.ok && r.code === '42501';

const { db, applied } = await openReplay(MIGRATIONS, { lastFile: LAST });
console.log(`replayed ${applied.length} migrations through ${applied[applied.length - 1]}`);

// ─── fixtures (owner bypasses RLS) ──────────────────────────────────────────
const people = {
  admin: ['admin', 'active'],
  member: ['member', 'active'],     // placed into cell A, then moved to cell B by the RPC
  deactivate: ['member', 'active'], // deactivated by an admin
  leader: ['member', 'active'],     // leads a BSC; deactivation releases the leadership
  trigger: ['member', 'active'],    // moved by service_role, which fires the definer trigger
};
const ids = {};
for (const label of Object.keys(people)) ids[label] = crypto.randomUUID();
for (const [label, [role, status]] of Object.entries(people)) {
  await db.query('insert into auth.users (id, email, aud, role, created_at) values ($1, $2, $3, $4, now())',
    [ids[label], `${label}@test.example`, 'authenticated', 'authenticated']);
  await db.query('update public.profiles set full_name = $2, role = $3, status = $4 where id = $1',
    [ids[label], label, role, status]);
}
const cellA = crypto.randomUUID();
const cellB = crypto.randomUUID();
await db.query("insert into public.cells (id, name) values ($1, 'Cell A'), ($2, 'Cell B')", [cellA, cellB]);
// Place members first: a BSC leader must already be an active member of the BSC's cell (guard_bsc_leader_eligibility).
await db.query('update public.profiles set cell_id = $2 where id = any($1::uuid[])',
  [[ids.member, ids.deactivate, ids.leader, ids.trigger], cellA]);
const bsc = crypto.randomUUID();
await db.query('insert into public.bscs (id, cell_id, name, leader_id) values ($1, $2, $3, $4)',
  [bsc, cellA, 'BSC 1', ids.leader]);

const count = async (sql, params = []) => Number((await db.query(sql, params)).rows[0].n);

// ─── 1. positive controls: authorised workflows still write their audit rows ─────────────────────────────────────────
const adminCtx = ['authenticated', ids.admin];

const memberCellBefore = await count('select count(*)::int n from public.member_cell_audit where member_id = $1', [ids.member]);
const transfer = await attempt(db, ...adminCtx, 'select * from public.transfer_member_cell($1, $2)', [ids.member, cellB]);
const memberCellRow = await db.query(
  'select from_cell_id, to_cell_id, actor_id from public.member_cell_audit where member_id = $1 order by id desc limit 1',
  [ids.member]);
check('admin transfer via RPC writes one member_cell_audit row with the actor',
  transfer.ok && (await count('select count(*)::int n from public.member_cell_audit where member_id = $1', [ids.member])) === memberCellBefore + 1
    && memberCellRow.rows[0]?.actor_id === ids.admin && memberCellRow.rows[0]?.to_cell_id === cellB, transfer.error);

const statusBefore = await count('select count(*)::int n from public.member_status_audit where member_id = $1', [ids.deactivate]);
const deactivate = await attempt(db, ...adminCtx, "select * from public.set_member_status($1, 'inactive', 'left the fellowship')", [ids.deactivate]);
check('admin status change via set_member_status writes one member_status_audit row',
  deactivate.ok && (await count('select count(*)::int n from public.member_status_audit where member_id = $1', [ids.deactivate])) === statusBefore + 1, deactivate.error);

const releaseBefore = await count('select count(*)::int n from public.leadership_release_audit where profile_id = $1', [ids.leader]);
const release = await attempt(db, ...adminCtx, "select * from public.set_member_status($1, 'inactive', 'stepped away')", [ids.leader]);
const leaderAfter = await db.query('select leader_id from public.bscs where id = $1', [bsc]);
check('deactivating a BSC leader writes one leadership_release_audit row and clears the leader',
  release.ok && leaderAfter.rows[0].leader_id === null
    && (await count('select count(*)::int n from public.leadership_release_audit where profile_id = $1', [ids.leader])) === releaseBefore + 1, release.error);

const cellBefore = await count('select count(*)::int n from public.cell_admin_audit where cell_id = $1', [cellB]);
const rename = await attempt(db, ...adminCtx, "update public.cells set name = 'Cell B renamed' where id = $1", [cellB]);
check('admin cell rename writes one cell_admin_audit row',
  rename.ok && (await count('select count(*)::int n from public.cell_admin_audit where cell_id = $1', [cellB])) === cellBefore + 1, rename.error);

// service_role starts the workflow; the definer trigger still writes the audit row.
const triggerBefore = await count('select count(*)::int n from public.member_cell_audit where member_id = $1', [ids.trigger]);
const svcPlacement = await attempt(db, 'service_role', null, 'update public.profiles set cell_id = $2 where id = $1', [ids.trigger, cellB]);
check('service_role placement still writes member_cell_audit through the definer trigger',
  svcPlacement.ok && (await count('select count(*)::int n from public.member_cell_audit where member_id = $1', [ids.trigger])) === triggerBefore + 1, svcPlacement.error);

// ─── 2. negative controls: service_role has no direct privilege on the four audit tables ─────────────────────────────
// Seed one existing row per table as owner, then let service_role try to tamper with it.
const seed = {
  cell_admin_audit: { sql: "insert into public.cell_admin_audit (cell_id, action, actor_id) values ($1, 'update', $2)", params: [cellA, ids.admin], key: 'cell_id', val: cellA },
  member_cell_audit: { sql: 'insert into public.member_cell_audit (member_id, from_cell_id, to_cell_id, actor_id) values ($1, $2, $3, $4)', params: [ids.member, cellA, cellB, ids.admin], key: 'member_id', val: ids.member },
  member_status_audit: { sql: "insert into public.member_status_audit (member_id, from_status, to_status, reason, actor_id) values ($1, 'active', 'inactive', 'seeded', $2)", params: [ids.deactivate, ids.admin], key: 'member_id', val: ids.deactivate },
  leadership_release_audit: { sql: "insert into public.leadership_release_audit (profile_id, target_type, target_id, actor_id) values ($1, 'bsc', $2, $3)", params: [ids.leader, bsc, ids.admin], key: 'profile_id', val: ids.leader },
};
for (const [table, s] of Object.entries(seed)) {
  await db.query(s.sql, s.params);
}
const snapshot = async () => {
  const out = {};
  for (const [table, s] of Object.entries(seed)) {
    out[table] = await count(`select count(*)::int n from public.${table} where ${s.key} = $1`, [s.val]);
  }
  return out;
};
const before = await snapshot();

for (const [table, s] of Object.entries(seed)) {
  const ins = await attempt(db, 'service_role', null, s.sql, s.params);
  check(`service_role cannot INSERT into ${table}`, denied(ins), ins.ok ? 'statement succeeded' : `${ins.code} ${ins.error}`);

  const upd = await attempt(db, 'service_role', null, `update public.${table} set ${s.key} = ${s.key} where ${s.key} = $1`, [s.val]);
  check(`service_role cannot UPDATE ${table}`, denied(upd), upd.ok ? 'statement succeeded' : `${upd.code} ${upd.error}`);

  const del = await attempt(db, 'service_role', null, `delete from public.${table} where ${s.key} = $1`, [s.val]);
  check(`service_role cannot DELETE from ${table}`, denied(del), del.ok ? 'statement succeeded' : `${del.code} ${del.error}`);

  const sel = await attempt(db, 'service_role', null, `select count(*) from public.${table}`);
  check(`service_role cannot SELECT ${table}`, denied(sel), sel.ok ? 'statement succeeded' : `${sel.code} ${sel.error}`);
}

const after = await snapshot();
const unchanged = JSON.stringify(before) === JSON.stringify(after);
check('the seeded audit rows are unchanged after every service_role attempt', unchanged, `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);

// ─── summary ─────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log('FAILED:');
  for (const f of failed) console.log(`  - ${f.name}`);
  process.exit(1);
}
