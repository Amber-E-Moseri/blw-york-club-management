import { expect, test, type Page, type Route } from '@playwright/test';
import { mockSupabase } from './supabaseMock';

// Announcements on the authoritative line, at phone and desktop widths. The browser runs the page's real requests
// (filters, keyset ordering, PATCH, DELETE, POST), answered by an in-memory store in this file. That proves the UI and
// the request shapes. It does not prove the database rules: those are certified by
// supabase/verification/announcements_port_rls_certification.sql against real PostgreSQL.

type Store = {
  rows: Row[];
  failLoads: boolean;
  refuseWrites: boolean;
  patches: Array<{ id: string; body: Record<string, unknown> }>;
  deletes: string[];
  inserts: Array<Record<string, unknown>>;
};

type Row = {
  id: string;
  title: string;
  body: string;
  author_id: string;
  author_name: string;
  created_at: string;
  audience_spec_id: string | null;
  is_active: boolean;
  published_at: string | null;
};

type Role = 'admin' | 'coordinator' | 'cell_leader' | 'member';
type Status = 'active' | 'pending' | 'inactive' | 'rejected';

const ME = 'e2e-user';
const TARGET_SPEC = '00000000-0000-4000-8000-00000000f001';
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, prefer, accept-profile',
  'access-control-allow-methods': 'GET,HEAD,POST,PATCH,DELETE,OPTIONS',
};

const pad = (n: number) => String(n).padStart(2, '0');
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Row n is newer than row n-1. Timestamps use PostgREST's "+00:00" form, which contains a plus sign. */
function makeRows(count: number, opts: { authorId?: string; spec?: string | null } = {}): Row[] {
  return Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    return {
      id: uuid(n),
      title: `Post ${pad(n)}`,
      body: `Body ${pad(n)}`,
      author_id: opts.authorId ?? ME,
      author_name: 'Jordan Leader',
      created_at: new Date(Date.UTC(2026, 8, 1, 10) + n * 60_000).toISOString().replace('Z', '+00:00'),
      audience_spec_id: opts.spec === undefined ? TARGET_SPEC : opts.spec,
      is_active: true,
      published_at: new Date(Date.UTC(2026, 8, 1, 10) + n * 60_000).toISOString().replace('Z', '+00:00'),
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

async function mount(page: Page, opts: { role: Role; status?: Status; leads?: boolean; rows: Row[] }): Promise<Store> {
  const { role, status = 'active', leads = false, rows } = opts;
  const store: Store = { rows, failLoads: false, refuseWrites: false, patches: [], deletes: [], inserts: [] };
  await mockSupabase(page);

  const profile = {
    id: ME,
    email: 'leader@yorku.ca',
    full_name: 'Jordan Leader',
    role,
    status,
    cell_id: null,
    admin_role: null,
    joined_at: '2026-01-01T00:00:00.000Z',
  };
  const ledCells = leads ? [{ id: 'cell-1', name: 'Cell One', leader_id: ME, archived_at: null }] : [];

  await page.route('**/rest/v1/profiles*', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'GET' || url.searchParams.get('id') !== `eq.${ME}`) return route.fallback();
    return json(route, 200, profile);
  });

  await page.route('**/rest/v1/cells*', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const url = new URL(route.request().url());
    if (url.searchParams.get('leader_id') === `eq.${ME}`) {
      return json(route, 200, ledCells.map((c) => ({ id: c.id })));
    }
    return json(route, 200, ledCells);
  });

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
        audience_spec_id: (body.audience_spec_id as string | null) ?? null,
        is_active: true,
        published_at: new Date().toISOString().replace('Z', '+00:00'),
      };
      store.rows.push(row);
      return json(route, 201, { id: row.id });
    }

    return route.fallback();
  });

  return store;
}

async function signInAndOpen(page: Page) {
  await page.goto('/');
  await page.getByLabel('Email').fill('leader@yorku.ca');
  await page.getByLabel('Password').fill('secret1');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.goto('/announcements');
  await expect(page.getByRole('heading', { name: 'Announcements' })).toBeVisible();
}

function cardTitles(page: Page) {
  return page.locator('div.py-3 p.text-small.font-bold');
}

function editButton(page: Page, title: string) {
  return page.getByRole('button', { name: `Edit announcement: ${title}` });
}

function deleteButton(page: Page, title: string) {
  return page.getByRole('button', { name: `Delete announcement: ${title}` });
}

