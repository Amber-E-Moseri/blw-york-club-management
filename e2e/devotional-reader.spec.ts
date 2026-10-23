/* eslint-disable testing-library/prefer-screen-queries -- Playwright `page` fixtures, not RTL render results */
import { expect, test, type Page } from '@playwright/test';
import { openDevotional, setup, signIn } from './devotionalFixtures';

const IMAGE_BUTTON = /Open Rhapsody of Realities day 19/;
const READER = /Devotional image/;

async function openReaderFromImage(page: Page) {
  await page.getByRole('button', { name: IMAGE_BUTTON }).click();
  await expect(page.getByRole('dialog', { name: READER })).toBeVisible();
}

/** Reads the current transform (scale and translate) applied to the zoomable content. */
async function contentTransform(page: Page): Promise<string> {
  return page.getByRole('dialog', { name: READER }).locator('img').evaluate((img) => {
    const content = img.parentElement as HTMLElement;
    return content.style.transform || getComputedStyle(content).transform;
  });
}

async function zoomLabel(page: Page): Promise<string> {
  return (await page.getByText(/\d+% zoom/).textContent()) ?? '';
}

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

    const imageButton = page.getByRole('button', { name: IMAGE_BUTTON });
    await imageButton.click();
    const reader = page.getByRole('dialog', { name: READER });
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

    await page.getByRole('button', { name: IMAGE_BUTTON }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: READER })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: READER })).toHaveCount(0);
  });

  test('keyboard zoom, Fit, and background scroll lock', async ({ page }) => {
    await setup(page);
    await signIn(page);
    await openDevotional(page);
    await openReaderFromImage(page);

    await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
    await expect.poll(() => zoomLabel(page)).toBe('100% zoom');

    await page.getByRole('button', { name: 'Zoom in' }).click();
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await expect.poll(() => zoomLabel(page)).not.toBe('100% zoom');

    await page.getByRole('button', { name: 'Fit', exact: true }).click();
    await expect.poll(() => zoomLabel(page)).toBe('100% zoom');

    await page.getByRole('button', { name: 'Close image viewer' }).click();
    await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
  });

  test('pinch-to-zoom changes the scale', async ({ page }) => {
    await setup(page);
    await signIn(page);
    await openDevotional(page);
    await openReaderFromImage(page);

    const box = await page.getByRole('dialog', { name: READER }).locator('img').boundingBox();
    expect(box).not.toBeNull();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.synthesizePinchGesture', {
      x: box!.x + box!.width / 2,
      y: box!.y + box!.height / 2,
      scaleFactor: 2.5,
      relativeSpeed: 1200,
      gestureSourceType: 'touch',
    });

    await expect.poll(() => zoomLabel(page)).not.toBe('100% zoom');
  });

  test('panning while zoomed moves the image', async ({ page }) => {
    await setup(page);
    await signIn(page);
    await openDevotional(page);
    await openReaderFromImage(page);

    await page.getByRole('button', { name: 'Zoom in' }).click();
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await expect.poll(() => zoomLabel(page)).not.toBe('100% zoom');
    const before = await contentTransform(page);

    // Explicit touch drag: start, several move steps, end. More deterministic than a synthesized scroll.
    const box = await page.getByRole('dialog', { name: READER }).locator('img').boundingBox();
    const cdp = await page.context().newCDPSession(page);
    const startX = box!.x + box!.width / 2;
    const y = box!.y + box!.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: startX, y }] });
    for (let step = 1; step <= 12; step++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: startX - step * 10, y }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

    await expect.poll(() => contentTransform(page)).not.toBe(before);
  });

  test('double-tap toggles zoom in and back out', async ({ page }) => {
    await setup(page);
    await signIn(page);
    await openDevotional(page);
    await openReaderFromImage(page);

    const box = await page.getByRole('dialog', { name: READER }).locator('img').boundingBox();
    const cdp = await page.context().newCDPSession(page);
    const tap = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2, tapCount: 2, gestureSourceType: 'touch' };

    await cdp.send('Input.synthesizeTapGesture', tap);
    await expect.poll(() => zoomLabel(page)).not.toBe('100% zoom');

    await cdp.send('Input.synthesizeTapGesture', tap);
    await expect.poll(() => zoomLabel(page)).toBe('100% zoom');
  });

  test('Full screen in the More actions menu opens the same reader', async ({ page }) => {
    await setup(page);
    await signIn(page);
    await openDevotional(page);

    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('button', { name: 'Full screen', exact: true }).click();
    await expect(page.getByRole('dialog', { name: READER })).toBeVisible();
    await page.getByRole('button', { name: 'Close image viewer' }).click();
    await expect(page.getByRole('dialog', { name: READER })).toHaveCount(0);
  });

  test('closing the reader restores the page scroll position', async ({ page }) => {
    await setup(page, { readDays: [1, 2, 3] });
    await signIn(page);
    await openDevotional(page);
    await page.getByRole('button', { name: 'View reading progress' }).click();
    await page.evaluate(() => window.scrollTo(0, 240));
    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(240);

    await openReaderFromImage(page);
    await page.getByRole('button', { name: 'Close image viewer' }).click();
    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(240);
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

  test('shows a saving state while the write is in flight', async ({ page }) => {
    const recorder = await setup(page);
    recorder.markReadDelayMs = 1500;
    await signIn(page);
    await openDevotional(page);

    await page.getByRole('button', { name: 'Mark this devotional as read' }).click();
    const saving = page.getByRole('button', { name: 'Saving…' });
    await expect(saving).toBeDisabled();
    await expect(saving).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByRole('status').filter({ hasText: 'Marked as read' })).toBeVisible();
    expect(recorder.markReadCalls).toBe(1);
  });

  test('shows an error with retry, and retry succeeds', async ({ page }) => {
    const recorder = await setup(page, { failMarkRead: true });
    await signIn(page);
    await openDevotional(page);

    await page.getByRole('button', { name: 'Mark this devotional as read' }).click();
    await expect(page.getByRole('alert')).toContainText("Couldn't save your reading");
    await expect(page.getByRole('status').filter({ hasText: 'Marked as read' })).toHaveCount(0);

    recorder.failMarkRead = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Marked as read' })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(recorder.markReadCalls).toBe(2);
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
});

test.describe('Daily Bread coordinator controls', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('a member does not see Manage', async ({ page }) => {
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

test.describe('Daily Bread desktop regression', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('keeps the desktop action row, stat tiles, and calendar; hides phone-only controls', async ({ page }) => {
    await setup(page, { readDays: [1, 2, 3] });
    await signIn(page);
    await openDevotional(page);

    await expect(page.getByRole('button', { name: 'Share', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Fullscreen', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'More actions' })).toBeHidden();
    await expect(page.getByText('Tap to enlarge')).toBeHidden();
    await expect(page.getByText('Read today', { exact: true })).toBeVisible();
    await expect(page.getByText('Your reading streak', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'My reading progress' })).toBeHidden();
  });

  test('desktop Fullscreen opens the same reader', async ({ page }) => {
    await setup(page);
    await signIn(page);
    await openDevotional(page);

    await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
    await expect(page.getByRole('dialog', { name: READER })).toBeVisible();
    await page.getByRole('button', { name: 'Close image viewer' }).click();
    await expect(page.getByRole('dialog', { name: READER })).toHaveCount(0);
  });

  test('calendar day 1 sits under its weekday (October 2026 starts on a Thursday)', async ({ page }) => {
    await setup(page);
    await signIn(page);
    await openDevotional(page);

    const dayGrid = page.getByRole('group', { name: /Reading history for October 2026/ });
    const weekdayRow = dayGrid.locator('xpath=preceding-sibling::div[1]');
    const thursday = weekdayRow.locator('span').nth(4);
    const day1 = page.getByRole('img', { name: 'Day 1, missed' });

    const [thu, d1] = await Promise.all([thursday.boundingBox(), day1.boundingBox()]);
    expect(thu).not.toBeNull();
    expect(d1).not.toBeNull();
    expect(Math.abs(thu!.x + thu!.width / 2 - (d1!.x + d1!.width / 2))).toBeLessThanOrEqual(2);
  });
});

// Width and theme sweep: no horizontal overflow, and the reader opens, at each requested size.
const WIDTHS = [320, 375, 390, 430, 768, 1440];
for (const width of WIDTHS) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`no horizontal overflow and reader opens at ${width}px, ${scheme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ colorScheme: scheme });
      await setup(page, { readDays: [1, 2, 3] });
      await signIn(page);
      await openDevotional(page);

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);

      await openReaderFromImage(page);
      const readerOverflow = await page.getByRole('dialog', { name: READER }).evaluate(
        (el) => el.scrollWidth - el.clientWidth,
      );
      expect(readerOverflow).toBeLessThanOrEqual(0);
      await page.getByRole('button', { name: 'Close image viewer' }).click();
    });
  }
}
