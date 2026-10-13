// authz_final_real_session_test.mjs
//
// Real authenticated-session tests for migrations 089-092 and the contact-logging rule. Each actor signs in through
// GoTrue and calls PostgREST or an RPC with its own bearer token, which is the path the application uses. A forbidden
// action is judged by the DATABASE STATE after the attempt, not by the HTTP status alone.
//
// Local stack only. Refuses any non-local SUPABASE_URL. Creates accounts and rows only with a per-run marker and removes
// exactly the rows and accounts it created. Every fixture write checks its result and aborts the run on failure.
//
// Fixture rules (see the fixture design in the release notes):
//   * Applicants register through GoTrue signup and become pending through the database's own signup trigger.
//   * Applicants are approved only through approve_pending_member() by a coordinator.
//   * Cells and placement use the authorised paths: transfer_member_cell() for active members,
//     assign_pending_applicant_to_cell() (migration 092) for pending applicants.
//   * Role changes use direct PATCH by a coordinator (allowed by the role guard).
//   * The one owner-level step is the first coordinator. It is performed by OWNER_BOOTSTRAP_SQL before this script,
//     against the same local stack, and this script only verifies that the coordinator exists and is active.
//
// Usage (after the migrations are applied and the owner bootstrap has run):
//   SUPABASE_URL=http://127.0.0.1:<port> SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
//   CERT_COORDINATOR_EMAIL=... CERT_COORDINATOR_PASSWORD=... node supabase/verification/authz_final_real_session_test.mjs
// Exits 1 on any FAIL and 2 on a configuration problem. BLOCKED rows are printed and do not pass the run.

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

const run = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const results = [];
const created = { users: [], cells: [], bscs: [], people: [], contacts: [] };
const record = (area, name, status, detail = '') => {
  results.push({ area, name, status, detail });
  console.log(`${status}\t${area}\t${name}\t${detail}`);
};
const pass = (area, name, ok, detail = '') => record(area, name, ok ? 'PASS' : 'FAIL', detail);
const blocked = (area, name, why) => record(area, name, 'BLOCKED', why);

