import {
  PUSH_SERVICE_WORKER_URL,
  registerPushServiceWorker,
  removeLegacyServiceWorkers,
} from '../lib/serviceWorker/pushServiceWorker';

type FakeWorker = { scriptURL: string } | null;

function registration(scope: string, active: FakeWorker, waiting: FakeWorker = null, installing: FakeWorker = null) {
  return {
    scope,
    active,
    waiting,
    installing,
    unregister: jest.fn(async () => true),
  };
}

function container(registrations: ReturnType<typeof registration>[]) {
  return {
    getRegistrations: jest.fn(async () => registrations as unknown as ServiceWorkerRegistration[]),
    register: jest.fn(async (url: string) => ({ scope: '/', url }) as unknown as ServiceWorkerRegistration),
  };
}

const ORIGIN = 'https://blwyork.vercel.app';

describe('push service worker registration', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('removes a registration that runs the legacy /sw.js, even if it is only waiting', async () => {
    const legacy = registration('/', null, { scriptURL: `${ORIGIN}/sw.js` });
    const push = registration('/', { scriptURL: `${ORIGIN}/service-worker.js` });
    const sw = container([legacy, push]);

    const removed = await removeLegacyServiceWorkers(sw);

    expect(removed).toBe(1);
    expect(legacy.unregister).toHaveBeenCalledTimes(1);
    expect(push.unregister).not.toHaveBeenCalled();
  });

  it('leaves the push worker registered and registers it at the same URL', async () => {
    const push = registration('/', { scriptURL: `${ORIGIN}/service-worker.js` });
    const sw = container([push]);

    const result = await registerPushServiceWorker(sw);

    expect(push.unregister).not.toHaveBeenCalled();
    expect(sw.register).toHaveBeenCalledWith(PUSH_SERVICE_WORKER_URL);
    expect(result).not.toBeNull();
  });

  it('still registers the push worker when legacy cleanup fails', async () => {
    const sw = container([]);
    sw.getRegistrations.mockRejectedValueOnce(new TypeError('Load failed'));

    const result = await registerPushServiceWorker(sw);

    expect(sw.register).toHaveBeenCalledWith(PUSH_SERVICE_WORKER_URL);
    expect(result).not.toBeNull();
  });

  it('logs and returns null instead of throwing when registration itself fails', async () => {
    const sw = container([]);
    sw.register.mockRejectedValueOnce(new TypeError('SecurityError'));

    await expect(registerPushServiceWorker(sw)).resolves.toBeNull();
    expect(console.warn).toHaveBeenCalled();
  });

  it('does nothing when the browser has no service worker container', async () => {
    await expect(registerPushServiceWorker(undefined)).resolves.toBeNull();
  });
});
