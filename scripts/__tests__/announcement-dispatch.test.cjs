// Static guard for the announcement dispatcher (migration 069). The database tests prove the authority rules; this pins
// the properties of the edge function that a database test cannot see: where recipients come from, which identity
// gates the call, and when a claim may be released.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const fn = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'functions', 'notify-announcement', 'index.ts'), 'utf8');

test('recipients come only from the database resolver, never from the request body', () => {
  assert.match(fn, /rpc\('resolve_announcement_recipients'/);
  assert.doesNotMatch(fn, /body\??\.(recipients|user_ids|userIds|cell_id|cellId)/);
  assert.doesNotMatch(fn, /from\('profiles'\)/, 'the dispatcher must not select members itself');
  assert.doesNotMatch(fn, /from\('push_subscriptions'\)\s*\.select/, 'the dispatcher must not select devices itself');
});

test('authority is decided by the database claim, not by a role label', () => {
  assert.match(fn, /rpc\('claim_announcement_dispatch'/);
  assert.doesNotMatch(fn, /POSTING_ROLES|MANAGING_ROLES|profile\.role|\.role\b/, 'no role label may gate dispatch');
  assert.match(fn, /error\.code === '42501'/, 'an authority refusal must map to 403');
});

test('an existing claim is refused with 409 and nothing is sent', () => {
  assert.match(fn, /claimed !== true\) throw new HttpError\('Announcement already notified', 409\)/);
});

test('a claim is released only by the request that created it, and only before any push', () => {
  assert.match(fn, /claimedHere = true/);
  assert.match(fn, /if \(claimedHere && !pushStarted/);
  assert.match(fn, /pushStarted = true;/);
  const pushIndex = fn.indexOf('pushStarted = true;');
  const sendIndex = fn.indexOf('webpush.sendNotification');
  assert.ok(pushIndex > 0 && sendIndex > pushIndex, 'pushStarted must be set before the first send');
});
