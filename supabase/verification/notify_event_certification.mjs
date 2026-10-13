// notify_event_certification.mjs
// End-to-end checks for the notify-event Edge Function against a LOCAL Supabase stack.
//
// The function source is transpiled from supabase/functions/notify-event and run in Node. Its two remote imports
// (esm.sh supabase-js and npm:web-push) are pointed at the locally installed packages, and Deno.serve is replaced
// by a capture. Everything else is the real code: the claim, recipient resolution, subscription lookup, web-push
// encryption, delivery logging and the expiry of dead endpoints. Push endpoints are a localhost mock that answers
// 201, 410 or 500 by path, so no real push service is contacted and no real email is sent.
//
// NOTIFY_MODE=deno runs the function in the real Deno runtime (denoland/deno, via Docker, host networking). The only
// change to the source is an import map that resolves https://esm.sh/@supabase/supabase-js@2.45.0 to the npm package
// of the same version, which is what esm.sh serves. Use it where esm.sh is unreachable.
// Not covered: the gateway's JWT check (the Supabase edge gateway), which only the hosted platform performs.
import { createECDH, randomBytes } from 'node:crypto';
import { createServer } from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const webpush = require('web-push');

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const fnDir = path.join(repoRoot, 'supabase', 'functions');

const apiUrl = process.env.SUPABASE_URL ?? '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const anonKey = process.env.SUPABASE_ANON_KEY ?? '';
if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(apiUrl) || !serviceKey || !anonKey) {
  throw new Error('SUPABASE_URL (local), SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are required');
}

