import { expect, test, type Page } from '@playwright/test';
import { mockSupabase } from './supabaseMock';
import { mockProfile, profileRow } from './approvalGateMock';

// Approval gate, in the browser, against a mocked Supabase. Covers the client decision only: GoTrue, PostgREST and the
// database are NOT exercised here (see the release-smoke spec and the PGlite replay for server-side checks).

const HELD = 'held';
const ALLOWED = 'allowed';

type Case =
  | { name: string; outcome: typeof HELD; row: Record<string, unknown>; heading: string }
  | { name: string; outcome: typeof ALLOWED; row: Record<string, unknown>; memberTab: boolean };

const cases: Case[] = [
  // Not approved: none of these may reach the Hub.
  { name: 'pending member', outcome: HELD, row: profileRow({ status: 'pending' }), heading: 'Account pending approval' },
  { name: 'rejected member', outcome: HELD, row: profileRow({ status: 'rejected' }), heading: 'Access not approved' },
  { name: 'inactive member', outcome: HELD, row: profileRow({ status: 'inactive' }), heading: 'Account inactive' },
  { name: 'missing status', outcome: HELD, row: profileRow({ status: undefined }), heading: 'Account pending approval' },
  { name: 'null status', outcome: HELD, row: profileRow({ status: null }), heading: 'Account pending approval' },
  { name: 'unrecognised status "banned"', outcome: HELD, row: profileRow({ status: 'banned' }), heading: 'Account pending approval' },
  { name: 'case-mismatched status "Active"', outcome: HELD, row: profileRow({ status: 'Active' }), heading: 'Account pending approval' },
  // Elevated labels on unapproved accounts: no staff access, no Hub access.
  { name: 'pending admin', outcome: HELD, row: profileRow({ role: 'admin', status: 'pending' }), heading: 'Account pending approval' },
  { name: 'rejected coordinator', outcome: HELD, row: profileRow({ role: 'coordinator', status: 'rejected' }), heading: 'Access not approved' },
  { name: 'inactive admin', outcome: HELD, row: profileRow({ role: 'admin', status: 'inactive' }), heading: 'Account inactive' },
  { name: 'admin with missing status', outcome: HELD, row: profileRow({ role: 'admin', status: undefined }), heading: 'Account pending approval' },
  { name: 'coordinator with null status', outcome: HELD, row: profileRow({ role: 'coordinator', status: null }), heading: 'Account pending approval' },
  { name: 'admin with unrecognised status', outcome: HELD, row: profileRow({ role: 'admin', status: 'superuser' }), heading: 'Account pending approval' },

  // Approved: the Hub opens, and the navigation reflects the role.
  { name: 'active member', outcome: ALLOWED, row: profileRow({ status: 'active' }), memberTab: false },
  { name: 'active admin', outcome: ALLOWED, row: profileRow({ role: 'admin', status: 'active' }), memberTab: true },
  { name: 'active coordinator', outcome: ALLOWED, row: profileRow({ role: 'coordinator', status: 'active' }), memberTab: true },
  { name: 'active member with unrecognised role', outcome: ALLOWED, row: profileRow({ role: 'superuser', status: 'active' }), memberTab: false },
  { name: 'active member with missing role', outcome: ALLOWED, row: profileRow({ role: undefined, status: 'active' }), memberTab: false },
];

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByLabel('Email').fill('leader@yorku.ca');
  await page.getByLabel('Password').fill('secret1');
  await page.getByRole('button', { name: 'Sign In' }).click();
}

function runSuite(viewportName: string, viewport: { width: number; height: number }) {
  // The role-gated control differs by layout: desktop shows the sidebar Admin section; the mobile bottom bar has a
  // Members tab for leaders. (The dashboard also has a "Members" card, so a bare name match is not a signal.)
  const roleControl = (page: Page) =>
    viewport.width >= 768
      ? page.getByRole('button', { name: 'Admin', exact: true })
      : page.locator('button[aria-label="Members"]');

  test.describe(`approval gate (${viewportName})`, () => {
    test.use({ viewport });

    test.beforeEach(async ({ page }) => {
      await mockSupabase(page);
    });

    for (const c of cases) {
      if (c.outcome === HELD) {
        test(`holds ${c.name} outside the Hub (${viewportName})`, async ({ page }) => {
          await mockProfile(page, { kind: 'row', profile: c.row });
          await signIn(page);

          await expect(page.getByRole('heading', { name: c.heading })).toBeVisible();
          await expect(page.getByRole('button', { name: 'Sign Out' })).toBeVisible();
          await expect(page.getByRole('heading', { name: /Good to see you/i })).toHaveCount(0);
          await expect(page.getByRole('button', { name: 'Members', exact: true })).toHaveCount(0);

          // Deep links are held too: the gate sits above the router.
          await page.goto('/admin');
          await expect(page.getByRole('heading', { name: c.heading })).toBeVisible();
          await expect(page.getByRole('heading', { name: /Good to see you/i })).toHaveCount(0);
        });
      } else {
        test(`admits ${c.name} into the Hub (${viewportName})`, async ({ page }) => {
          await mockProfile(page, { kind: 'row', profile: c.row });
          await signIn(page);

          await expect(page.getByRole('heading', { name: /Good to see you, Taylor\./i })).toBeVisible();
          await expect(page.getByRole('heading', { name: /Account pending approval/i })).toHaveCount(0);
          if (c.memberTab) {
            await expect(roleControl(page)).toBeVisible();
          } else {
            await expect(roleControl(page)).toHaveCount(0);
          }
        });
      }
    }

    test(`a missing profile record shows the sign-in error, not the Hub (${viewportName})`, async ({ page }) => {
      await mockProfile(page, { kind: 'missing' });
      await signIn(page);

      // useAuth reports a failed profile load with its generic message, because a PostgREST error is not an Error instance.
      await expect(page.getByRole('alert')).toHaveText('Failed to load profile.');
      await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible();
      await expect(page.getByRole('heading', { name: /Good to see you/i })).toHaveCount(0);
    });
  });
}

runSuite('desktop 1280x800', { width: 1280, height: 800 });
runSuite('mobile 375x812', { width: 375, height: 812 });
