import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';

// Release smoke against the LOCAL Supabase stack with fake, throwaway accounts.
// Requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (local only) in the environment.
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) throw new Error('release smoke only runs against a local Supabase stack');

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const run = `${Date.now()}`;
const password = `${randomBytes(18).toString('base64url')}aA1!`; // random per run; never reused
const authUrl = `${url.replace(/\/$/, '')}/auth/v1`;
const accounts = {
  admin: { email: `e2e.admin.${run}@example.test`, name: `E2E Admin ${run}`, role: 'admin', status: 'active' },
  member: { email: `e2e.member.${run}@example.test`, name: `E2E Member ${run}`, role: 'member', status: 'active' },
  pending: { email: `e2e.pending.${run}@example.test`, name: `E2E Pending ${run}`, role: 'member', status: 'pending' },
} as const;
const ids: string[] = [];
let pendingId = '';

async function waitForAuthReadiness() {
  const deadline = Date.now() + 60_000;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const health = await fetch(`${authUrl}/health`);
      if (!health.ok) throw new Error(`health ${health.status}`);

      const adminUsers = await fetch(`${authUrl}/admin/users?page=1&per_page=1`, {
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      });
      if (adminUsers.ok) return;
      lastError = `admin users ${adminUsers.status}: ${await adminUsers.text()}`;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`local Supabase Auth was not ready within 60s (${lastError})`);
}

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(90_000);
  await waitForAuthReadiness();
  for (const [key, a] of Object.entries(accounts)) {
    const { data, error } = await admin.auth.admin.createUser({
      email: a.email,
      password,
      email_confirm: true,
      user_metadata: { full_name: a.name },
    });
    if (error || !data.user) throw new Error(`createUser ${key}: ${error?.message}`);
    ids.push(data.user.id);
    if (key === 'pending') pendingId = data.user.id;
    if (a.status === 'active') {
      const { error: upErr } = await admin.from('profiles').update({ role: a.role, status: 'active' }).eq('id', data.user.id);
      if (upErr) throw new Error(`activate ${key}: ${upErr.message}`);
    }
  }
});

test.afterAll(async () => {
  for (const id of ids) await admin.auth.admin.deleteUser(id);
});

function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

async function signIn(page: Page, email: string, pw = password, expected: 'success' | 'failure' = 'success') {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(pw);
  const [authResponse] = await Promise.all([
    page.waitForResponse((response) => (
      response.url().startsWith(`${authUrl}/token?grant_type=password`)
        && response.request().method() === 'POST'
    ), { timeout: 20_000 }),
    page.getByRole('button', { name: 'Sign In' }).click(),
  ]);
  if (expected === 'success') expect(authResponse.status(), 'Supabase password auth should succeed').toBe(200);
  else expect(authResponse.status(), 'Supabase password auth should reject invalid credentials').toBeGreaterThanOrEqual(400);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'page must not scroll horizontally').toBeLessThanOrEqual(1);
}

test('invalid login is rejected', async ({ page }) => {
  const errors = trackErrors(page);
  await signIn(page, accounts.member.email, 'wrong-password', 'failure');
  await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(errors).toEqual([]);
});

test('pending account is held at the approval screen and cannot reach the app', async ({ page }) => {
  const errors = trackErrors(page);
  await signIn(page, accounts.pending.email);
  await expect(page.getByRole('heading', { name: 'Account pending approval' })).toBeVisible();
  await page.goto('/admin/pending');
  await expect(page.getByRole('heading', { name: 'Account pending approval' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('member signs in and every primary page loads without crashing', async ({ page }) => {
  const errors = trackErrors(page);
  await signIn(page, accounts.member.email);
  await expect(page.getByRole('heading', { name: /Good to see you|Welcome back/i })).toBeVisible();
  await expect(page.locator('nav:visible, [role="navigation"]:visible').first()).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const pages: Array<[string, string]> = [
    ['/', 'Dashboard'],
    ['/members', 'People'],
    ['/contacts', 'Contacts'],
    ['/meetings', 'Meetings'],
    ['/events', 'Events'],
    ['/books', 'Resources: books'],
    ['/devotionals', 'Resources: devotionals'],
  ];
  for (const [path, label] of pages) {
    await page.goto(path);
    await expect(page.locator('#root'), `${label} should render`).not.toBeEmpty();
    await expect(page.getByText(/something went wrong/i), `${label} must not hit an error boundary`).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  }
  expect(errors).toEqual([]);
});

test('member is denied privileged admin pages, including by direct URL', async ({ page }) => {
  const errors = trackErrors(page);
  await signIn(page, accounts.member.email);
  await expect(page.getByRole('heading', { name: /Good to see you|Welcome back/i })).toBeVisible();
  for (const path of ['/admin', '/admin/pending', '/admin/exports']) {
    await page.goto(path);
    await expect(page.getByText('Access denied.').first(), `${path} must deny a member`).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('admin reaches Admin and approves a pending member', async ({ page }) => {
  const errors = trackErrors(page);
  await signIn(page, accounts.admin.email);
  await expect(page.getByRole('heading', { name: /Good to see you|Welcome back/i })).toBeVisible();
  await page.goto('/admin');
  await expect(page.getByText('Access denied.')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await page.goto('/admin/pending');
  await expect(page.getByRole('heading', { name: 'Pending Approvals' })).toBeVisible();
  const row = page.locator('div', { hasText: accounts.pending.email }).filter({ has: page.getByRole('button', { name: 'Approve' }) }).last();
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Approve' }).click();

  await expect
    .poll(async () => (await admin.from('profiles').select('status').eq('id', pendingId).single()).data?.status, { timeout: 15_000 })
    .toBe('active');
  expect(errors).toEqual([]);
});

test('signed-in user can sign out and the session is gone', async ({ page }) => {
  await signIn(page, accounts.member.email);
  await expect(page.getByRole('heading', { name: /Good to see you|Welcome back/i })).toBeVisible();
  const signOut = page.getByRole('button', { name: 'Sign out' }).first();
  if (!(await signOut.isVisible())) {
    // On narrow screens sign-out lives in the header profile menu.
    await page.locator('header button:visible').last().click();
  }
  await page.getByRole('button', { name: 'Sign out' }).first().click();
  await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible();
  await page.goto('/members');
  await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible();
});
