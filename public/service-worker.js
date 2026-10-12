/* eslint-disable no-restricted-globals */
/**
 * Custom service worker for Web Push notifications.
 * Registered separately from CRA's Workbox service worker.
 * Cache strategy: cache-first for static assets, network-first for API calls.
 */

const CACHE_NAME = 'blw-york-v1';
const STATIC_ORIGINS = [self.location.origin];

// ─── Install & Activate ──────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ─── Fetch (cache strategy) ──────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Network-first for API and Supabase calls
  if (url.pathname.startsWith('/api/') || url.hostname.includes('supabase.co')) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first for same-origin static assets
  if (STATIC_ORIGINS.includes(url.origin) && url.pathname.startsWith('/static/')) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(event.request).then(
          (cached) =>
            cached ||
            fetch(event.request).then((response) => {
              cache.put(event.request, response.clone());
              return response;
            })
        )
      )
    );
    return;
  }

  // Network-first for everything else
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

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
    icon: payload.icon || '/logo.png',
    badge: payload.badge || '/logo.png',
    tag: payload.tag,
    // notify-event sends the target as a top-level `url`; accept either shape.
    data: payload.data || { url: payload.url || '/' },
    actions: payload.actions || [],
    requireInteraction: false,
    silent: false,
  };

  event.waitUntil(
    self.registration.showNotification(payload.title, options)
  );
});

// ─── Notification Click ───────────────────────────────────────────────────────

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
        // Focus existing window at the target URL if possible
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.navigate(targetUrl);
            return client.focus();
          }
        }
        // Otherwise open a new window
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      })
  );
});

// ─── Subscription Change ─────────────────────────────────────────────────────
// The browser rotated or expired the endpoint. Re-subscribe with the same key so pushes keep arriving. The new
// endpoint is saved to the database the next time the app loads (usePushNotifications reconciles on load).
self.addEventListener('pushsubscriptionchange', (event) => {
  const key = event.oldSubscription?.options?.applicationServerKey ?? null;
  if (!key) return;
  event.waitUntil(
    self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }).catch(() => {})
  );
});

// ─── Notification Close ───────────────────────────────────────────────────────

self.addEventListener('notificationclose', (_event) => {
  // Optionally log dismiss — no-op by default
});

// ─── Background Sync ─────────────────────────────────────────────────────────

self.addEventListener('sync', (event) => {
  if (event.tag === 'send-pending-responses') {
    event.waitUntil(syncPendingResponses());
  }
});

async function syncPendingResponses() {
  // Reserved for future offline-queue sync
}
