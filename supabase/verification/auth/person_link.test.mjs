// Focused regression tests for the approval person link. Pure decision logic; no network, no database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planPersonForLink } from './person_link.mjs';

const EMAIL = '84d516c7-1093-4e5c-8f1c-2ca7141d5824@sandbox.zazamail.link';
const RUN_START = '2026-10-15T22:30:00.000Z';
const during = '2026-10-15T22:30:05.000Z';
const before = '2026-10-15T22:17:00.000Z';

test('no existing person: insert one, owned by this run', () => {
  assert.deepEqual(planPersonForLink({ existing: null, accountEmail: EMAIL, runStartIso: RUN_START }), { action: 'insert', ownedByRun: true });
});

test('duplicate-email regression: the signup-created person from this run is reused, never inserted', () => {
  const plan = planPersonForLink({ existing: { email: EMAIL, created_at: during }, accountEmail: EMAIL, runStartIso: RUN_START });
  assert.equal(plan.action, 'reuse');
  assert.equal(plan.ownedByRun, true);
  assert.notEqual(plan.action, 'insert');
});

test('a leftover row from an earlier run is refused, not attached or deleted', () => {
  const plan = planPersonForLink({ existing: { email: EMAIL, created_at: before }, accountEmail: EMAIL, runStartIso: RUN_START });
  assert.equal(plan.action, 'refuse');
  assert.equal(plan.ownedByRun, undefined);
});

test('a person already linked to an account is refused', () => {
  const plan = planPersonForLink({ existing: { email: EMAIL, created_at: during }, accountEmail: EMAIL, runStartIso: RUN_START, linkedProfileCount: 1 });
  assert.equal(plan.action, 'refuse');
});

test('a person whose email differs from the account email is refused', () => {
  const plan = planPersonForLink({ existing: { email: 'someone.else@example.org', created_at: during }, accountEmail: EMAIL, runStartIso: RUN_START });
  assert.equal(plan.action, 'refuse');
});

test('email comparison ignores case', () => {
  const plan = planPersonForLink({ existing: { email: EMAIL.toUpperCase(), created_at: during }, accountEmail: EMAIL, runStartIso: RUN_START });
  assert.equal(plan.action, 'reuse');
});

test('small clock skew between runner and database is tolerated', () => {
  const plan = planPersonForLink({ existing: { email: EMAIL, created_at: '2026-10-15T22:29:30.000Z' }, accountEmail: EMAIL, runStartIso: RUN_START });
  assert.equal(plan.action, 'reuse');
});

test('an unreadable creation time is refused', () => {
  const plan = planPersonForLink({ existing: { email: EMAIL, created_at: null }, accountEmail: EMAIL, runStartIso: RUN_START });
  assert.equal(plan.action, 'refuse');
});
