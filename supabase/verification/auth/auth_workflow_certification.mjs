// auth_workflow_certification.mjs
// End-to-end Auth behaviour on the local stack with fake data: signup (hostile metadata ignored), login, pending
// state, no self-activation, password reset (no account enumeration), logout (refresh token revoked).
import { createClient } from '@supabase/supabase-js';
import { planPersonForLink } from './person_link.mjs';
import { harness, randomPassword } from './lib.mjs';

const h = harness('auth-workflow');
const { admin, expect } = h;
// Signup uses the approved MailSlurp inbox address, so GoTrue accepts it and the confirmation code is readable.
const email = '84d516c7-1093-4e5c-8f1c-2ca7141d5824@sandbox.zazamail.link';
const password = randomPassword();
let userId;
let personId;
let personOwnedByRun = false;
let runStartIso;

try {
  runStartIso = new Date().toISOString();
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

  // Confirm the synthetic email through the admin API. The OTP path is covered by otp_delivery_check.mjs; this
  // check exercises approval, so login must succeed. Approval state is still asserted from the profile, not email.
  const confirmed = await admin.auth.admin.updateUserById(userId, { email_confirm: true });
  expect('test account email confirmed through the admin API', !confirmed.error, confirmed.error?.message);

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
  const unknown = await h.newAnon().auth.resetPasswordForEmail(`cert.nobody.${h.run}@sandbox.zazamail.link`, { redirectTo: 'http://127.0.0.1:3000/reset' });
  expect('password reset request accepted', !known.error, known.error?.message);
  expect('password reset answers the same for an unknown email (no account enumeration)', !unknown.error === !known.error, `${unknown.error?.message ?? 'ok'} vs ${known.error?.message ?? 'ok'}`);

  // Approval by an authorised coordinator, then login still works and the account is active.
  // Approval requires the pending account to be linked to an existing person whose email is the account email.
  // The synthetic person is created here and removed in the finally block.
  const coordinator = await h.createUser('coordinator', { role: 'coordinator', status: 'active' });
  // Link the account to a person whose email matches it. Reuse only a record this run created; otherwise fail closed.
  const found = await admin.from('people').select('id,email,created_at').ilike('email', email).maybeSingle();
  if (found.error) throw new Error(`person lookup failed: ${found.error.message}`);
  let linkedCount = 0;
  if (found.data) {
    const counted = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('person_id', found.data.id);
    if (counted.error) throw new Error(`profile count failed: ${counted.error.message}`);
    linkedCount = counted.count ?? 0;
  }
  const plan = planPersonForLink({ existing: found.data, accountEmail: email, runStartIso, linkedProfileCount: linkedCount });
  if (plan.action === 'refuse') throw new Error(`approval link refused: ${plan.reason}`);
  if (plan.action === 'insert') {
    const inserted = await admin.from('people').insert({ full_name: 'Cert Linked Person', email }).select('id').single();
    if (inserted.error) throw new Error(`person insert failed: ${inserted.error.message}`);
    personId = inserted.data.id;
  } else {
    personId = found.data.id;
  }
  personOwnedByRun = plan.ownedByRun === true;
  expect('synthetic person available for the account link', !!personId, 'no person id');
  const linked = await coordinator.client.rpc('link_pending_profile_to_person', { p_profile_id: userId, p_person_id: personId, p_reason: 'Matched by staff review' });
  expect('staff link of the account to its verified person', !linked.error, linked.error?.message);

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
  // Remove only a person this run created or verified as its own. Never a foreign or pre-existing record.
  if (personId && personOwnedByRun) await admin.from('people').delete().eq('id', personId);
  await h.cleanup();
  h.report();
}