// ---- results -----------------------------------------------------------------------------------------------------
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}\t${name}${!ok && detail ? `\t${detail}` : ''}`);
}

const MODE = process.env.NOTIFY_MODE === 'deno' ? 'deno' : 'transpiled';
const DENO_IMAGE = 'denoland/deno:alpine';
const containers = [];
const secretDirs = [];  // per-container env files hold the VAPID private key; removed on exit

// ---- build the function for Node ---------------------------------------------------------------------------------
const buildDir = mkdtempSync(path.join(os.tmpdir(), 'notify-event-cert-'));
const transpile = (file) =>
  ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText;

writeFileSync(
  path.join(buildDir, 'supabase-shim.mjs'),
  `import { createRequire } from 'node:module';\n` +
    `const require = createRequire(${JSON.stringify(path.join(repoRoot, 'package.json'))});\n` +
    `export const createClient = require('@supabase/supabase-js').createClient;\n`
);
writeFileSync(
  path.join(buildDir, 'webpush-shim.mjs'),
  `import { createRequire } from 'node:module';\n` +
    `const require = createRequire(${JSON.stringify(path.join(repoRoot, 'package.json'))});\n` +
    `export default require('web-push');\n`
);
writeFileSync(
  path.join(buildDir, 'event-notification.mjs'),
  transpile(path.join(fnDir, '_shared', 'event-notification.ts'))
);
// index.ts also imports _shared/audience-recipients.ts. Build it next to index.mjs and rewrite that import as well, so
// every shared module resolves inside the temporary directory on any platform (Windows temp paths included).
writeFileSync(
  path.join(buildDir, 'audience-recipients.mjs'),
  transpile(path.join(fnDir, '_shared', 'audience-recipients.ts'))
);
const fnSource = transpile(path.join(fnDir, 'notify-event', 'index.ts'))
  .replace(/['"]https:\/\/esm\.sh\/@supabase\/supabase-js@2\.45\.0['"]/, "'./supabase-shim.mjs'")
  .replace(/['"]npm:web-push@3\.6\.7['"]/, "'./webpush-shim.mjs'")
  .replace(/['"]\.\.\/_shared\/event-notification\.ts['"]/, "'./event-notification.mjs'")
  .replace(/['"]\.\.\/_shared\/audience-recipients\.ts['"]/, "'./audience-recipients.mjs'");
if (fnSource.includes('esm.sh') || fnSource.includes('npm:')) throw new Error('remote import was not rewritten');
writeFileSync(path.join(buildDir, 'index.mjs'), fnSource);

// Module-level code reads Deno.env at import time, so each configuration is a separate import.
let capturedHandler = null;
/* global globalThis -- declares a standard ES2020 global for ESLint; no runtime change */
globalThis.Deno = {
  env: { get: (key) => process.env[key] },
  serve: (handler) => {
    capturedHandler = handler;
  },
};
let instanceCounter = 0;
async function loadFunction(env) {
  if (MODE === 'deno') return loadDenoFunction(env);
  Object.assign(process.env, env);
  capturedHandler = null;
  instanceCounter += 1;
  await import(pathToFileURL(path.join(buildDir, 'index.mjs')).href + `?instance=${instanceCounter}`);
  const handler = capturedHandler;
  if (!handler) throw new Error('function did not register a handler');
  return handler;
}

/** Starts notify-event in the Deno runtime with the given environment and returns a handler that calls it over HTTP. */
async function loadDenoFunction(env) {
  instanceCounter += 1;
  const port = 8100 + instanceCounter;
  const name = `notify-cert-${process.pid}-${instanceCounter}`;
  const envDir = mkdtempSync(path.join(os.tmpdir(), 'notify-env-'));
  secretDirs.push(envDir);
  const envFile = path.join(envDir, 'notify.env');
  const lines = { SUPABASE_URL: apiUrl, SUPABASE_SERVICE_ROLE_KEY: serviceKey, ...env };
  writeFileSync(envFile, Object.entries(lines).map(([k, v]) => `${k}=${v ?? ''}`).join('\n') + '\n', { mode: 0o600 });

  // A persistent Deno cache keeps npm packages between runs and between containers.
  const denoCache = process.env.NOTIFY_DENO_CACHE ?? path.join(os.tmpdir(), 'notify-event-deno-cache');
  mkdirSync(denoCache, { recursive: true });
  // Trust store for the container: the sandbox CA bundle if one is given (it is needed where outbound HTTPS is
  // intercepted), plus the localhost push mock's certificate. Verification stays on.
  const caFile = path.join(envDir, 'ca.crt');
  const bundle = process.env.NOTIFY_CA_BUNDLE ? readFileSync(process.env.NOTIFY_CA_BUNDLE) : '';
  writeFileSync(caFile, Buffer.concat([Buffer.from(bundle), readFileSync(path.join(tlsDir, 'cert.pem'))]), { mode: 0o644 });

  const dockerArgs = ['run', '-d', '--rm', '--name', name, '--network', 'host',
    '-e', 'DENO_DIR=/deno-cache', '-e', 'DENO_CERT=/envs/ca.crt', '-e', 'NODE_EXTRA_CA_CERTS=/envs/ca.crt', '-v', `${denoCache}:/deno-cache`,
    '-v', `${repoRoot}:/work`, '-v', `${envDir}:/envs:ro`, '-w', '/work'];
  dockerArgs.push('-e', `DENO_SERVE_ADDRESS=tcp:127.0.0.1:${port}`, DENO_IMAGE, 'deno', 'run', '-A',
    '--no-lock', '--node-modules-dir=none',
    '--import-map=/work/supabase/verification/edge/import_map.json', '--env-file=/envs/notify.env',
    '/work/supabase/functions/notify-event/index.ts');
  execFileSync('docker', dockerArgs, { stdio: 'ignore' });
  containers.push(name);

  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 120; i += 1) {
    const ready = await fetch(url, { method: 'OPTIONS' }).then(() => true, () => false);
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return async (req) => {
    const body = await req.text();
    return fetch(url, { method: req.method, headers: req.headers, body: body.length ? body : undefined });
  };
}

// ---- VAPID keys and the mock push service ------------------------------------------------------------------------
const vapid = webpush.generateVAPIDKeys();
const VAPID_ENV = {
  VAPID_PUBLIC_KEY: vapid.publicKey,
  VAPID_PRIVATE_KEY: vapid.privateKey,
  VAPID_SUBJECT: 'mailto:cert@example.org',
};
// web-push only speaks HTTPS to push endpoints. The mock presents a self-signed certificate created for this run, and
// the in-process mode trusts it by disabling verification for this process only; the Deno mode trusts it explicitly.
if (MODE !== 'deno') process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';  // deno mode trusts the mock cert explicitly
const pushHits = [];
const tlsDir = mkdtempSync(path.join(os.tmpdir(), 'notify-event-tls-'));
execFileSync('openssl', [
  'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes',
  '-keyout', path.join(tlsDir, 'key.pem'), '-out', path.join(tlsDir, 'cert.pem'),
  '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1',
], { stdio: 'ignore' });
const pushServer = createServer({
  key: readFileSync(path.join(tlsDir, 'key.pem')),
  cert: readFileSync(path.join(tlsDir, 'cert.pem')),
}, (req, res) => {
  const route = req.url.split('/')[1];
  pushHits.push(route);
  req.resume();
  req.on('end', () => {
    const status = { ok: 201, pending: 201, gone: 410, boom: 500 }[route] ?? 404;
    res.writeHead(status);
    res.end();
  });
});
await new Promise((resolve) => pushServer.listen(4321, '127.0.0.1', resolve));

const endpoint = (route) => `https://127.0.0.1:4321/${route}/${randomBytes(6).toString('hex')}`;

