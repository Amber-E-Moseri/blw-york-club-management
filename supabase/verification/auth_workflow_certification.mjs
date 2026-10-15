// auth_workflow_certification.mjs
// End-to-end Auth behaviour on the local stack with fake data: signup (hostile metadata ignored), login, pending
// state, no self-activation, password reset (no account enumeration), logout (refresh token revoked).
import { createClient } from '@supabase/supabase-js';
import { harness, randomPassword } from './lib.mjs';

const h = harness('auth-workflow');
const { admin, expect } = h;
const email = `cert.auth.${h.run}@example.test`;
const password = randomPassword();
let userId;

try {
  const signUp = await h.newAnon().auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: 'Cert Pending User',
        student_number: 'CERT-LOCAL',
        role: 'coordinator',
        status: 'active',
        admin_role: 'superuser',
      },
    },
  });
  expect('signup', !signUp.error && !!signUp.data.user, signUp.error?.message);
  userId = signUp.data.user?.id;

  const wrong = await h.newAnon().auth.signInWithPassword({ email, password: randomPassword() });
  expect('login with a wrong password is refused', !!wrong.error && !wrong.data.session, 'session issued');

  const client = h.newAnon();
  const login = await client.auth.signInWithPassword({ email, password });
  expect('login', !login.error && !!login.data.session, login.error?.message ?? 'missing session');
  const refreshToken = login.data.session?.refresh_token;

  const before = await h.profileOf(userId);
  expect('pending user (member + pending, hostile metadata ignored)', before.status === 'pending' && before.role === 'member' && before.admin_role == null, JSON.stringify(before));

  await client.from('profiles').update({ status: 'active', role: 'coordinator', admin_role: 'superuser' }).eq('id', userId).select();
  const after = await h.profileOf(userId);
  expect('pending bypass denied (direct privileged update persisted nothing)', after.status === 'pending' && after.role === 'member' && after.admin_role == null, JSON.stringify(after));

  // A pending account can read its own profile (the approval screen needs it) and nothing broader.
  const own = await client.from('profiles').select('id,status').eq('id', userId).maybeSingle();
  expect('pending user can read its own profile (approval screen)', !own.error && own.data?.status === 'pending', own.error?.message);

  const known = await h.newAnon().auth.resetPasswordForEmail(email, { redirectTo: 'http://127.0.0.1:3000/reset' });
  const unknown = await h.newAnon().auth.resetPasswordForEmail(`cert.nobody.${h.run}@example.test`, { redirectTo: 'http://127.0.0.1:3000/reset' });
  expect('password reset request accepted', !known.error, known.error?.message);
  expect('password reset answers the same for an unknown email (no account enumeration)', !unknown.error === !known.error, `${unknown.error?.message ?? 'ok'} vs ${known.error?.message ?? 'ok'}`);

  // Approval by an authorised coordinator, then login still works and the account is active.
  const coordinator = await h.createUser('coordinator', { role: 'coordinator', status: 'active' });
  const approve = await coordinator.client.rpc('approve_pending_member', { target_member_id: userId });
  expect('approval by an authorised coordinator activates the account', !approve.error && (await h.profileOf(userId)).status === 'active', approve.error?.message);
  const relogin = await h.newAnon().auth.signInWithPassword({ email, password });
  expect('login after approval', !relogin.error && !!relogin.data.session, relogin.error?.message);

  const logout = await client.auth.signOut();
  expect('logout', !logout.error, logout.error?.message);
  const reuse = await createClient(h.url, h.anonKey, { auth: { persistSession: false, autoRefreshToken: false } }).auth.refreshSession({ refresh_token: refreshToken });
  expect('logout revokes the refresh token', !!reuse.error && !reuse.data.session, 'refresh token still works');
} catch (error) {
  h.fail('harness completed without error', error.message);
} finally {
  if (userId) await admin.auth.admin.deleteUser(userId);
  await h.cleanup();
  h.report();
}
