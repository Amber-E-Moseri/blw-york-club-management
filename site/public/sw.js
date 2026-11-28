/* eslint-disable no-restricted-globals */
/**
 * Retired service worker. Do not add fetch handling or caching here.
 *
 * Earlier builds registered a worker at the site root, either /sw.js or /service-worker.js, with scope "/". A browser
 * keeps that registration until something removes it, and it controls the whole origin. This file replaces such a
 * worker on the next update check. It deletes only the caches that Hub builds created, removes its own registration,
 * and has no fetch handler, so requests reaching it go straight to the network. The Hub registers /hub/service-worker.js
 * (scope /hub/) instead. Caches owned by other features are never touched.
 */

const OWNED_CACHE_PREFIXES = ['blw-hub-', 'blw-york-', 'cc-portal-'];

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => OWNED_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix))).map((key) => caches.delete(key))
      );
      await self.registration.unregister();
    })()
  );
});
