// devotional_metadata_authz_certification.mjs
// Regression proof that user-editable metadata never grants devotional administration.
//
// A signed-in member sets user_metadata.role to 'admin' or 'coordinator' through the real GoTrue API, then uses the real
// PostgREST and Storage APIs. Every privileged check must still refuse them, while genuine active admins and coordinators
// keep their access. Signup metadata must not be able to set a privileged role or an active status.
//
// The access-token payload is decoded to prove the spoofed claim really reached the JWT. Without that proof, a refused
// write would not show that the attack was ever possible.
import { randomUUID } from 'node:crypto';
import { harness, TINY_PNG, randomPassword } from './lib.mjs';
import { createClient } from '@supabase/supabase-js';

const h = harness('devotional_metadata');
const { admin, expect } = h;

const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64'
);

const claimOf = (token) => {
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  return payload;
};

const createdDevotionals = [];
const createdSignups = [];
const uploaded = [];

async function devotionalFixture(createdBy) {
  const book = `cert-${h.run}-${randomUUID().slice(0, 8)}`;
  const { data, error } = await admin
    .from('monthly_devotionals')
    .insert({ month: 1, year: 2099, title: 'Cert devotional', book_title: book, total_days: 31, total_pages: 10, created_by: createdBy })
    .select('id')
    .single();
  if (error) throw new Error(`devotional fixture: ${error.message}`);
  createdDevotionals.push(data.id);
  return data.id;
}

