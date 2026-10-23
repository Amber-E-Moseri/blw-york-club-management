import { expect, test, type Page, type Route } from '@playwright/test';
import { mockSupabase, type MockRole } from './supabaseMock';

// Announcements UI at phone and desktop widths. The Supabase REST calls are answered by an in-memory store in
// this file, so the page's real requests (filters, ordering, PATCH, DELETE) are exercised. This proves the UI
// and the request shapes; it does not prove the database rules. The RLS rules are certified separately by
// supabase/verification/announcements_rls_certification.sql.

type Row = {
  id: string;
  title: string;
  body: string;
  author_id: string;
  author_name: string;
  created_at: string;
};

type Store = {
  rows: Row[];
  /** While true, list requests fail. A flag rather than a counter, because StrictMode runs effects twice in development. */
  failLoads: boolean;
  refuseWrites: boolean;
  patches: Array<{ id: string; body: Record<string, unknown> }>;
  deletes: string[];
  inserts: Array<Record<string, unknown>>;
};

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, prefer, accept-profile',
  'access-control-allow-methods': 'GET,HEAD,POST,PATCH,DELETE,OPTIONS',
};

const pad = (n: number) => String(n).padStart(2, '0');
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Row n is newer than row n-1. Timestamps use PostgREST's "+00:00" form, which contains a plus sign. */
function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    return {
      id: uuid(n),
      title: `Post ${pad(n)}`,
      body: `Body ${pad(n)}`,
      author_id: 'e2e-user',
      author_name: 'Jordan Leader',
      created_at: new Date(Date.UTC(2026, 8, 1, 10) + n * 60_000).toISOString().replace('Z', '+00:00'),
    };
  });
}

const newestFirst = (a: Row, b: Row) => {
  const ta = Date.parse(a.created_at);
  const tb = Date.parse(b.created_at);
  if (ta !== tb) return tb - ta;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
};

/** Applies the keyset filter the page sends: rows strictly after (created_at, id), newest first, then limit. */
function selectRows(rows: Row[], orValue: string | null, limit: number): Row[] {
  let eligible = rows;
  if (orValue) {
    const lt = /created_at\.lt\."([^"]+)"/.exec(orValue);
    const eq = /created_at\.eq\."([^"]+)"/.exec(orValue);
    const idLt = /id\.lt\.([0-9a-f-]+)\)/.exec(orValue);
    if (!lt || !eq || lt[1] !== eq[1] || !idLt) throw new Error(`Unexpected keyset filter: ${orValue}`);
    const t = Date.parse(lt[1]);
    const cursorId = idLt[1];
    eligible = rows.filter((r) => {
      const rt = Date.parse(r.created_at);
      return rt < t || (rt === t && r.id < cursorId);
    });
  }
  return [...eligible].sort(newestFirst).slice(0, limit);
}

function json(route: Route, status: number, body: unknown) {
  return route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
}

type AccountStatus = 'active' | 'pending' | 'inactive' | 'rejected';

