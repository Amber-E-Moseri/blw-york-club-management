// Unit tests for scripts/seed-guard.cjs. Run with: node --test scripts/__tests__/
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assertSafeSeedTarget, REQUIRED_CONFIRMATION } = require('../seed-guard.cjs');

const PROD_URL = 'https://yziuhtxtznginhdpqurb.supabase.co';
const PASSWORD = 'a-long-enough-test-password';

const local = {
  SUPABASE_URL: 'http://127.0.0.1:58321',
  TEST_SEED_CONFIRM: REQUIRED_CONFIRMATION,
  TEST_USER_PASSWORD: PASSWORD,
};

test('accepts a local host with explicit confirmation and a long password', () => {
  const r = assertSafeSeedTarget(local);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.host, '127.0.0.1');
});

test('accepts localhost by name', () => {
  assert.equal(assertSafeSeedTarget({ ...local, SUPABASE_URL: 'http://localhost:54321' }).ok, true);
});

test('refuses the production project URL', () => {
  const r = assertSafeSeedTarget({ ...local, SUPABASE_URL: PROD_URL });
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /production project/);
});

test('refuses the production project even when it is put on the allowlist', () => {
  const r = assertSafeSeedTarget({
    ...local,
    SUPABASE_URL: PROD_URL,
    TEST_SEED_ALLOWED_HOSTS: 'yziuhtxtznginhdpqurb.supabase.co',
  });
  assert.equal(r.ok, false, 'production must never pass, whatever the allowlist says');
  assert.match(r.errors.join('\n'), /not overridable/);
});

test('refuses a hosted host that is not on the allowlist', () => {
  const r = assertSafeSeedTarget({ ...local, SUPABASE_URL: 'https://some-other.supabase.co' });
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /not on the test-seed allowlist/);
});

test('accepts a hosted test host only when it is named in TEST_SEED_ALLOWED_HOSTS', () => {
  const r = assertSafeSeedTarget({
    ...local,
    SUPABASE_URL: 'https://blw-test-seed.supabase.co',
    TEST_SEED_ALLOWED_HOSTS: 'blw-test-seed.supabase.co',
  });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test('refuses NODE_ENV=production', () => {
  const r = assertSafeSeedTarget({ ...local, NODE_ENV: 'production' });
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /NODE_ENV=production/);
});

test('refuses without the exact confirmation string', () => {
  const r = assertSafeSeedTarget({ ...local, TEST_SEED_CONFIRM: 'yes' });
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /TEST_SEED_CONFIRM/);
});

test('refuses a short or missing password', () => {
  assert.equal(assertSafeSeedTarget({ ...local, TEST_USER_PASSWORD: 'short' }).ok, false);
  assert.equal(assertSafeSeedTarget({ ...local, TEST_USER_PASSWORD: undefined }).ok, false);
});

test('refuses a malformed URL', () => {
  const r = assertSafeSeedTarget({ ...local, SUPABASE_URL: 'not a url' });
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /not a valid URL/);
});

test('refuses an empty environment and reports every failure', () => {
  const r = assertSafeSeedTarget({});
  assert.equal(r.ok, false);
  assert.ok(r.errors.length >= 3, `expected several errors, got ${r.errors.length}`);
});
