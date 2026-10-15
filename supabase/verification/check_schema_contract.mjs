// check_schema_contract.mjs
// Asserts the reviewed security contract (schema_contract.json) against a schema fingerprint produced by
// schema_fingerprint.sql, and optionally compares the whole fingerprint to a golden copy.
//
//   node check_schema_contract.mjs <fingerprint.json> [--golden <golden.json>] [--same-as <other-fingerprint.json>]
//
// Works offline on a JSON file, so the same check can be run against a local replay or against a fingerprint copied
// out of a hosted project's SQL Editor (read-only). Exit code is non-zero if any check fails.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('usage: node check_schema_contract.mjs <fingerprint.json> [--golden <file>] [--same-as <file>]');
  process.exit(2);
}
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const load = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const fp = load(args[0]);
const contract = load(path.join(here, 'schema_contract.json'));

const results = [];
const check = (name, ok, evidence) => results.push({ name, ok: !!ok, evidence: ok ? '' : String(evidence ?? '') });
const eq = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const diff = (a, b) => ({ missing: b.filter((x) => !a.includes(x)), extra: a.filter((x) => !b.includes(x)) });
const norm = (sig) => sig.replace(/\bpublic\./g, '').replace(/\s+/g, '');

// --- inventory --------------------------------------------------------------------------------------------------
const tableNames = Object.keys(fp.tables);
check('inventory: exact table list (an unexpected new public table fails)', eq(tableNames, contract.tables), JSON.stringify(diff(tableNames, contract.tables)));
check('inventory: exact view list', eq(Object.keys(fp.views), contract.views), JSON.stringify(diff(Object.keys(fp.views), contract.views)));
check('inventory: no extra schemas', (fp.extra_schemas ?? []).length === 0, JSON.stringify(fp.extra_schemas));
check('ownership: every table is owned by postgres (so supabase_admin defaults never apply)', tableNames.every((t) => fp.tables[t].owner === 'postgres'),
  tableNames.filter((t) => fp.tables[t].owner !== 'postgres').join(','));

// --- RLS ----------------------------------------------------------------------------------------------------------
check('RLS: enabled on every public table', tableNames.every((t) => fp.tables[t].rls), tableNames.filter((t) => !fp.tables[t].rls).join(','));

// --- privileges -------------------------------------------------------------------------------------------------
const anonTables = tableNames.filter((t) => fp.tables[t].privileges.anon !== '');
check('grants: anon holds no privilege on any table', anonTables.length === 0, anonTables.join(','));
check('grants: anon holds no privilege on any view', Object.values(fp.views).every((v) => v.privileges.anon === ''), 'view');
const forbidden = [];
for (const t of tableNames) {
  for (const role of ['anon', 'authenticated', 'service_role']) {
    const have = fp.tables[t].privileges[role].split(',').filter(Boolean);
    contract.forbiddenPrivileges.forEach((p) => have.includes(p) && forbidden.push(`${t}:${role}:${p}`));
  }
  if (fp.tables[t].maintain_acl > 0) forbidden.push(`${t}:MAINTAIN`);
}
check('grants: no TRUNCATE / REFERENCES / TRIGGER / MAINTAIN for any API role', forbidden.length === 0, forbidden.slice(0, 8).join(' '));

const expectedAuth = {};
for (const [privs, names] of Object.entries(contract.authenticatedPrivileges)) names.forEach((n) => (expectedAuth[n] = privs));
const authMismatch = tableNames.filter((t) => fp.tables[t].privileges.authenticated !== (expectedAuth[t] ?? '<unlisted>'));
check('grants: authenticated privileges match the reviewed matrix exactly', authMismatch.length === 0,
  authMismatch.map((t) => `${t}: have '${fp.tables[t].privileges.authenticated}' want '${expectedAuth[t]}'`).join('; '));

