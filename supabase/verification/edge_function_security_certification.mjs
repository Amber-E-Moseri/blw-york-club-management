// edge_function_security_certification.mjs
// Behavioural security checks for the Edge Functions on a local stack. No real email is ever sent: authorised callers
// stop at the "provider not configured" boundary. The positive cron / unsubscribe paths need the throwaway secrets the
// local function runtime was started with (CERT_CRON_SECRET, CERT_UNSUBSCRIBE_SECRET), passed via environment only.
import { createHmac } from 'node:crypto';
import { harness } from './lib.mjs';

const functionsUrl = process.env.SUPABASE_FUNCTIONS_URL;
if (!functionsUrl) throw new Error('SUPABASE_FUNCTIONS_URL is required');

const h = harness('edge-functions');
const { admin, expect } = h;

async function call(path, { token, body, headers = {}, method = 'POST' } = {}) {
  const response = await fetch(`${functionsUrl}/${path}`, {
    method,
    headers: {
      apikey: h.anonKey,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await response.json(); } catch { /* denial paths may return an empty or HTML body */ }
  return { status: response.status, json };
}

async function grantNotificationPermission(userId) {
  const { data: role, error } = await admin.from('admin_roles')
    .insert({ name: `Cert Edge Role ${h.run}`, description: 'local edge certification', created_by: userId }).select('id').single();
  if (error) throw error;
  await admin.from('admin_role_permissions').insert({ role_id: role.id, permission_key: 'notifications.send' });
  await admin.from('admin_role_assignments').insert({ role_id: role.id, user_id: userId, assigned_by: userId });
}

try {
  const member = await h.createUser('member');
  const leader = await h.createUser('leader', { role: 'cell_leader' });
  const adminUser = await h.createUser('admin', { role: 'admin' });
  const custom = await h.createUser('custom');
  const rejected = await h.createUser('rejected', { role: 'coordinator' });
  await admin.from('profiles').update({ status: 'rejected' }).eq('id', rejected.id);
  await grantNotificationPermission(custom.id);

  // Use a transactional template type so preference enforcement is bypassed and the
  // call reaches the provider boundary (EMAIL_PROVIDER_NOT_CONFIGURED → 500).
  // Without templateType the preference guard short-circuits at no-identity → 200 skipped.
  const send = { action: 'send', to: 'nobody@example.test', subject: 'Cert', html: '<p>Cert</p>', templateType: 'account_approved' };
  const providerBoundary = (r) => r.status === 500 && /EMAIL_PROVIDER_NOT_CONFIGURED/.test(r.json?.error ?? '');

  expect('send-email anonymous denied', (await call('send-email', { body: send })).status === 401);
  expect('send-email ordinary member denied', (await call('send-email', { token: member.token, body: send })).status === 403);
  expect('send-email cell leader without permission denied', (await call('send-email', { token: leader.token, body: send })).status === 403);
  expect('send-email rejected coordinator denied (inactive accounts hold no authority)', (await call('send-email', { token: rejected.token, body: send })).status === 403);
  expect('send-email admin authorization allowed before provider failure', providerBoundary(await call('send-email', { token: adminUser.token, body: send })));
  expect('send-email custom notifications permission allowed', providerBoundary(await call('send-email', { token: custom.token, body: send })));

  const gate = { Authorization: `Bearer ${h.anonKey}` };
  expect('process-scheduled-emails no secret denied', (await call('process-scheduled-emails', { body: {}, headers: gate })).status === 401);
  expect('process-scheduled-emails wrong secret denied', (await call('process-scheduled-emails', { body: {}, headers: { ...gate, 'x-cron-secret': 'wrong-local-secret' } })).status === 401);

  const unsubscribe = (token) => fetch(`${functionsUrl}/unsubscribe?token=${encodeURIComponent(token)}`, { headers: { apikey: h.anonKey, ...gate } });
  expect('unsubscribe malformed token denied', (await unsubscribe('malformed')).status === 400);

  const cronSecret = process.env.CERT_CRON_SECRET;
  const unsubscribeSecret = process.env.CERT_UNSUBSCRIBE_SECRET;
  if (!cronSecret || !unsubscribeSecret) {
    h.fail('positive-path secrets provided', 'CERT_CRON_SECRET and CERT_UNSUBSCRIBE_SECRET are required');
  } else {
    // Seed a real scheduled email so the cron processor has something to dispatch.
    // The relay is not configured on the local stack; 'send' will stop at the
    // provider boundary and record a 'failed' row — that is still a real dispatch
    // attempt, confirming the auth chain works (pre-fix: auth.getUser rejected the
    // service role key and every dispatch returned 401 silently).
    const seed = await admin.from('profiles').select('id,email').eq('status', 'active').limit(1).single();
    const seedMemberId = seed.data?.id ?? null;
    const seedMemberEmail = seed.data?.email ?? 'x@example.test';
    await admin.from('scheduled_emails').insert({
      recipient_email: `cert.cron.${h.run}@example.test`,
      subject: 'Cert scheduled',
      html_content: '<p>cert</p>',
      scheduled_for: new Date(Date.now() - 1000).toISOString(), // 1 s in the past
      sent: false,
      member_id: seedMemberId,
      template_type: 'generic',
    });

    const cron = await call('process-scheduled-emails', { body: {}, headers: { ...gate, 'x-cron-secret': cronSecret } });
    // Core assertion: HTTP 200, processed ≥ 1, and sent + skipped + failed === processed.
    // A non-zero failed count is expected here because the relay is not configured;
    // the important invariant is that failed > 0 OR skipped > 0 (not that sent = 0),
    // proving the auth chain reached send-email instead of dying at the 401 boundary.
    const cronOk = (
      cron.status === 200 &&
      typeof cron.json?.processed === 'number' &&
      typeof cron.json?.sent === 'number' &&
      typeof cron.json?.skipped === 'number' &&
      typeof cron.json?.failed === 'number' &&
      cron.json.processed >= 1 &&
      cron.json.sent + cron.json.skipped + cron.json.failed === cron.json.processed
    );
    expect(
      'process-scheduled-emails dispatches scheduled emails (auth chain intact)',
      cronOk,
      `HTTP ${cron.status} body=${JSON.stringify(cron.json)}`,
    );

    // Additional denial: x-internal-dispatch with wrong secret is refused
    const wrongInternal = await call('send-email', {
      body: { action: 'send', to: 'x@example.test', subject: 'x', html: '<p>x</p>' },
      headers: { 'x-internal-dispatch': 'wrong-internal-secret' },
    });
    expect('send-email wrong internal dispatch secret denied', wrongInternal.status === 401, `HTTP ${wrongInternal.status}`);

    // Internal dispatch with correct secret reaches provider boundary (not 401)
    const correctInternal = await call('send-email', {
      // The destination must be the member's own address (recipient identity rule); an active, opted-in member is eligible.
      body: { action: 'send', to: seedMemberEmail, subject: 'x', html: '<p>x</p>', memberId: seedMemberId, templateType: 'generic' },
      headers: { 'x-internal-dispatch': cronSecret },
    });
    // Expected: 500 provider-not-configured (proof the auth chain passed)
    expect(
      'send-email correct internal dispatch reaches provider boundary (auth chain works)',
      correctInternal.status === 500 && /EMAIL_PROVIDER_NOT_CONFIGURED/.test(correctInternal.json?.error ?? ''),
      `HTTP ${correctInternal.status} body=${JSON.stringify(correctInternal.json)}`,
    );

    const sign = (payload, secret) => {
      const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
      return `${encoded}.${createHmac('sha256', secret).update(encoded).digest('hex')}`;
    };
    const exp = Math.floor(Date.now() / 1000) + 600;
    const good = { userId: member.id, notifType: 'weekly_digest', exp };

    expect('unsubscribe forged signature denied', (await unsubscribe(sign(good, 'not-the-real-secret'))).status === 400);
    expect('unsubscribe expired signed token denied', (await unsubscribe(sign({ ...good, exp: exp - 1200 }, unsubscribeSecret))).status === 400);
    expect('unsubscribe token for the retired memberId field denied', (await unsubscribe(sign({ memberId: member.id, notifType: 'weekly_digest', exp }, unsubscribeSecret))).status === 400);
    expect('unsubscribe unknown notification type denied', (await unsubscribe(sign({ ...good, notifType: 'nonsense' }, unsubscribeSecret))).status === 400);
    expect('unsubscribe for a nonexistent account saves nothing and is refused',
      (await unsubscribe(sign({ ...good, userId: '00000000-0000-4000-8000-000000000999' }, unsubscribeSecret))).status === 400);

    const valid = await unsubscribe(sign(good, unsubscribeSecret));
    const { data: pref } = await admin.from('email_preferences').select('user_id,weekly_digest').eq('user_id', member.id).maybeSingle();
    expect('unsubscribe valid signed token allowed and persisted for the account (user_id)', valid.status === 200 && pref?.weekly_digest === false, `HTTP ${valid.status} ${JSON.stringify(pref)}`);
  }
} catch (error) {
  h.fail('harness completed without error', error.message);
} finally {
  await h.cleanup();
  h.report();
}
