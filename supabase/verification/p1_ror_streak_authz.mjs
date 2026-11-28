// p1_ror_streak_authz.mjs
// Behavioral certification of the get_ror_streak authorization guard
// introduced in migration 043_get_ror_streak_authz.sql.
//
// Test strategy
//   An authorized caller (own data, admin, cell leader) with no devotional
//   data still receives exactly one row back (all-zero counters). An
//   unauthorized caller receives zero rows. This lets us test the access
//   control layer cleanly without needing real devotional entries.
//
// Safety: runs only against a LOCAL Supabase stack.  All accounts use the
// @example.test domain and are deleted after the run.
//
// 8 scenarios
//   1. Active member reads own streak                        → 1 row
//   2. Active coordinator reads any active member's streak  → 1 row
//   3. Active cell leader reads in-cell member's streak     → 1 row
//   4. Active stranger reads another member's streak        → 0 rows (main fix)
//   5. Active cell leader reads out-of-cell member's streak → 0 rows
//   6. Inactive member reads own streak                     → 0 rows (new gate)
//   7. Inactive cell leader reads in-cell member's streak   → 0 rows (new gate)
//   8. Active cell leader reads inactive member's streak    → 0 rows (new gate)

import { harness } from './lib.mjs';

const h = harness('p1-ror-authz');
const { admin, createUser, cleanup, report, expect, run } = h;

const today = new Date().toISOString().split('T')[0];       // 'YYYY-MM-DD'
const monthYear = today.slice(0, 7);                        // 'YYYY-MM'

async function callStreak(client, memberId) {
  const { data, error } = await client.rpc('get_ror_streak', {
    p_member_id: memberId,
    p_today: today,
    p_month_year: monthYear,
  });
  return { data: data ?? [], error };
}

const createdCellIds = [];

try {
  // ─── Setup ────────────────────────────────────────────────────────────────

  // Cell A: used for scenarios 1–3, 6–8.
  const { data: cellA, error: cellAErr } = await admin
    .from('cells').insert({ name: `CertCellA-${run}` }).select('id').single();
  if (cellAErr) throw new Error(`create cell A: ${cellAErr.message}`);
  createdCellIds.push(cellA.id);

  // Cell B: used for scenario 5 (out-of-cell member).
  const { data: cellB, error: cellBErr } = await admin
    .from('cells').insert({ name: `CertCellB-${run}` }).select('id').single();
  if (cellBErr) throw new Error(`create cell B: ${cellBErr.message}`);
  createdCellIds.push(cellB.id);

  // Coordinator (devotional admin) — no cell assignment required.
  const coordinator = await createUser('coord', { role: 'coordinator', status: 'active' });

  // Active cell leader for cell A.
  const cellLeader = await createUser('leader', { role: 'cell_leader', status: 'active', cellId: cellA.id });

  // Assign cellLeader as cell A's leader.
  const { error: assignErr } = await admin
    .from('cells').update({ leader_id: cellLeader.id }).eq('id', cellA.id);
  if (assignErr) throw new Error(`assign cell leader: ${assignErr.message}`);

  // Active member in cell A — the target for most scenarios.
  const member = await createUser('member', { role: 'member', status: 'active', cellId: cellA.id });

  // Active stranger — in cell B, no relation to cell A.
  const stranger = await createUser('stranger', { role: 'member', status: 'active', cellId: cellB.id });

  // Inactive member in cell A (scenario 6: own data, inactive profile).
  const inactiveMember = await createUser('inactive_m', { role: 'member', status: 'inactive', cellId: cellA.id });

  // Inactive cell leader for cell A (scenario 7: leader inactive).
  const inactiveLeader = await createUser('inactive_l', { role: 'cell_leader', status: 'inactive', cellId: cellA.id });

  // A second active member in cell A who will be marked inactive mid-test (scenario 8).
  const memberGoesInactive = await createUser('m_inactive', { role: 'member', status: 'inactive', cellId: cellA.id });

  // ─── Scenario 1: Active member reads own streak ───────────────────────────

  const s1 = await callStreak(member.client, member.id);
  expect(
    'S1 active member reads own streak → 1 row',
    s1.data.length === 1 && !s1.error,
    s1.error?.message ?? `rows=${s1.data.length}`,
  );

  // ─── Scenario 2: Coordinator reads any member's streak ───────────────────

  const s2 = await callStreak(coordinator.client, member.id);
  expect(
    'S2 coordinator reads any member streak → 1 row',
    s2.data.length === 1 && !s2.error,
    s2.error?.message ?? `rows=${s2.data.length}`,
  );

  // ─── Scenario 3: Cell leader reads in-cell member's streak ───────────────

  const s3 = await callStreak(cellLeader.client, member.id);
  expect(
    'S3 cell leader reads in-cell member streak → 1 row',
    s3.data.length === 1 && !s3.error,
    s3.error?.message ?? `rows=${s3.data.length}`,
  );

  // ─── Scenario 4: Stranger reads another member's streak ──────────────────
  // Primary vulnerability fix: this returned data before migration 043.

  const s4 = await callStreak(stranger.client, member.id);
  expect(
    'S4 stranger reads another member streak → 0 rows (authz fix)',
    s4.data.length === 0 && !s4.error,
    s4.error?.message ?? `rows=${s4.data.length}`,
  );

  // ─── Scenario 5: Cell leader reads out-of-cell member's streak ───────────

  const s5 = await callStreak(cellLeader.client, stranger.id);
  expect(
    'S5 cell leader reads out-of-cell member streak → 0 rows',
    s5.data.length === 0 && !s5.error,
    s5.error?.message ?? `rows=${s5.data.length}`,
  );

  // ─── Scenario 6: Inactive member reads own streak ────────────────────────
  // New behavior from migration 043: inactive profile may not read their own data.

  const s6 = await callStreak(inactiveMember.client, inactiveMember.id);
  expect(
    'S6 inactive member reads own streak → 0 rows (status gate)',
    s6.data.length === 0 && !s6.error,
    s6.error?.message ?? `rows=${s6.data.length}`,
  );

  // ─── Scenario 7: Inactive cell leader reads in-cell member's streak ───────

  const s7 = await callStreak(inactiveLeader.client, member.id);
  expect(
    'S7 inactive leader reads in-cell member streak → 0 rows (leader status gate)',
    s7.data.length === 0 && !s7.error,
    s7.error?.message ?? `rows=${s7.data.length}`,
  );

  // ─── Scenario 8: Active cell leader reads inactive in-cell member ─────────

  const s8 = await callStreak(cellLeader.client, memberGoesInactive.id);
  expect(
    'S8 active leader reads inactive member streak → 0 rows (member status gate)',
    s8.data.length === 0 && !s8.error,
    s8.error?.message ?? `rows=${s8.data.length}`,
  );

} finally {
  // Clean up cells (users are cleaned up by the harness).
  for (const id of createdCellIds) {
    try {
      // Null out cell references to allow delete (profiles may reference this cell).
      await admin.from('profiles').update({ cell_id: null }).eq('cell_id', id);
      await admin.from('cells').delete().eq('id', id);
    } catch { /* best effort */ }
  }
  await cleanup();
}

report();
