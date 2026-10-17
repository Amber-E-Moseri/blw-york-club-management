/* eslint-disable testing-library/prefer-screen-queries -- Playwright `page` fixtures, not RTL render results */
import { expect, test, type Page } from '@playwright/test';
import { mockSupabase, type MockRole } from './supabaseMock';

// Regression coverage for the mobile navigation drawer (hamburger in the mobile header).
// On phones, pages outside the bottom tab bar are reachable only through this drawer, so the
// drawer must list exactly what the desktop sidebar lists for the same role.

type NavEntry = { label: string; path: string };

const OVERVIEW: NavEntry[] = [{ label: 'Dashboard', path: '/' }];
const PEOPLE: NavEntry[] = [
  { label: 'People', path: '/members' },
  { label: 'Cells', path: '/cells' },
  { label: 'Outreach', path: '/contacts' },
];
const APPROVALS: NavEntry[] = [{ label: 'Approvals', path: '/admin/pending' }];
const MINISTRY: NavEntry[] = [
  { label: 'Meetings', path: '/meetings' },
  { label: 'Events', path: '/events' },
  { label: 'Growth', path: '/growth' },
];
const RESOURCES: NavEntry[] = [
  { label: 'Devotionals', path: '/devotionals' },
  { label: 'Messages', path: '/messages' },
  { label: 'Books', path: '/books' },
  { label: 'Testimonies', path: '/testimonies' },
];
const ADMINISTRATION: NavEntry[] = [
  { label: 'Admin', path: '/admin' },
  { label: 'Reports', path: '/admin/contact-reports' },
  { label: 'Roles & Access', path: '/admin/roles' },
  { label: 'Communications', path: '/admin/email-log' },
];

const PAGES_BY_ROLE: Record<MockRole, NavEntry[]> = {
  member: [...OVERVIEW, ...MINISTRY, ...RESOURCES],
  cell_leader: [...OVERVIEW, ...PEOPLE, ...MINISTRY, ...RESOURCES],
  coordinator: [...OVERVIEW, ...PEOPLE, ...APPROVALS, ...MINISTRY, ...RESOURCES, ...ADMINISTRATION],
  admin: [...OVERVIEW, ...PEOPLE, ...APPROVALS, ...MINISTRY, ...RESOURCES, ...ADMINISTRATION],
};

const ROLES = Object.keys(PAGES_BY_ROLE) as MockRole[];
const labelsOf = (entries: NavEntry[]) => entries.map((entry) => entry.label);

async function signIn(page: Page, role: MockRole) {
  await mockSupabase(page, { role });
  await page.goto('/');
  await page.getByLabel('Email').fill('leader@yorku.ca');
  await page.getByLabel('Password').fill('secret1');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.getByRole('main')).toBeVisible();
}

const drawer = (page: Page) => page.locator('#mobile-nav-drawer');

async function openDrawer(page: Page) {
  await page.getByRole('button', { name: 'Open navigation menu' }).click();
  await expect(drawer(page)).toBeVisible();
}

async function drawerLabels(page: Page) {
  return (await drawer(page).getByRole('button').allTextContents()).map((text) => text.trim());
}

async function sidebarLabels(page: Page) {
  const sidebar = page.getByRole('navigation', { name: 'Main navigation' });
  return (await sidebar.getByRole('button').allTextContents()).map((text) => text.trim());
}

// True when the element is the topmost thing at its centre point, i.e. nothing overlaps it.
const isUncovered = (locator: ReturnType<Page['locator']>) =>
  locator.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return !!top && el.contains(top);
  });

test.describe('drawer lists the sidebar pages for each role', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  for (const role of ROLES) {
    test(`${role}: drawer lists exactly the pages the sidebar lists`, async ({ page }) => {
      await signIn(page, role);
      await openDrawer(page);
      expect(await drawerLabels(page)).toEqual(labelsOf(PAGES_BY_ROLE[role]));
    });

    test(`${role}: every listed page opens from the drawer`, async ({ page }) => {
      await signIn(page, role);
      for (const entry of PAGES_BY_ROLE[role]) {
        await openDrawer(page);
        await drawer(page).getByRole('button', { name: entry.label, exact: true }).click();
        await expect.poll(() => new URL(page.url()).pathname).toBe(entry.path);
        await expect(page.getByRole('main')).toBeVisible();
        await expect(drawer(page)).toHaveCount(0);
      }
    });
  }
});

