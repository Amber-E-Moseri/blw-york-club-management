// Email OTP delivery and verification check for sign-up (six-digit code, GoTrue verify with type 'signup').
//
// Exit codes: 0 = PASS, 1 = FAIL, 2 = BLOCKED (the test mail path is not configured or not authorised).
// BLOCKED is never reported as PASS. The script creates one test account under CERT_MAIL_TEST_DOMAIN, reads the code
// from an approved test inbox, verifies it, checks a wrong code is refused, and deletes the account.
//
// Test inbox contract (provider-neutral; the owner supplies an adapter that meets it). No provider is selected here.
//   GET {CERT_MAIL_INBOX_API_URL}/latest?to=<address>
//   Authorization: Bearer {CERT_MAIL_INBOX_TOKEN}
//   200 -> JSON { "text": "<message body>", "receivedAt": "<ISO-8601>" } for the newest message to that address.
//   404 -> no message yet (the script polls for up to CERT_MAIL_TIMEOUT_SECONDS).
//
// Environment (names only; never printed): SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
//   CERT_HOSTED=1, CERT_EXPECTED_PROJECT_REF, CERT_MAIL_INBOX_API_URL, CERT_MAIL_INBOX_TOKEN, CERT_MAIL_TEST_DOMAIN,
//   optional CERT_MAIL_TIMEOUT_SECONDS (default 120).
import { assertCertificationTarget } from './lib.mjs';

const BLOCKED = 2;
const FAILED = 1;

function blocked(reason) {
  console.log(`BLOCKED: ${reason}`);
  process.exit(BLOCKED);
}

const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'CERT_MAIL_INBOX_API_URL', 'CERT_MAIL_INBOX_TOKEN', 'CERT_MAIL_TEST_DOMAIN'];
for (const name of required) {
  if (!process.env[name]) blocked(`${name} is not set`);
}
if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(process.env.CERT_MAIL_TEST_DOMAIN)) blocked('CERT_MAIL_TEST_DOMAIN is malformed');

// Target guard first: a non-certification project must never receive a test signup.
assertCertificationTarget(process.env.SUPABASE_URL);

const url = process.env.SUPABASE_URL.replace(/\/$/, '');
const anon = process.env.SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const inbox = process.env.CERT_MAIL_INBOX_API_URL.replace(/\/$/, '');
const inboxToken = process.env.CERT_MAIL_INBOX_TOKEN;
const timeoutMs = Number(process.env.CERT_MAIL_TIMEOUT_SECONDS ?? 120) * 1000;

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const address = `otp.${run}@${process.env.CERT_MAIL_TEST_DOMAIN}`;
const password = `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}Aa1!`;
const results = [];
const check = (name, ok, evidence = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${evidence ? `  (${evidence})` : ''}`);
};

async function waitForCode() {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await fetch(`${inbox}/latest?to=${encodeURIComponent(address)}`, {
      headers: { authorization: `Bearer ${inboxToken}` },
    });
    if (r.status === 200) {
      const body = await r.json();
      const m = /\b(\d{6})\b/.exec(body.text ?? '');
      if (m) return m[1];
    } else if (r.status !== 404) {
      blocked(`test inbox returned HTTP ${r.status}; the approved mail path is not usable`);
    }
    await new Promise((res) => setTimeout(res, 5000));
  }
  return null;
}

async function gt(method, path, { token = anon, body } = {}) {
  const r = await fetch(`${url}${path}`, {
    method,
    headers: { apikey: anon, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await r.json(); } catch { /* empty body */ }
  return { status: r.status, json };
}

let userId = null;
try {
  const signup = await gt('POST', '/auth/v1/signup', { body: { email: address, password } });
  check('signup accepted (confirmation mail requested)', signup.status === 200, `HTTP ${signup.status}`);
  userId = signup.json?.id ?? null;

  const code = await waitForCode();
  check('six-digit code delivered to the approved test inbox', code !== null, code ? 'code received, value not printed' : 'timed out');
  if (!code) {
    // Not a PASS. The mail path did not deliver within the timeout, so the verification cannot be concluded.
    console.log('RESULT: BLOCKED (no code delivered within the timeout; not a PASS)');
    process.exitCode = BLOCKED;
  } else {
    const wrong = code === '000000' ? '111111' : '000000';
    const bad = await gt('POST', '/auth/v1/verify', { body: { type: 'signup', email: address, token: wrong } });
    check('wrong code refused', bad.status >= 400, `HTTP ${bad.status}`);

    const good = await gt('POST', '/auth/v1/verify', { body: { type: 'signup', email: address, token: code } });
    check('correct code verifies and issues a session', good.status === 200 && Boolean(good.json?.access_token), `HTTP ${good.status}`);

    const reuse = await gt('POST', '/auth/v1/verify', { body: { type: 'signup', email: address, token: code } });
    check('reused code refused', reuse.status >= 400, `HTTP ${reuse.status}`);
  }
} finally {
  if (userId) {
    const del = await fetch(`${url}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers: { apikey: service, authorization: `Bearer ${service}` },
    });
    check('test account deleted', del.status < 300 || del.status === 404, `HTTP ${del.status}`);
  }
}

const failed = results.filter((r) => !r.ok).length;
console.log(`SUMMARY ${results.length - failed} PASS, ${failed} FAIL`);
if (failed > 0) process.exit(FAILED);
