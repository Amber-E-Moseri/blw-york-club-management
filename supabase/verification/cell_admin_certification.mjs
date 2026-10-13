// Cell administration certification (migrations 074 and the cell and BSC rules it relies on).
//
// Runs in an isolated, in-process PGlite database built from the real migration files. Each check runs as the role a
// real client would use. The owner context is used only for fixtures and for reading audit rows.
//
// Usage:
//   PGLITE_MODULE=file:///.../node_modules/@electric-sql/pglite/dist/index.js \
//     node supabase/verification/cell_admin_certification.mjs [migrationsDir]
//
// Exits non-zero on any FAIL.

import path from 'path';
import { fileURLToPath } from 'url';
import { openReplay, attempt } from './pglite_replay.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = process.argv[2] ?? path.join(here, '..', 'migrations');

const results = [];
const record = (area, name, ok, evidence = '') => {
  results.push({ area, name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${area.padEnd(12)} ${name}${evidence ? `  [${evidence}]` : ''}`);
};
const denied = (area, name, r, pattern = null) => {
  const ok = !r.ok && (pattern === null || r.error.includes(pattern));
  record(area, name, ok, r.ok ? 'statement succeeded' : r.error.slice(0, 110));
};
const allowed = (area, name, r, evidence = '') => record(area, name, r.ok, r.ok ? evidence : r.error.slice(0, 110));

const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ADMIN = uid(1), COORD = uid(2), LEAD = uid(3), M1 = uid(4), M2 = uid(5), PEND = uid(6), REJ = uid(7), NEW = uid(8);
const CA = uid(21), CB = uid(22), CC = uid(23);
const BSC1 = uid(31), BSC2 = uid(32);
const MISSING = uid(99);

const count = async (db, sql, params = []) => Number((await db.query(sql, params)).rows[0].n);

async function main() {
  const { db, applied } = await openReplay(migrationsDir);
  console.log(`replayed ${applied.length} migrations; last ${applied.at(-1)}\n`);

  // ─── Fixtures (owner) ───────────────────────────────────────────────────────
  const people = [
    [ADMIN, 'admin', 'admin'], [COORD, 'coordinator', 'coordinator'], [LEAD, 'leader', 'cell_leader'],
    [M1, 'm1', 'member'], [M2, 'm2', 'member'], [PEND, 'pend', 'member'], [REJ, 'rej', 'member'], [NEW, 'new', 'member'],
  ];
  await db.exec(`
    insert into auth.users (id, email, encrypted_password, aud, role, created_at, updated_at)
    select v.id::uuid, v.tag || '@cell.invalid', 'x', 'authenticated', 'authenticated', now(), now()
    from (values ${people.map(([id, tag]) => `('${id}','${tag}')`).join(',')}) v(id, tag);
    update public.profiles set status = 'active', role = 'member' where id in (${people.map(([id]) => `'${id}'`).join(',')});
    update public.profiles set role = 'admin' where id = '${ADMIN}';
    update public.profiles set role = 'coordinator' where id = '${COORD}';
    update public.profiles set role = 'cell_leader' where id = '${LEAD}';
    insert into public.cells (id, name, leader_id) values ('${CA}', 'Cell A', '${LEAD}'), ('${CB}', 'Cell B', null);
    update public.profiles set cell_id = '${CA}' where id in ('${LEAD}', '${M1}', '${M2}');
    insert into public.bscs (id, cell_id, name) values ('${BSC1}', '${CA}', 'Thursday BSC'), ('${BSC2}', '${CB}', 'Sunday BSC');
    update public.profiles set bsc_id = '${BSC1}' where id = '${M2}';
    update public.profiles set status = 'pending' where id = '${PEND}';
    update public.profiles set status = 'rejected' where id = '${REJ}';
  `);

  // ─── 1. Cell creation by admin and coordinator; members cannot create ─────────────────────────────────────────────
  const CADM = uid(41), CCOORD = uid(42);
  allowed('create', 'admin creates a cell',
    await attempt(db, 'authenticated', ADMIN, `insert into public.cells (id, name) values ($1, 'Admin Cell') returning id`, [CADM]));
  allowed('create', 'coordinator creates a cell',
    await attempt(db, 'authenticated', COORD, `insert into public.cells (id, name) values ($1, 'Coord Cell') returning id`, [CCOORD]));
  denied('create', 'member cannot create a cell',
    await attempt(db, 'authenticated', M1, `insert into public.cells (id, name) values ($1, 'Member Cell') returning id`, [uid(43)]));

  // ─── 2. Transfer across cells, with an audit row ───────────────────────────────────────────────────────────────────
  const t1 = await attempt(db, 'authenticated', COORD, `select * from public.transfer_member_cell($1, $2)`, [M1, CB]);
  allowed('transfer', 'coordinator transfers a member A → B', t1);
  const auditTransfer = await count(db,
    `select count(*) n from public.member_cell_audit where member_id=$1 and from_cell_id=$2 and to_cell_id=$3 and actor_id=$4`,
    [M1, CA, CB, COORD]);
  record('audit', 'transfer writes a member_cell_audit row with the actor', auditTransfer === 1, `rows=${auditTransfer}`);

  // ─── 3. BSC conflict blocks the transfer ───────────────────────────────────────────────────────────────────────────
  denied('bsc', 'transfer is blocked for a member in a Bible Study Class',
    await attempt(db, 'authenticated', COORD, `select * from public.transfer_member_cell($1, $2)`, [M2, CB]), 'Bible Study Class');
  const m2Still = await count(db, `select count(*) n from public.profiles where id=$1 and cell_id=$2`, [M2, CA]);
  record('bsc', 'a blocked BSC transfer leaves the member in their cell', m2Still === 1);

  // ─── 4. Leader reassignment requirement: a leader cannot be moved out of the cell they lead ───────────────────────
  denied('leader', 'a cell leader cannot be moved until a new leader is assigned',
    await attempt(db, 'authenticated', COORD, `select * from public.transfer_member_cell($1, $2)`, [LEAD, CB]), 'leads');

  // ─── 5. Removal from cell ──────────────────────────────────────────────────────────────────────────────────────────
  allowed('removal', 'coordinator removes a member from their cell',
    await attempt(db, 'authenticated', COORD, `select * from public.transfer_member_cell($1, null)`, [M1]));
  const removalAudit = await count(db,
    `select count(*) n from public.member_cell_audit where member_id=$1 and from_cell_id=$2 and to_cell_id is null`, [M1, CB]);
  record('audit', 'removal writes a member_cell_audit row with a null target', removalAudit === 1, `rows=${removalAudit}`);

  // ─── 6. Zero-row and unauthorized writes do not report success ─────────────────────────────────────────────────────
  denied('zero-row', 'transfer of a missing member is refused, not reported as saved',
    await attempt(db, 'authenticated', COORD, `select * from public.transfer_member_cell($1, $2)`, [MISSING, CB]), 'Member not found');
  const direct = await attempt(db, 'authenticated', M2, `update public.profiles set cell_id = $1 where id = $2 returning id`, [CCOORD, M2]);
  const directLanded = direct.ok && direct.rows.length > 0;
  record('direct', 'member cannot move another member with a direct profile update', !directLanded,
    direct.ok ? `returned ${direct.rows.length} rows` : direct.error.slice(0, 90));
  const m2Cell = await count(db, `select count(*) n from public.profiles where id=$1 and cell_id=$2`, [M2, CA]);
  record('direct', 'the refused direct update leaves the cell unchanged', m2Cell === 1);
  denied('pending', 'a pending member cannot be placed in a cell',
    await attempt(db, 'authenticated', COORD, `select * from public.transfer_member_cell($1, $2)`, [PEND, CB]), 'Only active members');
  denied('pending', 'a rejected member cannot be placed in a cell',
    await attempt(db, 'authenticated', COORD, `select * from public.transfer_member_cell($1, $2)`, [REJ, CB]), 'Only active members');

  // ─── 7. Archive and restore ───────────────────────────────────────────────────────────────────────────────────────
  denied('archive', 'a cell with members cannot be archived',
    await attempt(db, 'authenticated', COORD, `update public.cells set archived_at = now() where id = $1`, [CA]), 'Move or remove');
  allowed('archive', 'an empty cell is archived by a coordinator',
    await attempt(db, 'authenticated', COORD, `update public.cells set archived_at = now() where id = $1 returning id`, [CCOORD]));
  denied('archive', 'an archived cell takes no new members',
    await attempt(db, 'authenticated', COORD, `select * from public.transfer_member_cell($1, $2)`, [NEW, CCOORD]), 'archived');
  allowed('archive', 'an archived cell is restored',
    await attempt(db, 'authenticated', COORD, `update public.cells set archived_at = null where id = $1 returning id`, [CCOORD]));
  const cellAudit = await count(db, `select count(*) n from public.cell_admin_audit where cell_id=$1`, [CCOORD]);
  record('audit', 'cell creation, archive and restore are audited', cellAudit >= 3, `rows=${cellAudit}`);

  // ─── 8. Deletion of a populated cell is refused ───────────────────────────────────────────────────────────────────
  denied('delete', 'a cell with members cannot be deleted',
    await attempt(db, 'authenticated', ADMIN, `delete from public.cells where id = $1`, [CA]), 'cannot be deleted');

  // ─── 9. Leadership is recalculated from cells.leader_id when a leader becomes inactive ────────────────────────────
  // Profile updates of other people are permitted to coordinators only (RLS, migration 022). An admin's direct status
  // change therefore matches no row. That is recorded here as a finding: the write must not look successful.
  // A direct status write is refused for every role since migration 089 (status changes only through the workflow RPC).
  // The admin's attempt must not succeed, whether it raises or matches no row.
  const adminDeact = await attempt(db, 'authenticated', ADMIN, `update public.profiles set status = 'inactive' where id = $1 returning id`, [LEAD]);
  record('finding', 'admin direct status change is refused (089: status only through the workflow)',
    !adminDeact.ok || adminDeact.rows.length === 0, adminDeact.ok ? `rows=${adminDeact.rows.length}` : adminDeact.error.slice(0, 90));
  // Deactivation goes through the approved workflow, set_member_status, as a coordinator. The release triggers are unchanged.
  const deact = await attempt(db, 'authenticated', COORD, `select * from public.set_member_status($1, 'inactive', 'cell admin certification')`, [LEAD]);
  record('deactivate', 'coordinator sets the leader to inactive via set_member_status (one row saved)', deact.ok && deact.rows.length === 1,
    deact.ok ? `rows=${deact.rows.length}` : deact.error.slice(0, 110));
  const caLeader = await count(db, `select count(*) n from public.cells where id=$1 and leader_id is null`, [CA]);
  record('deactivate', 'the cell loses its leader (cells.leader_id cleared)', caLeader === 1);
  const leadPlacement = await count(db, `select count(*) n from public.profiles where id=$1 and cell_id=$2`, [LEAD, CA]);
  record('deactivate', 'the former leader keeps their historical cell placement', leadPlacement === 1);
  const deactAudit = await count(db,
    `select count(*) n from public.cell_admin_audit where cell_id=$1 and action='update' and before_values->>'leader_id' = $2`,
    [CA, LEAD]);
  record('audit', 'the leader release is audited with the before value', deactAudit === 1, `rows=${deactAudit}`);
  const leadAuth = await attempt(db, 'authenticated', LEAD, `select public.is_cell_leader_of($1) as v`, [CA]);
  record('deactivate', 'the former leader no longer has cell leadership', leadAuth.ok && leadAuth.rows[0].v === false,
    leadAuth.ok ? `is_cell_leader_of=${leadAuth.rows[0].v}` : leadAuth.error.slice(0, 80));

  // ─── 10. BSC leadership is released when its leader becomes inactive ──────────────────────────────────────────────
  // A BSC leader must be an active member of the BSC's cell (migration 040 guard), so place M1 in that cell first.
  await db.exec(`update public.profiles set cell_id = '${CB}' where id = '${M1}'; update public.bscs set leader_id = '${M1}' where id = '${BSC2}';`);
  const bscDeact = await attempt(db, 'authenticated', COORD, `select * from public.set_member_status($1, 'inactive', 'bsc release certification')`, [M1]);
  record('deactivate', 'coordinator sets a BSC leader to inactive via set_member_status (one row saved)', bscDeact.ok && bscDeact.rows.length === 1,
    bscDeact.ok ? `rows=${bscDeact.rows.length}` : bscDeact.error.slice(0, 110));
  const bscCleared = await count(db, `select count(*) n from public.bscs where id=$1 and leader_id is null`, [BSC2]);
  record('deactivate', 'the BSC leader is cleared on the row', bscCleared === 1);
  const bscRelease = await count(db,
    `select count(*) n from public.leadership_release_audit where profile_id=$1 and target_id=$2`, [M1, BSC2]);
  record('audit', 'the BSC leadership release is recorded', bscRelease === 1, `rows=${bscRelease}`);

  // ─── 11. Reassignment: only an active account can lead a cell ─────────────────────────────────────────────────────
  denied('reassign', 'an inactive account cannot be assigned as leader',
    await attempt(db, 'authenticated', ADMIN, `update public.cells set leader_id = $1 where id = $2`, [LEAD, CA]), 'active');
  denied('reassign', 'a pending account cannot be assigned as leader',
    await attempt(db, 'authenticated', ADMIN, `update public.cells set leader_id = $1 where id = $2`, [PEND, CA]), 'active');
  allowed('reassign', 'an active member is assigned as leader',
    await attempt(db, 'authenticated', ADMIN, `update public.cells set leader_id = $1 where id = $2 returning id`, [M2, CA]));
  const newAuth = await attempt(db, 'authenticated', M2, `select public.is_cell_leader_of($1) as v`, [CA]);
  record('reassign', 'the new leader is authorized by cells.leader_id', newAuth.ok && newAuth.rows[0].v === true);

  // ─── Summary ──────────────────────────────────────────────────────────────────────────────────────────────────────
  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;
  console.log(`\nCELL CERTIFICATION: PASS ${pass}  FAIL ${fail}  total ${results.length}`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('CERTIFICATION ABORTED:', e.message);
  process.exit(2);
});
