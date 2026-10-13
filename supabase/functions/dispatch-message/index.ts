import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import webpush from 'npm:web-push@3.6.7';
import { evaluatePreference, type EmailPreferenceRow } from '../_shared/email-preference-guard.ts';
import { classifyPushError } from '../_shared/event-notification.ts';

// Delivers the external channels (email, push) of one message that send_message already wrote to the database.
// The inbox is written by send_message in its own transaction, so this function never decides who receives a message.
//
// Delivery rules:
//   - Claiming is atomic in the database (claim_deliveries). A row is claimed once, moves to 'sending', and counts
//     one attempt. A second dispatch cannot claim a row that is already 'sending' or 'accepted'.
//   - 'accepted' means the email relay or push service accepted the request. It does not mean the member received it.
//   - Retryable failures are only those the provider definitively refused or that were never attempted (config
//     missing, relay 4xx). Network errors and 5xx responses are NOT retryable, because the provider may have accepted
//     the message anyway. Re-sending in that case could duplicate delivery.
//   - Nothing retries automatically. A sender triggers a retry by calling dispatch again. Attempts are capped at 3
//     in claim_deliveries.
//   - Rows left in 'sending' by a crashed dispatch are closed by expire_stuck_deliveries as 'outcome-unknown' and are
//     never retried.
//   - Email uses the 'message_notification' preference. Only messages use it, so admin-announcement opt-outs do not
//     silence direct messages.

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
const PREFERENCE_TYPE = 'message_notification';

class HttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** The relay answered with a definitive refusal (HTTP 4xx). The message was not accepted, so a retry cannot duplicate it. */
class RelayRefused extends Error {}

/** The email relay is not configured here. Nothing was attempted, so a later dispatch may try again. */
class NotConfigured extends Error {}

interface ClaimedRow { user_id: string }

type Outcome =
  | { status: 'accepted'; providerRef: string | null }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; reason: string; retryable: boolean };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** Returns the caller's id after checking they may dispatch this message: its sender, or an active admin or coordinator. */
async function authorizeDispatch(req: Request, messageId: string): Promise<{ callerId: string; role: string }> {
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
  return { callerId, role: caller.role };
}

async function claim(messageId: string, channel: 'email' | 'push'): Promise<string[]> {
  const { data, error } = await supabase.rpc('claim_deliveries', { p_message_id: messageId, p_channel: channel });
  if (error) throw new Error(error.message);
  return ((data ?? []) as ClaimedRow[]).map((row) => row.user_id);
}

async function record(messageId: string, userId: string, channel: 'email' | 'push', outcome: Outcome): Promise<void> {
  const update =
    outcome.status === 'accepted'
      ? { status: 'accepted', provider_ref: outcome.providerRef, reason: null, retryable: false }
      : outcome.status === 'skipped'
        ? { status: 'skipped', reason: outcome.reason.slice(0, MAX_REASON), retryable: false }
        : { status: 'failed', reason: outcome.reason.slice(0, MAX_REASON), retryable: outcome.retryable };
  const { error } = await supabase
    .from('communication_deliveries')
    .update(update)
    .eq('message_id', messageId)
    .eq('user_id', userId)
    .eq('channel', channel)
    .eq('status', 'sending');
  if (error) console.error('delivery outcome update failed', error.message);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}

/**
 * Sends one email through the relay. The Idempotency-Key lets a relay that honours it recognise a repeated request.
 * Whether the relay honours it is NOT verified here.
 */
async function sendEmailViaRelay(to: string, subject: string, html: string, idempotencyKey: string): Promise<{ id: string }> {
  if (!emailRelayUrl || !emailRelaySecret) throw new NotConfigured('EMAIL_PROVIDER_NOT_CONFIGURED');
  let res: Response;
  try {
    res = await fetch(emailRelayUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${emailRelaySecret}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({ to, subject, html }),
    });
  } catch (err) {
    // The request may have reached the relay before the connection failed. Treat it as uncertain, not refused.
    throw new Error(`Relay unreachable: ${err instanceof Error ? err.message : 'network error'}`);
  }
  const data = await res.json().catch(() => ({}));
  if (res.ok) return { id: data.messageId ?? crypto.randomUUID() };
  if (res.status >= 400 && res.status < 500) throw new RelayRefused(data?.message ?? `Relay refused (${res.status})`);
  throw new Error(data?.message ?? `Relay error ${res.status} (outcome unknown)`);
}

