/**
 * Regression test for the production login failure on iPhone Safari:
 *
 *   "FetchEvent.respondWith received an error: Returned response is null."
 *
 * Root cause: public/service-worker.js answered every Supabase request (including the POST to
 * /auth/v1/token that carries the password) with `fetch(request).catch(() => caches.match(request))`.
 * When the network request failed, `caches.match` resolved to `undefined`, so respondWith received
 * no Response. The worker is executed here against a fake ServiceWorker global so that the exact
 * fetch handler is tested, not a copy of it.
 */
import fs from 'fs';
import path from 'path';

const ORIGIN = 'https://blwyork.vercel.app';
const SUPABASE_TOKEN_URL = 'https://abcdefgh.supabase.co/auth/v1/token?grant_type=password';
const WORKER_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../public/service-worker.js'), 'utf8');

type Listener = (event: unknown) => unknown;

class FakeResponse {
  status: number;
  ok: boolean;
  type: string;
  body: unknown;
  constructor(body: unknown = null, init: { status?: number; type?: string } = {}) {
    this.body = body;
    this.status = init.status ?? 200;
    this.ok = this.status >= 200 && this.status < 300;
    this.type = init.type ?? 'basic';
  }
  clone() {
    return new FakeResponse(this.body, { status: this.status, type: this.type });
  }
  static error() {
    return new FakeResponse(null, { status: 0, type: 'error' });
  }
}

class FakeCache {
  entries = new Map<string, FakeResponse>();
  put = jest.fn(async (request: { url: string }, response: FakeResponse) => {
    this.entries.set(request.url, response);
  });
  match = jest.fn(async (request: { url: string } | string) => {
    const url = typeof request === 'string' ? request : request.url;
    return this.entries.get(url);
  });
  addAll = jest.fn(async () => undefined);
}

function makeRequest(url: string, init: { method?: string; mode?: string; headers?: Record<string, string> } = {}) {
  const headers = new Map(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    url,
    method: init.method ?? 'GET',
    mode: init.mode ?? 'cors',
    headers: { has: (k: string) => headers.has(k.toLowerCase()), get: (k: string) => headers.get(k.toLowerCase()) ?? null },
  };
}