async function setup(page: Page, role: MockRole, rows: Row[], status: AccountStatus = 'active'): Promise<Store> {
  const store: Store = { rows, failLoads: false, refuseWrites: false, patches: [], deletes: [], inserts: [] };
  await mockSupabase(page, { role });

  // The mock always reports an active profile. For other statuses, answer the signed-in profile lookup with the
  // requested status, so the app sees the same account state the database would.
  if (status !== 'active') {
    await page.route('**/rest/v1/profiles*', async (route) => {
      const url = new URL(route.request().url());
      if (route.request().method() !== 'GET' || url.searchParams.get('id') !== 'eq.e2e-user') return route.fallback();
      return json(route, 200, {
        id: 'e2e-user',
        email: 'leader@yorku.ca',
        full_name: 'Jordan Leader',
        role,
        status,
        cell_id: null,
        admin_role: null,
        joined_at: '2026-01-01T00:00:00.000Z',
      });
    });
  }

  await page.route('**/rest/v1/announcements*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') return route.fallback();

    if (request.method() === 'GET' && url.searchParams.get('select') === '*') {
      if (store.failLoads) return json(route, 500, { message: 'Database unavailable' });
      const limit = Number(url.searchParams.get('limit') ?? '1000');
      return json(route, 200, selectRows(store.rows, url.searchParams.get('or'), limit));
    }

    const id = (url.searchParams.get('id') ?? '').replace(/^eq\./, '');
    if (request.method() === 'PATCH') {
      const body = request.postDataJSON() as Record<string, unknown>;
      store.patches.push({ id, body });
      const index = store.rows.findIndex((r) => r.id === id);
      if (store.refuseWrites || index < 0) return json(route, 200, []);
      store.rows[index] = { ...store.rows[index], ...body } as Row;
      return json(route, 200, [store.rows[index]]);
    }

    if (request.method() === 'DELETE') {
      store.deletes.push(id);
      const index = store.rows.findIndex((r) => r.id === id);
      if (store.refuseWrites || index < 0) return json(route, 200, []);
      store.rows.splice(index, 1);
      return json(route, 200, [{ id }]);
    }

    if (request.method() === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>;
      store.inserts.push(body);
      const row: Row = {
        id: uuid(900 + store.inserts.length),
        title: String(body.title),
        body: String(body.body),
        author_id: String(body.author_id),
        author_name: String(body.author_name),
        created_at: new Date().toISOString().replace('Z', '+00:00'),
      };
      store.rows.push(row);
      return json(route, 201, { id: row.id });
    }

    return route.fallback();
  });

  await page.route('**/functions/v1/notify-announcement', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fallback();
    return json(route, 200, { recipients: 0, devices: 0, sent: 0, failed: 0, expired: 0 });
  });

  return store;
}

async function signInAndOpen(page: Page) {
  await page.goto('/');
  await page.getByLabel('Email').fill('leader@yorku.ca');
  await page.getByLabel('Password').fill('secret1');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.getByRole('heading', { name: /Good to see you/i })).toBeVisible();
  await page.goto('/announcements');
  await expect(page.getByRole('heading', { name: 'Announcements' })).toBeVisible();
}

function cardTitles(page: Page) {
  return page.locator('div.py-3 p.text-small.font-bold');
}

