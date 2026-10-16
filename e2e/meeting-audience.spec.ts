import { randomBytes } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { approveApplicant, coordinatorSession, placeActiveMember, requireCoordinatorEnv } from './support/authorizedFixtures';
import { supabaseTestEnv, requireEnv } from './support/env';

// Restricted-meeting audience certification: a real browser, real Supabase Auth, and RLS checked through each user's own
// session. Runs ONLY against a local Supabase stack, with synthetic accounts that the suite creates and deletes.
//
// Required (local stack only): SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, E2E_COORDINATOR_EMAIL, E2E_COORDINATOR_PASSWORD
// and a cell id in E2E_CELL_ID (the synthetic members are placed in it through the transfer workflow).
//
// Status of every scenario is recorded in the test title. A scenario that has not been executed against a live stack is
// NOT TESTED, not PASS.

const { url, anonKey, serviceKey } = supabaseTestEnv();
const cellId = requireEnv('E2E_CELL_ID');
requireCoordinatorEnv();

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const run = `${Date.now()}`;
const password = `${randomBytes(18).toString('base64url')}aA1!`; // random per run; never reused
const meetingTitle = `E2E Restricted ${run}`;
const meetingDate = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

const people = {
  invitee: { email: `e2e.invitee.${run}@example.test`, name: `E2E Invitee ${run}` },
  outsider: { email: `e2e.outsider.${run}@example.test`, name: `E2E Outsider ${run}` },
} as const;
const ids: Record<keyof typeof people, string> = { invitee: '', outsider: '' };
let meetingId = '';

