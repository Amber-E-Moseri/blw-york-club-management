// status_transition_adversarial_test.mjs
//
// Real authenticated-session test of profile status authority. Each actor signs in through GoTrue and calls PostgREST
// or an RPC with its own bearer token, which is the path the app uses. Local stack only. Creates and removes its own
// accounts.
//
// Approved rules (migrations 016, 048, 083):
//   - Status changes go through approve_pending_member (pending -> active), reject_pending_member (pending -> rejected)
//     and set_member_status (active <-> inactive, rejected -> pending), called by an admin or coordinator.
//   - set_member_status refuses self-change, refuses changes to a coordinator account, and refuses changes to an admin
//     account unless the caller is a coordinator. It requires a reason and writes member_status_audit.
//   - A rejected member is not reactivated directly. A pending account is not moved by set_member_status.
//   - Nobody else changes a profile's status: members, cell leaders and BSC leaders have no status authority.
//
// Two groups:
//   W  workflow: legitimate coordinator actions through the RPCs must still work (they must PASS);
//   N  workflow negatives: forbidden transitions through the RPCs must be refused;
//   D  direct: direct authenticated PATCH/DELETE on profiles must not change status or delete a profile.
//      A direct attempt is judged by the database state after the attempt, not by the HTTP status alone.
//
//   node supabase/verification/status_transition_adversarial_test.mjs
// Needs SUPABASE_URL (local), SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY. Exits 1 on any failed expectation.

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
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}\t${name}\t${detail}`);
};

async function call(method, path, token, body, prefer = '') {
  const r = await fetch(`${url}${path}`, {
    method,
    headers: { apikey: anon, Authorization: `Bearer ${token ?? anon}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: r.status, data };
}
const sRest = (method, path, body, prefer = 'return=representation') => call(method, `/rest/v1${path}`, service, body, prefer);
const rpc = (name, token, body) => call('POST', `/rest/v1/rpc/${name}`, token, body);

let seq = 0;
// The first coordinator is the one owner-level fixture step (setProfileAsOwner, local only). Every other state is reached
// through the approved workflow with that coordinator's session: approve_pending_member, reject_pending_member,
// set_member_status, and a coordinator role PATCH (role changes need an active account, migration 048).
let coordinatorToken = null;
async function createUser(role, status, label) {
  seq += 1;
  const email = `sta.${label}.${run}.${seq}@t9.test`;
  const password = `Pw-${run}-${label}-${seq}-7`;
  const r = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const user = await r.json();
  if (!user.id) throw new Error(`createUser ${label}: ${JSON.stringify(user)}`);
  created.push(user.id);
  const s = await (await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  })).json();
  if (!s.access_token) throw new Error(`sign-in ${label}: ${JSON.stringify(s)}`);

  if (label === 'coord') {
    await setProfileAsOwner(user.id, { role: 'coordinator', status: 'active' });
    coordinatorToken = s.access_token;
  } else {
    if (status === 'rejected') {
      const rj = await rpc('reject_pending_member', coordinatorToken, { target_member_id: user.id });
      if (rj.status >= 300) throw new Error(`fixture reject ${label}: ${rj.status}`);
    } else if (status !== 'pending') {
      const ap = await rpc('approve_pending_member', coordinatorToken, { target_member_id: user.id });
      if (ap.status >= 300) throw new Error(`fixture approve ${label}: ${ap.status}`);
      if (status === 'inactive') {
        const de = await rpc('set_member_status', coordinatorToken, { p_member_id: user.id, p_status: 'inactive', p_reason: 'fixture setup' });
        if (de.status >= 300) throw new Error(`fixture deactivate ${label}: ${de.status}`);
      }
    }
    if (role !== 'member' && status === 'active') {
      const rp = await call('PATCH', `/rest/v1/profiles?id=eq.${user.id}`, coordinatorToken, { role }, 'return=representation');
      if (rp.status >= 300) throw new Error(`fixture role ${label}: ${rp.status}`);
    }
  }
  return { label, id: user.id, token: s.access_token };
}
const created = [];
const statusOf = async (id) => (await sRest('GET', `/profiles?id=eq.${id}&select=status`)).data?.[0]?.status ?? null;
// member_status_audit is readable by admins and coordinators only (migration 080 policy). service_role has no privilege on
// it (migration 086), so the audit is read as a coordinator. Pass the coordinator's token.
const auditCount = async (token, id, to) =>
  (await call('GET', `/rest/v1/member_status_audit?member_id=eq.${id}&to_status=eq.${to}&select=id`, token)).data?.length ?? 0;

