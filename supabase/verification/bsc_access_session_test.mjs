// bsc_access_session_test.mjs
//
// Real authenticated-session test of BSC leadership access. Each user signs in through GoTrue and calls PostgREST with
// their own bearer token, which is the path the app uses. Local stack only. Creates its own accounts and rows, and
// removes them at the end.
//
// PD-2: every profile status, cell and BSC change in this fixture goes through an approved workflow RPC, run as an
// authorised coordinator: approve_pending_member, reject_pending_member, set_member_status, transfer_member_cell and
// assign_member_to_bsc. The harness never PATCHes status, cell_id or bsc_id with the service role, which migration 094
// refuses. The service role is used only for structure (fellowships, cells, BSCs, devotional and confession rows) and for
// the auth admin API, none of which 094 restricts.
//
// Some states the original fixture created directly have no authorised path, so their checks cannot be evaluated through
// the workflows. Those checks are kept, and each one is reported as BLOCKED (a failure) with the reason. They are not
// dropped, and they are not made to pass. See BLOCKED_STATES below.
//
//   node supabase/verification/bsc_access_session_test.mjs
// Needs SUPABASE_URL (local), SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, CERT_COORDINATOR_EMAIL and
// CERT_COORDINATOR_PASSWORD (an owner-bootstrapped active coordinator, as in authz_final_real_session_test.mjs).
// Exits 1 on any failed or blocked expectation.

const url = process.env.SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const coordEmail = process.env.CERT_COORDINATOR_EMAIL;
const coordPassword = process.env.CERT_COORDINATOR_PASSWORD;
if (!url || !anon || !service || !coordEmail || !coordPassword) {
  console.error('SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, CERT_COORDINATOR_EMAIL and CERT_COORDINATOR_PASSWORD are required');
  process.exit(2);
}
if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error('refusing to run against a non-local Supabase URL');
  process.exit(2);
}

const run = Math.random().toString(36).slice(2, 8);
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}\t${name}\t${detail}`);
};
// A check whose precondition cannot be produced through an authorised path. Reported as a failure with the reason.
const blocked = (name, reason) => {
  results.push({ name, ok: false });
  console.log(`FAIL\t${name}\tBLOCKED: ${reason}`);
};

const BLOCKED_STATES = {
  pendingInBscA: 'a pending member with a BSC has no authorised path: active -> pending is refused by 083, and BSC assignment requires an active member (058)',
  pendingLeader: 'a pending member cannot lead a BSC: the leader guard (055) requires an active leader at BSC creation, and no transition returns an active leader to pending',
  rejectedLeader: 'a rejected member cannot lead a BSC: the leader guard (055) requires an active leader, and reject_pending_member applies only to pending accounts',
  inactiveLeader: 'set_member_status(inactive) releases BSC leadership (077), so the inactive account no longer leads a BSC and the status-only check is not exercised',
};

async function rest(method, path, token, body, prefer = '') {
  const r = await fetch(`${url}/rest/v1${path}`, {
    method,
    headers: { apikey: anon, Authorization: `Bearer ${token ?? anon}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: r.status, data };
}
const sRest = (method, path, body, prefer = 'return=representation') => rest(method, path, service, body, prefer);
const rpc = (name, token, args) => rest('POST', `/rpc/${name}`, token, args);

async function signIn(email, password) {
  const s = await (await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  })).json();
  if (!s.access_token) throw new Error(`sign-in ${email}: ${JSON.stringify(s)}`);
  return s.access_token;
}

async function createUser(name) {
  const email = `bsc.${name}.${run}@t9.test`;
  const password = `Pw-${run}-${name}-7`;
  const r = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const user = await r.json();
  if (!user.id) throw new Error(`createUser ${name}: ${JSON.stringify(user)}`);
  return { name, id: user.id, token: await signIn(email, password) };
}

