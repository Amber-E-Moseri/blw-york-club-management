import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';

// Browser coverage for the flows changed by the authorisation remediation (confessions, BSC, habits), run against the
// LOCAL Supabase stack with throwaway accounts. Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (local only).
// Prayer requests have no UI route yet (see the round-5 report), so prayers are not covered here.
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) throw new Error('affected-flows only runs against a local Supabase stack');

// The flows share one dev server and one database. Run them one at a time, with a longer assertion timeout, so a
// first-load compile under parallel sign-ins cannot fail an otherwise correct assertion.
test.describe.configure({ mode: 'serial', timeout: 90_000 });
expect.configure({ timeout: 15_000 });

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const authUrl = `${url.replace(/\/$/, '')}/auth/v1`;
const run = `${Date.now()}`;
const password = `${randomBytes(18).toString('base64url')}aA1!`;
const today = new Date().toISOString().slice(0, 10);

const people = {
  coordinator: { email: `flow.coord.${run}@example.test`, name: `Flow Coord ${run}`, role: 'coordinator', status: 'active' },
  // The My BSC page opens for admin, coordinator and cell_leader roles (MyBsc.tsx). A BSC leader with the plain member
  // role has database access but no page; see the round-5 report, gap G1.
  leader: { email: `flow.leader.${run}@example.test`, name: `Flow Leader ${run}`, role: 'cell_leader', status: 'active' },
  member: { email: `flow.member.${run}@example.test`, name: `Flow Member ${run}`, role: 'member', status: 'active' },
  pending: { email: `flow.pending.${run}@example.test`, name: `Flow Pending ${run}`, role: 'member', status: 'pending' },
  outsider: { email: `flow.outsider.${run}@example.test`, name: `Flow Outsider ${run}`, role: 'member', status: 'active' },
} as const;
type Key = keyof typeof people;
const ids: Partial<Record<Key, string>> = {};
const created: string[] = [];
// Rows this spec creates in shared tables, removed in afterAll so the real-schema suites still see a clean database.
const cleanup: Array<{ table: string; column: string; value: string }> = [];

