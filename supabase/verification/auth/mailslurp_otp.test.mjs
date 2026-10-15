// Focused tests for the MailSlurp OTP adapter. Fake fetch and clock only; no network, no real key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForSignupCode } from './mailslurp_otp.mjs';

const BASE = 'https://api.mailslurp.com';
const INBOX = '84d516c7-1093-4e5c-8f1c-2ca7141d5824';
const KEY = 'test-key-not-real';
const SINCE = '2026-10-15T10:00:00.000Z';

// Scripted replies, consumed in order. Records every request for assertions.
function scripted(replies) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    const next = replies.shift();
    if (!next) throw new Error('unexpected extra request');
    return {
      status: next.status,
      json: async () => next.json,
    };
  };
  return { fetchImpl, calls };
}

// Clock that advances only when sleep() is called, so deadline logic is deterministic.
function fakeClock(startMs = Date.parse(SINCE) + 1000) {
  let t = startMs;
  return {
    now: () => t,
    sleep: async (ms) => { t += ms; },
  };
}

const base = { base: BASE, apiKey: KEY, inboxId: INBOX, sinceIso: SINCE };

test('success: returns the six-digit code from a fresh message', async () => {
  const { fetchImpl, calls } = scripted([
    { status: 200, json: { body: 'Your code is 482913', createdAt: '2026-10-15T10:00:05.000Z' } },
  ]);
  const clock = fakeClock();
  const out = await waitForSignupCode({ ...base, fetchImpl, deadlineMs: clock.now() + 60000, ...clock });
  assert.equal(out.status, 'code');
  assert.equal(out.code, '482913');
  assert.equal(out.receivedAt, '2026-10-15T10:00:05.000Z');
  assert.equal(calls.length, 1);
});

test('request targets waitForMatchingFirstEmail with inboxId, since and timeout, key in header only', async () => {
  const { fetchImpl, calls } = scripted([
    { status: 200, json: { body: '123456', createdAt: '2026-10-15T10:00:05.000Z' } },
  ]);
  const clock = fakeClock();
  await waitForSignupCode({ ...base, fetchImpl, deadlineMs: clock.now() + 60000, ...clock });
  const { url, init } = calls[0];
  const u = new URL(url);
  assert.equal(u.origin, BASE);
  assert.equal(u.pathname, '/waitForMatchingFirstEmail');
  assert.equal(u.searchParams.get('inboxId'), INBOX);
  assert.equal(u.searchParams.get('since'), SINCE);
  assert.ok(Number(u.searchParams.get('timeout')) > 0, 'timeout is sent in milliseconds');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['x-api-key'], KEY);
  assert.ok(!url.includes(KEY), 'API key must never appear in the URL');
});

test('stale: a code received before the sign-up started is ignored and the wait continues', async () => {
  const { fetchImpl } = scripted([
    { status: 200, json: { body: 'Old code 999999', createdAt: '2026-10-15T09:00:00.000Z' } },
    { status: 200, json: { body: 'New code 135790', createdAt: '2026-10-15T10:00:07.000Z' } },
  ]);
  const clock = fakeClock();
  const out = await waitForSignupCode({ ...base, fetchImpl, deadlineMs: clock.now() + 60000, ...clock });
  assert.equal(out.status, 'code');
  assert.equal(out.code, '135790', 'the stale 999999 must not satisfy the check');
});

test('no message in time (HTTP 408) keeps polling and returns timeout at the deadline', async () => {
  const replies = Array.from({ length: 50 }, () => ({ status: 408, json: null }));
  const { fetchImpl } = scripted(replies);
  const clock = fakeClock();
  const out = await waitForSignupCode({ ...base, fetchImpl, deadlineMs: clock.now() + 12000, ...clock });
  assert.deepEqual(out, { status: 'timeout' });
});

test('a message with no six-digit code does not end the wait', async () => {
  const { fetchImpl } = scripted([
    { status: 200, json: { body: 'Welcome, no code here', createdAt: '2026-10-15T10:00:03.000Z' } },
    { status: 200, json: { body: 'Code 246810', createdAt: '2026-10-15T10:00:09.000Z' } },
  ]);
  const clock = fakeClock();
  const out = await waitForSignupCode({ ...base, fetchImpl, deadlineMs: clock.now() + 60000, ...clock });
  assert.equal(out.code, '246810');
});

test('failure: an auth error from the inbox is blocked, and the key is not echoed', async () => {
  const { fetchImpl } = scripted([{ status: 401, json: { message: 'unauthorized' } }]);
  const clock = fakeClock();
  const out = await waitForSignupCode({ ...base, fetchImpl, deadlineMs: clock.now() + 60000, ...clock });
  assert.equal(out.status, 'blocked');
  assert.match(out.reason, /HTTP 401/);
  assert.ok(!out.reason.includes(KEY));
});

test('failure: a server error is blocked, not treated as a timeout', async () => {
  const { fetchImpl } = scripted([{ status: 500, json: null }]);
  const clock = fakeClock();
  const out = await waitForSignupCode({ ...base, fetchImpl, deadlineMs: clock.now() + 60000, ...clock });
  assert.equal(out.status, 'blocked');
  assert.match(out.reason, /HTTP 500/);
});