const created = [];
const cleanupRows = [];
try {
  const coord = await signIn(coordEmail, coordPassword);

  // Structure: two fellowships, cell 1 in fellowship 1, cell 2 in fellowship 2. Structure is created by the service role.
  const fellowship = (await sRest('POST', '/fellowships', { name: `BSC test fellowship ${run}` })).data[0];
  const fellowship2 = (await sRest('POST', '/fellowships', { name: `BSC test other fellowship ${run}` })).data[0];
  cleanupRows.push(['fellowships', fellowship.id], ['fellowships', fellowship2.id]);
  const cell1 = (await sRest('POST', '/cells', { name: `BSC cell 1 ${run}`, fellowship_id: fellowship.id })).data[0];
  const cell2 = (await sRest('POST', '/cells', { name: `BSC cell 2 ${run}`, fellowship_id: fellowship2.id })).data[0];
  cleanupRows.push(['cells', cell1.id], ['cells', cell2.id]);

  // Accounts start pending after signup. The coordinator approves them, which is the only path from pending to active.
  const people = {};
  for (const key of ['memberLeader', 'memberInBscA', 'pendingInBscA', 'outsiderInBscB', 'bscBLeader', 'unassigned',
    'pendingLeader', 'inactiveLeader', 'rejectedLeader', 'memberInBscD', 'memberOtherFellowship']) {
    people[key] = await createUser(key);
    created.push(people[key].id);
  }
  const approve = async (key) => {
    const r = await rpc('approve_pending_member', coord, { target_member_id: people[key].id });
    if (r.status >= 300) throw new Error(`approve ${key}: ${r.status} ${JSON.stringify(r.data)}`);
  };
  for (const key of ['memberLeader', 'memberInBscA', 'outsiderInBscB', 'bscBLeader', 'unassigned',
    'inactiveLeader', 'memberInBscD', 'memberOtherFellowship']) {
    await approve(key);
  }
  // pendingInBscA, pendingLeader stay pending. rejectedLeader is rejected through the approved path.
  {
    const r = await rpc('reject_pending_member', coord, { target_member_id: people.rejectedLeader.id });
    if (r.status >= 300) throw new Error(`reject rejectedLeader: ${r.status} ${JSON.stringify(r.data)}`);
  }

  // Cell placement through the approved transfer path. A BSC leader must be an active member of the BSC's cell (055).
  const transfer = async (key, cell) => {
    const r = await rpc('transfer_member_cell', coord, { p_member_id: people[key].id, p_cell_id: cell.id, p_reason: 'BSC fixture placement' });
    if (r.status >= 300) throw new Error(`transfer ${key}: ${r.status} ${JSON.stringify(r.data)}`);
  };
  for (const key of ['memberLeader', 'bscBLeader', 'memberInBscA', 'outsiderInBscB', 'unassigned', 'inactiveLeader']) {
    await transfer(key, cell1);
  }
  await transfer('memberInBscD', cell1);
  await transfer('memberOtherFellowship', cell2);

  const bsc = async (name, cell, leader) => {
    const r = await sRest('POST', '/bscs', { cell_id: cell, name: `${name} ${run}`, leader_id: leader });
    if (r.status >= 300) throw new Error(`bsc ${name}: ${JSON.stringify(r.data)}`);
    cleanupRows.push(['bscs', r.data[0].id]);
    return r.data[0].id;
  };
  const bscA = await bsc('BSC A', cell1.id, people.memberLeader.id);
  const bscB = await bsc('BSC B', cell1.id, people.bscBLeader.id);
  const bscD = await bsc('BSC D', cell1.id, people.inactiveLeader.id);
  const bscF = await bsc('BSC F', cell2.id, null);

  const assign = async (key, bscId) => {
    const r = await rpc('assign_member_to_bsc', coord, { p_member_id: people[key].id, p_bsc_id: bscId });
    if (r.status >= 300) throw new Error(`assign ${key}: ${r.status} ${JSON.stringify(r.data)}`);
  };
  await assign('memberInBscA', bscA);
  await assign('outsiderInBscB', bscB);
  await assign('memberInBscD', bscD);
  await assign('memberOtherFellowship', bscF);

  // Inactive leader: set inactive through set_member_status (077 releases the BSC leadership it held).
  {
    const r = await rpc('set_member_status', coord, { p_member_id: people.inactiveLeader.id, p_status: 'inactive', p_reason: 'BSC fixture deactivation' });
    if (r.status >= 300) throw new Error(`deactivate inactiveLeader: ${r.status} ${JSON.stringify(r.data)}`);
  }

  // A monthly devotional for the read rows (devotional_views references it), created by the service role.
  const monthly = (await sRest('POST', '/monthly_devotionals', { month: 1, year: 2026, title: `BSC test devotional ${run}`, book_title: `BSC test book ${run}`, total_days: 31, total_pages: 10, created_by: people.memberLeader.id })).data[0];
  cleanupRows.push(['monthly_devotionals', monthly.id]);

  // A devotional read for every member, so that each read check has something to see.
  for (const key of ['memberInBscA', 'pendingInBscA', 'outsiderInBscB', 'memberInBscD']) {
    const r = await sRest('POST', '/devotional_views', { member_id: people[key].id, devotional_id: monthly.id, day_of_month: 1, viewed_date: new Date().toISOString().slice(0, 10) });
    if (r.status >= 300) throw new Error(`read ${key}: ${r.status} ${JSON.stringify(r.data)}`);
  }

  const members = async (token) => (await rest('POST', '/rpc/bsc_members_visible', token, {})).data ?? [];
  const bscRows = async (token) => (await rest('GET', '/bscs?select=id,leader_id', token)).data ?? [];
  const readRows = async (token, memberId) => (await rest('GET', `/devotional_views?select=id&member_id=eq.${memberId}`, token)).data ?? [];
  const declRows = async (token, memberId) => (await rest('GET', `/confession_declarations?select=user_id&user_id=eq.${memberId}`, token)).data ?? [];

  // Seed a confession declaration per member for the declaration checks.
  const { data: conf } = await sRest('POST', '/confessions', { title: `BSC test ${run}`, body: 'x', scheduled_date: new Date().toISOString().slice(0, 10), created_by: people.memberLeader.id, is_active: true });
  cleanupRows.push(['confessions', conf[0].id]);
  for (const key of ['memberInBscA', 'pendingInBscA', 'outsiderInBscB', 'memberInBscD']) {
    await sRest('POST', '/confession_declarations', { confession_id: conf[0].id, user_id: people[key].id });
  }

  const t = (k) => people[k].token;

  // ─── Member-role BSC leader: scoped access ──────────────────────────────────────────────────────────────────────
  const leaderBscs = await bscRows(t('memberLeader'));
  check('L1 member-role leader can read BSC rows (own assignment is visible)', leaderBscs.length >= 1, `sees ${leaderBscs.length} BSCs`);
  const leaderMembers = await members(t('memberLeader'));
  const leaderIds = leaderMembers.map((m) => m.id);
  check('L2 member-role leader sees an approved active member of their BSC (positive)',
    leaderIds.includes(people.memberInBscA.id), `sees ${leaderMembers.length}`);
  // Approved rule: pending onboarding members stay hidden from ordinary BSC leaders. Admins and coordinators may see them.
  // BLOCKED: pendingInBscA cannot be given a BSC through an authorised path, so this forbidden case is not reachable.
  blocked('L2F member-role leader does NOT see a pending onboarding member of their BSC (forbidden, approved rule)', BLOCKED_STATES.pendingInBscA);
  check('L3 member-role leader does not see a member of another BSC (cross-BSC)',
    !leaderIds.includes(people.outsiderInBscB.id) && !leaderIds.includes(people.memberInBscD.id), `sees ${leaderMembers.length}`);
  check('L4 member-role leader can read the Rhapsody read of an own BSC member',
    (await readRows(t('memberLeader'), people.memberInBscA.id)).length === 1);
  check('L5 member-role leader cannot read the Rhapsody read of a member of another BSC',
    (await readRows(t('memberLeader'), people.outsiderInBscB.id)).length === 0);
  // Migration 052 (declaration_identity_privacy): BSC leaders have no row-level access to confession declarations.
  check('L6 member-role leader has no direct read on confession declarations of own BSC members (privacy guard 052)',
    (await declRows(t('memberLeader'), people.memberInBscA.id)).length === 0);
  check('L7 member-role leader has no direct read on confession declarations of another BSC member',
    (await declRows(t('memberLeader'), people.outsiderInBscB.id)).length === 0);

  // ─── Unassigned, ordinary member: no BSC leadership, no protected data ─────────────────────────────────────────
  check('U1 unassigned member: no BSC is led (no BSC rows with own leader_id)',
    (await bscRows(t('unassigned'))).every((b) => b.leader_id !== people.unassigned.id));
  check('U2 unassigned member lists no BSC members', (await members(t('unassigned'))).length === 0);
  check('U3 unassigned member reads no BSC member Rhapsody reads', (await readRows(t('unassigned'), people.memberInBscA.id)).length === 0);
  check('U4 member of BSC A (not a leader) lists no BSC members', (await members(t('memberInBscA'))).length === 0);
  blocked('U5 member of BSC A cannot read the data of a pending onboarding member', BLOCKED_STATES.pendingInBscA);

  // ─── Pending, inactive and rejected leaders: nothing protected ─────────────────────────────────────────────────
  // These accounts never led a BSC through an authorised path, so the leader checks are BLOCKED. The pending and rejected
  // accounts still get the account-level checks, which are real.
  blocked('P1 pending leader cannot read BSC rows', BLOCKED_STATES.pendingLeader);
  check('P2 pending account lists no BSC members', (await members(t('pendingLeader'))).length === 0);
  check('P3 pending account reads no member Rhapsody read', (await readRows(t('pendingLeader'), people.memberInBscA.id)).length === 0);
  blocked('I1 inactive leader cannot read BSC rows', BLOCKED_STATES.inactiveLeader);
  check('I2 inactive leader lists no BSC members', (await members(t('inactiveLeader'))).length === 0);
  check('I3 inactive leader reads no member Rhapsody read', (await readRows(t('inactiveLeader'), people.memberInBscD.id)).length === 0);
  check('I4 inactive leader reads no member confession declaration', (await declRows(t('inactiveLeader'), people.memberInBscD.id)).length === 0);
  blocked('R1 rejected leader cannot read BSC rows', BLOCKED_STATES.rejectedLeader);
  check('R2 rejected account lists no BSC members', (await members(t('rejectedLeader'))).length === 0);
  check('R3 rejected account reads no member Rhapsody read', (await readRows(t('rejectedLeader'), people.memberInBscA.id)).length === 0);

  // ─── Fellowship and BSC structure: active only, and isolated by fellowship for members ──────────────────────────
  const fellowshipsFor = async (token) => (await rest('GET', '/fellowships?select=id', token)).data ?? [];
  check('F1 pending account reads no fellowships', (await fellowshipsFor(t('pendingInBscA'))).length === 0);
  check('F2 rejected account reads no fellowships', (await fellowshipsFor(t('rejectedLeader'))).length === 0);
  check('F3 an active member can read fellowship structure (not protected member data)', (await fellowshipsFor(t('unassigned'))).length >= 2);
  const otherFellowshipLeaderMembers = await members(t('memberOtherFellowship'));
  check('F4 cross-fellowship member lists no BSC members', otherFellowshipLeaderMembers.length === 0);
} catch (err) {
  console.error('ERROR', err.message);
  results.push({ name: 'harness error', ok: false });
} finally {
  for (const [table, id] of cleanupRows.reverse()) {
    await fetch(`${url}/rest/v1/${table}?id=eq.${id}`, { method: 'DELETE', headers: { apikey: service, Authorization: `Bearer ${service}` } });
  }
  for (const id of created) {
    await fetch(`${url}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: { apikey: service, Authorization: `Bearer ${service}` } });
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nbsc-access-session: ${results.length - failed}/${results.length} checks passed (${failed} failed, including BLOCKED states)`);
  process.exit(failed ? 1 : 0);
}
