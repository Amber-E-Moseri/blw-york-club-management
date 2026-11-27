/**
 * The one service worker the Hub registers: push notifications plus the narrow static cache in public/service-worker.js.
 * In the unified deployment the Hub is served under PUBLIC_URL (/hub), so the worker is /hub/service-worker.js and its
 * scope is /hub/. The public website and administration are outside that scope.
 */
export const PUSH_SERVICE_WORKER_URL = `${process.env.PUBLIC_URL ?? ''}/service-worker.js`;

/**
 * Earlier builds registered workers at the site root with scope "/": /service-worker.js (the first Hub worker) and
 * /sw.js (its successor). A browser keeps those registrations until something removes them, so a device that installed
 * one keeps running an old fetch handler. Only root-scope registrations running these scripts are removed. The Hub's
 * own /hub/ registration is never removed.
 */
export const LEGACY_SERVICE_WORKER_PATHS = ['/sw.js', '/service-worker.js'];

type ServiceWorkerContainerLike = Pick<ServiceWorkerContainer, 'register' | 'getRegistrations'>;

function scriptPath(worker: ServiceWorker | null | undefined): string | null {
  if (!worker) return null;
  try {
    return new URL(worker.scriptURL).pathname;
  } catch {
    return null;
  }
}

function isRootScope(scope: string): boolean {
  try {
    return new URL(scope, 'https://origin.invalid').pathname === '/';
  } catch {
    return false;
  }
}

/** Unregisters every root-scope registration that runs a legacy worker script. Returns how many were removed. */
export async function removeLegacyServiceWorkers(container: ServiceWorkerContainerLike): Promise<number> {
  const registrations = await container.getRegistrations();
  let removed = 0;
  for (const registration of registrations) {
    if (!isRootScope(registration.scope)) continue;
    const paths = [registration.active, registration.waiting, registration.installing].map(scriptPath);
    const legacy = paths.some((p) => p !== null && LEGACY_SERVICE_WORKER_PATHS.includes(p));
    if (legacy && (await registration.unregister())) {
      removed += 1;
    }
  }
  return removed;
}

/**
 * Registers the Hub push service worker. Cleanup of legacy registrations runs first, and its failure never blocks the
 * push registration. Registration failures are logged, never thrown, so they cannot break the app shell.
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
