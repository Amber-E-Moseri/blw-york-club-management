// Authorization regression tests for remediation Wave 1 (migrations 043 and 044), run on PGlite.
//
// Replays the real migration chain (000 .. 044) and checks the behaviour that the certification defects depend on:
//   * get_ror_streak (043): a caller may read a streak only when they are the member (active), an active devotional
//     admin, or an active cell leader of an active member in their cell.
//   * bscs_read and the BSC helpers (044): only active accounts read BSC rows or pass BSC helper checks.
//   * profiles (022, 028): a pending account cannot change its own status, role or cell; a rejected account cannot edit.
//
// Limits: PGlite is not a Supabase stack. This certifies the SQL, RLS and SECURITY DEFINER behaviour, not PostgREST or
// GoTrue. It does not replace the Docker/hosted certification harnesses.
//
// Usage (PGlite must be installed outside the repo; this repo does not add it as a dependency):
//   PGLITE_MODULE=file:///<path>/node_modules/@electric-sql/pglite/dist/index.js node supabase/verification/remediation_wave1_authz_pglite.mjs

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openReplay, attempt } from './pglite_replay.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.join(here, '..', 'migrations');

const ids = {
  coordinator: '50000000-0000-4000-8000-000000000001',
  leaderA: '50000000-0000-4000-8000-000000000002',
  memberA: '50000000-0000-4000-8000-000000000003',
  strangerActive: '50000000-0000-4000-8000-000000000004',
  memberPending: '50000000-0000-4000-8000-000000000005',
  memberRejected: '50000000-0000-4000-8000-000000000006',
  leaderPending: '50000000-0000-4000-8000-000000000007',
  memberB: '50000000-0000-4000-8000-000000000008',
};
const cellA = '51000000-0000-4000-8000-000000000001';
const cellB = '51000000-0000-4000-8000-000000000002';
const bscA = '52000000-0000-4000-8000-000000000001';

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
}

const today = '2026-11-26';
const monthYear = '2026-11';

async function fixture(db) {
  // Owner session: bypasses RLS, as a migration or seed run would.
  for (const [label, id] of Object.entries(ids)) {
    await db.query(
      "insert into auth.users (id, email, aud, role, created_at, email_confirmed_at) values ($1, $2, 'authenticated', 'authenticated', now(), now())",
      [id, `${label.toLowerCase()}@example.test`],
    );
  }
  await db.query(
    `insert into public.cells (id, name) values ($1, 'AuthzCellA'), ($2, 'AuthzCellB')`,
    [cellA, cellB],
  );
  // The auth.users insert fires the signup trigger, which creates the profile row. Set the fixture values on that row.
  const profile = (id, name, role, status, cell, bsc = null) =>
    db.query(
      'update public.profiles set full_name = $2, role = $3, status = $4, cell_id = $5, bsc_id = $6 where id = $1',
      [id, name, role, status, cell, bsc],
    );
  // bscs before profiles, because profiles.bsc_id references bscs. The leader is set once the profiles exist.
  await db.query(`insert into public.bscs (id, name, cell_id) values ($1, 'AuthzBSC', $2)`, [bscA, cellA]);
  await profile(ids.coordinator, 'Coordinator', 'coordinator', 'active', null);
  await profile(ids.leaderA, 'Leader A', 'cell_leader', 'active', cellA);
  await profile(ids.memberA, 'Member A', 'member', 'active', cellA, bscA);
  await profile(ids.strangerActive, 'Stranger', 'member', 'active', null);
  await profile(ids.memberPending, 'Pending Member', 'member', 'pending', cellA);
  await profile(ids.memberRejected, 'Rejected Member', 'member', 'rejected', null);
  await profile(ids.leaderPending, 'Pending Leader', 'cell_leader', 'pending', cellB);
  await profile(ids.memberB, 'Member B', 'member', 'active', cellB);
  await db.query('update public.cells set leader_id = $1 where id = $2', [ids.leaderA, cellA]);
  await db.query('update public.cells set leader_id = $1 where id = $2', [ids.leaderPending, cellB]);
  await db.query('update public.bscs set leader_id = $1 where id = $2', [ids.leaderA, bscA]);
}

