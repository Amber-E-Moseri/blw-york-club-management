import { expect, test, type Page } from '@playwright/test';
import { mockSupabase } from './supabaseMock';

// Regression coverage for the production sign-in report: unreadable heading in dark mode, a card touching the screen
// edges on phones, and raw browser exceptions shown in place of sign-in messages.

const WCAG_AA_CONTRAST = 4.5;

async function contrastRatio(page: Page, textSelector: string, surfaceSelector: string): Promise<number> {
  return page.evaluate(
    ([textSel, surfaceSel]) => {
      const parse = (value: string): [number, number, number, number] => {
        const match = value.match(/rgba?\(([^)]+)\)/);
        if (!match) throw new Error(`Unparsable colour: ${value}`);
        const parts = match[1].split(',').map((p) => parseFloat(p.trim()));
        return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
      };
      const luminance = ([r, g, b]: number[]) => {
        const [R, G, B] = [r, g, b].map((c) => {
          const s = c / 255;
          return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * R + 0.7152 * G + 0.0722 * B;
      };
      const text = document.querySelector(textSel);
      const surface = document.querySelector(surfaceSel);
      if (!text || !surface) throw new Error(`Missing element: ${textSel} or ${surfaceSel}`);
      const [tr, tg, tb, ta] = parse(getComputedStyle(text).color);
      const [sr, sg, sb, sa] = parse(getComputedStyle(surface).backgroundColor);
      if (sa < 1 || ta < 1) throw new Error('Expected opaque colours for a contrast check');
      const l1 = luminance([tr, tg, tb]);
      const l2 = luminance([sr, sg, sb]);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    },
    [textSelector, surfaceSelector],
  );
}

test.describe('sign-in card in light and dark themes', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`heading and field label are readable in ${scheme} mode`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await mockSupabase(page);
      await page.goto('/');

      await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible();

      expect(await contrastRatio(page, '.login-card h2', '.login-card')).toBeGreaterThanOrEqual(WCAG_AA_CONTRAST);
      expect(await contrastRatio(page, '.login-card label', '.login-card')).toBeGreaterThanOrEqual(WCAG_AA_CONTRAST);
    });
  }

  test('the card sits inside the screen on a 320px phone and a 375px phone', async ({ page }) => {
    await mockSupabase(page);
    for (const width of [320, 375]) {
      await page.setViewportSize({ width, height: 640 });
      await page.goto('/');
      const box = await page.locator('.login-card').boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(12);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width - 12);
    }
  });
});

test.describe('sign-in messages', () => {
  test('a network failure shows a plain message, never the browser exception', async ({ page }) => {
    await mockSupabase(page);
    await page.route('**/auth/v1/token*', (route) => route.abort('failed'));
    await page.goto('/');

    await page.getByLabel('Email').fill('leader@yorku.ca');
    await page.getByLabel('Password').fill('secret1');
    await page.getByRole('button', { name: 'Sign In' }).click();

    const alert = page.getByRole('alert');
    await expect(alert).toHaveText(/could not reach the sign-in service/i);
    await expect(page.getByText(/failed to fetch|load failed|networkerror/i)).toHaveCount(0);
  });

  test('a wrong password shows the friendly message', async ({ page }) => {
    await mockSupabase(page);
    await page.route('**/auth/v1/token*', (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }),
      }),
    );
    await page.goto('/');

    await page.getByLabel('Email').fill('leader@yorku.ca');
    await page.getByLabel('Password').fill('wrong-password');
    await page.getByRole('button', { name: 'Sign In' }).click();

    await expect(page.getByRole('alert')).toHaveText('Incorrect email or password. Please try again.');
  });
});
