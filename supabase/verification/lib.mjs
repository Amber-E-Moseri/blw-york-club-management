// Shared helpers for the behavioural certification harnesses.
//
// Safety rules baked in:
//   * runs only against a LOCAL Supabase stack (127.0.0.1 / localhost) unless ALLOW_NON_LOCAL_CERTIFICATION=1;
//   * every account is fake (@example.test) and gets a random password generated for this run only;
//   * every account created is deleted again at the end, even if a check throws.
//
// Fixture state (role, status, cell) is never written through the service_role API key: migration 094 removes those
// privileges. It is set in one of two ways only:
//   * the approved workflow RPCs, run as an admin or coordinator session (used by the authorization harnesses);
//   * setProfileAsOwner(): a local-only owner connection (LOCAL_OWNER_DATABASE_URL, a postgres login on 127.0.0.1 or
//     localhost). It is a test-setup step, not an endpoint. It refuses any non-local host and any value that is not on
//     the allow-list below, and it is never reachable from the application.
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const options = { auth: { persistSession: false, autoRefreshToken: false } };

const FIXTURE_ROLES = ['member', 'cell_leader', 'coordinator', 'admin'];
const FIXTURE_STATUSES = ['pending', 'active', 'inactive', 'rejected'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Sets role, status and/or cell on one fixture profile through a local owner connection. Values are allow-listed or
 * UUID-validated before they reach the SQL text, so nothing caller-supplied is interpolated unchecked.
 */
export function setProfileAsOwner(profileId, { role, status, cellId, bscId } = {}) {
  const hosted = process.env.CERT_HOSTED === '1';
  const dsn = hosted ? process.env.CERT_OWNER_DATABASE_URL : process.env.LOCAL_OWNER_DATABASE_URL;
  if (!dsn) return Promise.reject(new Error('setProfileAsOwner: an owner connection is required for fixture state'));
  if (hosted) {
    // Hosted: the pooler user must name the certification project, and the project must be the allowlisted one.
    const m = /^postgres(ql)?:\/\/[^:]+\.([a-z0-9]{20}):[^@]*@[^/]+\//.exec(dsn);
    if (!m || m[2] !== certificationProjectRef()) {
      return Promise.reject(new Error('setProfileAsOwner: owner connection does not name the certification project'));
    }
  } else if (!/^postgres(ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost)[:/]/.test(dsn)) {
    return Promise.reject(new Error('setProfileAsOwner: refusing a non-local owner connection'));
  }
  if (!UUID.test(profileId)) return Promise.reject(new Error('setProfileAsOwner: profile id is not a UUID'));
  const sets = [];
  if (role !== undefined) {
    if (!FIXTURE_ROLES.includes(role)) return Promise.reject(new Error(`setProfileAsOwner: role ${role} is not allowed`));
    sets.push(`role = '${role}'`);
  }
  if (status !== undefined) {
    if (!FIXTURE_STATUSES.includes(status)) return Promise.reject(new Error(`setProfileAsOwner: status ${status} is not allowed`));
    sets.push(`status = '${status}'`);
  }
  if (cellId !== undefined) {
    if (cellId !== null && !UUID.test(cellId)) return Promise.reject(new Error('setProfileAsOwner: cell id is not a UUID'));
    sets.push(`cell_id = ${cellId === null ? 'null' : `'${cellId}'`}`);
  }
  if (bscId !== undefined) {
    if (bscId !== null && !UUID.test(bscId)) return Promise.reject(new Error('setProfileAsOwner: BSC id is not a UUID'));
    sets.push(`bsc_id = ${bscId === null ? 'null' : `'${bscId}'`}`);
  }
  if (sets.length === 0) return Promise.resolve();
  // A cell change needs a reason (the audit trigger refuses an unreasoned change, migration 093). The reason is set for
  // this one statement's transaction only, and is consumed by its audit row. Owner fixtures record why they moved a cell.
  const reason = cellId !== undefined ? "select set_config('app.cell_change_reason', 'Owner fixture setup', true);" : '';
  const sql = `begin; ${reason} update public.profiles set ${sets.join(', ')} where id = '${profileId}'; commit;`;
  return new Promise((resolve, reject) => {
    execFile('psql', [dsn, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-c', sql], (err, _stdout, stderr) => {
      if (err) reject(new Error(`setProfileAsOwner: ${stderr || err.message}`));
      else resolve();
    });
  });
}

export function randomPassword() {
  return `${randomBytes(18).toString('base64url')}aA1!`;
}

// Project references that no certification run may ever target. The production and Preview references are denied by
// name here, so a mistyped secret or variable cannot point a hosted run at them.
export const DENIED_PROJECT_REFS = [
  'rjtstjmtddqhesexltbj', // protected production project
  'yziuhtxtznginhdpqurb', // Preview certification project (must not be reused by Hub-Certification)
];

/** The certification project reference for hosted runs. Must be set explicitly; there is no default. */
export function certificationProjectRef() {
  const ref = (process.env.CERT_EXPECTED_PROJECT_REF ?? '').trim();
  if (!/^[a-z0-9]{20}$/.test(ref)) throw new Error('CERT_EXPECTED_PROJECT_REF is missing or malformed');
  if (DENIED_PROJECT_REFS.includes(ref)) throw new Error('CERT_EXPECTED_PROJECT_REF names a denied (protected) project');
  return ref;
}

/**
 * Decides whether a Supabase URL may be used. Local stacks are allowed by default. A hosted URL is allowed only when
 * CERT_HOSTED=1, the URL names exactly CERT_EXPECTED_PROJECT_REF, and that reference is not on the deny list.
 */
export function assertCertificationTarget(url) {
  if (/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) {
    if (process.env.CERT_HOSTED === '1') throw new Error('CERT_HOSTED=1 but SUPABASE_URL is local');
    return { hosted: false, ref: null };
  }
  if (process.env.CERT_HOSTED !== '1') throw new Error('refusing a non-local Supabase URL (set CERT_HOSTED=1 for the certification project)');
  const m = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/.exec(url);
  if (!m) throw new Error('hosted SUPABASE_URL must be https://<project-ref>.supabase.co');
  const expected = certificationProjectRef();
  if (m[1] !== expected) throw new Error('SUPABASE_URL does not name CERT_EXPECTED_PROJECT_REF');
  if (DENIED_PROJECT_REFS.includes(m[1])) throw new Error('SUPABASE_URL names a denied (protected) project');
  return { hosted: true, ref: m[1] };
}

export function harness(name) {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error('SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are required');
  }
  assertCertificationTarget(url);

  const admin = createClient(url, serviceRoleKey, options);
  // A client that has never signed in. supabase-js keeps a session in memory after signUp/signIn, so denial checks
  // must use a fresh client every time (see newAnon) or they would silently run as an authenticated user.
  const newAnon = () => createClient(url, anonKey, options);
  const anon = newAnon();
  const createdUsers = [];
  const results = [];
  const run = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;

  const pass = (check, evidence = '') => results.push({ ok: true, check, evidence });
  const fail = (check, evidence = '') => results.push({ ok: false, check, evidence });
  const expect = (check, condition, evidence = '') => (condition ? pass(check, condition === true ? '' : evidence) : fail(check, evidence));

  /** Creates a confirmed account through the Auth admin API (so the real signup trigger runs), optionally elevates it. */
  async function createUser(label, { role = 'member', status = 'active', metadata = {}, cellId = null } = {}) {
    const email = `cert.${name}.${label}.${run}@example.test`;
    const password = randomPassword();
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: `Cert ${label}`, ...metadata },
    });
    if (error || !data.user) throw new Error(`createUser ${label}: ${error?.message}`);
    createdUsers.push(data.user.id);
    const patch = {};
    if (role !== 'member') patch.role = role;
    if (status !== 'pending') patch.status = status;
    if (cellId) patch.cellId = cellId;
    if (Object.keys(patch).length) {
      await setProfileAsOwner(data.user.id, patch).catch((e) => {
        throw new Error(`elevate ${label}: ${e.message}`);
      });
    }
    const client = createClient(url, anonKey, options);
    const { data: session, error: signErr } = await client.auth.signInWithPassword({ email, password });
    if (signErr || !session.session) throw new Error(`sign in ${label}: ${signErr?.message}`);
    return { id: data.user.id, email, password, client, token: session.session.access_token };
  }

  async function profileOf(id) {
    const { data, error } = await admin.from('profiles').select('id,role,status,admin_role').eq('id', id).single();
    if (error) throw new Error(`profileOf: ${error.message}`);
    return data;
  }

  async function cleanup() {
    for (const id of createdUsers.splice(0)) {
      try { await admin.auth.admin.deleteUser(id); } catch { /* best effort */ }
    }
  }

  function report() {
    for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}\t${r.check}${r.ok || !r.evidence ? '' : '\t' + r.evidence}`);
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${name}: ${results.length - failed}/${results.length} checks passed`);
    process.exitCode = failed ? 1 : 0;
  }

  return { url, anonKey, admin, anon, newAnon, createUser, profileOf, cleanup, report, pass, fail, expect, run, results };
}

/** A body of a valid 1x1 PNG, for upload tests. */
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);
