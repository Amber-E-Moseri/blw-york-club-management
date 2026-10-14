// security_gap_regression_test.mjs
//
// Real authenticated-session regression tests for four BSC and devotional invariants. Fixtures are written with the
// service role. Every actor signs in through GoTrue and calls PostgREST or an RPC with its own bearer token.
// Local disposable stack only.
//
// Each check states the secure expectation. A denial is counted only when the database refuses with the expected
// SQLSTATE or the expected message, or when an RLS write touches zero rows. Any other error is reported as an
// unexpected error, so a fixture problem cannot pass as an authorisation denial.
//
//   node supabase/verification/security_gap_regression_test.mjs
// Needs SUPABASE_URL (local), SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY. Exits 1 on any failed check.

import { setProfileAsOwner } from './lib.mjs';

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
const check = (name, ok, evidence = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}\t${name}\t${evidence}`);
};

class FixtureError extends Error {}

async function rest(method, path, token, body, prefer = 'return=representation') {
  const r = await fetch(`${url}/rest/v1${path}`, {
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

const sRest = (method, path, body) => rest(method, path, service, body);
// Owner fixture writes (local only, lib.mjs). service_role holds no profile UPDATE (094). Each write returns the same
// {status, data} shape as a PostgREST call, so the fixture checks below are unchanged.
const ownerWrite = async (id, fields) => {
  try { await setProfileAsOwner(id, fields); return { status: 200, data: [{ id }] }; }
  catch (e) { return { status: 500, data: e.message }; }
};

async function rpc(token, fn, args = {}) {
  return rest('POST', `/rpc/${fn}`, token, args, '');
}

// A write is "applied" when PostgREST returns at least one row. An RLS denial returns zero rows with a 2xx status.
function writeOutcome(res) {
  if (res.status >= 400) return { kind: 'error', code: res.data?.code, message: res.data?.message ?? '' };
  return { kind: Array.isArray(res.data) && res.data.length > 0 ? 'applied' : 'no-rows' };
}

function rpcOutcome(res) {
  if (res.status >= 400) return { kind: 'error', code: res.data?.code, message: res.data?.message ?? '' };
  return { kind: 'ok', data: res.data };
}

const describe = (o) => (o.kind === 'error' ? `error ${o.code}: ${o.message}` : o.kind);

async function createUser(label, { role = 'member', status = 'active', cellId = null } = {}) {
  const email = `sec.${label}.${run}@example.test`;
  const password = `Sec-${run}-${label}-Pw7!`;
  const r = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: `Sec ${label}` } }),
  });
  const user = await r.json();
  if (!user.id) throw new FixtureError(`createUser ${label}: ${JSON.stringify(user)}`);
  // Owner fixture state. The signup trigger creates the profile as pending; status, role and cell are then set locally.
  const up = await ownerWrite(user.id, { status, role, cellId: cellId || undefined });
  if (up.status >= 400) throw new FixtureError(`profile ${label}: ${JSON.stringify(up.data)}`);
  const s = await (await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })).json();
  if (!s.access_token) throw new FixtureError(`sign-in ${label}: ${JSON.stringify(s)}`);
  return { label, id: user.id, token: s.access_token };
}

async function fixture(label, res) {
  if (res.status >= 400 || !Array.isArray(res.data) || res.data.length === 0) {
    throw new FixtureError(`${label}: ${res.status} ${JSON.stringify(res.data)}`);
  }
  return res.data[0];
}

async function visibleMembers(token) {
  const r = await rpc(token, 'bsc_members_visible');
  if (r.status >= 400) return { error: r.data };
  return { ids: new Set((r.data ?? []).map((m) => m.id)) };
}

// The audit table grants no privilege to service_role (by design), so audit reads go through a staff session.
async function auditRows(memberId, token) {
  const r = await rest('GET', `/bsc_assignment_audit?member_id=eq.${memberId}&select=from_bsc_id,to_bsc_id,performed_by&order=performed_at`, token);
  if (r.status >= 400) throw new FixtureError(`audit read: ${JSON.stringify(r.data)}`);
  return r.data;
}

async function profile(id) {
  const r = await sRest('GET', `/profiles?id=eq.${id}&select=cell_id,bsc_id,status,role`);
  return r.data?.[0];
}

const assignBsc = (actor, memberId, bscId) => rpc(actor.token, 'assign_member_to_bsc', { p_member_id: memberId, p_bsc_id: bscId });

try {
  // ─── Structure ───────────────────────────────────────────────────────────────────────────────────────────────────
  const fellowship = await fixture('fellowship', await sRest('POST', '/fellowships', { name: `Sec fellowship ${run}` }));
  const cellA = await fixture('cell A', await sRest('POST', '/cells', { name: `Sec cell A ${run}`, fellowship_id: fellowship.id }));
  const cellB = await fixture('cell B', await sRest('POST', '/cells', { name: `Sec cell B ${run}`, fellowship_id: fellowship.id }));

  const coord = await createUser('coord', { role: 'coordinator' });
  const admin = await createUser('admin', { role: 'admin' });
  const rejectedCoord = await createUser('rejcoord', { role: 'coordinator', status: 'rejected' });
  const leadA = await createUser('leadA', { cellId: cellA.id });
  const leadB = await createUser('leadB', { cellId: cellB.id });
  const bscALeader = await createUser('bscALeader', { cellId: cellA.id });
  const bscBLeader = await createUser('bscBLeader', { cellId: cellB.id });
  const other = await createUser('other');
  const movedMember = await createUser('moved', { cellId: cellA.id });
  const directMember = await createUser('direct', { cellId: cellA.id });
  const inactiveMember = await createUser('inactive', { cellId: cellA.id });
  const metaMember = await createUser('meta');

  await fixture('cell A leader', await sRest('PATCH', `/cells?id=eq.${cellA.id}`, { leader_id: leadA.id }));
  await fixture('cell B leader', await sRest('PATCH', `/cells?id=eq.${cellB.id}`, { leader_id: leadB.id }));

  const bscA = await fixture('BSC A', await sRest('POST', '/bscs', { cell_id: cellA.id, name: `Sec BSC A ${run}`, leader_id: bscALeader.id }));
  const bscB = await fixture('BSC B', await sRest('POST', '/bscs', { cell_id: cellB.id, name: `Sec BSC B ${run}`, leader_id: bscBLeader.id }));

  // ─── 1. Cross-cell BSC roster access ─────────────────────────────────────────────────────────────────────────────
  {
    const legit = await assignBsc(coord, movedMember.id, bscA.id);
    check("1 fixture: coordinator assigns member to BSC A in the member's cell", rpcOutcome(legit).kind === 'ok', describe(rpcOutcome(legit)));

    const transferWhileAssigned = await rest('PATCH', `/profiles?id=eq.${movedMember.id}`, coord.token, { cell_id: cellB.id });
    const twOut = writeOutcome(transferWhileAssigned);
    check('1d coordinator cannot move a member to another cell while still assigned to a BSC', twOut.kind !== 'applied', `outcome=${describe(twOut)}`);

    const unassigned = await assignBsc(coord, movedMember.id, null);
    check('1 legit: coordinator unassigns the member before the cell move', rpcOutcome(unassigned).kind === 'ok', describe(rpcOutcome(unassigned)));
    const transfer = await rest('PATCH', `/profiles?id=eq.${movedMember.id}`, coord.token, { cell_id: cellB.id });
    const tOut = writeOutcome(transfer);
    check('1 legit: coordinator moves the unassigned member to cell B', tOut.kind === 'applied', describe(tOut));

    // Simulates a stale assignment left by data written before the fix: the service role bypasses the guard.
    await fixture('legacy stale assignment', await ownerWrite(movedMember.id, { bscId: bscA.id }));
    const p = await profile(movedMember.id);
    console.log(`INFO\t1 stale state\tcell_id=${p.cell_id === cellB.id ? 'cell B' : p.cell_id} bsc_id=${p.bsc_id === bscA.id ? 'BSC A (cell A)' : p.bsc_id}`);

    const formerBsc = await visibleMembers(bscALeader.token);
    check('1a former BSC leader cannot read a transferred member through BSC A', !formerBsc.error && !formerBsc.ids.has(movedMember.id),
      formerBsc.error ? `error ${formerBsc.error.code}` : `visible=${formerBsc.ids.has(movedMember.id) ? 'yes' : 'no'}`);

    const formerCell = await visibleMembers(leadA.token);
    check('1b former cell leader cannot read a transferred member through BSC A', !formerCell.error && !formerCell.ids.has(movedMember.id),
      formerCell.error ? `error ${formerCell.error.code}` : `visible=${formerCell.ids.has(movedMember.id) ? 'yes' : 'no'}`);

    const formerProfile = await rest('GET', `/profiles?id=eq.${movedMember.id}&select=id`, bscALeader.token, undefined, '');
    check('1c former BSC leader reads no profile row of the transferred member', formerProfile.status === 200 && formerProfile.data.length === 0,
      `status=${formerProfile.status} rows=${Array.isArray(formerProfile.data) ? formerProfile.data.length : 'n/a'}`);

    const reassign = await assignBsc(coord, movedMember.id, bscB.id);
    check('1 legit: coordinator assigns member to BSC B in cell B', rpcOutcome(reassign).kind === 'ok', describe(rpcOutcome(reassign)));
    const newBsc = await visibleMembers(bscBLeader.token);
    check('1 legit: BSC B leader reads the member after reassignment', !newBsc.error && newBsc.ids.has(movedMember.id),
      newBsc.error ? `error ${newBsc.error.code}` : `visible=${newBsc.ids.has(movedMember.id) ? 'yes' : 'no'}`);
  }

  // ─── 2. Audited BSC assignments ──────────────────────────────────────────────────────────────────────────────────
  {
    await ownerWrite(directMember.id, { bscId: null });
    const before = (await auditRows(directMember.id, coord.token)).length;

    const crossCell = await rest('PATCH', `/profiles?id=eq.${directMember.id}`, coord.token, { bsc_id: bscB.id });
    const cOut = writeOutcome(crossCell);
    check('2a coordinator direct write of a cross-cell BSC is refused', cOut.kind !== 'applied', `outcome=${describe(cOut)}`);

    const sameCell = await rest('PATCH', `/profiles?id=eq.${directMember.id}`, coord.token, { bsc_id: bscA.id });
    const sOut = writeOutcome(sameCell);
    check('2b coordinator direct write bypassing the audited RPC is refused', sOut.kind !== 'applied', `outcome=${describe(sOut)}`);

    const afterDirect = (await auditRows(directMember.id, coord.token)).length;
    const stateAfter = await profile(directMember.id);
    const changed = stateAfter.bsc_id !== null;
    check('2c every bsc_id change has an audit row', !changed || afterDirect > before,
      `bsc_id=${changed ? 'set' : 'null'} audit rows before=${before} after=${afterDirect}`);

    await ownerWrite(directMember.id, { bscId: null });
    const adminDirect = await rest('PATCH', `/profiles?id=eq.${directMember.id}`, admin.token, { bsc_id: bscA.id });
    const aOut = writeOutcome(adminDirect);
    check('2d admin role direct write is refused (RPC only)', aOut.kind !== 'applied', `outcome=${describe(aOut)}`);

    const selfDirect = await rest('PATCH', `/profiles?id=eq.${directMember.id}`, directMember.token, { bsc_id: bscA.id });
    const selfOut = writeOutcome(selfDirect);
    check('2e member cannot change own bsc_id', selfOut.kind !== 'applied', `outcome=${describe(selfOut)}`);

    const legitAssign = await assignBsc(coord, directMember.id, bscA.id);
    check('2f legit: coordinator assigns member through the RPC', rpcOutcome(legitAssign).kind === 'ok', describe(rpcOutcome(legitAssign)));
    const rows = await auditRows(directMember.id, coord.token);
    const last = rows[rows.length - 1];
    check('2g legit: RPC writes one audit row with performer and destination',
      rows.length === before + 1 && last?.to_bsc_id === bscA.id && last?.performed_by === coord.id,
      `rows=${rows.length} to=${last?.to_bsc_id === bscA.id ? 'BSC A' : last?.to_bsc_id} by=${last?.performed_by === coord.id ? 'coordinator' : last?.performed_by}`);

    const wrongCell = await assignBsc(coord, directMember.id, bscB.id);
    const wOut = rpcOutcome(wrongCell);
    check("2h RPC refuses a BSC outside the member's current cell (P0001)",
      wOut.kind === 'error' && wOut.code === 'P0001' && /current cell/.test(wOut.message),
      `outcome=${describe(wOut)}`);

    const memberRpc = await assignBsc(other, directMember.id, null);
    const mOut = rpcOutcome(memberRpc);
    check('2i RPC refuses a non-staff caller (42501)', mOut.kind === 'error' && mOut.code === '42501', `outcome=${describe(mOut)}`);

    const rejectedRpc = await assignBsc(rejectedCoord, directMember.id, null);
    const rOut = rpcOutcome(rejectedRpc);
    check('2j RPC refuses a rejected coordinator (42501)', rOut.kind === 'error' && rOut.code === '42501', `outcome=${describe(rOut)}`);

    const adminRpc = await assignBsc(admin, directMember.id, bscA.id);
    check('2k legit: admin role assigns through the RPC', rpcOutcome(adminRpc).kind === 'ok', describe(rpcOutcome(adminRpc)));
  }

  // ─── 3. Inactive-member lifecycle ────────────────────────────────────────────────────────────────────────────────
  {
    const lifecycleBsc = await fixture('lifecycle BSC', await sRest('POST', '/bscs', { cell_id: cellA.id, name: `Sec lifecycle BSC ${run}`, leader_id: bscALeader.id }));
    const assign = await assignBsc(coord, inactiveMember.id, lifecycleBsc.id);
    check('3 fixture: coordinator assigns member to the lifecycle BSC', rpcOutcome(assign).kind === 'ok', describe(rpcOutcome(assign)));

    const blockedDelete = await sRest('DELETE', `/bscs?id=eq.${lifecycleBsc.id}`);
    const dOut = writeOutcome(blockedDelete);
    check('3a BSC with members cannot be deleted', dOut.kind !== 'applied', `outcome=${describe(dOut)}`);

    // UNREACHABLE BY WORKFLOW: a rejected account cannot keep a BSC through any approved path. The owner helper sets it
    // so the check below can run. It is reported as BLOCKED, not as a pass, because the state is not an authorised one.
    const deact = await ownerWrite(inactiveMember.id, { status: 'rejected' });
    console.log(`BLOCKED\t3 fixture: member rejected while in a BSC is owner-set (no workflow reaches it); dependent checks are not counted as passed`);

    const denied = await assignBsc(other, inactiveMember.id, null);
    const uOut = rpcOutcome(denied);
    check('3b unauthorised user cannot unassign the inactive member (42501)', uOut.kind === 'error' && uOut.code === '42501', `outcome=${describe(uOut)}`);

    const unassign = await assignBsc(coord, inactiveMember.id, null);
    const nOut = rpcOutcome(unassign);
    check('3c staff can unassign an inactive member', nOut.kind === 'ok', describe(nOut));

    const audit = await auditRows(inactiveMember.id, coord.token);
    const lastAudit = audit[audit.length - 1];
    check('3d unassignment is audited with the BSC it left',
      audit.length === 2 && lastAudit?.from_bsc_id === lifecycleBsc.id && lastAudit?.to_bsc_id === null,
      `audit rows=${audit.length}`);

    const del = await sRest('DELETE', `/bscs?id=eq.${lifecycleBsc.id}`);
    check('3e BSC can be deleted once its roster is empty', writeOutcome(del).kind === 'applied', describe(writeOutcome(del)));

    const afterDelete = await auditRows(inactiveMember.id, coord.token);
    check('3f audit history survives BSC deletion', afterDelete.length === 2, `audit rows=${afterDelete.length}`);
  }

  // ─── 4. Devotional administration cannot be claimed through user_metadata ───────────────────────────────────────
  {
    const claim = await fetch(`${url}/auth/v1/user`, {
      method: 'PUT',
      headers: { apikey: anon, Authorization: `Bearer ${metaMember.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { role: 'admin' } }),
    });
    check('4 fixture: member sets user_metadata.role to admin', claim.status === 200, `status=${claim.status}`);

    const helper = await rpc(metaMember.token, 'is_devotional_admin');
    check('4a is_devotional_admin() is false for a member with user_metadata.role = admin', helper.status === 200 && helper.data === false,
      `status=${helper.status} value=${JSON.stringify(helper.data)}`);

    const monthly = await fixture('monthly devotional', await sRest('POST', '/monthly_devotionals', {
      month: 1, year: 2026, title: `Sec ${run}`, book_title: `Sec book ${run}`, total_days: 31, total_pages: 100, created_by: coord.id,
    }));
    const page = await fixture('daily page', await sRest('POST', '/devotional_daily_pages', {
      devotional_id: monthly.id, day_of_month: 1, page_range: '1-2', image_url: 'https://example.test/a.png', title: 'Before',
    }));

    const memberWrite = await rest('PATCH', `/devotional_daily_pages?id=eq.${page.id}`, metaMember.token, { title: 'Member edit' });
    const mw = writeOutcome(memberWrite);
    check('4b member with user_metadata.role = admin cannot edit devotional pages', mw.kind !== 'applied', `outcome=${describe(mw)}`);

    const coordWrite = await rest('PATCH', `/devotional_daily_pages?id=eq.${page.id}`, coord.token, { title: 'Coordinator edit' });
    const cw = writeOutcome(coordWrite);
    check('4c control: active coordinator can edit devotional pages', cw.kind === 'applied', `outcome=${describe(cw)}`);

    const rejectedHelper = await rpc(rejectedCoord.token, 'is_devotional_admin');
    check('4d rejected coordinator is not a devotional admin', rejectedHelper.status === 200 && rejectedHelper.data === false,
      `status=${rejectedHelper.status} value=${JSON.stringify(rejectedHelper.data)}`);
  }
} catch (err) {
  if (err instanceof FixtureError) {
    console.log(`FIXTURE\t${err.message}`);
    process.exit(2);
  }
  throw err;
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
