/* eslint-disable testing-library/prefer-screen-queries -- Playwright `page` fixtures, not RTL render results */
import { expect, test, type Page } from '@playwright/test';
import { mockSupabase } from './supabaseMock';

// Leader pages follow the cell assignment (cells.leader_id), not the profile role. A cell_leader account with no
// assignment must see none of the leader pages and must not reach them by direct address. An assigned leader sees them.

const LEADER_PAGES = ['People', 'Cells', 'Outreach'];

async function signIn(page: Page, leadsCell: boolean) {
  await mockSupabase(page, { role: 'cell_leader', leadsCell });
  await page.goto('/hub');
  await page.getByLabel('Email').fill('leader@yorku.ca');
  await page.getByLabel('Password').fill('secret1');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.getByRole('main')).toBeVisible();
}

test.describe('leader pages follow the cell assignment', () => {
  test('a cell_leader role with no assignment sees no leader pages in the sidebar', async ({ page }) => {
    await signIn(page, false);
    const sidebar = page.getByRole('navigation', { name: 'Main navigation' });
    for (const label of LEADER_PAGES) {
      await expect(sidebar.getByRole('button', { name: label, exact: true })).toHaveCount(0);
    }
  });

  test('a cell_leader role with no assignment is redirected from a leader page by direct address', async ({ page }) => {
    await signIn(page, false);
    await page.goto('/hub/members');
    await expect(page).toHaveURL(/\/hub\/?$/);
  });

  test('an assigned cell leader sees the leader pages', async ({ page }) => {
    await signIn(page, true);
    const sidebar = page.getByRole('navigation', { name: 'Main navigation' });
    for (const label of LEADER_PAGES) {
      await expect(sidebar.getByRole('button', { name: label, exact: true })).toHaveCount(1);
    }
  });
});
