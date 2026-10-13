import { expect, test } from '@playwright/test';
import { mockSupabase } from './supabaseMock';

// Database-independent: Supabase is answered by the in-page mock, so no local stack is needed.

test.beforeEach(async ({ page }) => {
  await mockSupabase(page);
});

async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByLabel('Email').fill('leader@yorku.ca');
  await page.getByLabel('Password').fill('secret1');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.getByRole('heading', { name: /Good to see you, Jordan\./i })).toBeVisible();
}

// Exactly one Quick Add control is visible at every width: the header button (sm/md+) or the mobile FAB (below md).
for (const width of [375, 640, 767, 768]) {
  test(`exactly one Quick add control is visible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await signIn(page);

    const visible = page.locator('button[aria-label="Quick add"]:visible');
    await expect(visible).toHaveCount(1);

    const inMobileNav = await visible.first().evaluate((el) => !!el.closest('nav[aria-label="Mobile navigation"]'));
    expect(inMobileNav).toBe(width < 768);
  });
}

test('mobile bottom navigation has safe-area padding defined and applied at 375px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page);

  const nav = page.getByRole('navigation', { name: 'Mobile navigation' });
  await expect(nav).toBeVisible();
  await expect(nav).toHaveClass(/safe-bottom/);

  const ruleDefined = await page.evaluate(() =>
    Array.from(document.styleSheets).some((sheet) => {
      try {
        return Array.from(sheet.cssRules).some((rule) => rule.cssText.includes('.safe-bottom'));
      } catch {
        return false;
      }
    }),
  );
  expect(ruleDefined).toBe(true);

  // Chromium reports a zero safe-area inset, so the computed padding is 0px here; the rule is the thing under test.
  const padding = await nav.evaluate((el) => getComputedStyle(el).paddingBottom);
  expect(padding).toBe('0px');
});
