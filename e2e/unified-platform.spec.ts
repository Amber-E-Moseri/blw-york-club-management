import { expect, test } from '@playwright/test';

// Unified platform: public website at /, Hub under /hub, administration under /admin, one origin.

const FATAL_SW_PATTERNS = [/respondWith/i, /Returned response is null/i];

function collectErrors(page: import('@playwright/test').Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  return errors;
}

test('public homepage renders at the root with a Hub sign-in entry', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/BLW York/);
  const signIn = page.locator('a[href="/hub/login"]').first();
  await expect(signIn).toBeAttached();
});

test('public navigation reaches member sign-in at /hub/login', async ({ page, isMobile }) => {
  await page.goto('/');
  if (isMobile) await page.getByRole('button', { name: 'Menu' }).click();
  await page.locator('a[href="/hub/login"]:visible').filter({ hasText: 'Member sign-in' }).first().click();
  await expect(page).toHaveURL(/\/hub\/login$/);
  await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible();
});

test('public pages survive direct navigation and refresh', async ({ page }) => {
  for (const path of ['/about', '/events', '/contact', '/new-here']) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    await page.reload();
    await expect(page.locator('#root')).not.toBeEmpty();
  }
});

test('hub routes render the Hub shell on direct navigation and refresh', async ({ page }) => {
  for (const path of ['/hub/login', '/hub/events', '/hub/members', '/hub/reset-password']) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    await page.reload();
    await expect(page.locator('#root')).not.toBeEmpty();
  }
});

test('legacy Hub deep links redirect into /hub', async ({ page }) => {
  await page.goto('/members');
  await expect(page).toHaveURL(/\/hub\/members$/);
  await page.goto('/meetings');
  await expect(page).toHaveURL(/\/hub\/meetings$/);
});

test('unauthenticated visitors see sign-in at /admin, never administration', async ({ page }) => {
  await page.goto('/admin/pending');
  await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible();
  await expect(page.getByText('Pending Approvals')).toHaveCount(0);
});

test('hub service worker is scoped to /hub/ and no public worker is registered', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/hub/login');
  await page.waitForLoadState('load');
  const scopes = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return null;
    const regs = await navigator.serviceWorker.getRegistrations();
    return regs.map((r) => new URL(r.scope).pathname);
  });
  if (scopes !== null) {
    expect(scopes.every((s) => s.startsWith('/hub/')), `scopes: ${JSON.stringify(scopes)}`).toBeTruthy();
  }
  expect(errors.filter((e) => FATAL_SW_PATTERNS.some((p) => p.test(e)))).toEqual([]);
});

test('public website registers no service worker', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('load');
  const count = await page.evaluate(async () => (navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : 0));
  expect(count).toBe(0);
});

test('no page-level errors during hub sign-in render', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/hub/login');
  await page.waitForLoadState('networkidle');
  expect(errors.filter((e) => FATAL_SW_PATTERNS.some((p) => p.test(e)))).toEqual([]);
});

test('public and hub layouts do not scroll horizontally', async ({ page }) => {
  for (const path of ['/', '/hub/login']) {
    await page.goto(path);
    await page.waitForLoadState('load');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(1);
  }
});
