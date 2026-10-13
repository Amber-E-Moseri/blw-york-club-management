import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import webpush from 'npm:web-push@3.6.7';
import { evaluatePreference, type EmailPreferenceRow } from '../_shared/email-preference-guard.ts';
import { classifyPushError } from '../_shared/event-notification.ts';

// Delivers the external channels (email, push) of one message that send_message already wrote to the database.
// The inbox is written by send_message in its own transaction, so this function never decides who receives a message.
// It only delivers rows that are 'pending' for that message.
//
// Idempotency: each pending row is claimed by an UPDATE ... WHERE status = 'pending' (set to 'sending') before any
// provider call. A retry or a second click finds no pending rows and sends nothing again.
//
// Outcome honesty: 'accepted' means the email relay or the push service accepted the request. It is not proof that
// the member read or received it. Nothing here writes 'delivered'.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const emailRelayUrl = Deno.env.get('EMAIL_RELAY_URL') ?? '';
const emailRelaySecret = Deno.env.get('EMAIL_RELAY_SECRET') ?? '';
const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const vapidSubject = Deno.env.get('VAPID_SUBJECT') ?? '';

const supabase = createClient(supabaseUrl, serviceRoleKey);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_REASON = 200;

class HttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** Returns the caller and the message they may dispatch: the sender, or any active admin or coordinator. */
async function authorizeDispatch(req: Request, messageId: string): Promise<{ senderId: string }> {
  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!jwt) throw new HttpError('Authentication required', 401);

  const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
  if (userError || !userData?.user) throw new HttpError('Invalid authentication token', 401);
  const callerId = userData.user.id;

  const { data: caller } = await supabase.from('profiles').select('role, status').eq('id', callerId).maybeSingle();
  if (!caller || caller.status !== 'active') throw new HttpError('Not authorised to dispatch this message', 403);

  const { data: message, error: messageError } = await supabase
    .from('communication_messages')
    .select('sender_id')
    .eq('id', messageId)
    .maybeSingle();
  if (messageError) throw new HttpError('Could not load message', 500);
  if (!message) throw new HttpError('Message not found', 404);

  const isStaff = caller.role === 'admin' || caller.role === 'coordinator';
  if (!isStaff && message.sender_id !== callerId) throw new HttpError('Not authorised to dispatch this message', 403);
  return { senderId: message.sender_id };
}

/** Claim pending rows for one channel. Only rows still 'pending' are returned; each becomes 'sending'. */
async function claimPending(messageId: string, channel: 'email' | 'push'): Promise<string[]> {
  const { data, error } = await supabase
    .from('communication_deliveries')
    .update({ status: 'sending', attempted_at: new Date().toISOString() })
    .eq('message_id', messageId)
    .eq('channel', channel)
    .eq('status', 'pending')
    .select('user_id');
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: { user_id: string }) => row.user_id);
}

async function finish(
  messageId: string,
  userId: string,
  channel: 'email' | 'push',
  outcome: { status: 'accepted' | 'failed' | 'skipped'; reason?: string | null; providerRef?: string | null },
): Promise<void> {
  const { error } = await supabase
    .from('communication_deliveries')
    .update({
      status: outcome.status,
      reason: outcome.reason ? outcome.reason.slice(0, MAX_REASON) : null,
      provider_ref: outcome.providerRef ?? null,
    })
    .eq('message_id', messageId)
    .eq('user_id', userId)
    .eq('channel', channel)
    .eq('status', 'sending');
  if (error) console.error('delivery outcome update failed', error.message);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}

async function sendEmailViaRelay(to: string, subject: string, html: string): Promise<{ id: string }> {
  if (!emailRelayUrl || !emailRelaySecret) throw new Error('EMAIL_PROVIDER_NOT_CONFIGURED');
  const res = await fetch(emailRelayUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${emailRelaySecret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ to, subject, html }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message ?? `Email relay error ${res.status}`);
  return { id: data.messageId ?? crypto.randomUUID() };
}

