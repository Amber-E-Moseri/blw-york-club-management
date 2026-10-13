// bsc_access_session_test.mjs
//
// Real authenticated-session test of BSC leadership access. Each user signs in through GoTrue and calls PostgREST with
// their own bearer token, which is the path the app uses. Local stack only. Creates its own accounts and rows, and
// removes them at the end.
//
// Covers: a member-role BSC leader (ordinary application role, valid BSC assignment) can read the members of their own
// BSC and no other BSC; unassigned, pending, inactive and rejected users cannot read protected BSC data; fellowship and
// BSC structure is not readable by pending or rejected accounts.
//
//   node supabase/verification/bsc_access_session_test.mjs
// Needs SUPABASE_URL (local), SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY. Exits 1 on any failed expectation.

const url = process.env.SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anon || !service) {
  console.error('SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are required');
  process.exit(2);
}
if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error('refusing to run against a non-local Supabase URL');
  process.exit(2);
}

const run = Math.random().toString(36).slice(2, 8);
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}\t${name}\t${detail}`);
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
  const s = await (await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  })).json();
  if (!s.access_token) throw new Error(`sign-in ${name}: ${JSON.stringify(s)}`);
  return { name, id: user.id, token: s.access_token };
}

const created = [];
const cleanupRows = [];
try {
  // Structure: one fellowship, two cells in it, a BSC per leader in the first cell, and a BSC in the second cell.
  const fellowship = (await sRest('POST', '/fellowships', { name: `BSC test fellowship ${run}` })).data[0];
  const fellowship2 = (await sRest('POST', '/fellowships', { name: `BSC test other fellowship ${run}` })).data[0];
  cleanupRows.push(['fellowships', fellowship.id], ['fellowships', fellowship2.id]);
  const cell1 = (await sRest('POST', '/cells', { name: `BSC cell 1 ${run}`, fellowship_id: fellowship.id })).data[0];
  const cell2 = (await sRest('POST', '/cells', { name: `BSC cell 2 ${run}`, fellowship_id: fellowship2.id })).data[0];
  cleanupRows.push(['cells', cell1.id], ['cells', cell2.id]);

  const people = {};
  for (const [key, spec] of Object.entries({
    memberLeader: { role: 'member', status: 'active' },      // ordinary role, leads BSC A
    memberInBscA: { role: 'member', status: 'active' },      // member of BSC A
    pendingInBscA: { role: 'member', status: 'active' },      // onboarding, member of BSC A; set pending after linking (below)
    outsiderInBscB: { role: 'member', status: 'active' },    // member of BSC B (another leader)
    bscBLeader: { role: 'member', status: 'active' },        // leads BSC B
    unassigned: { role: 'member', status: 'active' },        // no BSC, not a leader
    pendingLeader: { role: 'member', status: 'active' },     // leads BSC C, set pending after BSC is created
    inactiveLeader: { role: 'member', status: 'active' },    // leads BSC D, set inactive afterwards
    rejectedLeader: { role: 'member', status: 'active' },    // leads BSC E, set rejected after BSC is created
    memberInBscD: { role: 'member', status: 'active' },      // member of BSC D (led by the inactive leader)
    memberOtherFellowship: { role: 'member', status: 'active' }, // member of cell 2 (other fellowship)
  })) {
    const u = await createUser(key);
    created.push(u.id);
    const r = await sRest('PATCH', `/profiles?id=eq.${u.id}`, { role: spec.role, status: spec.status });
    if (r.status >= 300) throw new Error(`profile ${key}: ${r.status}`);
    people[key] = u;
  }

  // guard_bsc_leader_eligibility (055) requires profiles.cell_id = bscs.cell_id at BSC insert time.
  // Set cell1 membership on all leaders that will be assigned to BSCs in cell1 before any BSC insert.
  for (const key of ['memberLeader', 'bscBLeader', 'pendingLeader', 'inactiveLeader', 'rejectedLeader']) {
    const r = await sRest('PATCH', `/profiles?id=eq.${people[key].id}`, { cell_id: cell1.id });
    if (r.status >= 300) throw new Error(`cell_id ${key}: ${r.status}`);
  }

  const bsc = async (name, cell, leader) => {
    const r = await sRest('POST', '/bscs', { cell_id: cell, name: `${name} ${run}`, leader_id: leader });
    if (r.status >= 300) throw new Error(`bsc ${name}: ${JSON.stringify(r.data)}`);
    cleanupRows.push(['bscs', r.data[0].id]);
    return r.data[0].id;
  };
  const bscA = await bsc('BSC A', cell1.id, people.memberLeader.id);
  const bscB = await bsc('BSC B', cell1.id, people.bscBLeader.id);
  const bscC = await bsc('BSC C', cell1.id, people.pendingLeader.id);
  const bscD = await bsc('BSC D', cell1.id, people.inactiveLeader.id);
  const bscE = await bsc('BSC E', cell1.id, people.rejectedLeader.id);
  const bscF = await bsc('BSC F', cell2.id, null);

  const setBsc = (id, bscId) => sRest('PATCH', `/profiles?id=eq.${id}`, { bsc_id: bscId, cell_id: cell1.id });
  await setBsc(people.memberInBscA.id, bscA);
  await setBsc(people.pendingInBscA.id, bscA);
  // The member keeps their cell and BSC, and only the status changes to pending. A pending profile cannot be given a
  // cell (guard 072), so the link has to be made while active. This is the state a status-only update reaches.
  { const r = await sRest('PATCH', `/profiles?id=eq.${people.pendingInBscA.id}`, { status: 'pending' }); if (r.status >= 300) throw new Error(`pending link: ${r.status}`); }
  await setBsc(people.outsiderInBscB.id, bscB);
  await setBsc(people.memberInBscD.id, bscD);
  await sRest('PATCH', `/profiles?id=eq.${people.memberOtherFellowship.id}`, { bsc_id: bscF, cell_id: cell2.id });

  // A monthly devotional for the read rows (devotional_views references it), created by the service role.
  const monthly = (await sRest('POST', '/monthly_devotionals', { month: 1, year: 2026, title: `BSC test devotional ${run}`, book_title: `BSC test book ${run}`, total_days: 31, total_pages: 10, created_by: people.memberLeader.id })).data[0];
  cleanupRows.push(['monthly_devotionals', monthly.id]);

  // A devotional read for every member, so that each read check has something to see.
  const reads = {};
  for (const key of ['memberInBscA', 'pendingInBscA', 'outsiderInBscB', 'memberInBscD']) {
    const r = await sRest('POST', '/devotional_views', { member_id: people[key].id, devotional_id: monthly.id, day_of_month: 1, viewed_date: new Date().toISOString().slice(0, 10) });
    if (r.status >= 300) throw new Error(`read ${key}: ${r.status} ${JSON.stringify(r.data)}`);
    reads[key] = r.data[0].id;
  }

  // Downgrade leader statuses after BSC creation (guard_bsc_leader_eligibility requires active at insert time).
  await sRest('PATCH', `/profiles?id=eq.${people.pendingLeader.id}`, { status: 'pending' });
  await sRest('PATCH', `/profiles?id=eq.${people.rejectedLeader.id}`, { status: 'rejected' });
  // Inactive leader: active while the BSC was set up, then deactivated.
  await sRest('PATCH', `/profiles?id=eq.${people.inactiveLeader.id}`, { status: 'inactive' });

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
  // Approved rule: pending onboarding members stay hidden from ordinary BSC leaders. Admins and coordinators may see them.
  check('L2 member-role leader sees an approved active member of their BSC (positive)',
    leaderIds.includes(people.memberInBscA.id), `sees ${leaderMembers.length}`);
  check('L2F member-role leader does NOT see a pending onboarding member of their BSC (forbidden, approved rule)',
    !leaderIds.includes(people.pendingInBscA.id), `sees ${leaderMembers.length}`);
  check('L3 member-role leader does not see a member of another BSC (cross-BSC)',
    !leaderIds.includes(people.outsiderInBscB.id) && !leaderIds.includes(people.memberInBscD.id), `sees ${leaderMembers.length}`);
  check('L4 member-role leader can read the Rhapsody read of an own BSC member',
    (await readRows(t('memberLeader'), people.memberInBscA.id)).length === 1);
  check('L5 member-role leader cannot read the Rhapsody read of a member of another BSC',
    (await readRows(t('memberLeader'), people.outsiderInBscB.id)).length === 0);
  // Migration 052 (declaration_identity_privacy): BSC leaders have no row-level access to confession declarations;
  // they read counts only via confession_declaration_counts() RPC. Both own-BSC and cross-BSC queries return 0.
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
  check('U5 member of BSC A cannot read the data of a pending onboarding member',
    (await readRows(t('memberInBscA'), people.pendingInBscA.id)).length === 0);

  // ─── Pending, inactive and rejected leaders: nothing protected ─────────────────────────────────────────────────
  check('P1 pending leader cannot read BSC rows', (await bscRows(t('pendingLeader'))).length === 0);
  check('P2 pending leader lists no BSC members', (await members(t('pendingLeader'))).length === 0);
  check('P3 pending leader reads no member Rhapsody read', (await readRows(t('pendingLeader'), people.memberInBscA.id)).length === 0);
  check('I1 inactive leader cannot read BSC rows', (await bscRows(t('inactiveLeader'))).length === 0);
  check('I2 inactive leader lists no BSC members', (await members(t('inactiveLeader'))).length === 0);
  check('I3 inactive leader reads no member Rhapsody read', (await readRows(t('inactiveLeader'), people.memberInBscD.id)).length === 0);
  check('I4 inactive leader reads no member confession declaration', (await declRows(t('inactiveLeader'), people.memberInBscD.id)).length === 0);
  check('R1 rejected leader cannot read BSC rows', (await bscRows(t('rejectedLeader'))).length === 0);
  check('R2 rejected leader lists no BSC members', (await members(t('rejectedLeader'))).length === 0);
  check('R3 rejected leader reads no member Rhapsody read', (await readRows(t('rejectedLeader'), people.memberInBscA.id)).length === 0);

  // ─── Fellowship and BSC structure: active only, and isolated by fellowship for members ──────────────────────────
  const fellowshipsFor = async (token) => (await rest('GET', '/fellowships?select=id', token)).data ?? [];
  check('F1 pending account reads no fellowships', (await fellowshipsFor(t('pendingInBscA'))).length === 0);
  check('F2 rejected account reads no fellowships', (await fellowshipsFor(t('rejectedLeader'))).length === 0);
  check('F3 an active member can read fellowship structure (not protected member data)', (await fellowshipsFor(t('unassigned'))).length >= 2);
  const otherFellowshipLeaderMembers = await members(t('memberOtherFellowship'));
  check('F4 cross-fellowship member lists no BSC members', otherFellowshipLeaderMembers.length === 0);
} catch (err) {
  console.error('ERROR', err.message);
  results.push({ name: 'harness error', ok: false, detail: err.message });
} finally {
  for (const [table, id] of cleanupRows.reverse()) {
    await fetch(`${url}/rest/v1/${table}?id=eq.${id}`, { method: 'DELETE', headers: { apikey: service, Authorization: `Bearer ${service}` } });
  }
  for (const id of created) {
    await fetch(`${url}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: { apikey: service, Authorization: `Bearer ${service}` } });
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nbsc-access-session: ${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
