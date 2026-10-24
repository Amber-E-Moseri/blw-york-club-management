// Regression tests for the submit_contact cell-scope defect (migration 106), run on PGlite.
//
// The defect: _f2_submit_contact_row (097) compared p_cell_id = v_actor_cell, which is NULL for an account with no assigned
// cell, so the scope check never refused an unassigned caller. The fix (106) guards that comparison.
//
// This file replays the chain twice:
//   BEFORE  through 105: the defect is reproduced. Recorded for the report; it does not gate the result.
//   AFTER   through 106: every required case must hold. These checks gate the result.
//
// Limits: PGlite is not a Supabase stack. This certifies the SQL and SECURITY DEFINER path, not PostgREST or GoTrue.
//
// Usage:
//   PGLITE_MODULE=file:///path/to/node_modules/@electric-sql/pglite/dist/index.js \
//     node supabase/verification/submit_contact_cell_scope_pglite_test.mjs

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openReplay, attempt } from './pglite_replay.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.join(here, '..', 'migrations');

const ids = {
  admin: '40000000-0000-4000-8000-000000000001',
  coordinator: '40000000-0000-4000-8000-000000000002',
  leaderA: '40000000-0000-4000-8000-000000000003',
  leaderB: '40000000-0000-4000-8000-000000000004',
  leaderUnassigned: '40000000-0000-4000-8000-000000000005',
  memberA: '40000000-0000-4000-8000-000000000006',
  memberUnassigned: '40000000-0000-4000-8000-000000000007',
};

// Creates the fixture on one replayed database. The owner session bypasses RLS and the privilege layer, as in a real replay.
async function fixture(db) {
  for (const [label, id] of Object.entries(ids)) {
    await db.query(
      "insert into auth.users (id, email, aud, role, created_at, email_confirmed_at) values ($1, $2, 'authenticated', 'authenticated', now(), now())",
      [id, `${label.toLowerCase()}@example.test`],
    );
  }
  const setProfile = (id, role, status) =>
    db.query('update public.profiles set role = $2, status = $3 where id = $1', [id, role, status]);
  await setProfile(ids.admin, 'admin', 'active');
  await setProfile(ids.coordinator, 'coordinator', 'active');
  await setProfile(ids.leaderA, 'cell_leader', 'active');
  await setProfile(ids.leaderB, 'cell_leader', 'active');
  await setProfile(ids.leaderUnassigned, 'cell_leader', 'active');
  await setProfile(ids.memberA, 'member', 'active');
  await setProfile(ids.memberUnassigned, 'member', 'active');

  const cellA = (await db.query("insert into public.cells (name, leader_id) values ('Scope A', $1) returning id", [ids.leaderA])).rows[0].id;
  const cellB = (await db.query("insert into public.cells (name, leader_id) values ('Scope B', $1) returning id", [ids.leaderB])).rows[0].id;
  // A cell change is audited and needs its own reason (migration 093). Each assigned profile states one.
  await db.query("select set_config('app.cell_change_reason', 'scope fixture setup', false)");
  await db.query('update public.profiles set cell_id = $2 where id = $1', [ids.leaderA, cellA]);
  await db.query("select set_config('app.cell_change_reason', 'scope fixture setup', false)");
  await db.query('update public.profiles set cell_id = $2 where id = $1', [ids.memberA, cellA]);
  return { cellA, cellB, unknownCell: '40000000-0000-4000-8000-0000000000ff' };
}

let seq = 0;
// One submit_contact call as the given caller. Returns { accepted, code, error }.
async function submit(db, callerId, cellId, label) {
  seq += 1;
  const r = await attempt(
    db, 'authenticated', callerId,
    'select * from public.submit_contact($1, $2, null, $3, false, null, null, null, null, $4, false, $5)',
    [`Scope ${label}`, cellId, `scope.${seq}.${label.replace(/\W+/g, '.').toLowerCase()}@example.test`, '2026-10-24', `scope-${seq}-${label}`],
  );
  return { accepted: r.ok, code: r.code ?? null, error: r.error ?? null };
}

// Every required case. `expect` is 'ALLOWED' or 'DENIED'. A DENIED case must fail with SQLSTATE 42501.
function cases(f) {
  return [
    ['unassigned member -> foreign cell', ids.memberUnassigned, f.cellA, 'DENIED'],
    ['unassigned leader -> foreign cell', ids.leaderUnassigned, f.cellA, 'DENIED'],
    ['assigned member -> own cell', ids.memberA, f.cellA, 'ALLOWED'],
    ['assigned member -> foreign cell', ids.memberA, f.cellB, 'DENIED'],
    ['leader -> cell the leader leads', ids.leaderA, f.cellA, 'ALLOWED'],
    ['leader -> another leader\'s cell', ids.leaderA, f.cellB, 'DENIED'],
    ['administrator -> any cell', ids.admin, f.cellB, 'ALLOWED'],
    ['coordinator -> any cell', ids.coordinator, f.cellA, 'ALLOWED'],
    ['unassigned member -> no cell (unassigned workflow)', ids.memberUnassigned, null, 'ALLOWED'],
    ['unassigned leader -> no cell (unassigned workflow)', ids.leaderUnassigned, null, 'ALLOWED'],
    ['assigned member -> no cell (unassigned workflow)', ids.memberA, null, 'ALLOWED'],
    ['any active caller -> cell that does not exist', ids.admin, f.unknownCell, 'DENIED'],
  ];
}

async function run(label, lastFile, gate) {
  const { db, applied } = await openReplay(MIGRATIONS, { lastFile });
  console.log(`\n== ${label}: replayed ${applied.length} migrations through ${applied[applied.length - 1]}`);
  const f = await fixture(db);
  const failures = [];
  for (const [name, caller, cell, expected] of cases(f)) {
    const r = await submit(db, caller, cell, name.replace(/\W+/g, '_'));
    const correct = expected === 'ALLOWED' ? r.accepted : (!r.accepted && r.code === '42501');
    const outcome = r.accepted ? 'ACCEPTED' : `REFUSED ${r.code ?? ''}`;
    console.log(`${correct ? 'PASS' : (gate ? 'FAIL' : 'DEFECT')}  ${name.padEnd(52)} expected ${expected.padEnd(8)} got ${outcome}`);
    if (!correct) failures.push(name);
  }
  return failures;
}

const before = await run('BEFORE the fix', '105_audience_trigger_nested_check.sql', false);
const after = await run('AFTER the fix', '106_fix_submit_contact_cell_scope.sql', true);
console.log(`\nBefore the fix: ${before.length} case(s) showed the defect (expected for the unassigned and leader-foreign cases).`);
if (after.length > 0) {
  console.log(`AFTER the fix: ${after.length} case(s) failed: ${after.join('; ')}`);
  process.exit(1);
}
console.log('AFTER the fix: all required cases hold.');