function loadWorker(networkImpl: (request: unknown) => Promise<FakeResponse>) {
  const listeners: Record<string, Listener[]> = {};
  const caches = new Map<string, FakeCache>();
  const cacheStorage = {
    open: jest.fn(async (name: string) => {
      if (!caches.has(name)) caches.set(name, new FakeCache());
      return caches.get(name)!;
    }),
    match: jest.fn(async (request: { url: string }) => {
      for (const cache of Array.from(caches.values())) {
        const hit = await cache.match(request);
        if (hit) return hit;
      }
      return undefined;
    }),
    keys: jest.fn(async () => Array.from(caches.keys())),
    delete: jest.fn(async (name: string) => caches.delete(name)),
  };
  const fetchMock = jest.fn(networkImpl);
  const fakeSelf = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: Listener) => {
      (listeners[type] ??= []).push(listener);
    },
    skipWaiting: jest.fn(),
    clients: { claim: jest.fn(async () => undefined), matchAll: jest.fn(async () => []), openWindow: jest.fn() },
    registration: { showNotification: jest.fn(async () => undefined), scope: `${ORIGIN}/` },
  };

  // The worker is evaluated with the ServiceWorker globals it expects, nothing else.
  // eslint-disable-next-line no-new-func
  new Function('self', 'caches', 'fetch', 'Response', 'URL', WORKER_SOURCE)(
    fakeSelf,
    cacheStorage,
    fetchMock,
    FakeResponse,
    URL,
  );

  /** Dispatches a fetch event. Returns the promise handed to respondWith, or undefined if the worker let the browser handle it. */
  function dispatchFetch(request: ReturnType<typeof makeRequest>): Promise<unknown> | undefined {
    let handed: Promise<unknown> | undefined;
    const event = {
      request,
      respondWith: (value: Promise<unknown>) => {
        handed = Promise.resolve(value);
      },
      waitUntil: () => undefined,
    };
    for (const listener of listeners['fetch'] ?? []) listener(event);
    return handed;
  }

  async function dispatchLifecycle(type: 'install' | 'activate') {
    const waits: Promise<unknown>[] = [];
    for (const listener of listeners[type] ?? []) {
      listener({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
    }
    await Promise.all(waits);
  }

  return { dispatchFetch, dispatchLifecycle, fetchMock, cacheStorage, caches, fakeSelf, listeners };
}

const offline = async () => {
  throw new TypeError('Load failed');
};

describe('service worker never answers an intercepted request with null (iOS login regression)', () => {
  it('does not intercept the password POST to Supabase, so a network failure cannot yield a null response', async () => {
    const worker = loadWorker(offline);

    const handed = worker.dispatchFetch(
      makeRequest(SUPABASE_TOKEN_URL, { method: 'POST', mode: 'cors', headers: { apikey: 'public-anon-key' } }),
    );

    // Passing through is correct: the browser performs the request and surfaces its own network error.
    expect(handed).toBeUndefined();
    expect(worker.fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['GET Supabase REST data', 'https://abcdefgh.supabase.co/rest/v1/profiles?select=*', {}],
    ['GET Supabase auth user', 'https://abcdefgh.supabase.co/auth/v1/user', { authorization: 'Bearer t' }],
    ['GET same-origin API', `${ORIGIN}/api/meetings`, {}],
    ['GET request carrying Authorization', `${ORIGIN}/static/js/main.1a2b3c.js`, { authorization: 'Bearer t' }],
    ['GET HTML navigation', `${ORIGIN}/members`, { mode: 'navigate' }],
  ])('passes through and never caches %s', async (_label, url, extra) => {
    const worker = loadWorker(offline);
    const { mode, ...headerExtra } = extra as { mode?: string } & Record<string, string>;
    const request = makeRequest(url, { mode: mode ?? 'cors', headers: headerExtra });

    const handed = worker.dispatchFetch(request);

    if (handed !== undefined) {
      const response = await handed;
      expect(response).not.toBeNull();
      expect(response).not.toBeUndefined();
    }
    for (const cache of Array.from(worker.caches.values())) {
      expect(cache.put).not.toHaveBeenCalled();
    }
  });

  it('any intercepted request still settles with a Response when the network fails and nothing is cached', async () => {
    const worker = loadWorker(offline);

    const handed = worker.dispatchFetch(makeRequest(`${ORIGIN}/static/css/main.9f8e7d.css`));

    expect(handed).toBeDefined();
    const response = await handed;
    expect(response).not.toBeNull();
    expect(response).not.toBeUndefined();
    expect((response as FakeResponse).type).toBe('error');
  });

  it('serves a hashed static bundle from cache first and caches only successful same-origin responses', async () => {
    const worker = loadWorker(async () => new FakeResponse('console.log(1)', { status: 200 }));
    const url = `${ORIGIN}/static/js/main.abc123.js`;

    const first = await worker.dispatchFetch(makeRequest(url));
    expect((first as FakeResponse).ok).toBe(true);
    expect(worker.fetchMock).toHaveBeenCalledTimes(1);

    const second = await worker.dispatchFetch(makeRequest(url));
    expect((second as FakeResponse).ok).toBe(true);
    expect(worker.fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed static response', async () => {
    const worker = loadWorker(async () => new FakeResponse('nope', { status: 404 }));

    const response = await worker.dispatchFetch(makeRequest(`${ORIGIN}/static/js/missing.js`));

    expect((response as FakeResponse).status).toBe(404);
    const cache = worker.caches.get(Array.from(worker.caches.keys())[0]);
    expect(cache?.entries.size ?? 0).toBe(0);
  });

  it('removes every cache from earlier builds on activate, including the legacy names', async () => {
    const worker = loadWorker(offline);
    await worker.cacheStorage.open('blw-york-v1');
    await worker.cacheStorage.open('cc-portal-v1');

    await worker.dispatchLifecycle('activate');

    const remaining = await worker.cacheStorage.keys();
    expect(remaining).not.toContain('blw-york-v1');
    expect(remaining).not.toContain('cc-portal-v1');
  });

  it('never deletes a cache this Hub did not write, so other apps on the same origin keep theirs', async () => {
    const worker = loadWorker(offline);
    await worker.cacheStorage.open('other-app-cache-v3');
    await worker.cacheStorage.open('blw-york-v1');

    await worker.dispatchLifecycle('activate');

    const remaining = await worker.cacheStorage.keys();
    expect(remaining).toContain('other-app-cache-v3');
    expect(remaining).not.toContain('blw-york-v1');
  });

  it('does not precache the HTML shell or the root document', async () => {
    const worker = loadWorker(offline);

    await worker.dispatchLifecycle('install');

    const addAllCalls = Array.from(worker.caches.values()).map((c) => c.addAll.mock.calls.length);
    expect(addAllCalls.every((n) => n === 0)).toBe(true);
  });

  it('keeps the push and notification-click handlers that the app depends on', () => {
    const worker = loadWorker(offline);
    expect(worker.listeners['push']?.length ?? 0).toBeGreaterThan(0);
    expect(worker.listeners['notificationclick']?.length ?? 0).toBeGreaterThan(0);
  });
});
