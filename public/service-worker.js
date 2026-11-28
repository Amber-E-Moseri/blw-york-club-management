/* eslint-disable no-restricted-globals */
/**
 * BLW York Hub service worker: Web Push notifications plus a narrow static-asset cache.
 * Served at /hub/service-worker.js and registered by src/lib/serviceWorker/pushServiceWorker.ts, so its scope is /hub/.
 * The public website (/), administration (/admin) and the legacy root worker are outside this scope.
 *
 * Fetch policy. This worker must never be the reason a request fails:
 *  - Only GET requests for hashed same-origin bundles under /hub/static/ are answered, cache-first.
 *  - Everything else is NOT intercepted. That covers authentication and token refresh, every Supabase host, /api/,
 *    POST/PUT/PATCH/DELETE, page navigations and any request that carries an Authorization header.
 *  - Every respondWith promise resolves to a Response. A failed network fetch resolves to Response.error(), never to
 *    undefined. An undefined value is what produced "FetchEvent.respondWith received an error: Returned response is
 *    null." on the production login form.
 *
 * Cache lifecycle. The cache name is versioned. Activate deletes only caches this application owns (the current Hub
 * cache, earlier Hub caches and the legacy names), never caches owned by other origins or other features. Nothing is
 * precached, so an old HTML shell is never pinned.
 */

const SCOPE_PATH = new URL(self.registration.scope).pathname; // "/hub/" in production, "/" in tests
const CACHE_NAME = 'blw-hub-v3';
const STATIC_PREFIX = `${SCOPE_PATH}static/`;
const STATIC_FILE = /\.(?:js|css|woff2?|png|jpe?g|svg|ico|webp|gif)$/i;
const SUPABASE_HOST = /(?:^|\.)supabase\.(?:co|in)$/i;
// Cache names this application created in earlier builds. Only these are removed on activate.
const OWNED_CACHE_PREFIXES = ['blw-hub-', 'blw-york-', 'cc-portal-'];

// ─── Install & Activate ──────────────────────────────────────────────────────

self.addEventListener('install', () => {
  // Intentionally precaches nothing. See the cache lifecycle note above.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME && OWNED_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix)))
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ─── Fetch ───────────────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Anything not explicitly cacheable is left to the browser. Returning here means respondWith is never called.
  if (!isCacheableStaticRequest(request)) return;

  event.respondWith(cacheFirstStatic(request));
});

function isCacheableStaticRequest(request) {
  if (request.method !== 'GET') return false;
  if (request.mode === 'navigate') return false;
  if (request.headers.has('authorization')) return false;

  const url = new URL(request.url);
  if (SUPABASE_HOST.test(url.hostname)) return false;
  if (url.origin !== self.location.origin) return false;
  if (!url.pathname.startsWith(STATIC_PREFIX)) return false;

  return STATIC_FILE.test(url.pathname);
}

async function cacheFirstStatic(request) {
  let cache = null;
  try {
    cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
  } catch {
    // Cache storage can be unavailable (for example in some private-browsing modes). Use the network instead.
    cache = null;
  }

  try {
    const response = await fetch(request);
    // Store only successful, same-origin ("basic") responses. Errors and opaque responses are never kept.
    if (cache && response.ok && response.type === 'basic') {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    return Response.error();
  }
}

// ─── Background Sync ─────────────────────────────────────────────────────────

self.addEventListener('sync', (event) => {
  if (event.tag === 'send-pending-responses') {
    event.waitUntil(syncPendingResponses());
  }
});

async function syncPendingResponses() {
  // Reserved for future offline-queue sync. Nothing is queued or replayed today.
}

// ─── Push Events ─────────────────────────────────────────────────────────────

/** Notification links are app paths such as "/meetings". Hub paths live under the scope, so they are prefixed. */
function hubPath(path) {
  const base = SCOPE_PATH.replace(/\/$/, '');
  const value = typeof path === 'string' && path.length > 0 ? path : '/';
  if (!value.startsWith('/')) return `${base}/`;
  if (value === base || value.startsWith(`${base}/`) || value.startsWith(`${base}?`)) return value;
  return `${base}${value}`;
}

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'BLW York Hub', body: event.data.text(), data: { url: '/' } };
  }

  const data = payload.data || { url: '/' };
  const options = {
    body: payload.body,
    icon: payload.icon || `${SCOPE_PATH}icon-192.png`,
    badge: payload.badge || `${SCOPE_PATH}icon-192.png`,
    tag: payload.tag,
    data: { ...data, url: hubPath(data.url) },
    actions: payload.actions || [],
    requireInteraction: false,
    silent: false,
  };

  event.waitUntil(self.registration.showNotification(payload.title || 'BLW York Hub', options));
});

// ─── Notification Click ──────────────────────────────────────────────────────

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const notifData = event.notification.data || {};
  const targetUrl = hubPath(notifData.url || '/');

  // Handle action buttons
  if (event.action === 'confirm' && notifData.meetingId) {
    event.waitUntil(
      fetch('/api/meetings/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetingId: notifData.meetingId }),
      }).catch(() => {})
    );
  }

  // Open or focus the app window
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.startsWith(self.registration.scope) && 'focus' in client) {
            return client.navigate(new URL(targetUrl, self.location.origin).href).then(() => client.focus());
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
        return undefined;
      })
  );
});

// ─── Notification Close ──────────────────────────────────────────────────────

self.addEventListener('notificationclose', () => {
  // No-op by default.
});
