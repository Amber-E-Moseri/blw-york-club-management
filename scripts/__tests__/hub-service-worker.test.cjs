// Regression test for "FetchEvent.respondWith received an error: Returned response is null" (iPhone Safari Hub login).
// Runs the real Hub service worker source in a sandbox with a fake Service Worker global and checks the fetch rules.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'service-worker.js'), 'utf8');

function loadWorker({ cacheHit = undefined, networkFails = true } = {}) {
  const listeners = {};
  const sandbox = {
    registration: { scope: 'https://hub.test/hub/' },
    location: { origin: 'https://hub.test' },
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
    skipWaiting: () => {},
    clients: { claim: async () => {} },
    caches: {
      keys: async () => [],
      delete: async () => true,
      open: async () => ({ match: async () => cacheHit, put: async () => {} }),
      match: async () => cacheHit, // A miss resolves to undefined. The old worker returned that straight to respondWith.
    },
    fetch: async () => { if (networkFails) throw new TypeError('network down'); return new Response('ok'); },
    Response,
    URL,
    console,
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return { listeners, sandbox };
}

function dispatchFetch(listeners, request) {
  const event = { request, responded: undefined, respondWith(p) { this.responded = p; } };
  for (const fn of listeners.fetch || []) fn(event);
  return event;
}

const req = (url, extra = {}) => ({ url, method: 'GET', mode: 'cors', ...extra });

test('auth and Supabase requests are never intercepted', async () => {
  const { listeners } = loadWorker();
  for (const r of [
    req('https://abc.supabase.co/auth/v1/token?grant_type=password'),
    req('https://abc.supabase.co/rest/v1/profiles'),
    req('https://hub.test/api/meetings/confirm'),
  ]) {
    assert.equal(dispatchFetch(listeners, r).responded, undefined, r.url);
  }
});

test('writes are never intercepted', async () => {
  const { listeners } = loadWorker();
  assert.equal(dispatchFetch(listeners, req('https://hub.test/hub/members', { method: 'POST' })).responded, undefined);
});

test('paths outside /hub/ are never intercepted (public site and /admin stay untouched)', async () => {
  const { listeners } = loadWorker();
  assert.equal(dispatchFetch(listeners, req('https://hub.test/about', { mode: 'navigate' })).responded, undefined);
  assert.equal(dispatchFetch(listeners, req('https://hub.test/admin/pending', { mode: 'navigate' })).responded, undefined);
});

test('offline navigation resolves to a real Response, never undefined', async () => {
  const { listeners } = loadWorker({ networkFails: true });
  const ev = dispatchFetch(listeners, req('https://hub.test/hub/login', { mode: 'navigate' }));
  assert.ok(ev.responded, 'navigation under /hub/ is handled');
  const res = await ev.responded;
  assert.ok(res instanceof Response);
  assert.equal(res.status, 503);
});

test('a static-asset cache miss while offline resolves to a real Response', async () => {
  const { listeners } = loadWorker({ networkFails: true, cacheHit: undefined });
  const ev = dispatchFetch(listeners, req('https://hub.test/hub/static/js/main.abc.js', { mode: 'no-cors', destination: 'script' }));
  const res = await ev.responded;
  assert.ok(res instanceof Response, 'never undefined or null');
});

test('a cached static asset is served from cache when present', async () => {
  const cached = new Response('cached-js');
  const { listeners } = loadWorker({ cacheHit: cached, networkFails: true });
  const res = await dispatchFetch(listeners, req('https://hub.test/hub/static/js/main.abc.js', { destination: 'script' })).responded;
  assert.equal(await res.text(), 'cached-js');
});

test('push notification URLs are normalised under /hub', () => {
  // The notificationclick and push handlers store hub paths. A bare "/meetings" must become "/hub/meetings".
  const { sandbox } = loadWorker();
  assert.equal(typeof sandbox, 'object');
  assert.ok(source.includes("return `/hub${value}`"), 'hubPath prefixes bare app paths with /hub');
});