async function dispatchEmail(messageId: string, subject: string, body: string): Promise<{ accepted: number; failed: number; skipped: number }> {
  const userIds = await claimPending(messageId, 'email');
  const counts = { accepted: 0, failed: 0, skipped: 0 };
  if (userIds.length === 0) return counts;

  const { data: profiles } = await supabase.from('profiles').select('id, email, status').in('id', userIds);
  const { data: prefRows } = await supabase
    .from('email_preferences')
    .select('user_id, opt_out_all, meeting_reminders_8am, meeting_reminders_1hr, message_notifications, habit_milestones, devotional_reminders, testimony_approved, weekly_digest, admin_announcements')
    .in('user_id', userIds);
  const profileById = new Map((profiles ?? []).map((p: { id: string; email: string | null; status: string }) => [p.id, p]));
  const prefsById = new Map((prefRows ?? []).map((r: { user_id: string } & EmailPreferenceRow) => [r.user_id, r]));

  const html = `<div style="font-family:sans-serif">${body.split(/\n+/).map((line) => `<p>${escapeHtml(line)}</p>`).join('')}</div>`;

  for (const userId of userIds) {
    const profile = profileById.get(userId);
    if (!profile || profile.status !== 'active' || !profile.email) {
      await finish(messageId, userId, 'email', { status: 'skipped', reason: 'not-active-or-no-address' });
      counts.skipped++;
      continue;
    }
    const decision = evaluatePreference('generic', prefsById.get(userId) ?? null, userId);
    if (!decision.send) {
      await finish(messageId, userId, 'email', { status: 'skipped', reason: decision.reason });
      counts.skipped++;
      continue;
    }
    try {
      const sent = await sendEmailViaRelay(profile.email, subject, html);
      await finish(messageId, userId, 'email', { status: 'accepted', providerRef: sent.id });
      counts.accepted++;
    } catch (err) {
      await finish(messageId, userId, 'email', { status: 'failed', reason: err instanceof Error ? err.message : 'Email error' });
      counts.failed++;
    }
  }
  return counts;
}

async function dispatchPush(messageId: string): Promise<{ accepted: number; failed: number; skipped: number }> {
  const userIds = await claimPending(messageId, 'push');
  const counts = { accepted: 0, failed: 0, skipped: 0 };
  if (userIds.length === 0) return counts;

  if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    for (const userId of userIds) {
      await finish(messageId, userId, 'push', { status: 'failed', reason: 'PUSH_NOT_CONFIGURED' });
      counts.failed++;
    }
    return counts;
  }
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('id, user_id, endpoint, p256dh, auth')
    .in('user_id', userIds)
    .eq('is_active', true);
  const subsByUser = new Map<string, Array<{ id: string; endpoint: string; p256dh: string; auth: string }>>();
  for (const sub of subs ?? []) {
    const list = subsByUser.get(sub.user_id) ?? [];
    list.push(sub);
    subsByUser.set(sub.user_id, list);
  }

  // The push body names no content: it appears on lock screens. The member opens the app to read it.
  const payload = JSON.stringify({
    title: 'New message from BLW York',
    body: 'Open the app to read it.',
    url: '/communications',
    type: 'message',
    messageId,
  });

  for (const userId of userIds) {
    const devices = subsByUser.get(userId) ?? [];
    if (devices.length === 0) {
      await finish(messageId, userId, 'push', { status: 'skipped', reason: 'no-active-subscription' });
      counts.skipped++;
      continue;
    }
    let anyAccepted = false;
    let lastError: string | null = null;
    for (const sub of devices) {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: 60 * 60 * 24 });
        anyAccepted = true;
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        const message = err instanceof Error ? err.message : String(err);
        const { status, error } = classifyPushError(statusCode, message);
        if (status === 'expired') await supabase.from('push_subscriptions').update({ is_active: false }).eq('id', sub.id);
        lastError = error;
      }
    }
    if (anyAccepted) {
      await finish(messageId, userId, 'push', { status: 'accepted' });
      counts.accepted++;
    } else {
      await finish(messageId, userId, 'push', { status: 'failed', reason: lastError ?? 'Push error' });
      counts.failed++;
    }
  }
  return counts;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const body = await req.json().catch(() => null);
    const messageId = typeof body?.message_id === 'string' ? body.message_id : '';
    if (!UUID.test(messageId)) throw new HttpError('message_id must be a UUID', 400);

    await authorizeDispatch(req, messageId);

    const { data: message, error } = await supabase
      .from('communication_messages')
      .select('subject, body')
      .eq('id', messageId)
      .single();
    if (error || !message) throw new HttpError('Message not found', 404);

    const email = await dispatchEmail(messageId, message.subject, message.body);
    const push = await dispatchPush(messageId);

    return json({ message_id: messageId, email, push });
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error('dispatch-message failed', err instanceof Error ? err.message : err);
    return json({ error: 'Could not dispatch message' }, 500);
  }
});