function outcomeForEmailError(err: unknown): Outcome {
  if (err instanceof NotConfigured) return { status: 'failed', reason: err.message, retryable: true };
  if (err instanceof RelayRefused) return { status: 'failed', reason: err.message, retryable: true };
  return { status: 'failed', reason: err instanceof Error ? err.message : 'Email error', retryable: false };
}

async function dispatchEmail(messageId: string, subject: string, body: string): Promise<{ accepted: number; failed: number; skipped: number }> {
  const userIds = await claim(messageId, 'email');
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
    let outcome: Outcome;
    if (!profile || profile.status !== 'active' || !profile.email) {
      outcome = { status: 'skipped', reason: 'not-active-or-no-address' };
    } else {
      const decision = evaluatePreference(PREFERENCE_TYPE, prefsById.get(userId) ?? null, userId);
      if (!decision.send) {
        outcome = { status: 'skipped', reason: decision.reason };
      } else {
        try {
          const sent = await sendEmailViaRelay(profile.email, subject, html, `${messageId}:${userId}:email`);
          outcome = { status: 'accepted', providerRef: sent.id };
        } catch (err) {
          outcome = outcomeForEmailError(err);
        }
      }
    }
    await record(messageId, userId, 'email', outcome);
    if (outcome.status === 'accepted') counts.accepted++;
    else if (outcome.status === 'skipped') counts.skipped++;
    else counts.failed++;
  }
  return counts;
}

async function dispatchPush(messageId: string): Promise<{ accepted: number; failed: number; skipped: number }> {
  const userIds = await claim(messageId, 'push');
  const counts = { accepted: 0, failed: 0, skipped: 0 };
  if (userIds.length === 0) return counts;

  if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    for (const userId of userIds) {
      await record(messageId, userId, 'push', { status: 'failed', reason: 'PUSH_NOT_CONFIGURED', retryable: true });
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
    let outcome: Outcome;
    if (devices.length === 0) {
      outcome = { status: 'skipped', reason: 'no-active-subscription' };
    } else {
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
      outcome = anyAccepted
        ? { status: 'accepted', providerRef: null }
        : { status: 'failed', reason: lastError ?? 'Push error', retryable: false };
    }
    await record(messageId, userId, 'push', outcome);
    if (outcome.status === 'accepted') counts.accepted++;
    else if (outcome.status === 'skipped') counts.skipped++;
    else counts.failed++;
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

    const caller = await authorizeDispatch(req, messageId);

    const { data: message, error } = await supabase
      .from('communication_messages')
      .select('subject, body, channels, sender_role, recipient_count, audience_spec_id')
      .eq('id', messageId)
      .single();
    if (error || !message) throw new HttpError('Message not found', 404);

    // External broadcasts are staff-only, checked again here in case a message row was written another way.
    const external = (message.channels as string[]).some((c) => c === 'email' || c === 'push');
    if (external && caller.role !== 'admin' && caller.role !== 'coordinator') {
      throw new HttpError('External email and push are restricted to admins and coordinators', 403);
    }

    // Close rows a crashed earlier dispatch left in 'sending'. They are never retried (see header).
    await supabase.rpc('expire_stuck_deliveries', { p_older_than: '15 minutes' });

    const { data: spec, error: specError } = await supabase
      .from('audience_specs')
      .select('mode')
      .eq('id', message.audience_spec_id)
      .single();
    if (specError || !spec) throw new HttpError('Could not read the audience for this message', 500);

    // The audit row must exist before any provider is called. If it cannot be written, nothing is sent.
    const { error: auditError } = await supabase.from('communication_audit').insert({
      message_id: messageId,
      actor_id: caller.callerId,
      actor_role: caller.role,
      action: 'dispatch',
      audience_mode: spec.mode,
      recipient_count: message.recipient_count,
    });
    if (auditError) throw new HttpError('Could not record the dispatch audit; nothing was sent', 500);

    const email = await dispatchEmail(messageId, message.subject, message.body);
    const push = await dispatchPush(messageId);

    return json({ message_id: messageId, email, push });
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error('dispatch-message failed', err instanceof Error ? err.message : err);
    return json({ error: 'Could not dispatch message' }, 500);
  }
});
