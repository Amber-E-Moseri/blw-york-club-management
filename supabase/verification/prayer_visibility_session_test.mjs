// prayer_visibility_session_test.mjs
//
// Real authenticated-session test of prayer visibility (T7 and cross-cell isolation). It goes through the same path the
// app uses: GoTrue sign-in for a JWT, then PostgREST with that bearer token. Local stack only. Refuses any non-local URL.
//
//   node supabase/verification/prayer_visibility_session_test.mjs
//
// Needs SUPABASE_URL (local API), SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY. Creates accounts with a run-specific
// prefix and deletes them at the end. Exits 1 if any expectation fails. Expectations are the intended behaviour.

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

async function admin(method, path, body) {
  const r = await fetch(`${url}/auth/v1${path}`, {
    method,
    headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

async function rest(method, path, token, body, prefer = '') {
  const r = await fetch(`${url}/rest/v1${path}`, {
    method,
    headers: {
      apikey: anon,
      Authorization: `Bearer ${token ?? anon}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: r.status, data };
}

async function serviceRest(method, path, body) {
  return rest(method, path, service, body, 'return=representation');
}

async function createUser(name) {
  const email = `${name}.${run}@t7.test`;
  const password = `Pw-${run}-${name}-9`;
  const user = await admin('POST', '/admin/users', { email, password, email_confirm: true });
  const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const session = await r.json();
  if (!session.access_token) throw new Error(`sign-in failed for ${name}: ${JSON.stringify(session)}`);
  return { name, id: user.id, token: session.access_token };
}

// Owner fixture state (local only, lib.mjs). service_role holds no profile UPDATE (094).
async function setProfile(id, fields) {
  const { status, role, cell_id, bsc_id } = fields;
  await setProfileAsOwner(id, { status, role, cellId: cell_id, bscId: bsc_id });
}

async function listPrayers(token) {
  const r = await rest('GET', '/prayer_requests?select=id,content,visibility,author_id&order=content', token);
  return { status: r.status, rows: Array.isArray(r.data) ? r.data : [] };
}

const created = [];
try {
  // Cells: C1 and C2 (in the real schema, cells need a name and optionally a fellowship)
  const cellA = (await serviceRest('POST', '/cells', { name: `T7 cell A ${run}` })).data[0].id;
  const cellB = (await serviceRest('POST', '/cells', { name: `T7 cell B ${run}` })).data[0].id;

  // Accounts. The on-signup trigger creates the profile; statuses and roles are set with the service key.
  const people = {};
  for (const [key, spec] of Object.entries({
    authorActive:   { role: 'member', status: 'active', cell_id: cellA },
    authorPending:  { role: 'member', status: 'pending', cell_id: null },
    authorRejected: { role: 'member', status: 'rejected', cell_id: null },
    authorInactive: { role: 'member', status: 'active', cell_id: cellA }, // deactivated after posting
    authorCellB:    { role: 'member', status: 'active', cell_id: cellB },
    memberA:        { role: 'member', status: 'active', cell_id: cellA },
    memberB:        { role: 'member', status: 'active', cell_id: cellB },
    leaderA:        { role: 'cell_leader', status: 'active', cell_id: cellA },
    leaderB:        { role: 'cell_leader', status: 'active', cell_id: cellB },
    coordinator:    { role: 'coordinator', status: 'active', cell_id: null },
    admin:          { role: 'admin', status: 'active', cell_id: null },
  })) {
    const u = await createUser(key);
    created.push(u.id);
    await setProfile(u.id, spec);
    people[key] = u;
  }
  // The service key reads the leader row to confirm the cell link we set.
  await serviceRest('PATCH', `/cells?id=eq.${cellA}`, { leader_id: people.leaderA.id });
  await serviceRest('PATCH', `/cells?id=eq.${cellB}`, { leader_id: people.leaderB.id });

  // Authors post while active. The pending and rejected authors attempt too, and must be refused.
  const post = async (author, content, visibility) =>
    rest('POST', '/prayer_requests', author.token, { content, author_id: author.id, author_name: author.name, visibility }, 'return=representation');
  const pActive = await post(people.authorActive, `T7 shared active ${run}`, 'shared');
  const pActiveL = await post(people.authorActive, `T7 leadership active ${run}`, 'leadership');
  const pCellB = await post(people.authorCellB, `T7 leadership cellB ${run}`, 'leadership');
  const pInactive = await post(people.authorInactive, `T7 shared then inactive ${run}`, 'shared');
  const pInactiveL = await post(people.authorInactive, `T7 leadership then inactive ${run}`, 'leadership');
  const pPending = await post(people.authorPending, `T7 pending attempt ${run}`, 'shared');
  const pRejected = await post(people.authorRejected, `T7 rejected attempt ${run}`, 'shared');

  check('setup: active author posts a shared prayer', pActive.status === 201, `status ${pActive.status}`);
  check('setup: active author posts a leadership prayer', pActiveL.status === 201, `status ${pActiveL.status}`);
  check('setup: cell B author posts a leadership prayer', pCellB.status === 201, `status ${pCellB.status}`);
  check('setup: inactive-to-be author posts shared and leadership prayers while active', pInactive.status === 201 && pInactiveL.status === 201, `${pInactive.status}/${pInactiveL.status}`);
  check('pending author cannot post (prayers_own requires an active account)', pPending.status >= 400 || (Array.isArray(pPending.data) && pPending.data.length === 0), `status ${pPending.status}`);
  check('rejected author cannot post', pRejected.status >= 400 || (Array.isArray(pRejected.data) && pRejected.data.length === 0), `status ${pRejected.status}`);

  // The author of the shared and leadership prayers is deactivated after posting. The rows remain.
  await setProfile(people.authorInactive.id, { status: 'inactive' });

  const idOf = (r) => r.data?.[0]?.id;
  const P = {
    sharedActive: idOf(pActive),
    leadActive: idOf(pActiveL),
    leadCellB: idOf(pCellB),
    sharedInactive: idOf(pInactive),
    leadInactive: idOf(pInactiveL),
  };

  // Each viewer reads with their own token. Expectation = intended behaviour.
  const expect = {
    // ordinary members: shared prayers of ACTIVE authors only (T7); never leadership prayers
    memberA: { visible: [P.sharedActive], hidden: [P.sharedInactive, P.leadActive, P.leadInactive, P.leadCellB] },
    memberB: { visible: [P.sharedActive], hidden: [P.sharedInactive, P.leadActive, P.leadInactive, P.leadCellB] },
    // cell leaders: leadership prayers of ACTIVE authors in their OWN cell only (cross-cell isolation)
    leaderA: { visible: [P.leadActive, P.sharedActive], hidden: [P.leadCellB, P.sharedInactive, P.leadInactive] },
    leaderB: { visible: [P.leadCellB], hidden: [P.leadActive, P.sharedInactive, P.leadInactive] },
    // coordinator and admin: leadership and shared prayers of ACTIVE authors across cells (approved leader access)
    coordinator: { visible: [P.leadActive, P.leadCellB, P.sharedActive], hidden: [P.sharedInactive, P.leadInactive] },
    admin: { visible: [P.leadActive, P.leadCellB, P.sharedActive], hidden: [P.sharedInactive, P.leadInactive] },
  };

  for (const [viewerKey, spec] of Object.entries(expect)) {
    const viewer = people[viewerKey];
    const { status, rows } = await listPrayers(viewer.token);
    const ids = new Set(rows.map((r) => r.id));
    const missing = spec.visible.filter((id) => !ids.has(id));
    const leaked = spec.hidden.filter((id) => ids.has(id));
    check(`${viewerKey}: sees intended prayers (read status ${status})`, status === 200 && missing.length === 0,
      missing.length ? `missing ${missing.length}` : `sees ${rows.length}`);
    check(`${viewerKey}: sees no restricted prayers`, leaked.length === 0,
      leaked.length ? `leaked ${leaked.length}` : 'none leaked');
  }

  // The author's own rows, after deactivation: no longer readable through the own policy (F5).
  const own = await listPrayers(people.authorInactive.token);
  check('inactive author cannot read own prayers (F5)', own.rows.length === 0, `sees ${own.rows.length}`);
} catch (err) {
  console.error('ERROR', err.message);
  results.push({ name: 'harness error', ok: false, detail: err.message });
} finally {
  // clean up the accounts and cells created for this run
  for (const id of created) {
    await fetch(`${url}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: { apikey: service, Authorization: `Bearer ${service}` } });
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nprayer-visibility-session: ${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
