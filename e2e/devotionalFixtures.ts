/* eslint-disable testing-library/prefer-screen-queries -- Playwright `page` fixtures, not RTL render results */
import { expect, type Page, type Route } from '@playwright/test';
import { mockSupabase, type MockRole } from './supabaseMock';

// Shared fixtures for the Daily Bread reader specs. All data is fictional and served by route
// interception, so no request reaches a real Supabase project.

export const MEMBER_ID = 'e2e-user';
export const DEVOTIONAL_ID = 'devo-oct-2026';

export const devotional = {
  id: DEVOTIONAL_ID,
  month: 10,
  year: 2026,
  title: 'Test Devotional',
  book_title: 'Rhapsody of Realities',
  author: null,
  total_days: 31,
  total_pages: 62,
  created_by: 'e2e-user',
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
};

export const pages = Array.from({ length: 31 }, (_, i) => ({
  id: `page-${i + 1}`,
  devotional_id: DEVOTIONAL_ID,
  day_of_month: i + 1,
  page_range: `${42 + i * 2}–${43 + i * 2}`,
  image_url: `https://e2e-mock.invalid/scans/day-${i + 1}.svg`,
  title: i + 1 === 19 ? 'His Triumph Over Darkness' : null,
  created_at: '2026-10-01T00:00:00.000Z',
}));

// Fictional two-page scan (synthetic text only), served as SVG so the test has no binary fixture.
const scanSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="800">
<rect width="1600" height="800" fill="#fbf8f2"/><rect x="800" y="0" width="2" height="800" fill="#d9d2c5"/>
${[0, 1].map((p) => `<g transform="translate(${p * 800},0)"><text x="90" y="110" font-family="Georgia,serif" font-size="46" fill="#222">Test fixture page ${42 + p}</text>${Array.from({ length: 14 }, (_, i) => `<rect x="90" y="${180 + i * 38}" width="${620 - (i % 4) * 60}" height="14" fill="#3a3a3a" opacity="0.75"/>`).join('')}</g>`).join('')}
</svg>`;

export interface Options {
  role?: MockRole;
  /** Days already read this month (ISO dates and day numbers). */
  readDays?: number[];
  /** Make Mark as read fail. */
  failMarkRead?: boolean;
  /** Make the streak RPC fail. */
  failStreak?: boolean;
}

export interface Recorder {
  markReadCalls: number;
  /** Read on each write, so a test can make a retry succeed. */
  failMarkRead: boolean;
  /** Delay before the write responds, to observe the saving state. */
  markReadDelayMs: number;
}

export async function setup(page: Page, options: Options = {}): Promise<Recorder> {
  const recorder: Recorder = {
    markReadCalls: 0,
    failMarkRead: !!options.failMarkRead,
    markReadDelayMs: 0,
  };
  const readRows = (options.readDays ?? []).map((day) => ({
    viewed_date: `2026-10-${String(day).padStart(2, '0')}`,
    day_of_month: day,
    devotional_id: DEVOTIONAL_ID,
    member_id: MEMBER_ID,
    viewed_at: `2026-10-${String(day).padStart(2, '0')}T08:00:00.000Z`,
  }));
  const viewsStore = [...readRows];

  await mockSupabase(page, { role: options.role ?? 'member' });

  // Registered after mockSupabase, so these take precedence (Playwright runs the latest route first).
  await page.route(/https:\/\/e2e-mock\.invalid\/scans\//, (route) =>
    route.fulfill({ status: 200, contentType: 'image/svg+xml', body: scanSvg }),
  );

  await page.route('**/rest/v1/**', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const table = url.pathname.split('/').pop() ?? '';
    const wantsObject = (request.headers()['accept'] ?? '').includes('vnd.pgrst.object');

    const reply = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' },
        body: JSON.stringify(body),
      });

    if (request.method() === 'OPTIONS') return reply({});

    // Tables this spec doesn't own (profiles, auth-related reads) go to the shared mock.
    const owned = ['monthly_devotionals', 'devotional_daily_pages', 'devotional_views'];
    if (!owned.includes(table)) return route.fallback();

    if (table === 'monthly_devotionals') {
      return reply(wantsObject ? devotional : [devotional]);
    }
    if (table === 'devotional_daily_pages') {
      const day = Number(url.searchParams.get('day_of_month')?.replace('eq.', ''));
      const match = Number.isNaN(day) ? pages : pages.filter((p) => p.day_of_month === day);
      return reply(wantsObject ? (match[0] ?? null) : match);
    }
    if (table === 'devotional_views') {
      if (request.method() === 'POST') {
        recorder.markReadCalls += 1;
        if (recorder.markReadDelayMs) await new Promise((resolve) => setTimeout(resolve, recorder.markReadDelayMs));
        if (recorder.failMarkRead) return reply({ message: 'Simulated failure' }, 500);
        const payload = JSON.parse(request.postData() ?? '{}') as Record<string, unknown>;
        const row = { ...(Array.isArray(payload) ? payload[0] : payload), viewed_at: new Date().toISOString() };
        viewsStore.push(row as (typeof viewsStore)[number]);
        return reply(row);
      }
      const dayParam = url.searchParams.get('day_of_month');
      const dateParam = url.searchParams.get('viewed_date');
      let rows = viewsStore;
      if (dayParam) rows = rows.filter((r) => `eq.${r.day_of_month}` === dayParam);
      if (dateParam) rows = rows.filter((r) => `eq.${r.viewed_date}` === dateParam);
      if (wantsObject) return reply(rows[0] ?? null);
      return reply(rows);
    }
    return reply(wantsObject ? null : []);
  });

  await page.route('**/rest/v1/rpc/get_ror_streak', (route) => {
    if (options.failStreak) {
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Simulated streak failure' }) });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify([{ current_streak: 5, longest_streak: 12, monthly_completed: 7, monthly_total: 19, last_completed: '2026-10-18' }]),
    });
  });

  return recorder;
}

export async function signIn(page: Page) {
  await page.goto('/');
  await page.getByLabel('Email').fill('leader@yorku.ca');
  await page.getByLabel('Password').fill('secret1');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.getByRole('main')).toBeVisible();
}

export async function openDevotional(page: Page) {
  await page.goto('/devotionals?day=19&month=10&year=2026');
  await expect(page.getByRole('heading', { name: /Day 19/ })).toBeVisible();
}

