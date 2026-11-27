// Tests for scripts/check-supabase-config.mjs. Ensures the public website and the Hub cannot point at different
// databases, and that Preview and demo settings cannot reach production.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let mod;
async function load() {
  mod ??= await import(pathToFileURL(path.join(__dirname, '..', 'check-supabase-config.mjs')).href);
  return mod;
}

const ISOLATED = 'https://abcdefghijklmnopqrst.supabase.co';
const OTHER = 'https://zyxwvutsrqponmlkjihg.supabase.co';
const PROD = 'https://rjtstjmtddqhesexltbj.supabase.co';
const KEY = 'anon-key-a';

test('matching site and Hub configuration passes', async () => {
  const { checkSupabaseConfig } = await load();
  assert.deepEqual(checkSupabaseConfig({ VITE_SUPABASE_URL: ISOLATED, REACT_APP_SUPABASE_URL: ISOLATED, VITE_SUPABASE_ANON_KEY: KEY, REACT_APP_SUPABASE_ANON_KEY: KEY }), []);
});

test('site and Hub pointing at different projects is refused', async () => {
  const { checkSupabaseConfig } = await load();
  const p = checkSupabaseConfig({ VITE_SUPABASE_URL: ISOLATED, REACT_APP_SUPABASE_URL: OTHER });
  assert.ok(p.some((x) => x.includes('different projects')));
});

test('differing anon keys are refused', async () => {
  const { checkSupabaseConfig } = await load();
  const p = checkSupabaseConfig({ VITE_SUPABASE_URL: ISOLATED, REACT_APP_SUPABASE_URL: ISOLATED, VITE_SUPABASE_ANON_KEY: 'a', REACT_APP_SUPABASE_ANON_KEY: 'b' });
  assert.ok(p.some((x) => x.includes('ANON_KEY differ')));
});

test('a URL without its anon key is refused', async () => {
  const { checkSupabaseConfig } = await load();
  assert.ok(checkSupabaseConfig({ VITE_SUPABASE_URL: ISOLATED }).some((x) => x.includes('must be set together')));
});

test('a Preview build cannot reach the protected production project', async () => {
  const { checkSupabaseConfig } = await load();
  const p = checkSupabaseConfig({ VERCEL_ENV: 'preview', VITE_SUPABASE_URL: PROD, REACT_APP_SUPABASE_URL: PROD, VITE_SUPABASE_ANON_KEY: KEY, REACT_APP_SUPABASE_ANON_KEY: KEY });
  assert.ok(p.some((x) => x.includes('protected production project')));
});

test('a Preview build must use the approved isolated project when one is named', async () => {
  const { checkSupabaseConfig } = await load();
  const env = { VERCEL_ENV: 'preview', EXPECTED_PREVIEW_SUPABASE_REF: 'abcdefghijklmnopqrst', VITE_SUPABASE_URL: OTHER, REACT_APP_SUPABASE_URL: OTHER, VITE_SUPABASE_ANON_KEY: KEY, REACT_APP_SUPABASE_ANON_KEY: KEY };
  assert.ok(checkSupabaseConfig(env).some((x) => x.includes('approved isolated project')));
  assert.deepEqual(checkSupabaseConfig({ ...env, EXPECTED_PREVIEW_SUPABASE_REF: 'zyxwvutsrqponmlkjihg' }), []);
});

test('demo content is refused in production', async () => {
  const { checkSupabaseConfig } = await load();
  assert.ok(checkSupabaseConfig({ VERCEL_ENV: 'production', VITE_PREVIEW_DEMO: 'true' }).some((x) => x.includes('Demo content')));
});

test('projectRef reads the ref from a Supabase URL and rejects credentials', async () => {
  const { projectRef } = await load();
  assert.equal(projectRef(ISOLATED), 'abcdefghijklmnopqrst');
  assert.equal(projectRef('https://user:pw@abcdefghijklmnopqrst.supabase.co'), null);
  assert.equal(projectRef('http://example.com'), null);
});
