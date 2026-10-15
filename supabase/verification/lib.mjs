// Shared helpers for the behavioural certification harnesses.
//
// Safety rules baked in:
//   * runs only against a LOCAL Supabase stack (127.0.0.1 / localhost) unless ALLOW_NON_LOCAL_CERTIFICATION=1;
//   * every account is fake (@example.test) and gets a random password generated for this run only;
//   * every account created is deleted again at the end, even if a check throws.
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const options = { auth: { persistSession: false, autoRefreshToken: false } };

export function randomPassword() {
  return `${randomBytes(18).toString('base64url')}aA1!`;
}

export function harness(name) {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error('SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are required');
  }
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url) && process.env.ALLOW_NON_LOCAL_CERTIFICATION !== '1') {
    throw new Error(`${name}: refusing to run against a non-local Supabase URL`);
  }

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
    if (cellId) patch.cell_id = cellId;
    if (Object.keys(patch).length) {
      const { error: upErr } = await admin.from('profiles').update(patch).eq('id', data.user.id);
      if (upErr) throw new Error(`elevate ${label}: ${upErr.message}`);
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
