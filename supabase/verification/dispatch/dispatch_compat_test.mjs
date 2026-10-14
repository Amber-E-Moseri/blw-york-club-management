// dispatch_compat_test.mjs
// Runs the REAL dispatch-message Edge Function (Deno, real supabase-js client, unmodified request path) against:
//   * an in-process PGlite replay of the migrations (real tables, constraints, grants, RLS and RPCs), served through a
//     PostgREST-compatible stub (postgrest_stub.mjs); and
//   * a local email-relay stub that records every call with a timestamp.
//
//   node dispatch_compat_test.mjs <migrationsDir> [indexTs]
//
// Requires Deno on PATH and network access for the esm.sh import in the function. Fixtures are disposable and rolled
// into a fresh replay on every run.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..', '..');
const [migDir, indexArg] = process.argv.slice(2);
if (!migDir) {
  console.error('usage: node dispatch_compat_test.mjs <migrationsDir> [indexTs]');
  process.exit(2);
}
const indexTs = path.resolve(indexArg ?? path.join(repo, 'supabase/functions/dispatch-message/index.ts'));

// The PGlite module must be named explicitly. No default path is assumed: a missing module is a refusal, not a pass.
if (!process.env.PGLITE_MODULE) {
  console.error('refused: set PGLITE_MODULE=file:///<path>/node_modules/@electric-sql/pglite/dist/index.js');
  process.exit(2);
}
const { openReplay, asRole } = await import(pathToFileURL(path.join(here, '..', 'pglite_replay.mjs')).href);
const { startPostgrestStub } = await import(pathToFileURL(path.join(here, 'postgrest_stub.mjs')).href);

const SERVICE_KEY = 'service-key-test-only';
const U = (n) => `00000000-0000-4000-8000-${n.padStart(12, '0')}`;
const COORD = U('c1'), OUTSIDER = U('0a'), R1 = U('e1'), R2 = U('e2'), R3 = U('e3'), R4 = U('e4');
const EMAIL = { [R1]: 'r1@t.test', [R2]: 'refuse@t.test', [R3]: 'flaky@t.test', [R4]: 'r4@t.test' };

const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass: !!pass, detail });

// ── Email relay stub ────────────────────────────────────────────────────────────────────────────────────────────────
const calls = [];
const relay = http.createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  const data = JSON.parse(body || '{}');
  calls.push({ to: data.to, subject: data.subject, key: req.headers['idempotency-key'], at: Date.now() });
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (data.to.startsWith('refuse@')) return send(400, { error: 'address rejected' });
  if (data.to.startsWith('flaky@')) return send(500, { error: 'upstream' });
  return send(200, { id: 'msg-' + calls.length });
});
await new Promise((r) => relay.listen(0, '127.0.0.1', r));
const relayUrl = `http://127.0.0.1:${relay.address().port}/send`;

// ── Replay and fixtures ────────────────────────────────────────────────────────────────────────────────────────────
const { db } = await openReplay(migDir);
await db.exec(`
  insert into auth.users (id, email, created_at) values
    ('${COORD}','coord@t.test',now()),('${OUTSIDER}','outsider@t.test',now()),
    ('${R1}','r1@t.test',now()),('${R2}','refuse@t.test',now()),('${R3}','flaky@t.test',now()),('${R4}','r4@t.test',now());
  update public.profiles set full_name = d.n, role = d.r, status = 'active', joined_at = now()
    from (values ('${COORD}'::uuid,'Coordinator','coordinator'),('${OUTSIDER}'::uuid,'Outsider','member'),
                 ('${R1}'::uuid,'R1','member'),('${R2}'::uuid,'R2','member'),('${R3}'::uuid,'R3','member'),('${R4}'::uuid,'R4','member')) as d(id,n,r)
   where profiles.id = d.id;
  insert into public.email_preferences (user_id, message_notifications) values ('${R4}', false);
`);
// The message is created through the real send_message RPC as the coordinator (external channels are staff-only).
await asRole(db, 'authenticated', COORD);
const sent = await db.query(
  `select public.send_message('Compat', 'Hello there', 'explicit', null, null, $1::uuid[], array['inbox','email','push'], gen_random_uuid()) as id`,
  [[R1, R2, R3, R4]],
);
await asRole(db, 'owner');
const MSG = sent.rows[0].id;

