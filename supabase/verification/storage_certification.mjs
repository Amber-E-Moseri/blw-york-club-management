// storage_certification.mjs
// Behavioural proof of Storage: expected buckets and limits, allowed uploads succeed, and every unauthorized
// upload / overwrite / delete is refused. Uses the real Storage API as real (fake, throwaway) accounts.
import { randomUUID } from 'node:crypto';
import { harness, TINY_PNG } from './lib.mjs';

const h = harness('storage');
const { admin, expect } = h;

// A minimal JPEG (1x1). The Storage API checks the declared MIME type against the bucket allow-list.
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64'
);

const uploaded = { 'user-media': [], 'testimony-images': [], 'devotional-images': [] };
const put = async (client, bucket, path, body, contentType, upsert = false) => {
  const r = await client.storage.from(bucket).upload(path, body, { contentType, upsert });
  if (!r.error) uploaded[bucket].push(path);
  return r;
};
const exists = async (bucket, path) => {
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  const name = path.slice(path.lastIndexOf('/') + 1);
  const r = await admin.storage.from(bucket).list(dir, { search: name });
  return (r.data ?? []).some((o) => o.name === name);
};

try {
  // ---- buckets ---------------------------------------------------------------------------------------------------------
  const { data: buckets } = await admin.storage.listBuckets();
  const byId = Object.fromEntries((buckets ?? []).map((b) => [b.id, b]));
  const want = { 'devotional-images': 10485760, 'testimony-images': 5242880, 'user-media': 5242880 };
  for (const [id, limit] of Object.entries(want)) {
    const b = byId[id];
    expect(`bucket ${id} exists, is public, limited to ${limit / 1048576} MB, images only`,
      !!b && b.public === true && b.file_size_limit === limit && (b.allowed_mime_types ?? []).join() === 'image/jpeg,image/png,image/webp',
      JSON.stringify(b));
  }

  const alice = await h.createUser('alice', { role: 'member', status: 'active' });
  const bob = await h.createUser('bob', { role: 'member', status: 'active' });
  const pending = await h.createUser('pending', { status: 'pending' });
  const adminUser = await h.createUser('admin', { role: 'admin', status: 'active' });
  const coordinator = await h.createUser('coordinator', { role: 'coordinator', status: 'active' });

  // ---- user-media (avatars) -----------------------------------------------------------------------------------------------
  const avatar = `avatars/${alice.id}.png`;
  expect('alice can upload her own avatar', !(await put(alice.client, 'user-media', avatar, TINY_PNG, 'image/png')).error);
  expect('alice can replace (upsert) her own avatar', !(await put(alice.client, 'user-media', avatar, TINY_PNG, 'image/png', true)).error);
  const publicUrl = `${h.url}/storage/v1/object/public/user-media/${avatar}`;
  const fetched = await fetch(publicUrl);
  expect('the avatar renders from its public URL without signing in', fetched.status === 200, `HTTP ${fetched.status}`);
  expect("bob cannot upload to alice's avatar path", !!(await put(bob.client, 'user-media', `avatars/${alice.id}.jpg`, TINY_PNG, 'image/png')).error, 'upload succeeded');
  expect("bob cannot overwrite alice's avatar", !!(await put(bob.client, 'user-media', avatar, TINY_PNG, 'image/png', true)).error, 'overwrite succeeded');
  await bob.client.storage.from('user-media').remove([avatar]);
  expect("bob cannot delete alice's avatar", await exists('user-media', avatar));
  expect('an avatar outside the avatars/ folder is refused', !!(await put(alice.client, 'user-media', `other/${alice.id}.png`, TINY_PNG, 'image/png')).error, 'upload succeeded');
  expect('a non-image file is refused', !!(await put(alice.client, 'user-media', `avatars/${alice.id}.txt`, Buffer.from('not an image'), 'text/plain')).error, 'text accepted');
  expect('a file over 5 MB is refused', !!(await put(alice.client, 'user-media', `avatars/${alice.id}.webp`, Buffer.alloc(5.5 * 1024 * 1024), 'image/webp')).error, 'oversize accepted');
  expect('anonymous upload is refused', !!(await put(h.newAnon(), 'user-media', `avatars/${randomUUID()}.png`, TINY_PNG, 'image/png')).error, 'anon upload succeeded');
  expect('a pending (unapproved) account cannot upload', !!(await put(pending.client, 'user-media', `avatars/${pending.id}.png`, TINY_PNG, 'image/png')).error, 'pending upload succeeded');
  expect('anonymous listing is refused', ((await h.newAnon().storage.from('user-media').list('avatars')).data ?? []).length === 0);
  expect('alice can delete her own avatar', !(await alice.client.storage.from('user-media').remove([avatar])).error && !(await exists('user-media', avatar)));

  // ---- testimony-images ----------------------------------------------------------------------------------------------------
  const photo = `${alice.id}/${Date.now()}.png`;
  expect('alice can upload into her own testimony folder', !(await put(alice.client, 'testimony-images', photo, TINY_PNG, 'image/png')).error);
  expect("bob cannot upload into alice's folder", !!(await put(bob.client, 'testimony-images', `${alice.id}/${Date.now()}-x.png`, TINY_PNG, 'image/png')).error, 'upload succeeded');
  expect("bob cannot overwrite alice's image", !!(await put(bob.client, 'testimony-images', photo, TINY_PNG, 'image/png', true)).error, 'overwrite succeeded');
  await bob.client.storage.from('testimony-images').remove([photo]);
  expect("bob cannot delete alice's image", await exists('testimony-images', photo));
  expect('a non-image testimony file is refused', !!(await put(alice.client, 'testimony-images', `${alice.id}/${Date.now()}.pdf`, Buffer.from('%PDF'), 'application/pdf')).error, 'pdf accepted');
  expect('a pending account cannot upload a testimony image', !!(await put(pending.client, 'testimony-images', `${pending.id}/${Date.now()}.png`, TINY_PNG, 'image/png')).error, 'pending upload succeeded');
  const mod = `${bob.id}/${Date.now()}-m.png`;
  await put(bob.client, 'testimony-images', mod, TINY_PNG, 'image/png');
  await coordinator.client.storage.from('testimony-images').remove([mod]);
  expect('a coordinator can remove an image for moderation', !(await exists('testimony-images', mod)));
  expect('alice can delete her own testimony image', !(await alice.client.storage.from('testimony-images').remove([photo])).error && !(await exists('testimony-images', photo)));

  // ---- devotional-images -------------------------------------------------------------------------------------------------------
  const page = `2026/10/${randomUUID()}/day-01.jpg`;
  expect('an ordinary member cannot upload a devotional image', !!(await put(alice.client, 'devotional-images', page, TINY_JPEG, 'image/jpeg')).error, 'member upload succeeded');
  expect('anonymous cannot upload a devotional image', !!(await put(h.newAnon(), 'devotional-images', page, TINY_JPEG, 'image/jpeg')).error, 'anon upload succeeded');
  // The old check trusted user-editable metadata. A member who sets user_metadata.role = 'admin' must still be refused.
  const spoof = await h.createUser('spoofer', { role: 'member', status: 'active' });
  await spoof.client.auth.updateUser({ data: { role: 'admin' } });
  await spoof.client.auth.refreshSession();
  expect('a member who edits their own user_metadata.role to admin is still refused', !!(await put(spoof.client, 'devotional-images', page, TINY_JPEG, 'image/jpeg')).error, 'spoofed role accepted');
  expect('an admin can upload a devotional image', !(await put(adminUser.client, 'devotional-images', page, TINY_JPEG, 'image/jpeg')).error);
  await alice.client.storage.from('devotional-images').remove([page]);
  expect('a member cannot delete a devotional image', await exists('devotional-images', page));
  expect('an admin can delete a devotional image', !(await adminUser.client.storage.from('devotional-images').remove([page])).error && !(await exists('devotional-images', page)));
} catch (error) {
  h.fail('harness completed without error', error.message);
} finally {
  for (const [bucket, paths] of Object.entries(uploaded)) {
    if (paths.length) { try { await admin.storage.from(bucket).remove(paths); } catch { /* best effort */ } }
  }
  await h.cleanup();
  h.report();
}