async function streakRows(db, caller, member) {
  const r = await attempt(
    db,
    'authenticated',
    caller,
    'select * from public.get_ror_streak($1, $2, $3)',
    [member, today, monthYear],
  );
  if (!r.ok) return { error: r.error };
  return { rows: r.rows.length };
}

async function run() {
  const { db } = await openReplay(MIGRATIONS, { lastFile: process.env.REPLAY_LAST ?? null });
  await fixture(db);

  // ── get_ror_streak (043) ──────────────────────────────────────────────────
  const s = (caller, member) => streakRows(db, caller, member);

  const own = await s(ids.memberA, ids.memberA);
  check('ror: member reads own streak (active) -> 1 row', own.rows === 1, JSON.stringify(own));

  const coord = await s(ids.coordinator, ids.memberA);
  check('ror: active coordinator reads any member -> 1 row', coord.rows === 1, JSON.stringify(coord));

  const leader = await s(ids.leaderA, ids.memberA);
  check('ror: active cell leader reads in-cell member -> 1 row', leader.rows === 1, JSON.stringify(leader));

  const stranger = await s(ids.strangerActive, ids.memberA);
  check('ror: active stranger reads another member -> 0 rows (fix)', stranger.rows === 0, JSON.stringify(stranger));

  const outOfCell = await s(ids.leaderA, ids.memberB);
  check('ror: leader reads out-of-cell member -> 0 rows', outOfCell.rows === 0, JSON.stringify(outOfCell));

  const pendingSelf = await s(ids.memberPending, ids.memberPending);
  check('ror: pending member reads own streak -> 0 rows', pendingSelf.rows === 0, JSON.stringify(pendingSelf));

  const pendingLeader = await s(ids.leaderPending, ids.memberB);
  check('ror: pending leader reads cell member -> 0 rows', pendingLeader.rows === 0, JSON.stringify(pendingLeader));

  const inactiveMemberTarget = await s(ids.leaderA, ids.memberPending);
  check('ror: active leader reads inactive in-cell member -> 0 rows', inactiveMemberTarget.rows === 0, JSON.stringify(inactiveMemberTarget));

  // ── BSC (044) ─────────────────────────────────────────────────────────────
  const bscRead = async (caller) => {
    const r = await attempt(db, 'authenticated', caller, 'select id from public.bscs');
    return r.ok ? { rows: r.rows.length } : { error: r.error };
  };

  const activeRead = await bscRead(ids.strangerActive);
  check('bsc: active account reads BSC list -> 1 row', activeRead.rows === 1, JSON.stringify(activeRead));

  const pendingRead = await bscRead(ids.memberPending);
  check('bsc: pending account reads BSC list -> 0 rows (fix)', pendingRead.rows === 0, JSON.stringify(pendingRead));

  const rejectedRead = await bscRead(ids.memberRejected);
  check('bsc: rejected account reads BSC list -> 0 rows (fix)', rejectedRead.rows === 0, JSON.stringify(rejectedRead));

  const helperPendingLeader = await attempt(
    db,
    'authenticated',
    ids.leaderPending,
    'select public.is_bsc_leader_for_logger($1) as v',
    [ids.memberA],
  );
  check(
    'bsc: helper denies a pending caller',
    helperPendingLeader.ok && helperPendingLeader.rows[0].v === false,
    JSON.stringify(helperPendingLeader),
  );

  const helperActiveLeader = await attempt(
    db,
    'authenticated',
    ids.leaderA,
    'select public.is_bsc_leader_for_logger($1) as v',
    [ids.memberA],
  );
  check(
    'bsc: helper grants the active BSC leader for a BSC member',
    helperActiveLeader.ok && helperActiveLeader.rows[0].v === true,
    JSON.stringify(helperActiveLeader),
  );

  const pendingSetsBsc = await attempt(
    db,
    'authenticated',
    ids.memberPending,
    'update public.profiles set bsc_id = $1 where id = $2',
    [bscA, ids.memberPending],
  );
  const pendingBscAfter = await db.query('select bsc_id from public.profiles where id = $1', [ids.memberPending]);
  check(
    'bsc: pending account cannot assign itself to a BSC',
    pendingBscAfter.rows[0].bsc_id === null,
    `update ok=${pendingSetsBsc.ok} code=${pendingSetsBsc.code ?? ''} bsc_id=${pendingBscAfter.rows[0].bsc_id}`,
  );

  // ── Pending account self-edits (022 guard, 028 onboarding policy) ─────────
  // A pending account may edit ordinary fields on its own row (028 policy). The guard blocks status, role, cell_id,
  // admin_role, joined_at, person_id and email. Each negative check reads the row back as owner. The positive control
  // shows the update path is open, so the negative checks are not passing only because every write is rejected.
  const readProfile = async (id) =>
    (await db.query('select full_name, status, role, cell_id from public.profiles where id = $1', [id])).rows[0];

  const beforePending = await readProfile(ids.memberPending);

  const pendingSetsCell = await attempt(
    db,
    'authenticated',
    ids.memberPending,
    'update public.profiles set cell_id = $1 where id = $2',
    [cellB, ids.memberPending],
  );
  const afterPendingCell = await readProfile(ids.memberPending);
  check(
    'profiles: pending account cannot move itself to another cell',
    afterPendingCell.cell_id === beforePending.cell_id,
    `ok=${pendingSetsCell.ok} code=${pendingSetsCell.code ?? ''} cell_id=${afterPendingCell.cell_id}`,
  );

  const pendingApprovesSelf = await attempt(
    db,
    'authenticated',
    ids.memberPending,
    "update public.profiles set status = 'active' where id = $1",
    [ids.memberPending],
  );
  const afterPendingStatus = await readProfile(ids.memberPending);
  check(
    'profiles: pending account cannot approve itself (status)',
    afterPendingStatus.status === 'pending',
    `ok=${pendingApprovesSelf.ok} code=${pendingApprovesSelf.code ?? ''} status=${afterPendingStatus.status}`,
  );

  const pendingPromotesSelf = await attempt(
    db,
    'authenticated',
    ids.memberPending,
    "update public.profiles set role = 'coordinator' where id = $1",
    [ids.memberPending],
  );
  const afterPendingRole = await readProfile(ids.memberPending);
  check(
    'profiles: pending account cannot change its own role',
    afterPendingRole.role === beforePending.role,
    `ok=${pendingPromotesSelf.ok} code=${pendingPromotesSelf.code ?? ''} role=${afterPendingRole.role}`,
  );

  const pendingEditsName = await attempt(
    db,
    'authenticated',
    ids.memberPending,
    'update public.profiles set full_name = $1 where id = $2',
    ['Pending Member (edited)', ids.memberPending],
  );
  const afterPendingName = await readProfile(ids.memberPending);
  check(
    'profiles: pending account can still edit its own ordinary fields (positive control)',
    pendingEditsName.ok && afterPendingName.full_name === 'Pending Member (edited)',
    `ok=${pendingEditsName.ok} code=${pendingEditsName.code ?? ''} full_name=${afterPendingName.full_name}`,
  );

  const beforeRejected = await readProfile(ids.memberRejected);
  await attempt(
    db,
    'authenticated',
    ids.memberRejected,
    'update public.profiles set full_name = $1 where id = $2',
    ['Rejected Member (edited)', ids.memberRejected],
  );
  const afterRejected = await readProfile(ids.memberRejected);
  check(
    'profiles: rejected account cannot edit its own profile',
    afterRejected.full_name === beforeRejected.full_name,
    `full_name=${afterRejected.full_name}`,
  );

  const failed = results.filter((r) => !r.pass);
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : `  ${r.detail}`}`);
  }
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed, ${results.length} total`);
  process.exitCode = failed.length === 0 ? 0 : 1;
}

run().catch((err) => {
  console.error('ERROR', err);
  process.exitCode = 2;
});