// ── Stubs and the real Edge Function ──────────────────────────────────────────────────────────────────────────────
const stub = await startPostgrestStub({ db, serviceKey: SERVICE_KEY });
const fnPort = 18000 + Math.floor(Math.random() * 1000);
const env = {
  ...process.env,
  SUPABASE_URL: stub.url,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  EMAIL_RELAY_URL: relayUrl,
  EMAIL_RELAY_API_KEY: 'relay-test',
  DENO_SERVE_ADDRESS: `tcp:127.0.0.1:${fnPort}`,
  DENO_NO_UPDATE_CHECK: '1',
};
const deno = spawn('deno', ['run', '--allow-net', '--allow-env', '--allow-read', indexTs], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let denoLog = '';
deno.stdout.on('data', (d) => (denoLog += d));
deno.stderr.on('data', (d) => (denoLog += d));
const fnUrl = `http://127.0.0.1:${fnPort}/`;
for (let i = 0; i < 120; i++) {
  try { await fetch(fnUrl, { method: 'POST' }); break; } catch { await new Promise((r) => setTimeout(r, 500)); }
}

// Unsigned test JWT (the stub does not verify signatures; see postgrest_stub.mjs).
const userJwt = (uid) => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: uid, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.`;
};

async function dispatch(userId, messageId = MSG) {
  const headers = { 'Content-Type': 'application/json' };
  if (userId) headers.Authorization = `Bearer ${userJwt(userId)}`;
  const r = await fetch(fnUrl, { method: 'POST', headers, body: JSON.stringify({ message_id: messageId }) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* plain text */ }
  return { status: r.status, text, json };
}
const deliveries = async () => (await db.query(
  `select user_id::text as user_id, channel, status, reason, retryable, attempts from public.communication_deliveries where message_id = $1 order by channel, user_id`, [MSG])).rows;
const row = (rows, user, channel) => rows.find((r) => r.user_id === user && r.channel === channel);

// ── 1. Authorization: an active member who is not the sender is refused ───────────────────────────────────────────
{
  const before = calls.length;
  const r = await dispatch(OUTSIDER);
  check('auth: outsider (active member, not sender) is refused with 403', r.status === 403, `status ${r.status} ${r.text.slice(0, 120)}`);
  check('auth: refused dispatch sends nothing and changes no delivery', calls.length === before && (await deliveries()).every((d) => d.status === 'pending' || d.status === 'stored'),
    `calls ${calls.length - before}`);
  const audits = (await db.query(`select count(*)::int as n from public.communication_audit where message_id = $1 and action = 'dispatch'`, [MSG])).rows[0].n;
  check('auth: refused dispatch writes no dispatch audit row', audits === 0, `dispatch audit rows ${audits}`);
}

// ── 2. Successful claim and dispatch by the sender (staff) ────────────────────────────────────────────────────────
let first;
{
  const r = await dispatch(COORD);
  first = r;
  check('dispatch: sender dispatch succeeds with HTTP 200', r.status === 200, `status ${r.status} ${r.text.slice(0, 200)}`);
  const s = r.json ?? {};
  check('dispatch: response reports email accepted=1 failed=1 skipped=1', s.email?.accepted === 1 && s.email?.failed === 1 && s.email?.skipped === 1, JSON.stringify(s.email));
  check('dispatch: response reports one unknown outcome (the 5xx relay), not a silent drop', s.unknown === 1, `unknown ${s.unknown}`);
  check('dispatch: response reports push outcomes (none silently dropped)', (s.push?.failed ?? 0) + (s.push?.accepted ?? 0) + (s.push?.skipped ?? 0) === 4, JSON.stringify(s.push));
  const d = await deliveries();
  check('claim: the accepted recipient is recorded as accepted', row(d, R1, 'email')?.status === 'accepted', JSON.stringify(row(d, R1, 'email')));
  check('claim: the relay refusal is recorded as failed and not retryable', row(d, R2, 'email')?.status === 'failed' && row(d, R2, 'email')?.retryable === false && /relay refused/.test(row(d, R2, 'email')?.reason ?? ''),
    JSON.stringify(row(d, R2, 'email')));
  check('claim: a 5xx relay response leaves the outcome unknown (sending), not re-sent', row(d, R3, 'email')?.status === 'sending', JSON.stringify(row(d, R3, 'email')));
  check('claim: an opted-out recipient is skipped and never sent', row(d, R4, 'email')?.status === 'skipped' && !calls.some((c) => c.to === EMAIL[R4]), JSON.stringify(row(d, R4, 'email')));
  check('claim: push deliveries are recorded as failed with a reason and stay retryable (no provider configured)',
    ['R1', 'R2', 'R3'].every((_, i) => row(d, [R1, R2, R3][i], 'push')?.status === 'failed' && (row(d, [R1, R2, R3][i], 'push')?.reason ?? '').length > 0),
    JSON.stringify(d.filter((x) => x.channel === 'push')));
  const toR1 = calls.filter((c) => c.to === EMAIL[R1]);
  check('claim: each accepted email is sent exactly once with the per-recipient idempotency key',
    toR1.length === 1 && toR1[0].key === `${MSG}:${R1}:email`, JSON.stringify(toR1));
}

// ── 3. Required audit attribution, written before any provider call ──────────────────────────────────────────────
{
  const audits = (await db.query(
    `select actor_id::text as actor, actor_role, action, audience_mode, recipient_count, created_at from public.communication_audit
      where message_id = $1 and action = 'dispatch' order by created_at`, [MSG])).rows;
  check('audit: a dispatch audit row is written with actor, role, audience and count', audits.length >= 1
    && audits[0].actor === COORD && audits[0].actor_role === 'coordinator' && audits[0].audience_mode === 'explicit' && Number(audits[0].recipient_count) === 4,
    JSON.stringify(audits[0] ?? null));
  const firstSend = Math.min(...calls.map((c) => c.at));
  check('audit: the audit row is written before the first provider call', audits.length >= 1 && new Date(audits[0].created_at).getTime() <= firstSend,
    `audit ${audits[0] && new Date(audits[0].created_at).getTime()} first send ${firstSend}`);
}

// ── 4. Replay: a second dispatch must not duplicate any delivery ─────────────────────────────────────────────────────
{
  const before = calls.length;
  const r = await dispatch(COORD);
  check('replay: second dispatch returns 200', r.status === 200, `status ${r.status} ${r.text.slice(0, 160)}`);
  check('replay: no duplicate email is sent', calls.length === before, `new calls ${calls.length - before}`);
  check('replay: the accepted delivery is unchanged', row(await deliveries(), R1, 'email')?.status === 'accepted');
  const audits = (await db.query(`select count(*)::int as n from public.communication_audit where message_id = $1 and action = 'dispatch'`, [MSG])).rows[0].n;
  check('replay: every attempt is audited (two dispatch rows)', audits === 2, `dispatch audit rows ${audits}`);
}

// ── 5. An inactive sender is refused even though they sent the message ───────────────────────────────────────────
{
  await db.exec(`update public.profiles set status = 'pending' where id = '${COORD}'`);
  const r = await dispatch(COORD);
  check('auth: a sender who is no longer active is refused with 403', r.status === 403, `status ${r.status}`);
  await db.exec(`update public.profiles set status = 'active' where id = '${COORD}'`);
}

// ── 6. Privileges: the claim RPC stays service-role only; the function does not need broader grants ─────────────────
{
  const r = await fetch(`${stub.url}/rest/v1/rpc/claim_deliveries`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${userJwt(COORD)}`, apikey: SERVICE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_message_id: MSG, p_channel: 'email' }),
  });
  check('privilege: an authenticated user cannot call claim_deliveries directly (403)', r.status === 403, `status ${r.status}`);
}

// ── report ──────────────────────────────────────────────────────────────────────────────────────────────────────────
for (const c of results) console.log(`${c.pass ? 'PASS' : 'FAIL'}\t${c.name}${c.pass || !c.detail ? '' : '\t[' + c.detail.slice(0, 220) + ']'}`);
const passed = results.filter((c) => c.pass).length;
console.log(`\n${passed}/${results.length} dispatch compatibility checks passed`);
if (process.env.DISPATCH_DEBUG) console.log('--- function log ---\n' + denoLog.slice(0, 2000));
deno.kill();
stub.close();
relay.close();
await db.close();
process.exit(passed === results.length ? 0 : 1);