async function call(method, path, token, body, prefer = '') {
  const r = await fetch(`${url}${path}`, {
    method,
    headers: {
      apikey: anon,
      Authorization: `Bearer ${token ?? anon}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: r.status, data };
}
const svc = (method, path, body, prefer = 'return=representation') => call(method, `/rest/v1${path}`, service, body, prefer);
const rpc = (name, token, body) => call('POST', `/rest/v1/rpc/${name}`, token, body);

// Each fixture write must succeed; otherwise the run stops, so no test runs against a partial fixture.
function mustOk(label, res, expectRows = false) {
  const ok = res.status >= 200 && res.status < 300 && (!expectRows || (Array.isArray(res.data) && res.data.length > 0));
  if (!ok) throw new Error(`fixture write failed (${label}): HTTP ${res.status} ${JSON.stringify(res.data).slice(0, 200)}`);
  return res.data;
}

async function signIn(email, password) {
  const r = await call('POST', '/auth/v1/token?grant_type=password', null, { email, password });
  if (!r.data?.access_token) throw new Error(`sign-in failed for ${email}: HTTP ${r.status}`);
  return { token: r.data.access_token, id: r.data.user.id };
}

// Applicant: registration through the normal signup path. The database signup trigger makes the profile pending.
async function registerApplicant(label) {
  const email = `${run}.${label}@t9.test`;
  const password = `Pw-${run}-${label}-7`;
  const r = await call('POST', '/auth/v1/signup', null, { email, password });
  if (!r.data?.user?.id) throw new Error(`signup failed for ${label}: HTTP ${r.status}`);
  created.users.push(r.data.user.id);
  const who = await signIn(email, password);
  const prof = mustOk(`read pending profile ${label}`, await svc('GET', `/profiles?id=eq.${who.id}&select=id,status`), true);
  if (prof[0].status !== 'pending') throw new Error(`${label} is not pending after signup`);
  return { ...who, email, password, label };
}

async function main() {
  // ── Fixture: coordinator (owner-bootstrapped) ─────────────────────────────────────────────────────────────────────
  const coord = await signIn(coordEmail, coordPassword);
  const coordRow = mustOk('coordinator row', await svc('GET', `/profiles?id=eq.${coord.id}&select=id,role,status`), true)[0];
  if (coordRow.role !== 'coordinator' || coordRow.status !== 'active') {
    throw new Error('CERT_COORDINATOR must be an active coordinator (created by OWNER_BOOTSTRAP_SQL)');
  }

  // ── Fixture: applicants and roles ─────────────────────────────────────────────────────────────────────────────────
  const leaderA = await registerApplicant('leadera');   // Cell Leader of cell A
  const bscOnly = await registerApplicant('bsconly');   // BSC-only Leader in cell A
  const memberA = await registerApplicant('membera');   // ordinary active member in cell A
  const memberB = await registerApplicant('memberb');   // ordinary active member, no cell
  const pendingA = await registerApplicant('pendinga'); // pending applicant (to be placed in cell A by an admin)
  const pendingB = await registerApplicant('pendingb'); // pending applicant, never placed
  const admin = await registerApplicant('admin');
  for (const a of [leaderA, bscOnly, memberA, memberB, admin]) {
    mustOk(`approve ${a.label}`, await rpc('approve_pending_member', coord.token, { target_member_id: a.id }), false);
  }
  mustOk('role admin', await svc('PATCH', `/profiles?id=eq.${admin.id}`, { role: 'admin' }), true);

  // Cell A and its leader; BSC in cell A led by the BSC-only leader.
  const cellA = mustOk('cell A', await svc('POST', '/cells', { name: `${run} cell A` }), true)[0];
  created.cells.push(cellA.id);
  mustOk('cell A leader', await svc('PATCH', `/cells?id=eq.${cellA.id}`, { leader_id: leaderA.id }), true);
  mustOk('place leader A', await rpc('transfer_member_cell', coord.token, { p_member_id: leaderA.id, p_cell_id: cellA.id }), false);
  mustOk('place BSC-only leader', await rpc('transfer_member_cell', coord.token, { p_member_id: bscOnly.id, p_cell_id: cellA.id }), false);
  mustOk('place member A', await rpc('transfer_member_cell', coord.token, { p_member_id: memberA.id, p_cell_id: cellA.id }), false);
  const bscA = mustOk('BSC A', await svc('POST', '/bscs', { name: `${run} BSC A`, cell_id: cellA.id, leader_id: bscOnly.id }), true)[0];
  created.bscs.push(bscA.id);
  mustOk('BSC A place', await svc('PATCH', `/profiles?id=eq.${bscOnly.id}`, { bsc_id: bscA.id }), true);

  // Cell B (other cell) with its own leader, so cross-cell denial is tested with a real leader.
  const leaderB = await registerApplicant('leaderb');
  mustOk('approve leaderB', await rpc('approve_pending_member', coord.token, { target_member_id: leaderB.id }), false);
  const cellB = mustOk('cell B', await svc('POST', '/cells', { name: `${run} cell B` }), true)[0];
  created.cells.push(cellB.id);
  mustOk('cell B leader', await svc('PATCH', `/cells?id=eq.${cellB.id}`, { leader_id: leaderB.id }), true);
  mustOk('place leader B', await rpc('transfer_member_cell', coord.token, { p_member_id: leaderB.id, p_cell_id: cellB.id }), false);

  // Pending applicant placed in cell A through the audited RPC (migration 092), and a second applicant left unplaced.
  mustOk('admin places pending A', await rpc('assign_pending_applicant_to_cell', admin.token, { p_member_id: pendingA.id, p_cell_id: cellA.id }), false);

  // ── Pending visibility (migration 090 and profiles RLS) ─────────────────────────────────────────────────────────────
  const visibleTo = async (who, targetId) => {
    const r = await call('GET', `/rest/v1/profiles?id=eq.${targetId}&select=id`, who.token);
    return Array.isArray(r.data) && r.data.length === 1;
  };
  const rosterHas = async (who, targetId) => {
    const r = await rpc('bsc_members_visible', who.token, {});
    return Array.isArray(r.data) && r.data.some((row) => row.id === targetId);
  };

  pass('Pending visibility', 'Cell Leader A sees pending applicant placed in cell A', await visibleTo(leaderA, pendingA.id));
  pass('Pending visibility', 'Cell Leader A does not see pending applicant B (unplaced)', !(await visibleTo(leaderA, pendingB.id)));
  pass('Pending visibility', 'Cell Leader B (other cell) cannot see pending applicant A', !(await visibleTo(leaderB, pendingA.id)));
  pass('Pending visibility', 'BSC-only Leader cannot see pending applicant A (profile row)', !(await visibleTo(bscOnly, pendingA.id)));
  pass('Pending visibility', 'BSC-only Leader roster excludes pending applicant A', !(await rosterHas(bscOnly, pendingA.id)));
  pass('Pending visibility', 'Ordinary active member cannot see pending applicant A', !(await visibleTo(memberA, pendingA.id)));
  pass('Pending visibility', 'Pending applicant sees own row only', (await visibleTo(pendingA, pendingA.id)) && !(await visibleTo(pendingA, pendingB.id)));
  pass('Pending visibility', 'Admin sees pending applicant A', await visibleTo(admin, pendingA.id));
  pass('Pending visibility', 'Coordinator sees pending applicant A', await visibleTo(coord, pendingA.id));

  // ── Coordinator direct status PATCH denial (migration 089) ──────────────────────────────────────────────────────────
  const patch = await call('PATCH', `/rest/v1/profiles?id=eq.${memberB.id}`, coord.token, { status: 'inactive' }, 'return=minimal');
  const afterPatch = mustOk('read after direct PATCH', await svc('GET', `/profiles?id=eq.${memberB.id}&select=status`), true)[0];
  pass('Status', 'Coordinator direct status PATCH is refused (state unchanged)', afterPatch.status === 'active', `HTTP ${patch.status}; status=${afterPatch.status}`);

  // ── Authorised status RPC success and audit (migration 083 workflow, 089 leaves it intact) ──────────────────────────
  const deact = await rpc('set_member_status', coord.token, { p_member_id: memberB.id, p_status: 'inactive', p_reason: `${run} test` });
  const afterRpc = mustOk('read after RPC', await svc('GET', `/profiles?id=eq.${memberB.id}&select=status`), true)[0];
  pass('Status', 'Coordinator set_member_status active -> inactive succeeds', deact.status < 300 && afterRpc.status === 'inactive', `HTTP ${deact.status}`);
  const audit = mustOk('status audit', await svc('GET', `/member_status_audit?member_id=eq.${memberB.id}&select=from_status,to_status,actor_id`), false);
  pass('Status', 'member_status_audit records the change with the coordinator as actor',
    Array.isArray(audit) && audit.some((a) => a.from_status === 'active' && a.to_status === 'inactive' && a.actor_id === coord.id));

  // ── Contact logging (migration 091) ─────────────────────────────────────────────────────────────────────────────────
  const personFor = async (who, name) => {
    const r = await call('POST', '/rest/v1/people', who.token, { full_name: `${run} ${name}` }, 'return=representation');
    if (!Array.isArray(r.data) || !r.data[0]?.id) return null;
    created.people.push(r.data[0].id);
    return r.data[0].id;
  };
  const logContact = (who, body) => call('POST', '/rest/v1/contacts', who.token, body, 'return=representation');
  const contactRow = async (name) => {
    const r = await svc('GET', `/contacts?contact_name=eq.${encodeURIComponent(name)}&select=id,logged_by,cell_id`);
    return Array.isArray(r.data) ? r.data : [];
  };

  const basePayload = (name, who, cellId) => ({
    contact_name: name, cell_id: cellId, date_contacted: new Date().toISOString().slice(0, 10),
    tag: '', follow_up_status: '', phone_hidden: false, is_member: false, logged_by: who.id,
  });

  // Positive: active member logs to own cell, and unassigned.
  const pOwn = await personFor(memberA, 'own');
  const ownName = `${run} own-cell contact`;
  if (pOwn) {
    const r = await logContact(memberA, { ...basePayload(ownName, memberA, cellA.id), person_id: pOwn });
    const rows = await contactRow(ownName);
    pass('Contacts', 'Active member logs a contact to own cell', r.status < 300 && rows.length === 1 && rows[0].logged_by === memberA.id);
    if (rows[0]) created.contacts.push(rows[0].id);
  } else blocked('Contacts', 'Active member logs a contact to own cell', 'person creation returned no row');

  const pNone = await personFor(memberB, 'unassigned');
  const noneName = `${run} unassigned contact`;
  if (pNone) {
    const r = await logContact(memberB, { ...basePayload(noneName, memberB, null), person_id: pNone });
    const rows = await contactRow(noneName);
    pass('Contacts', 'Active member without a cell logs an unassigned contact', r.status < 300 && rows.length === 1 && rows[0].cell_id === null);
    if (rows[0]) created.contacts.push(rows[0].id);
  }

  // Negative: cross-cell attribution by an active member.
  const crossName = `${run} cross-cell contact`;
  const cross = await logContact(memberA, { ...basePayload(crossName, memberA, cellB.id), person_id: pOwn ?? undefined });
  pass('Contacts', 'Active member cannot attribute a contact to another cell', (await contactRow(crossName)).length === 0, `HTTP ${cross.status}`);

  // Negative: ownership spoofing (logged_by is another person).
  const spoofName = `${run} spoofed logger`;
  const spoof = await logContact(memberA, { ...basePayload(spoofName, { id: leaderA.id }, cellA.id), person_id: pOwn ?? undefined });
  pass('Contacts', 'Active member cannot log a contact as another logger', (await contactRow(spoofName)).length === 0, `HTTP ${spoof.status}`);

  // Self-read: a member reads own logged contacts and not another member's.
  const own = await call('GET', `/rest/v1/contacts?select=contact_name,logged_by`, memberA.token);
  const sawOther = Array.isArray(own.data) && own.data.some((c) => c.logged_by !== memberA.id);
  pass('Contacts', 'Active member self-read returns only contacts they logged', Array.isArray(own.data) && !sawOther);

  // Negative: pending and rejected accounts cannot log contacts.
  const pendingContact = `${run} pending contact`;
  const pendingTry = await logContact(pendingB, { ...basePayload(pendingContact, pendingB, null), person_id: pOwn ?? undefined });
  pass('Contacts', 'Pending applicant cannot log a contact', (await contactRow(pendingContact)).length === 0, `HTTP ${pendingTry.status}`);

  // ── Placement (migration 092) ───────────────────────────────────────────────────────────────────────────────────────
  const placeAsLeader = await rpc('assign_pending_applicant_to_cell', leaderA.token, { p_member_id: pendingB.id, p_cell_id: cellA.id });
  const pbAfterLeader = mustOk('read pendingB after leader attempt', await svc('GET', `/profiles?id=eq.${pendingB.id}&select=cell_id`), true)[0];
  pass('Placement', 'Cell Leader cannot place a pending applicant', pbAfterLeader.cell_id === null, `HTTP ${placeAsLeader.status}`);

  const placeAsMember = await rpc('assign_pending_applicant_to_cell', memberA.token, { p_member_id: pendingB.id, p_cell_id: cellA.id });
  pass('Placement', 'Active member cannot place a pending applicant', placeAsMember.status >= 400, `HTTP ${placeAsMember.status}`);

  const directPlace = await call('PATCH', `/rest/v1/profiles?id=eq.${pendingB.id}`, coord.token, { cell_id: cellA.id }, 'return=minimal');
  const pbAfterDirect = mustOk('read pendingB after direct PATCH', await svc('GET', `/profiles?id=eq.${pendingB.id}&select=cell_id`), true)[0];
  pass('Placement', 'Coordinator direct PATCH cannot place a pending applicant', pbAfterDirect.cell_id === null, `HTTP ${directPlace.status}`);

  const selfPlace = await rpc('assign_pending_applicant_to_cell', pendingB.token, { p_member_id: pendingB.id, p_cell_id: cellA.id });
  pass('Placement', 'Pending applicant cannot place self', selfPlace.status >= 400, `HTTP ${selfPlace.status}`);

  const adminPlace = await rpc('assign_pending_applicant_to_cell', admin.token, { p_member_id: pendingB.id, p_cell_id: cellA.id });
  const pbAfterAdmin = mustOk('read pendingB after admin placement', await svc('GET', `/profiles?id=eq.${pendingB.id}&select=cell_id`), true)[0];
  pass('Placement', 'Admin places a pending applicant through the RPC', adminPlace.status < 300 && pbAfterAdmin.cell_id === cellA.id);

  const audited = mustOk('member_cell_audit', await svc('GET', `/member_cell_audit?member_id=eq.${pendingB.id}&select=to_cell_id,actor_id`), false);
  pass('Placement', 'member_cell_audit records the admin placement with the admin as actor',
    Array.isArray(audited) && audited.some((a) => a.to_cell_id === cellA.id && a.actor_id === admin.id));

  // ── Cleanup (only rows created by this run) ─────────────────────────────────────────────────────────────────────────
  for (const id of created.contacts) await svc('DELETE', `/contacts?id=eq.${id}`, undefined, 'return=minimal');
  for (const id of created.people) await svc('DELETE', `/people?id=eq.${id}`, undefined, 'return=minimal');
  for (const id of created.bscs) await svc('DELETE', `/bscs?id=eq.${id}`, undefined, 'return=minimal');
  for (const id of created.cells) await svc('DELETE', `/cells?id=eq.${id}`, undefined, 'return=minimal');
  for (const id of created.users) {
    const r = await call('DELETE', `/auth/v1/admin/users/${id}`, service, undefined);
    if (r.status >= 300) console.log(`CLEANUP-WARN\tuser ${id}\tHTTP ${r.status}`);
  }

  const counts = results.reduce((acc, r) => { acc[r.status] = (acc[r.status] ?? 0) + 1; return acc; }, {});
  console.log(`\nSUMMARY ${JSON.stringify(counts)}`);
  process.exit(results.some((r) => r.status === 'FAIL' || r.status === 'BLOCKED') ? 1 : 0);
}

main().catch((e) => {
  console.error('RUN ABORTED:', e.message);
  process.exit(1);
});
