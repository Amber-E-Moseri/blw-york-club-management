// Real-session authorization certification (Supabase Auth + PostgREST).
//
// Each account signs in through GoTrue (password grant) and every check is an HTTP request made with that account's
// access token, so Row Level Security is applied exactly as the app applies it. Fixtures are created through the
// service role, which is used only for setup and never for an authorization check.
//
// Usage (local stack only; the script refuses any other host):
//   CERT_SUPABASE_URL=http://127.0.0.1:60621 CERT_SUPABASE_ANON_KEY=... CERT_SUPABASE_SERVICE_ROLE_KEY=... \
//     node supabase/verification/real_session_authz_certification.mjs
//
// Result rules: a read reports the number of rows returned; a write reports the number of rows returned by the write
// (Prefer: return=representation); "refused" is an HTTP error from a guard or policy. Exit code is 1 if any check fails.

const URL_BASE = process.env.CERT_SUPABASE_URL ?? '';
const ANON = process.env.CERT_SUPABASE_ANON_KEY ?? '';
const SERVICE = process.env.CERT_SUPABASE_SERVICE_ROLE_KEY ?? '';

if (!URL_BASE || !ANON || !SERVICE) {
  console.error('Set CERT_SUPABASE_URL, CERT_SUPABASE_ANON_KEY and CERT_SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(2);
}
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(URL_BASE)) {
  console.error('Refusing to run against a non-local host:', URL_BASE);
  process.exit(2);
}

const RUN = Date.now().toString(36);
const PASSWORD = 'Cert-Session-Passw0rd-' + RUN;
const results = [];
const check = (name, ok, evidence) => results.push({ name, ok: !!ok, evidence: String(evidence ?? '') });