function registerAnnouncementTests(width: { name: string; viewport: { width: number; height: number } }) {
  test.describe(width.name, () => {
    test.use({ viewport: width.viewport });

    test('empty list shows a helpful message to a member', async ({ page }) => {
      await setup(page, 'member', []);
      await signInAndOpen(page);
      await expect(page.getByText('No announcements yet.')).toBeVisible();
      await expect(page.getByText('Announcements from club leaders will appear here.')).toBeVisible();
    });

    test('empty list points a leader to the composer', async ({ page }) => {
      await setup(page, 'admin', []);
      await signInAndOpen(page);
      await expect(page.getByText('Use + New to post the first one.')).toBeVisible();
    });

    test('a failed load shows an error and Retry recovers', async ({ page }) => {
      const store = await setup(page, 'member', makeRows(3));
      store.failLoads = true;
      await signInAndOpen(page);

      await expect(page.getByRole('alert')).toContainText('Announcements could not be loaded.');
      await expect(page.getByText('Database unavailable')).toHaveCount(0);

      store.failLoads = false;
      await page.getByRole('button', { name: 'Retry' }).click();
      await expect(page.getByRole('alert')).toHaveCount(0);
      await expect(cardTitles(page)).toHaveCount(3);
    });

    test('members see announcements but no edit or delete controls', async ({ page }) => {
      await setup(page, 'member', makeRows(2));
      await signInAndOpen(page);
      await expect(cardTitles(page)).toHaveCount(2);
      await expect(page.getByRole('button', { name: /^Edit announcement/ })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /^Delete announcement/ })).toHaveCount(0);
      await expect(page.getByRole('button', { name: '+ New' })).toHaveCount(0);
    });

    test('the misleading unread dot is gone', async ({ page }) => {
      await setup(page, 'member', makeRows(2));
      await signInAndOpen(page);
      await expect(cardTitles(page)).toHaveCount(2);
      await expect(page.locator('span.h-2.w-2.rounded-full')).toHaveCount(0);
    });

    test('a leader posts an announcement and it appears at the top', async ({ page }) => {
      const store = await setup(page, 'admin', makeRows(2));
      await signInAndOpen(page);

      await page.getByRole('button', { name: '+ New' }).click();
      await page.getByLabel('Title').fill('Brand new');
      await page.getByLabel('Message').fill('Fresh body');
      await page.getByRole('checkbox', { name: /Send a push notification/i }).uncheck();
      await page.getByRole('button', { name: 'Post Announcement' }).click();

      await expect(cardTitles(page).first()).toHaveText('Brand new');
      expect(store.inserts).toHaveLength(1);
      expect(store.inserts[0]).toMatchObject({ title: 'Brand new', body: 'Fresh body', author_id: 'e2e-user' });
    });

    test('edit prefills the form and saves only the one announcement', async ({ page }) => {
      const store = await setup(page, 'admin', makeRows(3));
      await signInAndOpen(page);

      await page.getByRole('button', { name: 'Edit announcement: Post 03' }).click();
      await expect(page.getByRole('heading', { name: 'Edit announcement' })).toBeVisible();
      await expect(page.getByLabel('Title')).toHaveValue('Post 03');
      await expect(page.getByLabel('Message')).toHaveValue('Body 03');
      await expect(page.getByText('Saving changes does not send a new notification.')).toBeVisible();
      await expect(page.getByRole('checkbox', { name: /Send a push notification/i })).toHaveCount(0);

      await page.getByLabel('Title').fill('Post 03 edited');
      await page.getByRole('button', { name: 'Save changes' }).click();

      await expect(page.getByRole('status')).toContainText('Announcement updated.');
      await expect(page.getByRole('heading', { name: 'Edit announcement' })).toHaveCount(0);
      await expect(page.getByText('Post 03 edited')).toBeVisible();
      await expect(page.getByText('Post 02', { exact: true })).toBeVisible();
      await expect(page.getByText('Post 01', { exact: true })).toBeVisible();

      expect(store.patches).toEqual([{ id: uuid(3), body: { title: 'Post 03 edited', body: 'Body 03' } }]);
      expect(store.rows.find((r) => r.id === uuid(2))?.title).toBe('Post 02');
    });

    test('a refused edit keeps the form open with the error', async ({ page }) => {
      const store = await setup(page, 'admin', makeRows(2));
      await signInAndOpen(page);
      store.refuseWrites = true;

      await page.getByRole('button', { name: 'Edit announcement: Post 02' }).click();
      await page.getByLabel('Title').fill('Changed');
      await page.getByRole('button', { name: 'Save changes' }).click();

      await expect(page.getByRole('alert')).toContainText('was not saved');
      await expect(page.getByLabel('Title')).toHaveValue('Changed');
      expect(store.rows.find((r) => r.id === uuid(2))?.title).toBe('Post 02');
    });

    test('delete asks first, and Keep leaves everything alone', async ({ page }) => {
      const store = await setup(page, 'admin', makeRows(3));
      await signInAndOpen(page);

      await page.getByRole('button', { name: 'Delete announcement: Post 03' }).click();
      await expect(page.getByRole('heading', { name: 'Delete this announcement?' })).toBeVisible();
      await expect(page.getByText('Post 03', { exact: false }).first()).toBeVisible();
      await page.getByRole('button', { name: 'Keep announcement' }).click();

      await expect(page.getByRole('heading', { name: 'Delete this announcement?' })).toHaveCount(0);
      expect(store.deletes).toHaveLength(0);
      await expect(cardTitles(page)).toHaveCount(3);
    });

    test('confirmed delete removes only the selected announcement and refreshes', async ({ page }) => {
      const store = await setup(page, 'admin', makeRows(3));
      await signInAndOpen(page);

      await page.getByRole('button', { name: 'Delete announcement: Post 02' }).click();
      await page.getByRole('button', { name: 'Delete', exact: true }).click();

      await expect(page.getByRole('status')).toContainText('Announcement deleted.');
      await expect(page.getByRole('heading', { name: 'Delete this announcement?' })).toHaveCount(0);
      await expect(cardTitles(page)).toHaveCount(2);
      await expect(page.getByText('Post 02', { exact: true })).toHaveCount(0);
      await expect(page.getByText('Post 03', { exact: true })).toBeVisible();
      await expect(page.getByText('Post 01', { exact: true })).toBeVisible();

      expect(store.deletes).toEqual([uuid(2)]);
      expect(store.rows.map((r) => r.id).sort()).toEqual([uuid(1), uuid(3)].sort());
    });

    test('a refused delete shows a useful error and keeps the dialog open', async ({ page }) => {
      const store = await setup(page, 'admin', makeRows(2));
      await signInAndOpen(page);
      store.refuseWrites = true;

      await page.getByRole('button', { name: 'Delete announcement: Post 02' }).click();
      await page.getByRole('button', { name: 'Delete', exact: true }).click();

      await expect(page.getByRole('alert')).toContainText('was not deleted');
      await expect(page.getByRole('heading', { name: 'Delete this announcement?' })).toBeVisible();
      await expect(cardTitles(page)).toHaveCount(2);
    });

    test('lists beyond 20 use Load more, with no gaps or duplicates', async ({ page }) => {
      await setup(page, 'member', makeRows(45));
      await signInAndOpen(page);

      await expect(cardTitles(page)).toHaveCount(20);
      await expect(cardTitles(page).first()).toHaveText('Post 45');

      await page.getByRole('button', { name: 'Load more' }).click();
      await expect(cardTitles(page)).toHaveCount(40);

      await page.getByRole('button', { name: 'Load more' }).click();
      await expect(cardTitles(page)).toHaveCount(45);
      await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);

      const titles = await cardTitles(page).allTextContents();
      expect(new Set(titles).size).toBe(45);
      expect(titles[44]).toBe('Post 01');
    });

    test('a failed Load more keeps the loaded rows and Retry recovers', async ({ page }) => {
      const store = await setup(page, 'member', makeRows(25));
      await signInAndOpen(page);
      await expect(cardTitles(page)).toHaveCount(20);
      store.failLoads = true;

      await page.getByRole('button', { name: 'Load more' }).click();
      await expect(page.getByRole('alert')).toContainText('More announcements could not be loaded.');
      await expect(cardTitles(page)).toHaveCount(20);

      store.failLoads = false;
      await page.getByRole('alert').getByRole('button', { name: 'Retry' }).click();
      await expect(cardTitles(page)).toHaveCount(25);
    });

    test('a new post does not duplicate rows already shown', async ({ page }) => {
      const store = await setup(page, 'admin', makeRows(25));
      await signInAndOpen(page);
      await page.getByRole('button', { name: 'Load more' }).click();
      await expect(cardTitles(page)).toHaveCount(25);

      await page.getByRole('button', { name: '+ New' }).click();
      await page.getByLabel('Title').fill('Newest');
      await page.getByLabel('Message').fill('Body');
      await page.getByRole('checkbox', { name: /Send a push notification/i }).uncheck();
      await page.getByRole('button', { name: 'Post Announcement' }).click();

      await expect(cardTitles(page).first()).toHaveText('Newest');
      const titles = await cardTitles(page).allTextContents();
      expect(new Set(titles).size).toBe(titles.length);
      expect(store.inserts).toHaveLength(1);
    });

    test('the list and actions fit the width without horizontal scrolling', async ({ page }) => {
      await setup(page, 'admin', makeRows(3));
      await signInAndOpen(page);
      await expect(cardTitles(page)).toHaveCount(3);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });

    test('the Personal Messages tab is unchanged', async ({ page }) => {
      await setup(page, 'member', []);
      await page.goto('/');
      await page.getByLabel('Email').fill('leader@yorku.ca');
      await page.getByLabel('Password').fill('secret1');
      await page.getByRole('button', { name: 'Sign In' }).click();
      await expect(page.getByRole('heading', { name: /Good to see you/i })).toBeVisible();
      await page.goto('/messages');
      await page.getByRole('button', { name: /my messages/i }).first().click();
      // The label on main; this PR does not change Personal Messages.
      await expect(page.getByRole('button', { name: '+ Personal Note' }).first()).toBeVisible();
    });

    ownershipTests(width.name);
  });
}