// ---- REST helpers (service role unless a token is given) ---------------------------------------------------------
async function rest(method, pathAndQuery, body, token) {
  const res = await fetch(`${apiUrl}${pathAndQuery}`, {
    method,
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token ?? serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${pathAndQuery} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

async function createUser(label) {
  const email = `${label}-${randomBytes(3).toString('hex')}@test.local`;
  const password = `Pw-${randomBytes(12).toString('hex')}`;
  const user = await fetch(`${apiUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: `Cert ${label}` } }),
  }).then((r) => r.json());
  const session = await fetch(`${apiUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }).then((r) => r.json());
  return { id: user.id, token: session.access_token };
}

async function setProfile(id, role, status) {
  await rest('PATCH', `/rest/v1/profiles?id=eq.${id}`, { role, status });
}

function fakeKeys() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') };
}

async function addSubscription(userId, route) {
  const keys = fakeKeys();
  const [row] = await rest('POST', '/rest/v1/push_subscriptions', {
    user_id: userId,
    endpoint: endpoint(route),
    p256dh: keys.p256dh,
    auth: keys.auth,
    is_active: true,
  });
  return row;
}

async function createEvent(createdBy, audience = 'all', audienceMeetingId = null) {
  const [row] = await rest('POST', '/rest/v1/events', {
    title: `Cert ${randomBytes(3).toString('hex')}`,
    date: '2026-11-01',
    time: '19:00',
    location: 'Room 2',
    category: 'Other',
    created_by: createdBy,
    audience,
    audience_meeting_id: audienceMeetingId,
  });
  return row;
}

async function eventState(id) {
  const [row] = await rest('GET', `/rest/v1/events?id=eq.${id}&select=notified_at`);
  return row;
}

async function subscriptionActive(id) {
  const [row] = await rest('GET', `/rest/v1/push_subscriptions?id=eq.${id}&select=is_active`);
  return row?.is_active;
}

async function logRows(userId) {
  return rest('GET', `/rest/v1/push_notification_log?user_id=eq.${userId}&notification_type=eq.event&select=status,response_data`);
}

const observedText = [];  // every response body and container log, for the secret-exposure check

async function invoke(handler, { token, body, method = 'POST', rawBody } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const req = new Request('http://localhost/functions/v1/notify-event', {
    method,
    headers,
    body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const res = await handler(req);
  const text = await res.text();
  observedText.push(text);
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON responses are checked as text only */ }
  return { status: res.status, json };
}

// ---- scenario setup ----------------------------------------------------------------------------------------------
const handler = await loadFunction(VAPID_ENV);

const admin = await createUser('admin');
await setProfile(admin.id, 'admin', 'active');
const coordinator = await createUser('coord');
await setProfile(coordinator.id, 'coordinator', 'active');
const member = await createUser('member');
await setProfile(member.id, 'member', 'active');
const member2 = await createUser('member2');
await setProfile(member2.id, 'member', 'active');
const pending = await createUser('pending');
await setProfile(pending.id, 'coordinator', 'pending');
const plainMember = await createUser('plain');
await setProfile(plainMember.id, 'member', 'active');

// Other harnesses may have left live subscriptions in this database, and their endpoints are not ours. Deactivate
// them so only the devices created below can receive anything in this run.
await rest('PATCH', '/rest/v1/push_subscriptions?is_active=eq.true', { is_active: false });

// Subscriptions for every account, then the audience rules are tested against them.
const subAdmin = await addSubscription(admin.id, 'ok');
const subMember = await addSubscription(member.id, 'ok');
const subMember2Gone = await addSubscription(member2.id, 'gone');
const subPendingMustNotReceive = await addSubscription(pending.id, 'pending');

// ---- 1. authentication and authorisation -------------------------------------------------------------------------
const anyEvent = await createEvent(admin.id);

let r = await invoke(handler, { body: { event_id: anyEvent.id } });
check('unauthenticated request is rejected (401)', r.status === 401, `got ${r.status}`);

r = await invoke(handler, { token: 'not-a-real-token', body: { event_id: anyEvent.id } });
check('forged token is rejected (401)', r.status === 401, `got ${r.status}`);

r = await invoke(handler, { token: member.token, body: { event_id: anyEvent.id } });
check('active member cannot send notifications (403)', r.status === 403, `got ${r.status}`);

r = await invoke(handler, { token: pending.token, body: { event_id: anyEvent.id } });
check('pending account with a coordinator role is rejected (403)', r.status === 403, `got ${r.status}`);
check('rejected requests did not claim the event', (await eventState(anyEvent.id)).notified_at === null);

r = await invoke(handler, { token: admin.token, method: 'GET' });
check('non-POST method is rejected (405)', r.status === 405, `got ${r.status}`);

r = await invoke(handler, { token: admin.token, rawBody: 'not json' });
check('malformed body is rejected (400)', r.status === 400, `got ${r.status}`);

r = await invoke(handler, { token: admin.token, body: { event_id: 'nope' } });
check('non-UUID event_id is rejected (400)', r.status === 400, `got ${r.status}`);

r = await invoke(handler, { token: admin.token, body: { event_id: '00000000-0000-4000-8000-000000000000' } });
check('unknown event is reported as not found (409)', r.status === 409, `got ${r.status}`);

// ---- 2. successful delivery, all members -------------------------------------------------------------------------
const hitsBefore = pushHits.length;
const activeAccounts = (await rest('GET', '/rest/v1/profiles?status=eq.active&select=id')).length;
r = await invoke(handler, { token: admin.token, body: { event_id: anyEvent.id } });
check('admin send returns 200', r.status === 200, `got ${r.status} ${JSON.stringify(r.json)}`);
check('audience "all" counts every active account and no pending account',
  r.json?.recipients === activeAccounts && activeAccounts >= 5, `recipients=${r.json?.recipients} active=${activeAccounts}`);
check('one device per active subscription; the pending account is not counted',
  r.json?.devices === 3, `devices=${r.json?.devices}`);
check('subscribed active devices receive the push (sent 2)', r.json?.sent === 2, `sent=${r.json?.sent}`);
check('a browser that answers 410 is recorded as expired, not failed', r.json?.expired === 1, `expired=${r.json?.expired}`);
check('the pending account endpoint is never contacted', !pushHits.includes('pending'));
check('the event is marked notified', (await eventState(anyEvent.id)).notified_at !== null);
check('the expired subscription is deactivated', (await subscriptionActive(subMember2Gone.id)) === false);
check('live subscriptions stay active', (await subscriptionActive(subMember.id)) === true);
check('pending subscription stays untouched (it was never selected)', (await subscriptionActive(subPendingMustNotReceive.id)) === true);
const adminLog = await logRows(admin.id);
check('delivery is logged per member as sent', adminLog.length === 1 && adminLog[0].status === 'sent', JSON.stringify(adminLog));
const member2Log = await logRows(member2.id);
check('expired device is logged as failed with its reason',
  member2Log.length === 1 && member2Log[0].status === 'failed' && /Subscription gone/.test(member2Log[0].response_data?.error ?? ''),
  JSON.stringify(member2Log));
check('no log row exists for the pending account', (await logRows(pending.id)).length === 0);
check('the push body reaches the endpoint exactly once per device',
  pushHits.slice(hitsBefore).filter((x) => x === 'ok').length === 2);

// ---- 3. duplicate notification -----------------------------------------------------------------------------------
const hitsBeforeDup = pushHits.length;
r = await invoke(handler, { token: admin.token, body: { event_id: anyEvent.id } });
check('a second send for the same event is refused (409)', r.status === 409, `got ${r.status}`);
check('a refused duplicate sends nothing', pushHits.length === hitsBeforeDup);
const dupAgain = await Promise.all([1, 2, 3].map(() => invoke(handler, { token: admin.token, body: { event_id: anyEvent.id } })));
check('concurrent duplicates send nothing and are refused',
  dupAgain.every((x) => x.status === 409) && pushHits.length === hitsBeforeDup, JSON.stringify(dupAgain.map((x) => x.status)));

// ---- 4. audience: a meeting ---------------------------------------------------------------------------------------
const [meeting] = await rest('POST', '/rest/v1/meetings', {
  title: 'Cert cell', date: '2026-11-02', time: '18:00', created_by: admin.id, visibility: 'public',
});
// Written as the admin (the meeting manager). A service-role insert is refused by the attendance trigger.
// Returns the status instead of throwing, so a refusal can be asserted.
async function postAs(token, pathAndQuery, body) {
  const res = await fetch(`${apiUrl}${pathAndQuery}`, {
    method: 'POST',
    headers: { apikey: anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}
const inviteActive = await postAs(admin.token, '/rest/v1/meeting_attendances', [
  { meeting_id: meeting.id, user_id: member2.id, user_name: 'Cert member2' },
]);
check('an active member can be invited to the meeting by the admin manager', inviteActive.status < 300, `${inviteActive.status}`);
// A pending account cannot be invited: the attendance policy requires an active profile. That refusal is the check.
const invitePending = await postAs(admin.token, '/rest/v1/meeting_attendances', [
  { meeting_id: meeting.id, user_id: pending.id, user_name: 'Cert pending' },
]);
check('a pending account cannot be invited (refused by the attendance policy)', invitePending.status === 403, `${invitePending.status}`);
await addSubscription(member2.id, 'ok');
const meetingEvent = await createEvent(admin.id, 'meeting', meeting.id);
const hitsBeforeMeeting = pushHits.length;
r = await invoke(handler, { token: admin.token, body: { event_id: meetingEvent.id } });
check('audience "meeting" reaches only active attendees (recipients 1)', r.json?.recipients === 1, JSON.stringify(r.json));
check('the pending attendee is excluded even though assigned', !pushHits.includes('pending'));
check('meeting audience sends to the attendee device only (sent 1)', r.json?.sent === 1, JSON.stringify(r.json));
check('no one outside the meeting is contacted',
  pushHits.slice(hitsBeforeMeeting).length === 1, `hits=${pushHits.slice(hitsBeforeMeeting).join(',')}`);

// ---- 5. delivery failure (server error) ----------------------------------------------------------------------------
await addSubscription(plainMember.id, 'boom');
const boomEvent = await createEvent(admin.id);
r = await invoke(handler, { token: admin.token, body: { event_id: boomEvent.id } });
check('a server error at the push service is recorded as failed, not expired', r.json?.failed >= 1 && r.json?.expired === 0,
  JSON.stringify(r.json));
const plainLog = await logRows(plainMember.id);
check('the failure reason is written to the log', plainLog.length === 1 && plainLog[0].status === 'failed' && !!plainLog[0].response_data?.error,
  JSON.stringify(plainLog));
check('a failed delivery keeps the subscription active', (await rest('GET', `/rest/v1/push_subscriptions?user_id=eq.${plainMember.id}&select=is_active`))[0]?.is_active === true);
check('the event stays notified after a partial failure (no automatic re-send)', (await eventState(boomEvent.id)).notified_at !== null);

// ---- 6. no devices: claim is released so the event can be sent later -----------------------------------------------
const noDeviceMeeting = (await rest('POST', '/rest/v1/meetings', {
  title: 'Cert empty cell', date: '2026-11-03', time: '18:00', created_by: admin.id, visibility: 'public',
}))[0];
await rest('POST', '/rest/v1/meeting_attendances', [{ meeting_id: noDeviceMeeting.id, user_id: coordinator.id, user_name: 'Cert coord' }], admin.token);
const noDeviceEvent = await createEvent(admin.id, 'meeting', noDeviceMeeting.id);
r = await invoke(handler, { token: admin.token, body: { event_id: noDeviceEvent.id } });
check('an audience with no push devices returns devices 0', r.status === 200 && r.json?.devices === 0, JSON.stringify(r.json));
check('no devices releases the claim, so the event is not consumed', (await eventState(noDeviceEvent.id)).notified_at === null);
await addSubscription(coordinator.id, 'ok');
r = await invoke(handler, { token: admin.token, body: { event_id: noDeviceEvent.id } });
check('after a device is added, the same event can be sent once', r.status === 200 && r.json?.sent === 1, JSON.stringify(r.json));

// ---- 7. orphaned meeting audience (meeting deleted after the event) ------------------------------------------------
const gone = (await rest('POST', '/rest/v1/meetings', {
  title: 'Cert deleted cell', date: '2026-11-04', time: '18:00', created_by: admin.id, visibility: 'public',
}))[0];
const orphanEvent = await createEvent(admin.id, 'meeting', gone.id);
await rest('DELETE', `/rest/v1/meetings?id=eq.${gone.id}`);
const orphanRow = (await rest('GET', `/rest/v1/events?id=eq.${orphanEvent.id}&select=audience,audience_meeting_id`))[0];
check('deleting the meeting leaves the event with a null meeting', orphanRow.audience === 'meeting' && orphanRow.audience_meeting_id === null);
const hitsBeforeOrphan = pushHits.length;
r = await invoke(handler, { token: admin.token, body: { event_id: orphanEvent.id } });
check('an orphaned meeting audience is refused, not sent to everyone (500)', r.status === 500, `got ${r.status}`);
check('an orphaned meeting audience sends nothing', pushHits.length === hitsBeforeOrphan);
check('the refused orphan releases its claim', (await eventState(orphanEvent.id)).notified_at === null);

// ---- 8. configuration: missing VAPID keys (checked after auth, claims nothing) ------------------------------------
const unconfigured = await loadFunction({ VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '', VAPID_SUBJECT: '' });
const unconfiguredEvent = await createEvent(admin.id);
r = await invoke(unconfigured, { body: { event_id: unconfiguredEvent.id } });
check('an unauthenticated caller cannot see configuration state (401, not 500)', r.status === 401, `got ${r.status}`);
r = await invoke(unconfigured, { token: admin.token, body: { event_id: unconfiguredEvent.id } });
check('missing VAPID configuration is reported to an admin (500)', r.status === 500 && /not configured/.test(r.json?.error ?? ''), JSON.stringify(r.json));
check('a configuration failure does not claim the event', (await eventState(unconfiguredEvent.id)).notified_at === null);

// ---- finish ------------------------------------------------------------------------------------------------------
for (const name of containers) {
  try {
    observedText.push(execFileSync('docker', ['logs', name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch { /* no logs available */ }
  try { execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore' }); } catch { /* already gone */ }
}
const everything = observedText.join('\n');
const secretsWithheld = [VAPID_ENV.VAPID_PRIVATE_KEY, serviceKey].every((secret) => !everything.includes(secret));
check('VAPID private key and service-role key never appear in responses or runtime logs', secretsWithheld);
for (const dir of secretDirs) rmSync(dir, { recursive: true, force: true });
pushServer.close();
rmSync(buildDir, { recursive: true, force: true });
rmSync(tlsDir, { recursive: true, force: true });
const failed = results.filter((x) => !x.ok).length;
console.log(`\nnotify-event (${MODE}): ${results.length - failed}/${results.length} checks passed`);
if (failed > 0) process.exit(1);
