// Focused regression tests for the approval person link. Pure decision logic; no network, no database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planPersonForLink } from './person_link.mjs';

const EMAIL = '84d516c7-1093-4e5c-8f1c-2ca7141d5824@sandbox.zazamail.link';
const MARK = 'Cert Pending 1a2b3c';
const RUN_START = '2026-10-15T22:30:00.000Z';
const during = '2026-10-15T22:30:05.000Z';
const before = '2026-10-15T22:17:00.000Z';
const base = { accountEmail: EMAIL, ownerMarker: MARK, runStartIso: RUN_START };

test('no existing person: insert one, owned by this run', () => {
  assert.deepEqual(planPersonForLink({ ...base, existing: null }), { action: 'insert', ownedByRun: true });
});

test('duplicate-email regression: the signup person carrying this run marker is reused, never inserted', () => {
  const plan = planPersonForLink({ ...base, existing: { email: EMAIL, full_name: MARK, created_at: during } });
  assert.equal(plan.action, 'reuse');
  assert.equal(plan.ownedByRun, true);
  assert.notEqual(plan.action, 'insert');
});

test('same email and a recent timestamp but a foreign name is refused (timing is not proof)', () => {
  const plan = planPersonForLink({ ...base, existing: { email: EMAIL, full_name: 'Some Real Member', created_at: during } });
  assert.equal(plan.action, 'refuse');
  assert.equal(plan.ownedByRun, undefined);
});

test('an earlier run marker is refused even if it looks recent', () => {
  const plan = planPersonForLink({ ...base, existing: { email: EMAIL, full_name: 'Cert Pending 9z9z9z', created_at: during } });
  assert.equal(plan.action, 'refuse');
});

test('a marked leftover row from an earlier run is refused, not attached or deleted', () => {
  const plan = planPersonForLink({ ...base, existing: { email: EMAIL, full_name: MARK, created_at: before } });
  assert.equal(plan.action, 'refuse');
  assert.equal(plan.ownedByRun, undefined);
});

test('a marked person already linked to an account is refused', () => {
  const plan = planPersonForLink({ ...base, existing: { email: EMAIL, full_name: MARK, created_at: during }, linkedProfileCount: 1 });
  assert.equal(plan.action, 'refuse');
});

test('a person whose email differs from the account email is refused', () => {
  const plan = planPersonForLink({ ...base, existing: { email: 'someone.else@example.org', full_name: MARK, created_at: during } });
  assert.equal(plan.action, 'refuse');
});

test('no run marker supplied: nothing is reused (fails closed)', () => {
  const plan = planPersonForLink({ ...base, ownerMarker: '', existing: { email: EMAIL, full_name: '', created_at: during } });
  assert.equal(plan.action, 'refuse');
});

test('email comparison ignores case', () => {
  const plan = planPersonForLink({ ...base, existing: { email: EMAIL.toUpperCase(), full_name: MARK, created_at: during } });
  assert.equal(plan.action, 'reuse');
});

test('small clock skew between runner and database is tolerated', () => {
  const plan = planPersonForLink({ ...base, existing: { email: EMAIL, full_name: MARK, created_at: '2026-10-15T22:29:30.000Z' } });
  assert.equal(plan.action, 'reuse');
});

test('an unreadable creation time is refused', () => {
  const plan = planPersonForLink({ ...base, existing: { email: EMAIL, full_name: MARK, created_at: null } });
  assert.equal(plan.action, 'refuse');
});
