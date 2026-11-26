import fs from 'fs';
import path from 'path';

// public/sw.js is the retired worker. Browsers that still hold the old registration fetch it on update checks, so this
// file must remove itself and its caches, and must never handle a request.
const LEGACY_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../public/sw.js'), 'utf8');

type Listener = (event: unknown) => unknown;

function loadLegacyWorker() {
  const listeners: Record<string, Listener[]> = {};
  const keys = ['cc-portal-v1', 'blw-york-v1', 'blw-york-v2'];
  const deleted: string[] = [];
  const unregister = jest.fn(async () => true);
  const fakeSelf = {
    addEventListener: (type: string, listener: Listener) => {
      (listeners[type] ??= []).push(listener);
    },
    skipWaiting: jest.fn(),
    registration: { unregister },
  };
  const cachesFake = {
    keys: jest.fn(async () => [...keys]),
    delete: jest.fn(async (key: string) => {
      deleted.push(key);
      return true;
    }),
  };
  // eslint-disable-next-line no-new-func
  new Function('self', 'caches', LEGACY_SOURCE)(fakeSelf, cachesFake);
  return { listeners, fakeSelf, deleted, unregister };
}

describe('retired public/sw.js', () => {
  it('replaces itself on install and removes its registration and every cache on activate', async () => {
    const worker = loadLegacyWorker();

    for (const listener of worker.listeners['install'] ?? []) listener({ waitUntil: () => undefined });
    expect(worker.fakeSelf.skipWaiting).toHaveBeenCalled();

    const waits: Promise<unknown>[] = [];
    for (const listener of worker.listeners['activate'] ?? []) {
      listener({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
    }
    await Promise.all(waits);

    expect(worker.deleted.sort()).toEqual(['blw-york-v1', 'blw-york-v2', 'cc-portal-v1']);
    expect(worker.unregister).toHaveBeenCalledTimes(1);
  });

  it('registers no fetch handler, so it can never answer a request with null', () => {
    const worker = loadLegacyWorker();
    expect(worker.listeners['fetch'] ?? []).toHaveLength(0);
  });
});
