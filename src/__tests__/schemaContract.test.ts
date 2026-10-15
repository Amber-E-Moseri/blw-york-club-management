import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Proves the release gate actually FAILS when the schema drifts. The golden fingerprint is mutated in memory in
// the ways production once drifted (rogue policy, anon grants, truncate, new unlisted table/function, unpinned
// search_path, member_id identity, missing guard trigger) and the checker must exit non-zero with a precise message.

const root = path.resolve(__dirname, '..', '..');
const verification = path.join(root, 'supabase', 'verification');
const golden = JSON.parse(fs.readFileSync(path.join(verification, 'schema_fingerprint.golden.json'), 'utf8'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-contract-'));

function check(mutate: (fp: any) => void): { status: number | null; output: string } {
  const copy = JSON.parse(JSON.stringify(golden));
  mutate(copy);
  const file = path.join(tmp, `fp-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(file, JSON.stringify(copy));
  const run = spawnSync(process.execPath, [path.join(verification, 'check_schema_contract.mjs'), file, '--golden', path.join(verification, 'schema_fingerprint.golden.json')], { encoding: 'utf8' });
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

describe('schema contract gate', () => {
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  test('the certified golden fingerprint passes every check', () => {
    const result = check(() => undefined);
    expect(result.output).not.toMatch(/^FAIL/m);
    expect(result.status).toBe(0);
  });

  test.each([
    ['an unexpected policy on profiles (self-update drift)', (fp: any) => fp.tables.profiles.policies.push("profiles_self_update | UPDATE | {public} | using=(auth.uid() = id) | check="), /profiles has exactly the allow-listed policies/],
    ['a policy that accepts any signed-in account', (fp: any) => fp.tables.events.policies.push("events_any | SELECT | {public} | using=(auth.role() = 'authenticated'::text) | check="), /no policy accepts "any signed-in account"/],
    ['a policy with no identity check at all', (fp: any) => fp.tables.events.policies.push('events_open | SELECT | {public} | using=true | check='), /lacks an identity check/],
    ['table privileges granted to anon', (fp: any) => { fp.tables.people.privileges.anon = 'SELECT'; }, /anon holds no privilege on any table/],
    ['TRUNCATE granted to authenticated', (fp: any) => { fp.tables.people.privileges.authenticated += ',TRUNCATE'; }, /no TRUNCATE/],
    ['an authenticated privilege outside the reviewed matrix', (fp: any) => { fp.tables.email_log.privileges.authenticated = 'SELECT'; }, /authenticated privileges match the reviewed matrix/],
    ['an unlisted new public table', (fp: any) => { fp.tables.zz_new_table = JSON.parse(JSON.stringify(fp.tables.cells)); }, /exact table list/],
    ['RLS disabled on a table', (fp: any) => { fp.tables.cells.rls = false; }, /RLS: enabled on every public table/],
    ['an unlisted new function', (fp: any) => { fp.functions['zz_new_fn()'] = { security: 'invoker', config: '', volatility: 'v', owner: 'postgres', execute: { public: true, anon: true, authenticated: true, service_role: true }, definition_md5: 'x' }; }, /exact allow-list/],
    ['PUBLIC can execute an RPC', (fp: any) => { fp.functions[Object.keys(fp.functions).find((k) => k.includes('approve_pending_member'))!].execute.public = true; }, /PUBLIC and anon never execute/],
    ['anon can execute an RPC', (fp: any) => { fp.functions[Object.keys(fp.functions).find((k) => k.includes('approve_pending_member'))!].execute.anon = true; }, /PUBLIC and anon never execute/],
    ['an unpinned search_path on a SECURITY DEFINER function', (fp: any) => { fp.functions[Object.keys(fp.functions).find((k) => k.includes('approve_pending_member'))!].config = ''; }, /pinned search_path/],
    ['member_id re-introduced on push_subscriptions', (fp: any) => fp.tables.push_subscriptions.columns.push('member_id:uuid:null:'), /push_subscriptions is keyed by user_id/],
    ['the privileged-column guard trigger removed', (fp: any) => { fp.tables.profiles.triggers = fp.tables.profiles.triggers.filter((t: string) => !t.includes('guard')); }, /privileged-column guard trigger/],
    ['default privileges that grant anon access to new tables', (fp: any) => fp.default_privileges.unshift('postgres | public | r | postgres=SELECT,anon=SELECT'), /default ACLs/],
    ['an extra Storage policy', (fp: any) => fp.storage_policies.push('rogue | INSERT | {public} | using= | check='), /exact policy set on storage.objects/],
    ['a Storage bucket without limits', (fp: any) => { fp.storage_buckets[0] = 'devotional-images | public=true | max=- | mime=-'; }, /exact buckets with size and MIME limits/],
  ])('fails on %s', (_name, mutate, expected) => {
    const result = check(mutate as (fp: any) => void);
    expect(result.status).toBe(1);
    expect(result.output).toMatch(expected as RegExp);
  });
});
