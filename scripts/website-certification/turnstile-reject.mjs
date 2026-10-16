// Turnstile rejection certification. The local stack serves the website functions with Cloudflare's published ALWAYS-FAIL
// test secret (2x0000000000000000000000000000000AA). Every public message must then be refused, with nothing stored.
// Local, disposable stack only. Node 22 built-ins only. Credentials are never printed.

import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const PROJECT = process.env.CERT_PROJECT_ID ?? '';
const RESULTS = process.env.CERT_RESULTS_FILE ?? 'turnstile-rejection-results.json';
if (!/^websitecert-[a-z0-9-]{4,60}$/.test(PROJECT)) fail('CERT_PROJECT_ID must look like websitecert-<run>.');

const env = Object.fromEntries(
  execSync('supabase status -o env', { encoding: 'utf8' }).split('\n').map((l) => /^([A-Z_]+)="?([^"]*)"?$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2]]),
);
const API = (env.API_URL ?? '').replace(/\/+$/, '');
const ANON = env.ANON_KEY ?? '';
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(API) || !ANON) fail('Local stack address or key is missing. Refusing to run.');
const DB = `supabase_db_${PROJECT}`;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ area: 'turnstile', name, ok: !!ok, detail: ok ? '' : String(detail).slice(0, 300) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [turnstile] ${name}${ok ? '' : ' :: ' + String(detail).slice(0, 200)}`);
};
const sql = (q) => execFileSync('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], { input: q, encoding: 'utf8' }).trim();
const countSubmissions = () => Number(sql('select count(*) from public.web_inbound_submissions'));
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

async function post(body, ip) {
  const res = await fetch(`${API}/functions/v1/website-inquiry`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'content-type': 'application/json', 'cf-connecting-ip': ip },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text };
}

const base = {
  name: 'Certification Visitor', email: 'visitor@example.invalid', phone: '', message: 'Hello', topic: 'General inquiry',
  consentVersion: 'v1', consentTextHash: sha256('I agree that BLW York may reply to me.'), honeypot: '',
  turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
};

async function main() {
  const before = countSubmissions();
  const contact = await post({ ...base, kind: 'contact' }, '198.51.100.31');
  check('a contact message is refused when Turnstile rejects the check', contact.status === 403, `${contact.status} ${contact.text.slice(0, 120)}`);
  check('the refusal does not claim the message was received', !/received|thank you/i.test(contact.text), contact.text.slice(0, 120));
  const newHere = await post({ ...base, kind: 'new_here' }, '198.51.100.31');
  check('a New Here message is refused when Turnstile rejects the check', newHere.status === 403, newHere.status);
  const prayer = await post({ ...base, kind: 'prayer', message: 'Prayer request' }, '198.51.100.31');
  check('a prayer request is refused when Turnstile rejects the check', prayer.status === 403, prayer.status);
  check('nothing is stored after rejected checks', countSubmissions() === before, `before=${before} after=${countSubmissions()}`);
  const noToken = await post({ ...base, kind: 'contact', turnstileToken: '' }, '198.51.100.32');
  check('a request without a token is still refused before any check', noToken.status === 400, noToken.status);

  const failed = results.filter((r) => !r.ok);
  writeFileSync(RESULTS, JSON.stringify({ project: PROJECT, total: results.length, passed: results.length - failed.length, failed: failed.length, results }, null, 2));
  console.log(`\nTURNSTILE REJECTION CERTIFICATION: ${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}

function fail(msg) {
  console.error(`FATAL: ${msg}`);
  process.exit(2);
}

main().catch((e) => {
  console.error(`FATAL during Turnstile rejection test: ${String(e.message ?? e).slice(0, 300)}`);
  process.exit(1);
});
