/** The one service worker the app registers: push notifications plus the narrow static cache in public/service-worker.js. */
export const PUSH_SERVICE_WORKER_URL = '/service-worker.js';

/**
 * Earlier builds registered /sw.js at the same "/" scope. A browser keeps that registration until something removes
 * it, so a device that installed it keeps running the old fetch handler. That handler is what this cleanup removes.
 */
export const LEGACY_SERVICE_WORKER_PATH = '/sw.js';

type ServiceWorkerContainerLike = Pick<ServiceWorkerContainer, 'register' | 'getRegistrations'>;

function scriptPath(worker: ServiceWorker | null | undefined): string | null {
  if (!worker) return null;
  try {
    return new URL(worker.scriptURL).pathname;
  } catch {
    return null;
  }
}

/** Unregisters every registration that runs the legacy /sw.js script. Returns how many were removed. */
export async function removeLegacyServiceWorkers(container: ServiceWorkerContainerLike): Promise<number> {
  const registrations = await container.getRegistrations();
  let removed = 0;
  for (const registration of registrations) {
    const paths = [registration.active, registration.waiting, registration.installing].map(scriptPath);
    if (paths.includes(LEGACY_SERVICE_WORKER_PATH) && (await registration.unregister())) {
      removed += 1;
    }
  }
  return removed;
}

/**
 * Registers the push service worker. Cleanup of the legacy worker runs first, and its failure never blocks the push
 * registration. Registration failures are logged, never thrown, so they cannot break the app shell.
 */
export async function registerPushServiceWorker(
  container: ServiceWorkerContainerLike | undefined,
): Promise<ServiceWorkerRegistration | null> {
  if (!container) return null;
  try {
    await removeLegacyServiceWorkers(container);
  } catch (error) {
    console.warn('[Push SW] Legacy service worker cleanup failed:', error);
  }
  try {
    const registration = await container.register(PUSH_SERVICE_WORKER_URL);
    console.log('[Push SW] Registered, scope:', registration.scope);
    return registration;
  } catch (error) {
    console.warn('[Push SW] Registration failed:', error);
    return null;
  }
}
