// Runs without any network access: node --test scripts/e2e/check-target.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTarget } from './check-target.mjs';

const SHA = 'a'.repeat(40);
const REF = 'abcdefghijklmnopqrst';
const base = {
  SUPABASE_URL: `https://${REF}.supabase.co`,
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  E2E_COORDINATOR_EMAIL: 'coord@example.test',
  E2E_COORDINATOR_PASSWORD: 'pw',
  E2E_HOSTED_ISOLATED: '1',
  E2E_ISOLATED_HOST: `${REF}.supabase.co`,
  E2E_DENIED_HOSTS: 'prodref00000000000000.supabase.co,previewref0000000000.supabase.co',
};
const accepted = (env, opts = { candidateSha: SHA }) => assert.deepEqual(validateTarget(env, opts), []);
const refused = (env, pattern, opts = { candidateSha: SHA }) => {
  const errors = validateTarget(env, opts);
  assert.ok(errors.length > 0, 'expected refusal');
  assert.match(errors.join('\n'), pattern);
};

test('accepts the named isolated project at a pinned SHA', () => accepted(base));
test('accepts loopback without hosted opt-in (local runs)', () =>
  accepted({ ...base, SUPABASE_URL: 'http://127.0.0.1:54321', E2E_HOSTED_ISOLATED: undefined, E2E_ISOLATED_HOST: undefined, E2E_DENIED_HOSTS: undefined }));
test('refuses hosted run without explicit opt-in', () => refused({ ...base, E2E_HOSTED_ISOLATED: '0' }, /E2E_HOSTED_ISOLATED=1/));
test('refuses a project that is not the named one', () =>
  refused({ ...base, SUPABASE_URL: 'https://zyxwvutsrqponmlkjihg.supabase.co' }, /does not match E2E_ISOLATED_HOST/));
test('refuses when no isolated host is named', () => refused({ ...base, E2E_ISOLATED_HOST: '' }, /E2E_ISOLATED_HOST is required/));
test('refuses a production host even if it is named', () =>
  refused({ ...base, SUPABASE_URL: 'https://prodref00000000000000.supabase.co', E2E_ISOLATED_HOST: 'prodref00000000000000.supabase.co' }, /denylist/));
test('refuses a Preview host even if it is named', () =>
  refused({ ...base, SUPABASE_URL: 'https://previewref0000000000.supabase.co', E2E_ISOLATED_HOST: 'previewref0000000000.supabase.co' }, /denylist/));
test('refuses an empty denylist', () => refused({ ...base, E2E_DENIED_HOSTS: '' }, /may not be empty/));
test('refuses a non-Supabase hosted host', () =>
  refused({ ...base, SUPABASE_URL: 'https://example.com', E2E_ISOLATED_HOST: 'example.com' }, /<20-char-ref>\.supabase\.co/));
test('refuses plain http for a hosted host', () => refused({ ...base, SUPABASE_URL: `http://${REF}.supabase.co` }, /must use https/));
test('refuses URL with credentials or path', () => {
  refused({ ...base, SUPABASE_URL: `https://user:pw@${REF}.supabase.co` }, /credentials/);
  refused({ ...base, SUPABASE_URL: `https://${REF}.supabase.co/rest/v1` }, /bare project origin/);
});
test('refuses a malformed URL', () => refused({ ...base, SUPABASE_URL: 'not a url' }, /not a valid URL/));
test('refuses a missing service-role key', () => refused({ ...base, SUPABASE_SERVICE_ROLE_KEY: '' }, /SUPABASE_SERVICE_ROLE_KEY is required/));
// Approved Preview exception: exact host yziuhtxtznginhdpqurb.supabase.co, only with explicit authorization.
const PREVIEW_HOST = 'yziuhtxtznginhdpqurb.supabase.co';
const PREVIEW_ENV = {
  ...base,
  SUPABASE_URL: `https://${PREVIEW_HOST}`,
  E2E_ISOLATED_HOST: PREVIEW_HOST,
  E2E_DENIED_HOSTS: `rjtstjmtddqhesexltbj.supabase.co,${PREVIEW_HOST}`,
  E2E_PREVIEW_TESTING_AUTHORIZED: 'true',
  E2E_APPROVED_PREVIEW_HOST: PREVIEW_HOST,
};
test('accepts the approved Preview host with explicit authorization, even though it is on the denylist', () => accepted(PREVIEW_ENV));
test('refuses the approved Preview host without the authorization flag', () =>
  refused({ ...PREVIEW_ENV, E2E_PREVIEW_TESTING_AUTHORIZED: undefined }, /requires E2E_PREVIEW_TESTING_AUTHORIZED=true/));
test('refuses the Preview host when the flag is not exactly "true"', () => {
  refused({ ...PREVIEW_ENV, E2E_PREVIEW_TESTING_AUTHORIZED: '1' }, /requires E2E_PREVIEW_TESTING_AUTHORIZED=true/);
  refused({ ...PREVIEW_ENV, E2E_PREVIEW_TESTING_AUTHORIZED: 'TRUE' }, /requires E2E_PREVIEW_TESTING_AUTHORIZED=true/);
});
test('refuses the Preview host when the approved-host value does not match exactly', () => {
  refused({ ...PREVIEW_ENV, E2E_APPROVED_PREVIEW_HOST: undefined }, /E2E_APPROVED_PREVIEW_HOST=yziuhtxtznginhdpqurb/);
  refused({ ...PREVIEW_ENV, E2E_APPROVED_PREVIEW_HOST: 'yziuhtxtznginhdpqurb.supabase.co.evil' }, /E2E_APPROVED_PREVIEW_HOST=yziuhtxtznginhdpqurb/);
});
test('refuses a look-alike Preview ref when the approved Preview host is the named host', () =>
  refused({ ...PREVIEW_ENV, SUPABASE_URL: 'https://yziuhtxtznginhdpqurc.supabase.co' }, /does not match E2E_ISOLATED_HOST/));
test('refuses production unconditionally, even with Preview authorization present', () => {
  const prod = { SUPABASE_URL: 'https://rjtstjmtddqhesexltbj.supabase.co', E2E_ISOLATED_HOST: 'rjtstjmtddqhesexltbj.supabase.co' };
  refused({ ...PREVIEW_ENV, ...prod }, /unconditionally refused/);
  refused({ ...PREVIEW_ENV, ...prod, E2E_DENIED_HOSTS: 'previewref0000000000.supabase.co' }, /unconditionally refused/);
  refused({ ...PREVIEW_ENV, ...prod, E2E_APPROVED_PREVIEW_HOST: 'rjtstjmtddqhesexltbj.supabase.co' }, /unconditionally refused/);
});
test('refuses production named as the isolated host even when the URL is another project', () =>
  refused({ ...base, E2E_ISOLATED_HOST: 'rjtstjmtddqhesexltbj.supabase.co' }, /unconditionally refused|does not match/));
test('refuses an unknown project even when Preview authorization is set', () =>
  refused({ ...PREVIEW_ENV, SUPABASE_URL: 'https://zyxwvutsrqponmlkjihg.supabase.co', E2E_ISOLATED_HOST: PREVIEW_HOST }, /does not match E2E_ISOLATED_HOST/));
test('refuses an unpinned or short candidate SHA', () => {
  refused(base, /40-character/, { candidateSha: 'main' });
  refused(base, /40-character/, { candidateSha: 'A'.repeat(40) });
  refused(base, /40-character/, { candidateSha: 'abc' });
});