function suite(width: { name: string; viewport: { width: number; height: number } }) {
  test.describe(width.name, () => {
    test.use({ viewport: width.viewport });

    test('an admin sees Edit and Delete on every post, broadcasts included', async ({ page }) => {
      const broadcast = makeRows(3, { spec: null }).slice(2);
      await mount(page, { role: 'admin', rows: [...makeRows(2, { authorId: 'someone' }), ...broadcast] });
      await signInAndOpen(page);
      for (const title of ['Post 01', 'Post 02', 'Post 03']) {
        await expect(editButton(page, title)).toBeVisible();
        await expect(deleteButton(page, title)).toBeVisible();
      }
    });

    test('a cell leader sees Edit and Delete only on their own targeted posts', async ({ page }) => {
      const rows = [
        ...makeRows(1, { authorId: ME }),
        ...makeRows(1, { authorId: 'someone-else' }).map((r) => ({ ...r, id: uuid(50), title: 'Other leader post' })),
        ...makeRows(1, { authorId: ME, spec: null }).map((r) => ({ ...r, id: uuid(51), title: 'My broadcast' })),
      ];
      await mount(page, { role: 'cell_leader', leads: true, rows });
      await signInAndOpen(page);

      await expect(editButton(page, 'Post 01')).toBeVisible();
      await expect(deleteButton(page, 'Post 01')).toBeVisible();
      await expect(editButton(page, 'Other leader post')).toHaveCount(0);
      await expect(deleteButton(page, 'Other leader post')).toHaveCount(0);
      await expect(editButton(page, 'My broadcast')).toHaveCount(0);
      await expect(page.getByRole('button', { name: '+ New' })).toBeVisible();
    });

    test('a member sees the posts but no composer and no manage controls', async ({ page }) => {
      await mount(page, { role: 'member', rows: makeRows(2, { spec: null }) });
      await signInAndOpen(page);
      await expect(cardTitles(page)).toHaveCount(2);
      await expect(page.getByRole('button', { name: '+ New' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /^Edit announcement/ })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /^Delete announcement/ })).toHaveCount(0);
    });

    test('a pending account does not reach the list', async ({ page }) => {
      await mount(page, { role: 'cell_leader', status: 'pending', leads: true, rows: makeRows(2) });
      await page.goto('/');
      await page.getByLabel('Email').fill('leader@yorku.ca');
      await page.getByLabel('Password').fill('secret1');
      await page.getByRole('button', { name: 'Sign In' }).click();
      await page.goto('/announcements');
      await expect(page.getByRole('heading', { name: 'Announcements' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /^Edit announcement/ })).toHaveCount(0);
    });

    test('an empty list shows a message, with a hint for the composer', async ({ page }) => {
      await mount(page, { role: 'admin', rows: [] });
      await signInAndOpen(page);
      await expect(page.getByText('No announcements yet.')).toBeVisible();
      await expect(page.getByText('Use + New to post the first one.')).toBeVisible();
    });

    test('a failed load shows an error, and Retry recovers', async ({ page }) => {
      const store = await mount(page, { role: 'member', rows: makeRows(3, { spec: null }) });
      store.failLoads = true;
      await signInAndOpen(page);

      await expect(page.getByRole('alert')).toContainText('Announcements could not be loaded.');
      await expect(page.getByText('Database unavailable')).toHaveCount(0);

      store.failLoads = false;
      await page.getByRole('button', { name: 'Retry' }).click();
      await expect(page.getByRole('alert')).toHaveCount(0);
      await expect(cardTitles(page)).toHaveCount(3);
    });

    test('edit prefills the form, keeps the audience, and sends only title and body', async ({ page }) => {
      const store = await mount(page, { role: 'admin', rows: makeRows(3) });
      await signInAndOpen(page);

      await editButton(page, 'Post 03').click();
      await expect(page.getByRole('heading', { name: 'Edit announcement' })).toBeVisible();
      await expect(page.getByLabel('Title')).toHaveValue('Post 03');
      await expect(page.getByLabel('Message')).toHaveValue('Body 03');
      await expect(page.getByText('The audience cannot be changed after posting.')).toBeVisible();
      await expect(page.getByText('Who should read this')).toHaveCount(0);

      await page.getByLabel('Title').fill('Post 03 edited');
      await page.getByRole('button', { name: 'Save changes' }).click();

      await expect(page.getByRole('status')).toContainText('Announcement updated.');
      await expect(page.getByRole('heading', { name: 'Edit announcement' })).toHaveCount(0);
      await expect(page.getByText('Post 03 edited')).toBeVisible();
      await expect(page.getByText('Post 02', { exact: true })).toBeVisible();

      expect(store.patches).toEqual([{ id: uuid(3), body: { title: 'Post 03 edited', body: 'Body 03' } }]);
      expect(store.rows.find((r) => r.id === uuid(3))?.audience_spec_id).toBe(TARGET_SPEC);
      expect(store.rows.find((r) => r.id === uuid(2))?.title).toBe('Post 02');
    });

    test('a refused edit keeps the form open with the error', async ({ page }) => {
      const store = await mount(page, { role: 'admin', rows: makeRows(2) });
      await signInAndOpen(page);
      store.refuseWrites = true;

      await editButton(page, 'Post 02').click();
      await page.getByLabel('Title').fill('Changed');
      await page.getByRole('button', { name: 'Save changes' }).click();

      await expect(page.getByRole('alert')).toContainText('was not saved');
      await expect(page.getByLabel('Title')).toHaveValue('Changed');
      expect(store.rows.find((r) => r.id === uuid(2))?.title).toBe('Post 02');
    });

    test('delete asks first, and Keep leaves everything alone', async ({ page }) => {
      const store = await mount(page, { role: 'admin', rows: makeRows(3) });
      await signInAndOpen(page);

      await deleteButton(page, 'Post 03').click();
      await expect(page.getByRole('heading', { name: 'Delete this announcement?' })).toBeVisible();
      await page.getByRole('button', { name: 'Keep announcement' }).click();

      await expect(page.getByRole('heading', { name: 'Delete this announcement?' })).toHaveCount(0);
      expect(store.deletes).toHaveLength(0);
      await expect(cardTitles(page)).toHaveCount(3);
    });

    test('a confirmed delete removes only the selected post and refreshes', async ({ page }) => {
      const store = await mount(page, { role: 'admin', rows: makeRows(3) });
      await signInAndOpen(page);

      await deleteButton(page, 'Post 02').click();
      await page.getByRole('button', { name: 'Delete', exact: true }).click();

      await expect(page.getByRole('status')).toContainText('Announcement deleted.');
      await expect(cardTitles(page)).toHaveCount(2);
      await expect(page.getByText('Post 02', { exact: true })).toHaveCount(0);
      await expect(page.getByText('Post 03', { exact: true })).toBeVisible();
      expect(store.deletes).toEqual([uuid(2)]);
      expect(store.rows.map((r) => r.id).sort()).toEqual([uuid(1), uuid(3)].sort());
    });

    test('a refused delete shows a useful error and keeps the dialog open', async ({ page }) => {
      const store = await mount(page, { role: 'admin', rows: makeRows(2) });
      await signInAndOpen(page);
      store.refuseWrites = true;

      await deleteButton(page, 'Post 02').click();
      await page.getByRole('button', { name: 'Delete', exact: true }).click();

      await expect(page.getByRole('alert')).toContainText('was not deleted');
      await expect(page.getByRole('heading', { name: 'Delete this announcement?' })).toBeVisible();
      await expect(cardTitles(page)).toHaveCount(2);
    });

    test('lists beyond 20 use Load more, with no gaps or duplicates', async ({ page }) => {
      await mount(page, { role: 'member', rows: makeRows(45, { spec: null }) });
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

    test('a failed Load more keeps the loaded rows, and Retry recovers', async ({ page }) => {
      const store = await mount(page, { role: 'member', rows: makeRows(25, { spec: null }) });
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

    test('the unread dot is gone', async ({ page }) => {
      await mount(page, { role: 'member', rows: makeRows(2, { spec: null }) });
      await signInAndOpen(page);
      await expect(cardTitles(page)).toHaveCount(2);
      await expect(page.locator('span.h-2.w-2.rounded-full')).toHaveCount(0);
    });

    test('an admin posts a broadcast, with no audience record created', async ({ page }) => {
      const store = await mount(page, { role: 'admin', rows: makeRows(1) });
      await signInAndOpen(page);

      await page.getByRole('button', { name: '+ New' }).click();
      await page.getByLabel('Title').fill('Everyone');
      await page.getByLabel('Message').fill('Body');
      await page.getByRole('button', { name: 'Post Announcement' }).click();

      await expect(cardTitles(page).first()).toHaveText('Everyone');
      expect(store.inserts[0]).toMatchObject({ title: 'Everyone', author_id: ME, audience_spec_id: null });
    });

    test('the list and actions fit the width without horizontal scrolling', async ({ page }) => {
      await mount(page, { role: 'admin', rows: makeRows(3) });
      await signInAndOpen(page);
      await expect(cardTitles(page)).toHaveCount(3);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });
}

suite({ name: 'desktop 1280x800', viewport: { width: 1280, height: 800 } });
suite({ name: 'mobile 375x812', viewport: { width: 375, height: 812 } });
