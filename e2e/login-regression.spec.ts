import { expect, test, type Locator, type Page } from '@playwright/test';
import { mockSupabase } from './supabaseMock';

// The app root: '/' for the root-mounted build, '/hub/' for the prefix-mounted unified build (PROD_MOUNT=/hub).
const APP_ROOT = `${process.env.PROD_MOUNT ?? ''}/`;

// Regression coverage for the production sign-in report: an unreadable "Sign In" heading in dark mode, a card touching
// the screen edges on phones, raw browser exceptions in place of sign-in messages, and a double submit.

const WCAG_AA_CONTRAST = 4.5;

/**
 * Measures the contrast the user actually sees. The text colour is the element's computed colour. The background is the
 * computed background of the element and its ancestors, composited from the page down. Nothing is looked up by a CSS
 * class, so a visually unreadable heading fails even if it carries no marker.
 */
async function renderedContrast(target: Locator): Promise<number> {
  return target.evaluate((el) => {
    type RGBA = [number, number, number, number];
    const parse = (value: string): RGBA => {
      const match = value.match(/rgba?\(([^)]+)\)/);
      if (!match) throw new Error(`Unparsable colour: ${value}`);
      const parts = match[1].split(',').map((p) => parseFloat(p.trim()));
      return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
    };
    const over = (top: RGBA, bottom: RGBA): RGBA => {
      const a = top[3] + bottom[3] * (1 - top[3]);
      if (a === 0) return [0, 0, 0, 0];
      const mix = (t: number, b: number) => (t * top[3] + b * bottom[3] * (1 - top[3])) / a;
      return [mix(top[0], bottom[0]), mix(top[1], bottom[1]), mix(top[2], bottom[2]), a];
    };
    const luminance = ([r, g, b]: RGBA) => {
      const [R, G, B] = [r, g, b].map((c) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * R + 0.7152 * G + 0.0722 * B;
    };

    // Collect backgrounds from the element up to the root, then composite from the root down.
    const layers: RGBA[] = [];
    for (let node: Element | null = el; node; node = node.parentElement) {
      const bg = parse(getComputedStyle(node).backgroundColor);
      if (bg[3] > 0) layers.push(bg);
    }
    let surface: RGBA = [255, 255, 255, 1]; // the canvas default when nothing paints a background
    for (let i = layers.length - 1; i >= 0; i -= 1) surface = over(layers[i], surface);

    // Text colour, with its own opacity applied over the surface it sits on.
    const text = over(parse(getComputedStyle(el).color), surface);
    const l1 = luminance(text);
    const l2 = luminance(surface);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  });
}

async function expectReadable(target: Locator, label: string) {
  const ratio = await renderedContrast(target);
  expect(ratio, `${label} contrast ${ratio.toFixed(2)}:1 must be at least ${WCAG_AA_CONTRAST}:1`).toBeGreaterThanOrEqual(
    WCAG_AA_CONTRAST,
  );
}

test.describe('sign-in card in light and dark themes', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`heading, label, field text and primary button are readable in ${scheme} mode`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await mockSupabase(page);
      await page.goto(APP_ROOT);

      const heading = page.getByRole('heading', { name: 'Sign In' });
      await expect(heading).toBeVisible();

      await expectReadable(heading, 'Sign In heading');
      await expectReadable(page.getByText('Email', { exact: true }), 'Email label');
      await expectReadable(page.getByLabel('Email'), 'Email field text');
      await expectReadable(page.getByRole('button', { name: 'Sign In' }), 'Sign In button');
    });
  }

  test('the card sits inside the screen on a 320px phone and a 375px phone', async ({ page }) => {
    await mockSupabase(page);
    for (const width of [320, 375]) {
      await page.setViewportSize({ width, height: 640 });
      await page.goto(APP_ROOT);
      // The card is the container of the sign-in heading. No marker class is needed to find it.
      const card = page.getByRole('heading', { name: 'Sign In' }).locator('..');
      const box = await card.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(12);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width - 12);
    }
  });
});

test.describe('sign-in messages and submission', () => {
  test('a network failure shows a plain message, never the browser exception', async ({ page }) => {
    await mockSupabase(page);
    await page.route('**/auth/v1/token*', (route) => route.abort('failed'));
    await page.goto(APP_ROOT);

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
    await page.goto(APP_ROOT);

    await page.getByLabel('Email').fill('leader@yorku.ca');
    await page.getByLabel('Password').fill('wrong-password');
    await page.getByRole('button', { name: 'Sign In' }).click();

    await expect(page.getByRole('alert')).toHaveText('Incorrect email or password. Please try again.');
  });

  test('a double tap on Sign In sends one password request', async ({ page }) => {
    await mockSupabase(page);
    const methods: string[] = [];
    await page.route('**/auth/v1/token*', async (route) => {
      methods.push(route.request().method());
      // Hold the response so a second tap lands while the first request is in flight.
      await new Promise((resolve) => setTimeout(resolve, 600));
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }),
      });
    });
    await page.goto(APP_ROOT);

    await page.getByLabel('Email').fill('leader@yorku.ca');
    await page.getByLabel('Password').fill('secret1');
    const button = page.getByRole('button', { name: 'Sign In' });
    await button.click();
    // Found by element, not by name: while busy the button's label reads "Loading...".
    await expect(page.locator('form button[type="submit"]')).toBeDisabled();
    // A second submit while the first request is still held open (the 600ms hold above). Issued directly so it lands
    // inside the in-flight window, not after the first response has already re-enabled the button.
    await page.evaluate(() => document.querySelector('form')?.requestSubmit());

    await expect(page.getByRole('alert')).toHaveText('Incorrect email or password. Please try again.');
    expect(methods, 'every request the route saw').toEqual(['POST']);
  });
});