async function waitForAuthReadiness() {
  const deadline = Date.now() + 60_000;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${authUrl}/admin/users?page=1&per_page=1`, {
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      });
      if (r.ok) return;
      lastError = `admin users ${r.status}`;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`local Supabase Auth was not ready (${lastError})`);
}

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(120_000);
  await waitForAuthReadiness();

  for (const [key, p] of Object.entries(people) as [Key, (typeof people)[Key]][]) {
    const { data, error } = await admin.auth.admin.createUser({
      email: p.email, password, email_confirm: true, user_metadata: { full_name: p.name },
    });
    if (error || !data.user) throw new Error(`createUser ${key}: ${error?.message}`);
    ids[key] = data.user.id;
    created.push(data.user.id);
    const { error: upErr } = await admin.from('profiles').update({ role: p.role, status: p.status, full_name: p.name }).eq('id', data.user.id);
    if (upErr) throw new Error(`profile ${key}: ${upErr.message}`);
  }

  // Fellowship, cell and two BSCs. The leader leads BSC 1 only; the outsider is in BSC 2.
  const { data: fellowship, error: fErr } = await admin.from('fellowships').insert({ name: `Flow fellowship ${run}` }).select().single();
  if (fErr) throw new Error(`fellowship: ${fErr.message}`);
  const { data: cell, error: cErr } = await admin.from('cells').insert({ name: `Flow cell ${run}`, fellowship_id: fellowship.id }).select().single();
  if (cErr) throw new Error(`cell: ${cErr.message}`);
  // guard_bsc_leader_eligibility (055) requires profiles.cell_id = bscs.cell_id. Set cell membership for all
  // test members now, before the BSC with leader_id is created. The leader is a BSC leader only (not a cell
  // leader): cells.leader_id is left unset so is_cell_leader_of() returns false and the leader sees only their
  // own BSC's members, not every BSC in the cell.
  await admin.from('profiles').update({ cell_id: cell.id }).in('id', [ids.leader!, ids.member!, ids.pending!, ids.outsider!]);
  const bscA = await admin.from('bscs').insert({ cell_id: cell.id, name: `Flow BSC A ${run}`, leader_id: ids.leader }).select().single();
  const bscB = await admin.from('bscs').insert({ cell_id: cell.id, name: `Flow BSC B ${run}` }).select().single();
  if (bscA.error || bscB.error) throw new Error(`bsc: ${bscA.error?.message ?? bscB.error?.message}`);
  cleanup.push({ table: 'bscs', column: 'id', value: bscA.data.id }, { table: 'bscs', column: 'id', value: bscB.data.id });
  cleanup.push({ table: 'cells', column: 'id', value: cell.id }, { table: 'fellowships', column: 'id', value: fellowship.id });
  await admin.from('profiles').update({ bsc_id: bscA.data.id }).in('id', [ids.member!, ids.pending!]);
  await admin.from('profiles').update({ bsc_id: bscB.data.id }).eq('id', ids.outsider!);

  // A confession scheduled today, declared by the member and by the outsider (count 2 for the member).
  const { data: confession, error: confErr } = await admin.from('confessions')
    .insert({ title: `Flow confession ${run}`, body: 'Declared in the flow test', scheduled_date: today, created_by: ids.coordinator, is_active: true })
    .select().single();
  if (confErr) throw new Error(`confession: ${confErr.message}`);
  cleanup.push({ table: 'confessions', column: 'id', value: confession.id });
  const { error: decErr } = await admin.from('confession_declarations').insert([
    { confession_id: confession.id, user_id: ids.member },
    { confession_id: confession.id, user_id: ids.outsider },
  ]);
  if (decErr) throw new Error(`declarations: ${decErr.message}`);

  // A habit template and one entry for the member today.
  const { data: template, error: tErr } = await admin.from('habit_templates')
    .insert({ name: `Flow habit ${run}`, icon: '*', created_by: ids.coordinator }).select().single();
  if (tErr) throw new Error(`habit template: ${tErr.message}`);
  await admin.from('habit_entries').insert({ template_id: template.id, user_id: ids.member, entry_date: today, status: 'done' });
  cleanup.push({ table: 'habit_templates', column: 'id', value: template.id });

  // A Rhapsody read for the member this month, so the leader's view shows a read.
  const { data: devotional } = await admin.from('devotional_views').insert({
    member_id: ids.member!, devotional_id: '00000000-0000-0000-0000-00000000f00d', day_of_month: new Date().getDate(), viewed_date: today,
  }).select().maybeSingle();
  void devotional;
});

test.afterAll(async () => {
  // Delete child rows first: declarations and habit entries cascade from their parents; BSCs before cells, cells before fellowships.
  for (const row of [...cleanup].reverse()) {
    const { error } = await admin.from(row.table).delete().eq(row.column, row.value);
    if (error) console.warn(`cleanup ${row.table}: ${error.message}`);
  }
  for (const id of created) await admin.auth.admin.deleteUser(id);
});

function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

async function signIn(page: Page, email: string) {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  const [authResponse] = await Promise.all([
    page.waitForResponse((r) => r.url().startsWith(`${authUrl}/token?grant_type=password`) && r.request().method() === 'POST', { timeout: 20_000 }),
    page.getByRole('button', { name: 'Sign In' }).click(),
  ]);
  expect(authResponse.status(), 'sign-in should succeed').toBe(200);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'page must not scroll horizontally').toBeLessThanOrEqual(1);
}

test.describe('confessions (declaration privacy, T1 and T5)', () => {
  test('member sees the confession and the aggregate count, and no other member identity', async ({ page }) => {
    const errors = trackErrors(page);
    await signIn(page, people.member.email);
    await page.goto('/confessions');
    await expect(page.getByRole('heading', { name: /Daily Affirmations/ })).toBeVisible();
    await expect(page.getByText(`Flow confession ${run}`)).toBeVisible();
    await expect(page.getByText('2 declared')).toBeVisible();
    const body = (await page.locator('body').innerText());
    expect(body, 'other members must not be named').not.toContain(people.outsider.name);
    expect(body).not.toContain(people.pending.name);
    expect(errors).toEqual([]);
  });

  test('pending account is held at the approval screen and cannot open confessions', async ({ page }) => {
    await signIn(page, people.pending.email);
    await expect(page.getByRole('heading', { name: 'Account pending approval' })).toBeVisible();
    await page.goto('/confessions');
    await expect(page.getByRole('heading', { name: 'Account pending approval' })).toBeVisible();
    await expect(page.getByText(`Flow confession ${run}`)).toHaveCount(0);
  });
});

test.describe('BSC leader view (scope, T2 and T4)', () => {
  test('leader sees own BSC members including a pending onboarding member, and not another BSC', async ({ page }) => {
    const errors = trackErrors(page);
    await signIn(page, people.leader.email);
    await page.goto('/my-bsc');
    await expect(page.getByText('My Bible Study Class', { exact: true })).toBeVisible();
    await expect(page.getByText(`Flow BSC A ${run}`)).toBeVisible();
    await expect(page.getByText(people.member.name)).toBeVisible();
    await expect(page.getByText(people.pending.name)).toBeVisible();
    const body = await page.locator('body').innerText();
    expect(body, 'a member of another BSC must not be listed').not.toContain(people.outsider.name);
    expect(errors).toEqual([]);
  });

  test('ordinary member cannot open the BSC leader view', async ({ page }) => {
    await signIn(page, people.member.email);
    await page.goto('/my-bsc');
    await expect(page.getByText(people.pending.name)).toHaveCount(0);
    await expect(page.getByText(people.outsider.name)).toHaveCount(0);
  });
});

test.describe('habits (own growth record)', () => {
  test('member sees own habit tracker and template', async ({ page }) => {
    const errors = trackErrors(page);
    await signIn(page, people.member.email);
    await page.goto('/habits');
    await expect(page.getByRole('heading', { name: 'Habit Tracker' })).toBeVisible();
    await expect(page.getByText(`Flow habit ${run}`)).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('phone width (375 x 812)', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('leader pages (My BSC, habits) do not scroll horizontally on a phone', async ({ page }) => {
    await signIn(page, people.leader.email);
    for (const path of ['/my-bsc', '/habits']) {
      await page.goto(path);
      await expect(page.locator('#root')).not.toBeEmpty();
      await expectNoHorizontalOverflow(page);
    }
  });

  test('confessions page does not scroll horizontally on a phone', async ({ page }) => {
    await signIn(page, people.member.email);
    await page.goto('/affirmations');
    await expect(page.getByRole('heading', { name: /Daily Affirmations/ })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
