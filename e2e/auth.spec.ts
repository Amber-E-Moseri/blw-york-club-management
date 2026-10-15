import { expect, test } from '@playwright/test';
import { mockSupabase } from './supabaseMock';

test.beforeEach(async ({ page }) => {
  await mockSupabase(page);
});

test('shows the sign-in screen for signed-out visitors', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Password')).toBeVisible();
});

test('validates request access before submitting', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Request access' }).click();
  await page.getByRole('button', { name: 'Submit Request' }).click();

  await expect(page.getByRole('alert')).toHaveText('Full name is required.');
});

test('submits an access request', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Request access' }).click();
  await page.getByLabel('Full Name').fill('New Member');
  await page.getByLabel('Email').fill('new@yorku.ca');
  await page.getByLabel('Password', { exact: true }).fill('secret1');
  await page.getByLabel('Confirm Password').fill('secret1');
  await page.getByRole('button', { name: 'Submit Request' }).click();

  await expect(page.getByRole('heading', { name: 'Application submitted!' })).toBeVisible();
});

test('signs in and reaches the dashboard', async ({ page }) => {
  await page.goto('/');

  await page.getByLabel('Email').fill('leader@yorku.ca');
  await page.getByLabel('Password').fill('secret1');
  await page.getByRole('button', { name: 'Sign In' }).click();

  await expect(page.getByRole('heading', { name: /Good to see you, Jordan\./i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Daily Bread/i })).toBeVisible();
  await expect(page.getByText('Sunday Service')).toBeVisible();
  await expect(page.getByText('Leadership Sync').first()).toBeVisible();
});

test('toggles between dark and light mode', async ({ page }) => {
  await page.goto('/');

  await page.getByLabel('Email').fill('leader@yorku.ca');
  await page.getByLabel('Password').fill('secret1');
  await page.getByRole('button', { name: 'Sign In' }).click();

  const themeToggle = page.getByRole('button', { name: 'Toggle dark mode' });

  await themeToggle.click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(themeToggle).toContainText('Light mode');

  await themeToggle.click();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await expect(themeToggle).toContainText('Dark mode');
});
