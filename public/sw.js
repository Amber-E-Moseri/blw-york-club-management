/* eslint-disable no-restricted-globals */
/**
 * Retired service worker. Do not add fetch handling or caching here.
 *
 * Earlier builds registered this file at "/". Browsers that still hold that registration check it for updates. This
 * version replaces the old worker on the next check, deletes its caches, and removes its own registration. The app no
 * longer registers this file (see src/lib/serviceWorker/pushServiceWorker.ts), and it has no fetch handler, so requests
 * that reach it go straight to the network.
 */

const HUB_CACHE_NAME = /^(?:blw-york-v\d+|cc-portal-v\d+)$/;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Delete only caches this Hub wrote. Other apps on the same origin keep theirs.
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => HUB_CACHE_NAME.test(key)).map((key) => caches.delete(key)));
      await self.registration.unregister();
    })()
  );
});
