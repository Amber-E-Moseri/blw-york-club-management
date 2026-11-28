import { expect, test, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// The app root: '/' for the root-mounted build, '/hub/' for the prefix-mounted unified build (PROD_MOUNT=/hub).
const APP_ROOT = `${process.env.PROD_MOUNT ?? ''}/`;

// Runs against a production build served by e2e/support/buildServers.cjs, through playwright.production.config.ts.
//
//   PROD_BUILD_KIND=candidate  the hotfix build. It must never produce a null response.
//   PROD_BUILD_KIND=prefix     the pre-fix build from main 9e57c54. The same flow must reproduce the null response.
//                              This is the negative control.
//   LEGACY_SW_FILE=<path>      the pre-fix public/sw.js (the legacy worker). Enables the legacy upgrade test.

const KIND = process.env.PROD_BUILD_KIND ?? 'candidate';
const LEGACY_SW_FILE = process.env.LEGACY_SW_FILE;
const SW_CACHE_NAMES = ['blw-york-v2'];
const SEEDED_OTHER_APP_CACHE = 'other-app-cache-v3';

test.use({ serviceWorkers: 'allow' });

/** Loads the app, waits until a service worker controls the page, and returns the page ready for sign-in. */
async function openControlledApp(page: Page) {
  await page.goto(APP_ROOT);
  await page.waitForFunction(() => 'serviceWorker' in navigator, undefined, { timeout: 30_000 });
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // The first load after registration is uncontrolled. One reload hands the page to the worker.
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 30_000 });
}

test.describe(`production build (${KIND})`, () => {
  test('a failed sign-in request shows the plain message, never the raw browser error', async ({ browser }) => {
    const context = await browser.newContext({ serviceWorkers: 'allow' });
    const page = await context.newPage();

    await openControlledApp(page);
    await page.getByLabel('Email').fill('leader@yorku.ca');
    await page.getByLabel('Password').fill('secret1');
    await page.getByRole('button', { name: 'Sign In' }).click();

    // The message is the signal: the candidate shows the plain message; the pre-fix build shows the raw browser error.
    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible({ timeout: 30_000 });
    // Playwright does not forward a service worker's own console, so the "Returned response is null" log cannot be
    // observed here. The null response itself is covered by serviceWorkerAuthRegression.test.ts, which runs the
    // pre-fix worker source. This test checks what the user sees.
    if (KIND === 'candidate') {
      await expect(alert).toHaveText(/could not reach the sign-in service/i);
    } else {
      // The pre-fix control must show a raw browser error. WebKit shows the reported "Returned response is null." text.
      await expect(alert).toHaveText(/returned response is null|respondWith received an error|failed to fetch|load failed|networkerror/i);
    }
    await context.close();
  });

  test('a password request is never answered from cache', async ({ browser }) => {
    const context = await browser.newContext({ serviceWorkers: 'allow' });
    const page = await context.newPage();
    await openControlledApp(page);
    await page.getByLabel('Email').fill('leader@yorku.ca');
    await page.getByLabel('Password').fill('secret1');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 30_000 });

    const cacheKeys = await page.evaluate(async () => {
      const names = await caches.keys();
      const out: string[] = [];
      for (const name of names) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          out.push(`${name} ${request.method} ${new URL(request.url).pathname}`);
        }
      }
      return out;
    });
    expect(cacheKeys.filter((entry) => /\/auth\/|\/rest\/|POST/.test(entry))).toEqual([]);
    await context.close();
  });
});

