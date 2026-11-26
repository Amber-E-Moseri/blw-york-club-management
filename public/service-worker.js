/* eslint-disable no-restricted-globals */
/**
 * BLW York Hub service worker: Web Push notifications plus a narrow static-asset cache.
 * Registered at /service-worker.js by src/lib/serviceWorker/pushServiceWorker.ts.
 *
 * Fetch policy. This worker must never be the reason a request fails:
 *  - Only GET requests for hashed same-origin bundles under /static/ are answered, cache-first.
 *  - Everything else is NOT intercepted. That covers authentication and token refresh, every Supabase
 *    host, /api/, POST/PUT/PATCH/DELETE, page navigations and any request that carries an Authorization
 *    header. The browser performs those requests itself, so no session, member or HTML response is stored.
 *  - Every respondWith promise resolves to a Response. A failed network fetch resolves to Response.error(),
 *    never to undefined. An undefined value is what produced "FetchEvent.respondWith received an error:
 *    Returned response is null." on the production login form.
 *
 * Cache lifecycle. The cache name is versioned. Activate deletes every other cache, including those written
 * by earlier builds (blw-york-v1 and cc-portal-v1), so stale bundles cannot outlive a deploy. Nothing is
 * precached, so an old HTML shell is never pinned.
 */

const CACHE_NAME = 'blw-york-v2';
const STATIC_PREFIX = '/static/';
const STATIC_FILE = /\.(?:js|css|woff2?|png|jpe?g|svg|ico|webp|gif)$/i;
const SUPABASE_HOST = /(?:^|\.)supabase\.(?:co|in)$/i;

// ─── Install & Activate ──────────────────────────────────────────────────────

self.addEventListener('install', () => {
  // Intentionally precaches nothing. See the cache lifecycle note above.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
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

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'BLW York Hub', body: event.data.text(), data: { url: '/' } };
  }

  const options = {
    body: payload.body,
    icon: payload.icon || '/icon-192.png',
    badge: payload.badge || '/icon-192.png',
    tag: payload.tag,
    data: payload.data || { url: '/' },
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
  const targetUrl = notifData.url || '/';

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
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.navigate(targetUrl);
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      })
  );
});

// ─── Notification Close ──────────────────────────────────────────────────────

self.addEventListener('notificationclose', () => {
  // No-op by default.
});