try {
  // ---- real privileged accounts (positive controls) ----------------------------------------------------------------------
  const realAdmin = await h.createUser('admin', { role: 'admin', status: 'active' });
  const realCoordinator = await h.createUser('coordinator', { role: 'coordinator', status: 'active' });
  const pendingAdmin = await h.createUser('pending-admin', { role: 'admin', status: 'pending' });
  const bob = await h.createUser('bob', { role: 'member', status: 'active' });

  const devotionalId = await devotionalFixture(realAdmin.id);
  // A devotional view by bob, to test whether an unprivileged member can read another member's views.
  const { error: viewSeedErr } = await admin.from('devotional_views').insert({
    member_id: bob.id,
    devotional_id: devotionalId,
    day_of_month: 1,
    viewed_date: '2099-01-01',
  });
  if (viewSeedErr) throw new Error(`view fixture: ${viewSeedErr.message}`);

  // ---- the attack: an ordinary active member edits their own user_metadata through GoTrue -----------------------------
  const alice = await h.createUser('alice', { role: 'member', status: 'active' });
  const baseline = claimOf(alice.token);
  expect('the baseline token carries no admin role claim', !baseline.user_metadata?.role);

  const spoofs = {};
  for (const role of ['admin', 'coordinator']) {
    const { error } = await alice.client.auth.updateUser({ data: { role } });
    spoofs[role] = !error;
    await alice.client.auth.refreshSession();
    const { data: session } = await alice.client.auth.getSession();
    const claim = claimOf(session.session.access_token).user_metadata?.role;
    expect(`GoTrue accepted user_metadata.role='${role}' from the member (attack reached the JWT)`, !error && claim === role, error?.message ?? `claim=${claim}`);

    // The helper the policies call, as the spoofed member.
    const { data: probe, error: probeErr } = await alice.client.rpc('is_devotional_admin');
    expect(`is_devotional_admin() is false for a member with user_metadata.role='${role}'`, !probeErr && probe === false, `result=${probe} error=${probeErr?.message}`);
  }

  // Database-side checks on the spoofed member's PostgREST session.
  const { data: spoofedRow, error: spoofedWriteErr } = await alice.client
    .from('monthly_devotionals')
    .insert({ month: 2, year: 2099, title: 'spoofed', book_title: `spoof-${h.run}`, total_days: 28, total_pages: 5, created_by: alice.id })
    .select('id');
  expect('a spoofed member cannot create a monthly devotional', !!spoofedWriteErr || !spoofedRow?.length, `inserted ${spoofedRow?.length ?? 0} row(s)`);
  if (spoofedRow?.length) createdDevotionals.push(spoofedRow[0].id);

  const { data: spoofedPage, error: pageWriteErr } = await alice.client
    .from('devotional_daily_pages')
    .insert({ devotional_id: devotionalId, day_of_month: 2, page_range: '1-2', image_url: 'https://example.test/x.jpg' })
    .select('id');
  expect('a spoofed member cannot create a devotional daily page', !!pageWriteErr || !spoofedPage?.length, `inserted ${spoofedPage?.length ?? 0} row(s)`);

  const { data: updatedRows } = await alice.client.from('monthly_devotionals').update({ title: 'hijacked' }).eq('id', devotionalId).select('id');
  const { data: afterUpdate } = await admin.from('monthly_devotionals').select('title').eq('id', devotionalId).single();
  expect('a spoofed member cannot edit a devotional', (updatedRows ?? []).length === 0 && afterUpdate.title === 'Cert devotional', `rows=${updatedRows?.length} title=${afterUpdate.title}`);

  const { data: deletedRows } = await alice.client.from('monthly_devotionals').delete().eq('id', devotionalId).select('id');
  const { data: stillThere } = await admin.from('monthly_devotionals').select('id').eq('id', devotionalId);
  expect('a spoofed member cannot delete a devotional', (deletedRows ?? []).length === 0 && stillThere.length === 1, `deleted=${deletedRows?.length}`);

  const { data: otherViews } = await alice.client.from('devotional_views').select('member_id').eq('member_id', bob.id);
  expect("a spoofed member cannot read another member's devotional views", (otherViews ?? []).length === 0, `visible=${otherViews?.length}`);

  const page = `2099/01/${randomUUID()}/day-01.jpg`;
  const { error: uploadErr } = await alice.client.storage.from('devotional-images').upload(page, TINY_JPEG, { contentType: 'image/jpeg' });
  expect('a spoofed member cannot upload a devotional image', !!uploadErr, 'upload accepted');
  if (!uploadErr) uploaded.push(page);

  // ---- positive controls: genuine privilege still works ------------------------------------------------------------------------
  const { data: adminProbe } = await realAdmin.client.rpc('is_devotional_admin');
  expect('is_devotional_admin() is true for an active admin', adminProbe === true);
  const { data: coordProbe } = await realCoordinator.client.rpc('is_devotional_admin');
  expect('is_devotional_admin() is true for an active coordinator', coordProbe === true);
  const { data: pendingProbe } = await pendingAdmin.client.rpc('is_devotional_admin');
  expect('is_devotional_admin() is false for a pending admin (status gating)', pendingProbe === false, `result=${pendingProbe}`);

  const adminBook = `admin-${h.run}`;
  const { data: adminDevotional, error: adminInsErr } = await realAdmin.client
    .from('monthly_devotionals')
    .insert({ month: 3, year: 2099, title: 'Admin devotional', book_title: adminBook, total_days: 31, total_pages: 9, created_by: realAdmin.id })
    .select('id')
    .single();
  expect('an active admin can create a monthly devotional', !adminInsErr && !!adminDevotional, adminInsErr?.message);
  if (adminDevotional) createdDevotionals.push(adminDevotional.id);

  const { error: coordInsErr } = await realCoordinator.client
    .from('devotional_daily_pages')
    .insert({ devotional_id: devotionalId, day_of_month: 3, page_range: '3-4', image_url: 'https://example.test/y.jpg' });
  expect('an active coordinator can create a devotional daily page', !coordInsErr, coordInsErr?.message);

  const { data: adminViews, error: adminViewsErr } = await realAdmin.client.from('devotional_views').select('member_id').eq('member_id', bob.id);
  expect("an active admin can read another member's devotional views", !adminViewsErr && (adminViews ?? []).length === 1, `visible=${adminViews?.length} error=${adminViewsErr?.message}`);

  const { error: adminUploadErr } = await realAdmin.client.storage.from('devotional-images').upload(`${page}-admin.jpg`, TINY_JPEG, { contentType: 'image/jpeg' });
  expect('an active admin can upload a devotional image', !adminUploadErr, adminUploadErr?.message);
  if (!adminUploadErr) uploaded.push(`${page}-admin.jpg`);

  // ---- signup metadata must not set a privileged role or an active status ---------------------------------------------
  const signupEmail = `cert.devotional_metadata.signup.${h.run}@example.test`;
  const signupClient = createClient(h.url, h.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: signup, error: signupErr } = await signupClient.auth.signUp({
    email: signupEmail,
    password: randomPassword(),
    options: { data: { full_name: 'Cert signup', role: 'admin', admin_role: 'coordinator', status: 'active' } },
  });
  if (signup?.user) createdSignups.push(signup.user.id);
  expect('signup with role metadata is accepted by GoTrue', !signupErr && !!signup?.user, signupErr?.message);
  if (signup?.user) {
    const { data: profile } = await admin.from('profiles').select('role,status,admin_role').eq('id', signup.user.id).single();
    expect("signup metadata cannot set profiles.role (is 'member')", profile?.role === 'member', `role=${profile?.role}`);
    expect("signup metadata cannot set profiles.admin_role (is null)", profile?.admin_role == null, `admin_role=${profile?.admin_role}`);
    expect("signup metadata cannot activate the account (is 'pending')", profile?.status === 'pending', `status=${profile?.status}`);
  }
} catch (error) {
  h.fail('harness completed without error', error.stack ?? error.message);
} finally {
  if (uploaded.length) { try { await admin.storage.from('devotional-images').remove(uploaded); } catch { /* best effort */ } }
  for (const id of createdDevotionals.splice(0)) {
    try { await admin.from('monthly_devotionals').delete().eq('id', id); } catch { /* best effort */ }
  }
  for (const id of createdSignups.splice(0)) {
    try { await admin.auth.admin.deleteUser(id); } catch { /* best effort */ }
  }
  await h.cleanup();
  h.report();
}