function ownershipRows(): Row[] {
  // Rows 1 and 3 were written by the signed-in leader ('e2e-user'); rows 2 and 4 by someone else.
  return makeRows(4).map((r, i) => (i % 2 === 0 ? r : { ...r, author_id: 'someone-else', author_name: 'Sam Other' }));
}

function ownershipTests(width: string) {
  test.describe(`cell leader ownership ${width}`, () => {
    test('a cell leader sees Edit and Delete only on their own posts', async ({ page }) => {
      await setup(page, 'cell_leader', ownershipRows());
      await signInAndOpen(page);

      await expect(page.getByRole('button', { name: 'Edit announcement: Post 01' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Delete announcement: Post 01' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Edit announcement: Post 03' })).toBeVisible();

      await expect(page.getByRole('button', { name: 'Edit announcement: Post 02' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Delete announcement: Post 02' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Edit announcement: Post 04' })).toHaveCount(0);
    });

    test('a cell leader can post, and the post is attributed to them', async ({ page }) => {
      const store = await setup(page, 'cell_leader', ownershipRows());
      await signInAndOpen(page);

      await page.getByRole('button', { name: '+ New' }).click();
      await page.getByLabel('Title').fill('Leader post');
      await page.getByLabel('Message').fill('Body');
      await page.getByRole('checkbox', { name: /Send a push notification/i }).uncheck();
      await page.getByRole('button', { name: 'Post Announcement' }).click();

      await expect(cardTitles(page).first()).toHaveText('Leader post');
      expect(store.inserts[0]).toMatchObject({ author_id: 'e2e-user' });
    });

    // The app holds pending and rejected accounts at a gate after sign-in, so they never reach the list. The
    // database also refuses their writes; announcements_rls_certification.sql certifies that separately.
    for (const status of ['pending', 'rejected'] as const) {
      test(`a ${status} cell leader cannot reach announcements or their manage controls`, async ({ page }) => {
        await setup(page, 'cell_leader', ownershipRows(), status);
        await page.goto('/');
        await page.getByLabel('Email').fill('leader@yorku.ca');
        await page.getByLabel('Password').fill('secret1');
        await page.getByRole('button', { name: 'Sign In' }).click();
        await expect(page.getByRole('heading', { name: 'Good to see you', exact: false })).toHaveCount(0);

        await page.goto('/announcements');
        await expect(page.getByRole('heading', { name: 'Announcements' })).toHaveCount(0);
        await expect(page.getByRole('button', { name: '+ New' })).toHaveCount(0);
        await expect(page.getByRole('button', { name: /^Edit announcement/ })).toHaveCount(0);
        await expect(page.getByRole('button', { name: /^Delete announcement/ })).toHaveCount(0);
        await expect(page.getByText('Post 01', { exact: true })).toHaveCount(0);
      });
    }
  });
}

registerAnnouncementTests({ name: 'desktop 1280x800', viewport: { width: 1280, height: 800 } });
registerAnnouncementTests({ name: 'mobile 375x812', viewport: { width: 375, height: 812 } });