function anonClient(): SupabaseClient {
  return createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function signedInClient(email: string): Promise<SupabaseClient> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in for ${email} failed: ${error.message}`);
  return client;
}

function check<T>(label: string, result: { data: T | null; error: { message: string } | null }): NonNullable<T> {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data as NonNullable<T>;
}

async function signInUi(page: Page, email: string, pass: string = password) {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(pass);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.getByRole('heading', { name: 'Sign In' })).toHaveCount(0, { timeout: 30_000 });
}

async function openInvitations(page: Page) {
  await page.goto('/meetings');
  await page.getByText(meetingTitle).first().waitFor({ timeout: 20_000 });
  await page.getByTitle('Invitations and attendance').first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

async function shot(page: Page, testInfo: TestInfo, name: string) {
  await testInfo.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
}

test.describe.configure({ mode: 'serial' });

test.describe('restricted meeting audience', () => {
  let coordinatorPage: Page;
  let coordinatorContext: BrowserContext;

  test.beforeAll(async ({ browser }, testInfo) => {
    testInfo.setTimeout(240_000);
    for (const key of Object.keys(people) as (keyof typeof people)[]) {
      const { data, error } = await admin.auth.admin.createUser({
        email: people[key].email,
        password,
        email_confirm: true,
        user_metadata: { full_name: people[key].name },
      });
      if (error || !data.user) throw new Error(`createUser ${key}: ${error?.message}`);
      ids[key] = data.user.id;
    }
    // Activation and placement go through the approved coordinator workflow, never a direct profile write.
    const coord = await coordinatorSession(url, anonKey);
    for (const key of Object.keys(people) as (keyof typeof people)[]) {
      await approveApplicant(coord.client, ids[key]);
      await placeActiveMember(coord.client, ids[key], cellId, `E2E placement ${run}`);
    }
    coordinatorContext = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3100' });
    coordinatorPage = await coordinatorContext.newPage();
  });

  test.afterAll(async ({}, testInfo) => {
    testInfo.setTimeout(120_000);
    await coordinatorContext?.close();
    if (meetingId) await admin.from('meeting_attendances').delete().eq('meeting_id', meetingId);
    if (meetingId) await admin.from('meetings').delete().eq('id', meetingId);
    const results = await Promise.allSettled(Object.values(ids).filter(Boolean).map((id) => admin.auth.admin.deleteUser(id)));
    const failed = results.filter((r) => r.status === 'rejected' || (r.status === 'fulfilled' && r.value.error));
    if (failed.length > 0) throw new Error(`synthetic account cleanup failed for ${failed.length} of ${Object.keys(ids).length} users`);
  });

  test('NOT TESTED until executed: coordinator creates an invite-only meeting as a draft', async ({}, testInfo) => {
    const coordinator = requireCoordinatorEnv();
    await signInUi(coordinatorPage, coordinator.email, coordinator.password);
    await coordinatorPage.goto('/meetings');
    await coordinatorPage.getByRole('button', { name: '+ New Meeting' }).click();
    await coordinatorPage.getByLabel('Meeting Title').fill(meetingTitle);
    await coordinatorPage.getByLabel('Date').fill(meetingDate);
    await coordinatorPage.getByLabel('Invite only').check();
    await coordinatorPage.getByLabel('Save as draft').check();
    await coordinatorPage.getByRole('button', { name: 'Create Meeting' }).click();
    await expect(coordinatorPage.getByText(meetingTitle).first()).toBeVisible({ timeout: 20_000 });

    const row = check<{ id: string; visibility: string; published_at: string | null }>('meeting row', await admin.from('meetings').select('id, visibility, published_at').eq('title', meetingTitle).single());
    meetingId = row.id;
    expect(row.visibility).toBe('explicit');
    expect(row.published_at).toBeNull();
    await shot(coordinatorPage, testInfo, 'draft-created');
  });

  test('NOT TESTED until executed: explicit audience is saved and persists across refresh', async ({}, testInfo) => {
    const dialog = await openInvitations(coordinatorPage);
    await dialog.getByLabel('Specific members').check();
    await dialog.getByLabel('Find a member').fill(people.invitee.email);
    await dialog.getByLabel(people.invitee.name).check();
    await dialog.getByRole('button', { name: 'Preview recipients' }).click();
    await expect(dialog.getByText('Invitation preview')).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole('button', { name: 'Save invitations' }).click();
    await expect(dialog.getByRole('status')).toBeVisible({ timeout: 15_000 });

    const attendance = check('attendance after save', await admin.from('meeting_attendances').select('user_id, invited_via, audience_spec_id').eq('meeting_id', meetingId));
    expect(attendance.map((a) => a.user_id)).toEqual([ids.invitee]);
    expect(attendance[0].audience_spec_id).not.toBeNull();

    await coordinatorPage.reload();
    const after = await openInvitations(coordinatorPage);
    // The saved mode is restored asynchronously after the dialog opens. Wait for it before reading the recipient list.
    await expect(after.getByRole('radio', { name: /Specific members/ })).toBeChecked({ timeout: 15_000 });
    await expect(after.getByRole('checkbox', { name: people.invitee.name, exact: true })).toBeChecked();
    expect(await after.getByLabel(people.outsider.name).isChecked(), 'a non-invited member must not be preselected').toBe(false);
    await shot(coordinatorPage, testInfo, 'audience-persisted-after-refresh');
  });

  test('NOT TESTED until executed: publish, invitee sees the meeting, outsider cannot read or enumerate it', async ({ browser }, testInfo) => {
    const dialog = await openInvitations(coordinatorPage);
    // Publishing is enabled only after a recipient preview. The preview must show exactly the invitee, not the outsider.
    await dialog.getByRole('button', { name: 'Preview recipients' }).click();
    await expect(dialog.getByText('Invitation preview')).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByText('This meeting will be sent to 1 person')).toBeVisible();
    const previewed = check('attendance before publish', await admin.from('meeting_attendances').select('user_id').eq('meeting_id', meetingId));
    expect(previewed.map((a) => a.user_id)).toEqual([ids.invitee]);
    await dialog.getByRole('button', { name: 'Publish meeting' }).click();
    await expect.poll(async () => check<{ published_at: string | null }>('published_at', await admin.from('meetings').select('published_at').eq('id', meetingId).single()).published_at, { timeout: 15_000 }).not.toBeNull();

    const inviteeClient = await signedInClient(people.invitee.email);
    const outsiderClient = await signedInClient(people.outsider.email);

    // RLS through real sessions: the invitee sees the meeting; the outsider gets no row and no attendance rows.
    const inviteeMeeting = check('invitee meetings', await inviteeClient.from('meetings').select('id').eq('id', meetingId));
    expect(inviteeMeeting).toHaveLength(1);
    const outsiderMeeting = check('outsider meetings', await outsiderClient.from('meetings').select('id').eq('id', meetingId));
    expect(outsiderMeeting).toHaveLength(0);
    const outsiderAudience = check('outsider attendance', await outsiderClient.from('meeting_attendances').select('user_id').eq('meeting_id', meetingId));
    expect(outsiderAudience, 'a non-invited member must not enumerate the audience').toHaveLength(0);

    const inviteeContext = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3100' });
    const inviteePage = await inviteeContext.newPage();
    await signInUi(inviteePage, people.invitee.email);
    await inviteePage.goto('/meetings');
    await expect(inviteePage.getByText(meetingTitle).first()).toBeVisible({ timeout: 20_000 });
    await shot(inviteePage, testInfo, 'invitee-sees-meeting');
    await inviteeContext.close();

    const outsiderContext = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3100' });
    const outsiderPage = await outsiderContext.newPage();
    await signInUi(outsiderPage, people.outsider.email);
    await outsiderPage.goto('/meetings');
    await expect(outsiderPage.getByText(meetingTitle)).toHaveCount(0);
    await shot(outsiderPage, testInfo, 'outsider-cannot-see-meeting');
    await outsiderContext.close();
  });

  test('NOT TESTED until executed: audience edits and removals take effect for RLS', async ({}, testInfo) => {
    // Remove the invitee.
    const dialog = await openInvitations(coordinatorPage);
    await dialog.getByRole('checkbox', {
      name: people.invitee.name,
      exact: true,
    }).uncheck();
    await dialog.getByRole('button', { name: 'Preview recipients' }).click();
    await dialog.getByRole('button', { name: 'Save invitations' }).click();
    await expect(dialog.getByRole('status')).toBeVisible({ timeout: 15_000 });
    const removed = check('attendance after removal', await admin.from('meeting_attendances').select('user_id').eq('meeting_id', meetingId));
    expect(removed.map((a) => a.user_id)).not.toContain(ids.invitee);

    const inviteeClient = await signedInClient(people.invitee.email);
    expect(check('removed invitee meetings', await inviteeClient.from('meetings').select('id').eq('id', meetingId))).toHaveLength(0);

    // Add the outsider; the new invitee now reads the meeting through RLS.
    await dialog.getByLabel('Find a member').fill(people.outsider.email);
    await dialog.getByLabel(people.outsider.name).check();
    await dialog.getByRole('button', { name: 'Preview recipients' }).click();
    await dialog.getByRole('button', { name: 'Save invitations' }).click();
    await expect(dialog.getByRole('status')).toBeVisible({ timeout: 15_000 });
    const outsiderClient = await signedInClient(people.outsider.email);
    expect(check('added invitee meetings', await outsiderClient.from('meetings').select('id').eq('id', meetingId))).toHaveLength(1);
    await shot(coordinatorPage, testInfo, 'audience-edited');
  });
});