test.describe('desktop sidebar keeps the same page list', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  for (const role of ROLES) {
    test(`${role}: sidebar lists the role's pages`, async ({ page }) => {
      await signIn(page, role);
      expect(await sidebarLabels(page)).toEqual(labelsOf(PAGES_BY_ROLE[role]));
    });
  }
});

for (const width of [375, 390, 768]) {
  for (const scheme of ['light', 'dark'] as const) {
    test.describe(`${width}px ${scheme}`, () => {
      test.use({
        viewport: { width, height: 844 },
        isMobile: width < 768,
        hasTouch: width < 768,
        colorScheme: scheme,
      });

      for (const role of ROLES) {
        if (width >= 768) {
          // Tablet and up: the sidebar carries navigation; the mobile header and drawer are hidden.
          test(`${role}: sidebar carries navigation, drawer hidden`, async ({ page }) => {
            await signIn(page, role);
            await expect(page.getByRole('button', { name: 'Open navigation menu' })).toBeHidden();
            await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeHidden();
            await expect(drawer(page)).toHaveCount(0);
            expect(await sidebarLabels(page)).toEqual(labelsOf(PAGES_BY_ROLE[role]));
          });
          continue;
        }

        test(`${role}: drawer layout`, async ({ page }) => {
          await signIn(page, role);
          await openDrawer(page);
          const panel = drawer(page);
          const header = page.locator('header:visible');
          const bottomNav = page.getByRole('navigation', { name: 'Mobile navigation' });

          // The drawer sits below the header and above the bottom tab bar, touching neither.
          const headerBox = await header.boundingBox();
          const panelBox = await panel.boundingBox();
          const navBox = await bottomNav.boundingBox();
          expect(headerBox && panelBox && navBox).toBeTruthy();
          expect(panelBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height - 1);
          expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(navBox!.y + 1);

          // Header toggle and bottom tabs stay tappable while the drawer is open.
          expect(await isUncovered(page.getByRole('button', { name: 'Close navigation menu' }))).toBe(true);
          expect(await isUncovered(bottomNav.getByRole('button', { name: 'Home' }))).toBe(true);

          // The last drawer item can be scrolled above the bottom tab bar, not hidden under it.
          const last = panel.getByRole('button').last();
          await last.scrollIntoViewIfNeeded();
          expect(await isUncovered(last)).toBe(true);

          expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
          expect(await panel.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
            scheme === 'dark' ? 'rgb(15, 23, 42)' : 'rgb(255, 255, 255)',
          );

          await page.screenshot({ path: test.info().outputPath(`drawer-${role}-${width}-${scheme}.png`) });
        });
      }
    });
  }
}

test.describe('closing the drawer', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('Escape closes it', async ({ page }) => {
    await signIn(page, 'admin');
    await openDrawer(page);
    await page.keyboard.press('Escape');
    await expect(drawer(page)).toHaveCount(0);
  });

  test('the header toggle closes it', async ({ page }) => {
    await signIn(page, 'admin');
    await openDrawer(page);
    await page.getByRole('button', { name: 'Close navigation menu' }).click();
    await expect(drawer(page)).toHaveCount(0);
  });

  test('choosing a page closes it', async ({ page }) => {
    await signIn(page, 'admin');
    await openDrawer(page);
    await drawer(page).getByRole('button', { name: 'Events', exact: true }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/events');
    await expect(drawer(page)).toHaveCount(0);
  });

  test('browser back and forward close it', async ({ page }) => {
    await signIn(page, 'admin');
    await openDrawer(page);
    await drawer(page).getByRole('button', { name: 'Events', exact: true }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/events');

    await openDrawer(page);
    await page.goBack();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/');
    await expect(drawer(page)).toHaveCount(0);

    await page.goForward();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/events');
    await expect(drawer(page)).toHaveCount(0);
  });
});
