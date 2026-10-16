// Focused tests for the cleanup plan. Pure: no network, no database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planCleanup } from './cleanup_plan.mjs';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

test('nothing tracked: nothing planned', () => {
  assert.deepEqual(planCleanup({ users: [], cells: [], bscs: [], people: [], contacts: [] }), { ops: [], skipped: [] });
});

test('only tracked ids are planned, in the safe order', () => {
  const plan = planCleanup({ users: [A], people: [B], contacts: [C], cells: [], bscs: [] });
  assert.deepEqual(plan.ops.map((o) => o.kind), ['contacts', 'people', 'users']);
  assert.deepEqual(plan.ops.map((o) => o.id), [C, B, A]);
});

test('a partial run (account created, later step failed) still plans the tracked account', () => {
  const plan = planCleanup({ users: [A], people: [], contacts: [], cells: [], bscs: [] });
  assert.deepEqual(plan.ops, [{ kind: 'users', id: A }]);
});

test('duplicate ids are planned once', () => {
  const plan = planCleanup({ users: [A, A], people: [], contacts: [], cells: [], bscs: [] });
  assert.equal(plan.ops.length, 1);
});

test('malformed or unsafe ids are skipped, never deleted', () => {
  const plan = planCleanup({ users: ['*', '', null, 'x; drop', A], people: [], contacts: [], cells: [], bscs: [] });
  assert.deepEqual(plan.ops, [{ kind: 'users', id: A }]);
  assert.equal(plan.skipped.length, 4);
});

test('unknown kinds are ignored; no unrelated records are added', () => {
  const plan = planCleanup({ users: [A], somethingElse: [B] });
  assert.deepEqual(plan.ops, [{ kind: 'users', id: A }]);
});

test('a missing tracking object plans nothing and does not throw', () => {
  assert.deepEqual(planCleanup(undefined), { ops: [], skipped: [] });
});
