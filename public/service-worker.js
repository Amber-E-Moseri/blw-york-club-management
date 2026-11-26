/* eslint-disable no-restricted-globals */
/**
 * BLW York Hub service worker. Served at /hub/service-worker.js, so its scope is /hub/ and it can never see the
 * public website (/) or the administration pages (/admin), which are not under /hub/.
 *
 * Safety rules (see docs/unified-platform.md):
 *  - Only GET requests for this origin's hashed build assets (/hub/static/), icons and the manifest are cached.
 *  - Auth, Supabase, API and every other request are never intercepted: no respondWith, so the browser handles them.
 *  - Navigations are network-first and never cached, so no stale HTML can point at an old build.
 *  - Every respondWith resolves to a real Response. A cache miss never resolves to undefined or null.
 */

const SCOPE_PATH = new URL(self.registration.scope).pathname; // "/hub/"
const CACHE_NAME = 'blw-hub-v3';
const STATIC_PREFIX = `${SCOPE_PATH}static/`;
const STATIC_FILES = new Set([`${SCOPE_PATH}manifest.json`, `${SCOPE_PATH}logo.png`, `${SCOPE_PATH}icon-192.png`, `${SCOPE_PATH}icon-512.png`, `${SCOPE_PATH}apple-touch-icon.png`]);

// ─── Install & Activate ──────────────────────────────────────────────────────

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Remove every cache this worker family ever created except the current one, so an upgraded install cannot serve
      // a previous build's assets.
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('blw-hub-') && k !== CACHE_NAME).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

// ─── Fetch ───────────────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Supabase, CDNs and auth: never intercepted.
  if (!url.pathname.startsWith(SCOPE_PATH)) return;

  if (request.mode === 'navigate') {
    event.respondWith(navigate(request));
    return;
  }

  if (url.pathname.startsWith(STATIC_PREFIX) || STATIC_FILES.has(url.pathname)) {
    event.respondWith(cacheFirst(request));
  }
  // Anything else under /hub/ (for example API-style requests) passes straight through to the network.
});

async function navigate(request) {
  try {
    return await fetch(request);
  } catch {
    return offlineResponse();
  }
}

async function cacheFirst(request) {
  try {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    const type = response.headers.get('content-type') || '';
    // Never cache an HTML shell that answered for a missing asset.
    if (response.ok && response.type === 'basic' && !type.includes('text/html')) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

function offlineResponse() {
  const html =
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>BLW York Hub</title><p style="font-family:sans-serif;padding:16px">You are offline. Please reconnect and try again.</p>';
  return new Response(html, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

// ─── Push Events ─────────────────────────────────────────────────────────────

/** Notification links are stored as app paths such as "/meetings". Hub paths live under /hub. */
function hubPath(path) {
  const value = typeof path === 'string' && path.length > 0 ? path : '/hub';
  if (!value.startsWith('/')) return '/hub';
  if (value === '/hub' || value.startsWith('/hub/') || value.startsWith('/hub?')) return value;
  return `/hub${value}`;
}

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'BLW York Hub', body: event.data.text(), data: { url: '/hub' } };
  }

  const options = {
    body: payload.body,
    icon: payload.icon || `${SCOPE_PATH}icon-192.png`,
    badge: payload.badge || `${SCOPE_PATH}icon-192.png`,
    tag: payload.tag,
    data: { url: hubPath(payload.data?.url ?? payload.url), meetingId: payload.data?.meetingId },
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
  const targetUrl = hubPath(notifData.url || '/hub');

  if (event.action === 'confirm' && notifData.meetingId) {
    event.waitUntil(
      fetch('/api/meetings/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetingId: notifData.meetingId }),
      }).catch(() => {})
    );
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.startsWith(self.registration.scope) && 'focus' in client) {
          return client.navigate(new URL(targetUrl, self.location.origin).href).then(() => client.focus());
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
      return undefined;
    })
  );
});
