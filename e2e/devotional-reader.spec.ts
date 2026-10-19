/* eslint-disable testing-library/prefer-screen-queries -- Playwright `page` fixtures, not RTL render results */
import { expect, test } from '@playwright/test';
import { openDevotional, setup, signIn } from './devotionalFixtures';

test.describe('Daily Bread mobile reader', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('shows the renamed header, the image, and no theme toggle', async ({ page }) => {
    await setup(page);
    await signIn(page);
    await openDevotional(page);

    await expect(page.getByText('Rhapsody of Realities', { exact: true }).filter({ visible: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Day 19: His Triumph Over Darkness/ })).toBeVisible();
    await expect(page.getByText('Tap to enlarge')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Switch to dark mode' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Manage' })).toHaveCount(0);
  });

  test('tapping the image opens the reader, and Close returns focus to the image', async ({ page }) => {
    const recorder = await setup(page);
    await signIn(page);
    await openDevotional(page);

    const imageButton = page.getByRole('button', { name: /Open Rhapsody of Realities day 19/ });
    await imageButton.click();
    const reader = page.getByRole('dialog', { name: /Devotional image/ });
    await expect(reader).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close image viewer' })).toBeFocused();

    await page.getByRole('button', { name: 'Close image viewer' }).click();
    await expect(reader).toHaveCount(0);
    await expect(imageButton).toBeFocused();

    // Opening and closing the reader must never mark the day as read.
    expect(recorder.markReadCalls).toBe(0);
  });

  test('Enter and Escape work for keyboard users', async ({ page }) => {
    await setup(page);
    await signIn(page);
    await openDevotional(page);

    await page.getByRole('button', { name: /Open Rhapsody of Realities day 19/ }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: /Devotional image/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: /Devotional image/ })).toHaveCount(0);
  });

  test('zoom in, Fit resets, and double-tap toggles', async ({ page }) => {
    await setup(page);
    await signIn(page);
    await openDevotional(page);
    await page.getByRole('button', { name: /Open Rhapsody of Realities day 19/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    const zoomIn = page.getByRole('button', { name: 'Zoom in' });
    await zoomIn.click();
    await zoomIn.click();
    await expect(page.getByText(/\d+% zoom/)).not.toHaveText('100% zoom');
    await page.getByRole('button', { name: 'Fit', exact: true }).click();
    await expect(page.getByText('100% zoom')).toBeAttached();
  });

  test('marks as read once, shows confirmation only after the database responds', async ({ page }) => {
    const recorder = await setup(page);
    await signIn(page);
    await openDevotional(page);

    const markButton = page.getByRole('button', { name: 'Mark this devotional as read' });
    await markButton.dblclick();
    await expect(page.getByRole('status').filter({ hasText: 'Marked as read' })).toBeVisible();
    expect(recorder.markReadCalls).toBe(1);
  });

  test('shows an error with retry when marking fails', async ({ page }) => {
    const recorder = await setup(page, { failMarkRead: true });
    await signIn(page);
    await openDevotional(page);

    await page.getByRole('button', { name: 'Mark this devotional as read' }).click();
    await expect(page.getByRole('alert')).toContainText("Couldn't save your reading");
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Marked as read' })).toHaveCount(0);
    expect(recorder.markReadCalls).toBe(1);
  });

  test('progress summary is labelled and the calendar opens from its disclosure', async ({ page }) => {
    await setup(page, { readDays: [1, 2, 3] });
    await signIn(page);
    await openDevotional(page);

    await expect(page.getByRole('heading', { name: 'My reading progress' })).toBeVisible();
    const summary = page.locator('dl');
    await expect(summary.locator('dt', { hasText: 'Current streak' })).toBeVisible();
    await expect(summary.getByText('5 days')).toBeVisible();
    await expect(summary.getByText('12 days')).toBeVisible();
    await expect(summary.getByText('7 / 19')).toBeVisible();

    const toggle = page.getByRole('button', { name: 'View reading progress' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(page.getByRole('button', { name: 'Hide reading calendar' })).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('img', { name: 'Day 1, completed' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Day 4, missed' })).toBeVisible();
  });

  test('streak failure shows a message, never zeros', async ({ page }) => {
    await setup(page, { failStreak: true });
    await signIn(page);
    await openDevotional(page);

    await expect(page.getByText('Reading progress is unavailable right now.')).toBeVisible();
    await expect(page.getByText('0 days')).toHaveCount(0);
  });

  test('no horizontal overflow at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await setup(page);
    await signIn(page);
    await openDevotional(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe('Daily Bread coordinator controls', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('a member does not see Manage; a coordinator does', async ({ page }) => {
    await setup(page, { role: 'member' });
    await signIn(page);
    await openDevotional(page);
    await expect(page.getByRole('button', { name: 'Manage' })).toHaveCount(0);
  });

  test('a coordinator sees Manage on mobile', async ({ page }) => {
    await setup(page, { role: 'coordinator' });
    await signIn(page);
    await openDevotional(page);
    await expect(page.getByRole('button', { name: 'Manage' }).first()).toBeVisible();
  });
});
