// email_push_certification.mjs
// Behavioural proof of the user_id identity contract for email preferences, push subscriptions and the push
// notification log, through the real API as real (fake, throwaway) accounts.
import { randomUUID } from 'node:crypto';
import { harness } from './lib.mjs';

const h = harness('email-push');
const { admin, expect } = h;

try {
  const a = await h.createUser('a', { role: 'member', status: 'active' });
  const b = await h.createUser('b', { role: 'member', status: 'active' });
  const coordinator = await h.createUser('coordinator', { role: 'coordinator', status: 'active' });

  // ---- email_preferences -------------------------------------------------------------------------------------------
  const save1 = await a.client.from('email_preferences').upsert({ user_id: a.id, weekly_digest: true }, { onConflict: 'user_id' }).select().single();
  expect('a saves preferences (upsert on user_id)', !save1.error && save1.data?.user_id === a.id && save1.data?.weekly_digest === true, save1.error?.message);
  const save2 = await a.client.from('email_preferences').upsert({ user_id: a.id, opt_out_all: true }, { onConflict: 'user_id' }).select().single();
  const { count: prefRows } = await admin.from('email_preferences').select('*', { count: 'exact', head: true }).eq('user_id', a.id);
  expect('saving again updates the same single row', !save2.error && save2.data?.opt_out_all === true && prefRows === 1, `rows=${prefRows} ${save2.error?.message ?? ''}`);
  const readOwn = await a.client.from('email_preferences').select('*').eq('user_id', a.id).maybeSingle();
  expect('a can read own preferences', !readOwn.error && readOwn.data?.user_id === a.id, readOwn.error?.message);
  const readOther = await b.client.from('email_preferences').select('*').eq('user_id', a.id);
  expect("b cannot read a's preferences", !readOther.error && (readOther.data ?? []).length === 0, JSON.stringify(readOther.data));
  await b.client.from('email_preferences').update({ opt_out_all: false }).eq('user_id', a.id).select();
  const stillOptedOut = (await admin.from('email_preferences').select('opt_out_all').eq('user_id', a.id).single()).data?.opt_out_all;
  expect("b cannot change a's preferences", stillOptedOut === true);
  const forged = await b.client.from('email_preferences').insert({ user_id: a.id }).select();
  expect("b cannot create a preferences row for a's account", !!forged.error, 'insert succeeded');
  const coordRead = await coordinator.client.from('email_preferences').select('*').eq('user_id', a.id);
  expect("even a coordinator cannot read another account's preferences (personal data)", !coordRead.error && (coordRead.data ?? []).length === 0, JSON.stringify(coordRead.data));
  const anonRead = await h.newAnon().from('email_preferences').select('*').limit(1);
  expect('anon cannot read preferences', anonRead.error?.code === '42501', anonRead.error?.message);
  const legacyCol = await a.client.from('email_preferences').upsert({ user_id: a.id, member_id: a.id }, { onConflict: 'user_id' }).select();
  expect('there is no member_id column on email_preferences', !!legacyCol.error, 'member_id accepted');

  // ---- push_subscriptions ------------------------------------------------------------------------------------------
  const ep1 = `https://push.example.test/${randomUUID()}`;
  const ep2 = `https://push.example.test/${randomUUID()}`;
  const sub = (userId, endpoint) => ({ user_id: userId, endpoint, auth: 'auth-key', p256dh: 'p256dh-key', user_agent: 'certification' });
  const s1 = await a.client.from('push_subscriptions').upsert(sub(a.id, ep1), { onConflict: 'endpoint' }).select().single();
  const s2 = await a.client.from('push_subscriptions').upsert(sub(a.id, ep2), { onConflict: 'endpoint' }).select().single();
  expect('a can subscribe two devices', !s1.error && !s2.error, s1.error?.message ?? s2.error?.message);
  await a.client.from('push_subscriptions').upsert(sub(a.id, ep1), { onConflict: 'endpoint' }).select();
  const { count: deviceRows } = await admin.from('push_subscriptions').select('*', { count: 'exact', head: true }).eq('user_id', a.id);
  expect('re-subscribing the same endpoint does not duplicate it (still 2 devices)', deviceRows === 2, `rows=${deviceRows}`);
  const forgedSub = await b.client.from('push_subscriptions').upsert(sub(a.id, `https://push.example.test/${randomUUID()}`), { onConflict: 'endpoint' }).select();
  expect("b cannot subscribe a device in a's name", !!forgedSub.error, 'insert succeeded');
  const seeOthers = await b.client.from('push_subscriptions').select('*').eq('user_id', a.id);
  expect("b cannot see a's subscriptions (they hold push keys)", (seeOthers.data ?? []).length === 0);
  const coordSee = await coordinator.client.from('push_subscriptions').select('*').eq('user_id', a.id);
  expect("a coordinator cannot see another account's subscriptions", (coordSee.data ?? []).length === 0);
  await b.client.from('push_subscriptions').delete().eq('endpoint', ep1).select();
  const { count: afterForeignDelete } = await admin.from('push_subscriptions').select('*', { count: 'exact', head: true }).eq('endpoint', ep1);
  expect("b cannot unsubscribe a's device", afterForeignDelete === 1);
  const steal = await a.client.from('push_subscriptions').update({ user_id: b.id }).eq('endpoint', ep2).select();
  const owner = (await admin.from('push_subscriptions').select('user_id').eq('endpoint', ep2).single()).data?.user_id;
  expect("a cannot hand a subscription to another account", owner === a.id, `owner=${owner} err=${steal.error?.message ?? ''}`);
  const unsub = await a.client.from('push_subscriptions').delete().eq('endpoint', ep2).select();
  const { count: remaining } = await admin.from('push_subscriptions').select('*', { count: 'exact', head: true }).eq('user_id', a.id);
  expect('a can unsubscribe own device', !unsub.error && remaining === 1, `remaining=${remaining}`);
  const legacySub = await a.client.from('push_subscriptions').upsert({ ...sub(a.id, ep2), member_id: a.id }, { onConflict: 'endpoint' }).select();
  expect('there is no member_id column on push_subscriptions', !!legacySub.error, 'member_id accepted');

  // ---- push_notification_log ----------------------------------------------------------------------------------------
  const logRow = { user_id: a.id, notification_type: 'meeting', title: 'Cert', body: 'Cert body', status: 'sent' };
  const logInsert = await admin.from('push_notification_log').insert(logRow).select().single();
  expect('the backend (service_role) can write a log row', !logInsert.error, logInsert.error?.message);
  const noRecipient = await admin.from('push_notification_log').insert({ ...logRow, user_id: null });
  expect('a log row must have a recipient (user_id NOT NULL)', !!noRecipient.error, 'null accepted');
  const badStatus = await admin.from('push_notification_log').insert({ ...logRow, status: 'bogus' });
  expect('log status is constrained', !!badStatus.error, 'bogus accepted');
  for (const status of ['queued', 'sent', 'failed', 'clicked', 'dismissed']) {
    const r = await admin.from('push_notification_log').insert({ ...logRow, status });
    expect(`log status '${status}' is accepted`, !r.error, r.error?.message);
  }
  const ownLog = await a.client.from('push_notification_log').select('*').eq('user_id', a.id);
  expect('a can read own notification history', !ownLog.error && (ownLog.data ?? []).length >= 1, ownLog.error?.message);
  const otherLog = await b.client.from('push_notification_log').select('*').eq('user_id', a.id);
  expect("b cannot read a's notification history", (otherLog.data ?? []).length === 0);
  const coordLog = await coordinator.client.from('push_notification_log').select('*').eq('user_id', a.id);
  expect('a coordinator can read the log for operations', !coordLog.error && (coordLog.data ?? []).length >= 1, coordLog.error?.message);
  const clientInsert = await a.client.from('push_notification_log').insert(logRow).select();
  expect('a client cannot write the log', !!clientInsert.error, 'insert succeeded');
  const clientUpdate = await a.client.from('push_notification_log').update({ status: 'failed' }).eq('user_id', a.id).select();
  expect('a client cannot rewrite the log', (clientUpdate.data ?? []).length === 0);
  const clientDelete = await a.client.from('push_notification_log').delete().eq('user_id', a.id).select();
  expect('a client cannot delete from the log', (clientDelete.data ?? []).length === 0);
  const anonLog = await h.newAnon().from('push_notification_log').select('*').limit(1);
  expect('anon cannot read the log', anonLog.error?.code === '42501', anonLog.error?.message);

  // ---- account deletion removes the account's notification state -------------------------------------------------------
  const temp = await h.createUser('temp', { role: 'member', status: 'active' });
  await temp.client.from('email_preferences').upsert({ user_id: temp.id, weekly_digest: true }, { onConflict: 'user_id' });
  await temp.client.from('push_subscriptions').upsert(sub(temp.id, `https://push.example.test/${randomUUID()}`), { onConflict: 'endpoint' });
  await admin.from('push_notification_log').insert({ ...logRow, user_id: temp.id });
  await admin.auth.admin.deleteUser(temp.id);
  const counts = await Promise.all(['email_preferences', 'push_subscriptions', 'push_notification_log'].map(async (t) =>
    (await admin.from(t).select('*', { count: 'exact', head: true }).eq('user_id', temp.id)).count));
  expect('deleting an account removes its preferences, subscriptions and log (cascade)', counts.every((n) => n === 0), JSON.stringify(counts));

  // ---- scheduled email is backend-only (feature intentionally not scheduled) ---------------------------------------------
  const sched = await admin.from('scheduled_emails').insert({ recipient_email: 'nobody@example.test', subject: 'cert', html_content: '<p>cert</p>', scheduled_for: new Date().toISOString() }).select().single();
  expect('the backend can queue a scheduled email', !sched.error, sched.error?.message);
  if (sched.data) await admin.from('scheduled_emails').delete().eq('id', sched.data.id);
  const memberSched = await a.client.from('scheduled_emails').select('*').limit(1);
  expect('a member cannot read or queue scheduled email', memberSched.error?.code === '42501', memberSched.error?.message);
} catch (error) {
  h.fail('harness completed without error', error.message);
} finally {
  await h.cleanup();
  h.report();
}