const svcMismatch = tableNames.filter((t) => fp.tables[t].privileges.service_role !== (contract.serviceRoleNoAccess.includes(t) ? '' : 'DELETE,INSERT,SELECT,UPDATE'));
check('grants: service_role has only SELECT/INSERT/UPDATE/DELETE (none on owner-only tables)', svcMismatch.length === 0, svcMismatch.join(','));
check('grants: member_directory is read-only for authenticated and unreachable by anon',
  fp.views.member_directory?.privileges.authenticated === 'SELECT' && fp.views.member_directory?.privileges.anon === '', JSON.stringify(fp.views.member_directory?.privileges));
check('views: security_invoker', (fp.views.member_directory?.options ?? '').includes('security_invoker=true'), fp.views.member_directory?.options);

const pgDefaults = (fp.default_privileges ?? []).filter((d) => d.startsWith('postgres |'));
const leaking = pgDefaults.filter((d) => /\b(anon|authenticated|service_role)=/.test(d));
check('default ACLs: objects created by postgres in public grant nothing to API roles', leaking.length === 0, leaking.join(' || '));

// --- authorization of profiles ---------------------------------------------------------------------------------------
for (const [table, allowed] of Object.entries(contract.profilePolicyAllowList)) {
  const names = fp.tables[table].policies.map((p) => p.split(' | ')[0]);
  check(`authorization: ${table} has exactly the allow-listed policies (an unexpected policy fails the release gate)`, eq(names, allowed), JSON.stringify(diff(names, allowed)));
}
const identity = /(auth\.uid\(\)|auth\.jwt\(\)|auth\.role\(\)|is_[a-z_]+\(|has_admin_permission|current_user_role)/i;
const open = [];
for (const t of tableNames) {
  for (const p of fp.tables[t].policies) {
    const [name, cmd, , usingPart, checkPart] = p.split(' | ');
    const using = (usingPart ?? '').replace(/^using=/, '');
    const check_ = (checkPart ?? '').replace(/^check=/, '');
    const lacksUsing = !identity.test(using);
    const lacksCheck = !identity.test(check_);
    if ((['SELECT', 'DELETE'].includes(cmd) && lacksUsing) || (cmd === 'INSERT' && lacksCheck) || (['ALL', 'UPDATE'].includes(cmd) && (lacksUsing || (check_ && lacksCheck)))) open.push(`${t}.${name}`);
  }
}
check('authorization: no policy on any table lacks an identity check', open.length === 0, open.join(','));
const anySignedIn = [];
for (const t of tableNames) {
  for (const p of fp.tables[t].policies) if (/auth\.role\(\) = 'authenticated'::text/.test(p)) anySignedIn.push(`${t}.${p.split(' | ')[0]}`);
}
check('authorization: no policy accepts "any signed-in account" (every such policy requires an active, approved account)', anySignedIn.length === 0, anySignedIn.join(','));
check('authorization: profiles carries the privileged-column guard trigger',
  contract.requiredTriggers.profiles.every((name) => fp.tables.profiles.triggers.some((t) => t.includes(` ${name} `))), JSON.stringify(fp.tables.profiles.triggers.map((t) => t.slice(0, 60))));

// --- identity contract ------------------------------------------------------------------------------------------------
for (const [table, rule] of Object.entries(contract.identityContract)) {
  const cols = fp.tables[table].columns.map((c) => c.split(':').slice(0, 3).join(':'));
  const colNames = fp.tables[table].columns.map((c) => c.split(':')[0]);
  check(`identity: ${table} is keyed by user_id and carries no member_id`,
    rule.mustHave.every((c) => cols.includes(c)) && rule.mustNotHave.every((c) => !colNames.includes(c)),
    `have ${colNames.join(',')}`);
}
check('identity: email_preferences primary key is user_id', fp.tables.email_preferences.constraints.some((c) => /PRIMARY KEY \(user_id\)/.test(c)), '');
check('identity: push_subscriptions endpoint is unique and user_id is not (many devices per account)',
  fp.tables.push_subscriptions.constraints.some((c) => /UNIQUE \(endpoint\)/.test(c)) && !fp.tables.push_subscriptions.constraints.some((c) => /UNIQUE \(user_id\)/.test(c)), '');

// --- functions ------------------------------------------------------------------------------------------------------
const fnSigs = Object.keys(fp.functions);
const normalized = Object.fromEntries(fnSigs.map((s) => [norm(s), fp.functions[s]]));
const expectedFns = Object.keys(contract.functions).map(norm);
check('functions: exact allow-list (an unexpected new public function fails)', eq(Object.keys(normalized), expectedFns), JSON.stringify(diff(Object.keys(normalized), expectedFns)));
const fnProblems = [];
for (const [sig, want] of Object.entries(contract.functions)) {
  const have = normalized[norm(sig)];
  if (!have) continue;
  const callers = ['anon', 'authenticated', 'service_role'].filter((r) => have.execute[r]);
  if (have.execute.public) fnProblems.push(`${sig}: PUBLIC can execute`);
  if (!eq(callers, want.execute)) fnProblems.push(`${sig}: EXECUTE ${JSON.stringify(callers)} want ${JSON.stringify(want.execute)}`);
  if (have.security !== want.security) fnProblems.push(`${sig}: ${have.security} want ${want.security}`);
  if (have.owner !== 'postgres') fnProblems.push(`${sig}: owner ${have.owner}`);
  if (want.security === 'definer' && !have.config.includes(contract.definerSearchPath)) fnProblems.push(`${sig}: search_path not pinned (${have.config || 'none'})`);
}
check('functions: security mode, pinned search_path, owner and EXECUTE grants match exactly; PUBLIC and anon never execute', fnProblems.length === 0, fnProblems.join(' | '));

// --- storage ---------------------------------------------------------------------------------------------------------
check('storage: exact buckets with size and MIME limits', eq(fp.storage_buckets ?? [], contract.storage.buckets), JSON.stringify(diff(fp.storage_buckets ?? [], contract.storage.buckets)));
const stPolicies = (fp.storage_policies ?? []).map((p) => p.split(' | ')[0]);
check('storage: exact policy set on storage.objects', eq(stPolicies, contract.storage.policyNames), JSON.stringify(diff(stPolicies, contract.storage.policyNames)));
check('storage: no policy applies to anon or public', (fp.storage_policies ?? []).every((p) => !/\{(anon|public)/.test(p.split(' | ')[2])), '');

// --- Auth signup trigger ----------------------------------------------------------------------------------------------
check('signup: on_auth_user_created trigger exists on auth.users', (fp.auth_user_triggers ?? []).some((t) => t.includes('on_auth_user_created')), JSON.stringify(fp.auth_user_triggers));

// --- optional comparisons ---------------------------------------------------------------------------------------------
const stable = (doc) => {
  const copy = JSON.parse(JSON.stringify(doc));
  delete copy.extensions; // hosted projects pre-install extra extensions
  copy.default_privileges = (copy.default_privileges ?? []).filter((d) => d.startsWith('postgres |')); // supabase_admin defaults are platform-managed
  return JSON.stringify(copy);
};
if (opt('--golden')) {
  const golden = load(opt('--golden'));
  const same = stable(fp) === stable(golden);
  let where = '';
  if (!same) {
    const a = JSON.parse(stable(fp)), b = JSON.parse(stable(golden));
    where = Object.keys({ ...a, ...b }).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).join(',');
  }
  check('parity: schema fingerprint equals the golden fingerprint', same, `sections differing: ${where}`);
}
if (opt('--same-as')) {
  const other = load(opt('--same-as'));
  check('replay: second independent replay is byte-identical to the first', JSON.stringify(fp) === JSON.stringify(other), 'fingerprints differ');
}

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}\t${r.name}${r.ok ? '' : '\t' + r.evidence}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
