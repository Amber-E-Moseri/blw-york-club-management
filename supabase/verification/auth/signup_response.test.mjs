// Focused tests for signup response handling. No network: responses are fixed in-memory objects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signupUserId } from './signup_response.mjs';

const ID = '5b1f0c2e-8a7d-4c3b-9e6f-123456789abc';
const SECRET_TOKEN = 'eyJhbGciOi.secret.token';
const EMAIL = '1a2b.membera@sandbox.zazamail.link';

test('wrapped user shape returns the id', () => {
  assert.equal(signupUserId({ status: 200, data: { user: { id: ID } } }), ID);
});

test('top-level user shape returns the id', () => {
  assert.equal(signupUserId({ status: 200, data: { id: ID, email: EMAIL } }), ID);
});

test('HTTP 200 with no user object fails closed', () => {
  assert.throws(() => signupUserId({ status: 200, data: {} }), /signup returned no user: HTTP 200/);
});

test('a null or non-object body fails closed', () => {
  assert.throws(() => signupUserId({ status: 200, data: null }), /no user/);
  assert.throws(() => signupUserId({ status: 200, data: 'text' }), /no user/);
});

test('an empty or non-string id fails closed', () => {
  assert.throws(() => signupUserId({ status: 200, data: { user: { id: '' } } }), /no user/);
  assert.throws(() => signupUserId({ status: 200, data: { user: { id: 42 } } }), /no user/);
});

test('error_code is surfaced, truncated, and nothing else from the body leaks', () => {
  const response = { status: 400, data: { error_code: 'weak_password', msg: `secret ${SECRET_TOKEN} ${EMAIL}`, access_token: SECRET_TOKEN } };
  let message = '';
  try { signupUserId(response); } catch (e) { message = e.message; }
  assert.match(message, /HTTP 400/);
  assert.match(message, /error_code=weak_password/);
  // Key names may appear (diagnostics); no values may.
  assert.doesNotMatch(message, /secret|eyJhbGciOi|sandbox[.]zazamail|@/);
});

test('a long error_code is truncated', () => {
  let message = '';
  try { signupUserId({ status: 429, data: { error_code: 'x'.repeat(200) } }); } catch (e) { message = e.message; }
  assert.ok(message.includes(`error_code=${'x'.repeat(60)}`));
  assert.ok(!message.includes('x'.repeat(61)));
});

test('partial signup: a user is returned only when its id is present, so nothing is tracked otherwise', () => {
  assert.throws(() => signupUserId({ status: 200, data: { user: {} } }), /no user/);
});

import { userIdFromAdminList } from './signup_response.mjs';

const OWN = 'tmvagughe9i50.leadera@sandbox.zazamail.link';
const OTHER = 'someone.else@sandbox.zazamail.link';

test('admin list: returns the id of the exact email, ignoring case', () => {
  const list = { data: { users: [{ id: ID, email: OWN.toUpperCase() }, { id: '99999999-9999-4999-8999-999999999999', email: OTHER }] } };
  assert.equal(userIdFromAdminList(list, OWN), ID);
});

test('admin list: no matching email returns null, never another account', () => {
  const list = { data: { users: [{ id: ID, email: OTHER }] } };
  assert.equal(userIdFromAdminList(list, OWN), null);
});

test('admin list: two matches are ambiguous and return null', () => {
  const list = { data: { users: [{ id: ID, email: OWN }, { id: '99999999-9999-4999-8999-999999999999', email: OWN }] } };
  assert.equal(userIdFromAdminList(list, OWN), null);
});

test('admin list: malformed responses return null', () => {
  assert.equal(userIdFromAdminList({ data: null }, OWN), null);
  assert.equal(userIdFromAdminList({ data: { users: 'x' } }, OWN), null);
  assert.equal(userIdFromAdminList({ data: { users: [{ email: OWN }] } }, OWN), null);
});
