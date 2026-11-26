/* eslint-disable no-restricted-globals */
/**
 * Retirement worker for the legacy root-scope Hub service worker.
 *
 * Earlier builds of the Hub registered /service-worker.js at the site root, so that worker controls the public website
 * and the whole origin. The Hub now registers /hub/service-worker.js (scope /hub/). This file replaces the legacy
 * worker on the next update check: it clears the legacy caches, removes its own registration and reloads open pages.
 * It has no fetch handler, so no request is ever intercepted here.
 */

const LEGACY_CACHE_PREFIXES = ['cc-portal', 'blw-york'];

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => LEGACY_CACHE_PREFIXES.some((p) => k.startsWith(p))).map((k) => caches.delete(k))
      );
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      await Promise.all(clients.map((client) => client.navigate(client.url).catch(() => undefined)));
    })()
  );
});