try {
  // Actors
  const coord = await createUser('coordinator', 'active', 'coord');
  const admin = await createUser('admin', 'active', 'admin');
  const cellLeader = await createUser('cell_leader', 'active', 'lead');
  const plainMember = await createUser('member', 'active', 'self');

  // ─── W: legitimate workflow (must PASS) ────────────────────────────────────────────────────────────────────────
  const pendA = await createUser('member', 'pending', 'pendA');
  const ap = await rpc('approve_pending_member', coord.token, { target_member_id: pendA.id });
  check('W1 coordinator approves a pending member (approve_pending_member)', ap.status === 200 && (await statusOf(pendA.id)) === 'active', `${ap.status}`);

  const pendB = await createUser('member', 'pending', 'pendB');
  const rj = await rpc('reject_pending_member', coord.token, { target_member_id: pendB.id });
  check('W2 coordinator rejects a pending member (reject_pending_member)', rj.status === 200 && (await statusOf(pendB.id)) === 'rejected', `${rj.status}`);

  const actA = await createUser('member', 'active', 'actA');
  const de = await rpc('set_member_status', coord.token, { p_member_id: actA.id, p_status: 'inactive', p_reason: 'left the fellowship' });
  check('W3 coordinator deactivates an active member with a reason (set_member_status)',
    de.status === 200 && (await statusOf(actA.id)) === 'inactive' && (await auditCount(coord.token, actA.id, 'inactive')) === 1, `${de.status}`);

  const re = await rpc('set_member_status', coord.token, { p_member_id: actA.id, p_status: 'active', p_reason: 'returned' });
  check('W4 coordinator reactivates an inactive member (set_member_status)',
    re.status === 200 && (await statusOf(actA.id)) === 'active' && (await auditCount(coord.token, actA.id, 'active')) === 1, `${re.status}`);

  const rjReopen = await createUser('member', 'rejected', 'rejR');
  const reo = await rpc('set_member_status', coord.token, { p_member_id: rjReopen.id, p_status: 'pending', p_reason: 'reopened for review' });
  check('W5 coordinator reopens a rejected account as pending (set_member_status)', reo.status === 200 && (await statusOf(rjReopen.id)) === 'pending', `${reo.status}`);

  // ─── N: forbidden transitions through the RPCs (must be refused) ─────────────────────────────────────────────
  const actN1 = await createUser('member', 'active', 'actN1');
  const n1 = await rpc('set_member_status', coord.token, { p_member_id: actN1.id, p_status: 'pending', p_reason: 'x' });
  check('N1 active -> pending through set_member_status is refused', n1.status >= 400 && (await statusOf(actN1.id)) === 'active', `${n1.status}`);

  const rejN2 = await createUser('member', 'rejected', 'rejN2');
  const n2 = await rpc('set_member_status', coord.token, { p_member_id: rejN2.id, p_status: 'active', p_reason: 'x' });
  check('N2 rejected -> active through set_member_status is refused', n2.status >= 400 && (await statusOf(rejN2.id)) === 'rejected', `${n2.status}`);

  const n3 = await rpc('set_member_status', coord.token, { p_member_id: coord.id, p_status: 'inactive', p_reason: 'x' });
  check('N3 a coordinator cannot change their own status', n3.status >= 400 && (await statusOf(coord.id)) === 'active', `${n3.status}`);

  const n4 = await rpc('set_member_status', admin.token, { p_member_id: coord.id, p_status: 'inactive', p_reason: 'x' });
  check('N4 an admin cannot change a coordinator account', n4.status >= 400 && (await statusOf(coord.id)) === 'active', `${n4.status}`);

  const n5 = await rpc('set_member_status', cellLeader.token, { p_member_id: actA.id, p_status: 'inactive', p_reason: 'x' });
  check('N5 a cell leader cannot change a member status', n5.status >= 400 && (await statusOf(actA.id)) === 'active', `${n5.status}`);

  // ─── D: direct authenticated writes (must not change status or delete a profile) ──────────────────────────────
  // Judged by database state after the attempt, not by HTTP status.
  const rejD1 = await createUser('member', 'rejected', 'rejD1');
  await call('PATCH', `/rest/v1/profiles?id=eq.${rejD1.id}`, coord.token, { status: 'active' }, 'return=representation');
  check('D1 coordinator direct update cannot reactivate a rejected member', (await statusOf(rejD1.id)) === 'rejected', `now=${await statusOf(rejD1.id)}`);

  const actD2 = await createUser('member', 'active', 'actD2');
  await call('PATCH', `/rest/v1/profiles?id=eq.${actD2.id}`, coord.token, { status: 'pending' }, 'return=representation');
  check('D2 coordinator direct update cannot move an active member to pending', (await statusOf(actD2.id)) === 'active', `now=${await statusOf(actD2.id)}`);

  const inD3 = await createUser('member', 'inactive', 'inD3');
  await call('PATCH', `/rest/v1/profiles?id=eq.${inD3.id}`, coord.token, { status: 'active' }, 'return=representation');
  check('D3 coordinator direct update cannot reactivate an inactive member (bypasses audit and reason)',
    (await statusOf(inD3.id)) === 'inactive' && (await auditCount(coord.token, inD3.id, 'active')) === 0, `now=${await statusOf(inD3.id)}`);

  await call('PATCH', `/rest/v1/profiles?id=eq.${coord.id}`, coord.token, { status: 'inactive' }, 'return=representation');
  check('D4 a coordinator cannot deactivate their own account by direct update', (await statusOf(coord.id)) === 'active', `now=${await statusOf(coord.id)}`);

  await call('PATCH', `/rest/v1/profiles?id=eq.${plainMember.id}`, plainMember.token, { status: 'inactive' }, 'return=representation');
  check('D5 a member cannot change their own status', (await statusOf(plainMember.id)) === 'active', `now=${await statusOf(plainMember.id)}`);

  // A fresh active member, so the result does not depend on D2.
  const actD6 = await createUser('member', 'active', 'actD6');
  await call('PATCH', `/rest/v1/profiles?id=eq.${actD6.id}`, cellLeader.token, { status: 'inactive' }, 'return=representation');
  check('D6 a cell leader cannot change a member status by direct update', (await statusOf(actD6.id)) === 'active', `now=${await statusOf(actD6.id)}`);

  // Deletion is not a status transition, but it removes an account without the audit or approval path. Reported on
  // its own; the status correction does not change it.
  const delVictim = await createUser('member', 'active', 'delV');
  await call('DELETE', `/rest/v1/profiles?id=eq.${delVictim.id}`, coord.token, undefined, 'return=representation');
  check('D7 coordinator direct DELETE of a profile is refused (separate finding)', (await sRest('GET', `/profiles?id=eq.${delVictim.id}&select=id`)).data?.length === 1,
    'profile still present');
} finally {
  // Clean up the accounts this run created. profiles.id references auth.users with ON DELETE CASCADE (000), so removing the
  // auth user removes its profile. The service role holds no DELETE on profiles (094).
  for (const id of created) {
    await fetch(`${url}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: { apikey: service, Authorization: `Bearer ${service}` } });
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\nstatus-transition: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exit(1);