test.describe('legacy service worker upgrade', () => {
  test.skip(KIND !== 'candidate' || !LEGACY_SW_FILE || !!process.env.PROD_MOUNT, 'root-scope only: the candidate with a legacy worker file, not the prefix build');

  test('a device that holds the retired /sw.js registration moves to the push worker, keeps other caches and sessions', async ({
    browser,
  }) => {
    const legacySource = fs.readFileSync(path.resolve(LEGACY_SW_FILE!));
    const context = await browser.newContext({ serviceWorkers: 'allow' });
    const seed = await context.newPage();

    // The test server serves the legacy worker at /sw.js, and a blank seed page that runs no app code, only while the
    // device is seeded. The override is removed afterwards so the candidate's own /sw.js is what the app sees.
    const origin = new URL(test.info().project.use.baseURL ?? 'http://127.0.0.1:4173').origin;
    await fetch(`${origin}/__test__/override?path=${encodeURIComponent('/sw.js')}`, { method: 'PUT', body: legacySource });
    await fetch(`${origin}/__test__/override?path=${encodeURIComponent('/legacy-seed.html')}`, {
      method: 'PUT',
      body: '<!doctype html><title>seed</title>',
    });
    await seed.goto('/legacy-seed.html');
    await seed.evaluate(async (otherCache) => {
      const reg = await navigator.serviceWorker.register('/sw.js');
      await new Promise<void>((resolve) => {
        const check = () => (reg.active ? resolve() : setTimeout(check, 50));
        check();
      });
      // Caches a pre-upgrade device would hold: the Hub's old caches and another app's cache on the same origin.
      await caches.open('cc-portal-v1');
      await caches.open('blw-york-v1');
      await caches.open(otherCache);
      // A well-formed, unexpired session. A bare token is discarded by supabase-js, which would make the session check meaningless.
      const seededSession = {
        access_token: 'seeded',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: 'seeded',
        user: { id: '00000000-0000-0000-0000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'leader@yorku.ca' },
      };
      localStorage.setItem('sb-127-auth-token', JSON.stringify(seededSession));
    }, SEEDED_OTHER_APP_CACHE);
    await seed.close();
    await fetch(`${origin}/__test__/override?path=${encodeURIComponent('/sw.js')}`, { method: 'DELETE' });
    await fetch(`${origin}/__test__/override?path=${encodeURIComponent('/legacy-seed.html')}`, { method: 'DELETE' });

    const page = await context.newPage();
    await page.goto(APP_ROOT);
    const readState = () =>
      page.evaluate(async () => {
        const regs = await navigator.serviceWorker.getRegistrations();
        const names = await caches.keys();
        return {
          scripts: regs.map((r) => (r.active ?? r.installing ?? r.waiting)?.scriptURL ?? ''),
          activePush: regs.some((r) => r.active?.scriptURL.endsWith('/service-worker.js') === true),
          caches: names,
          session: localStorage.getItem('sb-127-auth-token') !== null,
        };
      });

    // The push worker activates after it registers, and its activate step deletes the Hub's old caches. Poll until
    // both have happened: an async predicate in waitForFunction would return a Promise, which is always truthy.
    await expect
      .poll(
        async () => {
          const s = await readState();
          return (
            s.activePush &&
            !s.scripts.some((u) => u.endsWith('/sw.js')) &&
            !s.caches.includes('cc-portal-v1') &&
            !s.caches.includes('blw-york-v1')
          );
        },
        { timeout: 30_000 },
      )
      .toBe(true);

    const state = await readState();
    expect(
      state.scripts.filter((s) => s.endsWith('/sw.js')),
      'legacy registrations left after the upgrade',
    ).toEqual([]);
    expect(state.scripts.some((s) => s.endsWith('/service-worker.js'))).toBe(true);
    expect(state.caches).not.toContain('cc-portal-v1');
    expect(state.caches).not.toContain('blw-york-v1');
    expect(state.caches).toContain(SEEDED_OTHER_APP_CACHE);
    expect(state.session).toBe(true);
    await context.close();
  });
});

// Not used by the assertions above; kept so a failing run names the build it tested.
test('build identity is recorded', () => {
  expect(['candidate', 'prefix']).toContain(KIND);
  expect(SW_CACHE_NAMES.length).toBeGreaterThan(0);
});