async function http(method, path, { token, body, prefer } = {}) {
  const headers = { apikey: ANON, Authorization: `Bearer ${token ?? ANON}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(URL_BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}

const admin = (method, path, body) =>
  fetch(URL_BASE + path, {
    method,
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

// Service-role write used only for fixtures.
async function fixture(method, path, body, prefer = 'return=representation') {
  const r = await http(method, path, { token: SERVICE, body, prefer });
  if (r.status >= 300) throw new Error(`fixture ${method} ${path} -> ${r.status} ${JSON.stringify(r.json)}`);
  return r.json;
}

async function createUser(label) {
  const email = `${label}-${RUN}@cert-session.example.com`;
  const r = await admin('POST', '/auth/v1/admin/users', { email, password: PASSWORD, email_confirm: true });
  if (r.status >= 300) throw new Error(`createUser ${label} -> ${r.status} ${JSON.stringify(r.json)}`);
  return { id: r.json.id, email };
}

async function signIn(email) {
  const r = await http('POST', '/auth/v1/token?grant_type=password', { body: { email, password: PASSWORD } });
  if (r.status !== 200) throw new Error(`signIn ${email} -> ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.access_token;
}

// Read: number of rows returned. A non-2xx response is reported as an error string.
async function readCount(token, path) {
  const r = await http('GET', path, { token });
  if (r.status >= 300) return { count: -1, error: `HTTP ${r.status}` };
  return { count: Array.isArray(r.json) ? r.json.length : 0, rows: r.json };
}

// Write: rows returned by the write, or -1 when refused by the database.
async function writeCount(token, method, path, body) {
  const r = await http(method, path, { token, body, prefer: 'return=representation' });
  if (r.status >= 300) return { count: -1, error: `HTTP ${r.status}` };
  return { count: Array.isArray(r.json) ? r.json.length : 0 };
}

async function rpc(token, name, body) {
  const r = await http('POST', `/rest/v1/rpc/${name}`, { token, body });
  return r;
}

async function main() {
  // 1. Accounts
  const actors = {};
  for (const label of ['coord', 'lead', 'lead_unassigned', 'member_b_leader', 'member_a', 'member_b', 'bsc_leader', 'pending', 'rejected']) {
    actors[label] = await createUser(label);
  }
  const setStatus = (id, fields) => fixture('PATCH', `/rest/v1/profiles?id=eq.${id}`, fields);
  await setStatus(actors.coord.id, { role: 'coordinator', status: 'active' });
  await setStatus(actors.lead.id, { role: 'cell_leader', status: 'active' });
  await setStatus(actors.lead_unassigned.id, { role: 'cell_leader', status: 'active' });
  await setStatus(actors.member_b_leader.id, { role: 'member', status: 'active' });
  await setStatus(actors.member_a.id, { role: 'member', status: 'active' });
  await setStatus(actors.member_b.id, { role: 'member', status: 'active' });
  await setStatus(actors.bsc_leader.id, { role: 'member', status: 'active' });
  await setStatus(actors.pending.id, { role: 'member', status: 'pending' });
  await setStatus(actors.rejected.id, { role: 'member', status: 'rejected' });

  // 2. Structure: two cells with assigned leaders, a BSC, cell membership, meetings, a confession
  const [cellA] = await fixture('POST', '/rest/v1/cells', [{ name: `cell A ${RUN}`, leader_id: actors.lead.id }]);
  const [cellB] = await fixture('POST', '/rest/v1/cells', [{ name: `cell B ${RUN}`, leader_id: actors.member_b_leader.id }]);
  await setStatus(actors.lead.id, { cell_id: cellA.id });
  await setStatus(actors.lead_unassigned.id, { cell_id: cellA.id });
  await setStatus(actors.member_a.id, { cell_id: cellA.id });
  await setStatus(actors.member_b_leader.id, { cell_id: cellB.id });
  await setStatus(actors.member_b.id, { cell_id: cellB.id });
  // guard_bsc_leader_eligibility (055) requires profiles.cell_id = bscs.cell_id at insert time.
  await setStatus(actors.bsc_leader.id, { cell_id: cellB.id });
  const [bsc1] = await fixture('POST', '/rest/v1/bscs', [{ cell_id: cellB.id, name: `bsc one ${RUN}`, leader_id: actors.bsc_leader.id }]);
  await setStatus(actors.member_b.id, { bsc_id: bsc1.id });

  const meetingRow = (cell, title) => ({ title, date: '2026-10-12', time: '19:00', created_by: actors.coord.id, cell_id: cell.id, visibility: 'leaders' });
  const [meetA] = await fixture('POST', '/rest/v1/meetings', [meetingRow(cellA, 'leaders A')]);
  const [meetB] = await fixture('POST', '/rest/v1/meetings', [meetingRow(cellB, 'leaders B')]);

  const tokens = {};
  for (const [label, a] of Object.entries(actors)) tokens[label] = await signIn(a.email);

  // A leadership prayer by member_a, written through member_a's own session
  const prayer = await writeCount(tokens.member_a, 'POST', '/rest/v1/prayer_requests', {
    content: 'leadership prayer', author_id: actors.member_a.id, author_name: 'Member A', visibility: 'leadership',
  });
  check('prayer: author writes own leadership prayer (active)', prayer.count === 1, prayer.error ?? `${prayer.count} row`);

  // Confession with declarations by member_a and member_b (service role fixture)
  const [confession] = await fixture('POST', '/rest/v1/confessions', [{
    title: 'Test affirmation', body: 'affirmation body text', scheduled_date: '2026-10-12', created_by: actors.coord.id, is_active: true,
  }]);
  await fixture('POST', '/rest/v1/confession_declarations', [
    { confession_id: confession.id, user_id: actors.member_a.id },
    { confession_id: confession.id, user_id: actors.member_b.id },
  ]);

  // 3. Profile reads (049): assignment decides, not profile cell or role label
  const profileRead = (who, target) => readCount(tokens[who], `/rest/v1/profiles?select=id&id=eq.${actors[target].id}`);
  let r = await profileRead('lead', 'member_a');
  check('profiles: assigned cell_leader reads a member of their cell', r.count === 1, r.error ?? `${r.count}`);
  r = await profileRead('lead', 'member_b');
  check('profiles: assigned cell_leader cannot read a member of another cell', r.count === 0, r.error ?? `${r.count}`);
  r = await profileRead('lead_unassigned', 'member_a');
  check('profiles: unassigned cell_leader role with same profile cell reads nothing (over-grant closed)', r.count === 0, r.error ?? `${r.count}`);
  r = await profileRead('member_b_leader', 'member_b');
  check('profiles: assigned leader with member role label reads a member of their cell (decision 054)', r.count === 1, r.error ?? `${r.count}`);
  r = await profileRead('member_a', 'member_b');
  check('profiles: member cannot read another member', r.count === 0, r.error ?? `${r.count}`);

  // 4. Meetings (049)
  r = await readCount(tokens.lead, `/rest/v1/meetings?select=id&id=eq.${meetA.id}`);
  check('meetings: assigned leader reads leaders meeting of own cell', r.count === 1, r.error ?? `${r.count}`);
  r = await readCount(tokens.lead, `/rest/v1/meetings?select=id&id=eq.${meetB.id}`);
  check('meetings: assigned leader cannot read leaders meeting of another cell', r.count === 0, r.error ?? `${r.count}`);
  r = await readCount(tokens.lead_unassigned, `/rest/v1/meetings?select=id&id=in.(${meetA.id},${meetB.id})`);
  check('meetings: unassigned cell_leader reads no leaders meeting', r.count === 0, r.error ?? `${r.count}`);
  r = await readCount(tokens.coord, `/rest/v1/meetings?select=id&id=in.(${meetA.id},${meetB.id})`);
  check('meetings: coordinator reads both leaders meetings', r.count === 2, r.error ?? `${r.count}`);

  // 4b. Assigned member-label leader (054): own cell only; then inactive leader loses it
  r = await readCount(tokens.member_b_leader, `/rest/v1/meetings?select=id&id=eq.${meetB.id}`);
  check('meetings: assigned member-label leader reads leaders meeting of own cell (decision 054)', r.count === 1, r.error ?? `${r.count}`);
  r = await readCount(tokens.member_b_leader, `/rest/v1/meetings?select=id&id=eq.${meetA.id}`);
  check('meetings: assigned member-label leader reads no leaders meeting of another cell', r.count === 0, r.error ?? `${r.count}`);
  r = await writeCount(tokens.member_b_leader, 'PATCH', `/rest/v1/meetings?id=eq.${meetB.id}`, { title: `leaders B edited ${RUN}` });
  check('meetings: assigned member-label leader updates a meeting of own cell', r.count === 1, r.error ?? `${r.count}`);
  r = await writeCount(tokens.member_b_leader, 'PATCH', `/rest/v1/meetings?id=eq.${meetA.id}`, { title: `leaders A edited ${RUN}` });
  check('meetings: assigned member-label leader cannot update a meeting of another cell', r.count === 0, r.error ?? `${r.count}`);
  await setStatus(actors.member_b_leader.id, { status: 'rejected' });
  r = await readCount(tokens.member_b_leader, `/rest/v1/profiles?select=id&id=eq.${actors.member_b.id}`);
  check('profiles: deactivated assigned leader reads no member of their cell', r.count === 0, r.error ?? `${r.count}`);
  r = await readCount(tokens.member_b_leader, `/rest/v1/meetings?select=id&id=eq.${meetB.id}`);
  check('meetings: deactivated assigned leader reads no leaders meeting of own cell', r.count === 0, r.error ?? `${r.count}`);
  await setStatus(actors.member_b_leader.id, { status: 'active' });

  // 5. Prayers (047/049): leadership visibility via assigned leader of the author's cell
  const prayerId = prayer.count === 1 ? (await readCount(tokens.member_a, `/rest/v1/prayer_requests?select=id&author_id=eq.${actors.member_a.id}&content=eq.leadership%20prayer`)).rows?.[0]?.id : null;
  r = await readCount(tokens.lead, `/rest/v1/prayer_requests?select=id&id=eq.${prayerId}`);
  check('prayers: assigned leader reads leadership prayer of a member of their cell', r.count === 1, r.error ?? `${r.count}`);
  r = await readCount(tokens.lead_unassigned, `/rest/v1/prayer_requests?select=id&id=eq.${prayerId}`);
  check('prayers: unassigned cell_leader reads no leadership prayer', r.count === 0, r.error ?? `${r.count}`);
  r = await readCount(tokens.member_b, `/rest/v1/prayer_requests?select=id&id=eq.${prayerId}`);
  check('prayers: member of another cell reads no leadership prayer', r.count === 0, r.error ?? `${r.count}`);
  r = await readCount(tokens.bsc_leader, `/rest/v1/prayer_requests?select=id&id=eq.${prayerId}`);
  check('prayers: BSC leader (not cell leader) reads no leadership prayer', r.count === 0, r.error ?? `${r.count}`);
  r = await readCount(tokens.member_a, `/rest/v1/prayer_requests?select=id&id=eq.${prayerId}`);
  check('prayers: author reads own prayer', r.count === 1, r.error ?? `${r.count}`);
  r = await readCount(tokens.pending, `/rest/v1/prayer_requests?select=id&id=eq.${prayerId}`);
  check('prayers: pending account reads no prayer', r.count === 0, r.error ?? `${r.count}`);

  // 6. Declarations (052): identities only to the declarer and active staff; counts via RPC
  r = await readCount(tokens.member_a, `/rest/v1/confession_declarations?select=user_id&confession_id=eq.${confession.id}`);
  check('declarations: member reads own declaration row only', r.count === 1 && r.rows[0].user_id === actors.member_a.id, r.error ?? `${r.count}`);
  r = await readCount(tokens.bsc_leader, `/rest/v1/confession_declarations?select=user_id&confession_id=eq.${confession.id}`);
  check('declarations: BSC leader reads no declaration identity', r.count === 0, r.error ?? `${r.count}`);
  r = await readCount(tokens.lead, `/rest/v1/confession_declarations?select=user_id&confession_id=eq.${confession.id}`);
  check('declarations: cell leader reads no declaration identity', r.count === 0, r.error ?? `${r.count}`);
  r = await readCount(tokens.coord, `/rest/v1/confession_declarations?select=user_id&confession_id=eq.${confession.id}`);
  check('declarations: coordinator reads declarations of active members', r.count === 2, r.error ?? `${r.count}`);
  const rpcCounts = await rpc(tokens.bsc_leader, 'confession_declaration_counts', { p_confession_ids: [confession.id] });
  check('declarations: BSC leader gets aggregate count via RPC', rpcCounts.status === 200 && rpcCounts.json?.[0]?.declaration_count === 2, `${rpcCounts.status} ${JSON.stringify(rpcCounts.json)}`);
  const rpcPending = await rpc(tokens.pending, 'confession_declaration_counts', { p_confession_ids: [confession.id] });
  check('declarations: pending account gets no count', rpcPending.status === 200 && (rpcPending.json?.length ?? 0) === 0, `${rpcPending.status} ${JSON.stringify(rpcPending.json)}`);

  // 7. BSC (053): active assigned leader sees the members of the BSC, with member role label
  const bscVisible = await rpc(tokens.bsc_leader, 'bsc_members_visible', {});
  const sawMemberB = Array.isArray(bscVisible.json) && bscVisible.json.some((m) => m.id === actors.member_b.id);
  check('bsc: active assigned BSC leader with member role sees BSC members', bscVisible.status === 200 && sawMemberB, `${bscVisible.status} rows=${Array.isArray(bscVisible.json) ? bscVisible.json.length : 'n/a'}`);
  // Migration 055 added is_cell_leader_of(b.cell_id) to bsc_members_visible: an assigned cell leader can see
  // BSC members in their cell even without a BSC leader assignment of their own.
  const bscOther = await rpc(tokens.member_b_leader, 'bsc_members_visible', {});
  const sawMemberBByCell = Array.isArray(bscOther.json) && bscOther.json.some((m) => m.id === actors.member_b.id);
  check('bsc: cell leader (no BSC assignment) sees BSC members of BSCs in their cell (migration 055)', bscOther.status === 200 && sawMemberBByCell, `${bscOther.status} rows=${Array.isArray(bscOther.json) ? bscOther.json.length : 'n/a'}`);
  // Rejected former BSC leader: deactivate the leader and confirm loss of BSC access
  await setStatus(actors.bsc_leader.id, { status: 'rejected' });
  const bscAfter = await rpc(tokens.bsc_leader, 'bsc_members_visible', {});
  check('bsc: deactivated BSC leader loses BSC member visibility', bscAfter.status === 200 && (bscAfter.json?.length ?? 0) === 0, `${bscAfter.status} rows=${Array.isArray(bscAfter.json) ? bscAfter.json.length : 'n/a'}`);
  await setStatus(actors.bsc_leader.id, { status: 'active' });

  // 8. Profile self-edit (051) and onboarding (existing)
  const selfPatch = (who, body) => writeCount(tokens[who], 'PATCH', `/rest/v1/profiles?id=eq.${actors[who].id}`, body);
  r = await selfPatch('member_a', { full_name: 'Member A edited' });
  check('profile self-edit: active member edits own full name', r.count === 1, r.error ?? `${r.count}`);
  r = await selfPatch('member_a', { role: 'admin' });
  check('profile self-edit: active member cannot grant own role', r.count === -1, r.error ?? `${r.count}`);
  r = await selfPatch('member_a', { cell_id: cellB.id });
  check('profile self-edit: active member cannot move own cell', r.count === -1, r.error ?? `${r.count}`);
  r = await selfPatch('pending', { full_name: 'Pending edited' });
  check('profile self-edit: pending account edits own onboarding name', r.count === 1, r.error ?? `${r.count}`);
  r = await selfPatch('rejected', { full_name: 'Rejected edited' });
  check('profile self-edit: rejected account cannot edit own profile', r.count === 0, r.error ?? `${r.count}`);

  // 9. Owner writes (050)
  const testimony = (who) => ({ author_id: actors[who].id, author_name: who, title: 't', body: 'testimony body text' });
  r = await writeCount(tokens.pending, 'POST', '/rest/v1/testimonies', testimony('pending'));
  check('owner writes: pending account cannot create a testimony', r.count === -1, r.error ?? `${r.count}`);
  r = await writeCount(tokens.rejected, 'POST', '/rest/v1/testimonies', testimony('rejected'));
  check('owner writes: rejected account cannot create a testimony', r.count === -1, r.error ?? `${r.count}`);
  r = await writeCount(tokens.member_a, 'POST', '/rest/v1/testimonies', testimony('member_a'));
  check('owner writes: active member creates a testimony', r.count === 1, r.error ?? `${r.count}`);

  // 10. Role-assignment guard (048) through the API with the coordinator session
  r = await writeCount(tokens.coord, 'PATCH', `/rest/v1/profiles?id=eq.${actors.pending.id}`, { role: 'admin' });
  check('role guard: coordinator cannot make a pending account an admin', r.count === -1, r.error ?? `${r.count}`);
  r = await writeCount(tokens.coord, 'PATCH', `/rest/v1/cells?id=eq.${cellB.id}`, { leader_id: actors.pending.id });
  check('leader guard: pending account cannot be assigned as cell leader', r.count === -1, r.error ?? `${r.count}`);

  // Report
  const fails = results.filter((x) => !x.ok);
  for (const x of results) console.log(`${x.ok ? 'PASS' : 'FAIL'}\t${x.name}\t${x.evidence}`);
  console.log(`\n${results.length - fails.length}/${results.length} checks passed`);
  process.exit(fails.length ? 1 : 0);
}

main().catch((e) => {
  console.error('ERROR', e.message);
  process.exit(1);
});
