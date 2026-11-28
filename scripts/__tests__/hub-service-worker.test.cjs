// Regression test for "FetchEvent.respondWith received an error: Returned response is null" (iPhone Safari Hub login).
// Runs the real Hub service worker source in a sandbox with a fake Service Worker global and checks the fetch rules.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'service-worker.js'), 'utf8');

function loadWorker({ cacheHit = undefined, networkFails = true, keys = [] } = {}) {
  const listeners = {};
  const deleted = [];
  const sandbox = {
    registration: { scope: 'https://hub.test/hub/', showNotification: async (title, options) => { sandbox.shown = { title, options }; } },
    location: { origin: 'https://hub.test' },
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
    skipWaiting: () => {},
    clients: { claim: async () => {}, matchAll: async () => [], openWindow: async () => null },
    caches: {
      keys: async () => keys,
      delete: async (k) => { deleted.push(k); return true; },
      open: async () => ({ match: async () => cacheHit, put: async () => {} }),
      match: async () => cacheHit, // A miss resolves to undefined. The old worker returned that straight to respondWith.
    },
    fetch: async () => { if (networkFails) throw new TypeError('network down'); return new Response('ok'); },
    Response,
    Headers,
    URL,
    console,
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return { listeners, sandbox, deleted };
}

function dispatch(listeners, type, event) {
  for (const fn of listeners[type] || []) fn(event);
  return event;
}

function fetchEvent(url, { method = 'GET', mode = 'cors', headers = {}, destination } = {}) {
  const event = {
    request: { url, method, mode, destination, headers: new Headers(headers) },
    responded: undefined,
    respondWith(p) { this.responded = p; },
  };
  return event;
}

test('auth and Supabase requests are never intercepted', () => {
  const { listeners } = loadWorker();
  for (const url of [
    'https://abc.supabase.co/auth/v1/token?grant_type=password',
    'https://abc.supabase.co/static/x.js',
    'https://hub.test/api/meetings/confirm',
  ]) {
    assert.equal(dispatch(listeners, 'fetch', fetchEvent(url, { method: 'GET' })).responded, undefined, url);
  }
});

test('the password POST and every write are never intercepted', () => {
  const { listeners } = loadWorker();
  assert.equal(dispatch(listeners, 'fetch', fetchEvent('https://abc.supabase.co/auth/v1/token', { method: 'POST' })).responded, undefined);
  assert.equal(dispatch(listeners, 'fetch', fetchEvent('https://hub.test/hub/static/js/a.js', { method: 'POST' })).responded, undefined);
});

test('requests carrying an Authorization header are never intercepted', () => {
  const { listeners } = loadWorker();
  const ev = dispatch(listeners, 'fetch', fetchEvent('https://hub.test/hub/static/js/a.js', { headers: { Authorization: 'Bearer x' } }));
  assert.equal(ev.responded, undefined);
});

test('navigations and paths outside /hub/ are never intercepted (public site and /admin stay untouched)', () => {
  const { listeners } = loadWorker();
  assert.equal(dispatch(listeners, 'fetch', fetchEvent('https://hub.test/hub/login', { mode: 'navigate' })).responded, undefined);
  assert.equal(dispatch(listeners, 'fetch', fetchEvent('https://hub.test/about', { mode: 'navigate' })).responded, undefined);
  assert.equal(dispatch(listeners, 'fetch', fetchEvent('https://hub.test/static/js/a.js')).responded, undefined, 'root /static is not Hub-owned');
});

test('an offline static-asset cache miss resolves to a real Response, never undefined', async () => {
  const { listeners } = loadWorker({ networkFails: true });
  const ev = dispatch(listeners, 'fetch', fetchEvent('https://hub.test/hub/static/js/main.abc.js', { destination: 'script' }));
  assert.ok(ev.responded, 'hashed Hub bundle is handled');
  const res = await ev.responded;
  assert.ok(res instanceof Response, 'never undefined or null');
  assert.equal(res.type, 'error');
});

test('a cached static asset is served from cache when present', async () => {
  const cached = new Response('cached-js');
  const { listeners } = loadWorker({ cacheHit: cached, networkFails: true });
  const ev = dispatch(listeners, 'fetch', fetchEvent('https://hub.test/hub/static/js/main.abc.js', { destination: 'script' }));
  assert.equal(await (await ev.responded).text(), 'cached-js');
});

test('activate removes only Hub-owned caches, never caches of other features', async () => {
  const keys = ['blw-york-v1', 'cc-portal-v1', 'blw-hub-v2', 'blw-hub-v3', 'analytics-cache'];
  const { listeners, deleted } = loadWorker({ keys });
  const waits = [];
  for (const fn of listeners.activate || []) fn({ waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  assert.deepEqual(deleted.sort(), ['blw-hub-v2', 'blw-york-v1', 'cc-portal-v1']);
});

test('push notification links are normalised under /hub', async () => {
  const { listeners, sandbox } = loadWorker();
  const event = {
    data: { json: () => ({ title: 'Meeting', body: 'Soon', data: { url: '/meetings' } }) },
    waitUntil: (p) => { event.pending = p; },
  };
  dispatch(listeners, 'push', event);
  await event.pending;
  assert.equal(sandbox.shown.options.data.url, '/hub/meetings');

  const already = { data: { json: () => ({ title: 'T', data: { url: '/hub/events' } }) }, waitUntil: (p) => { event.pending = p; } };
  dispatch(listeners, 'push', already);
  await event.pending;
  assert.equal(sandbox.shown.options.data.url, '/hub/events');
});
