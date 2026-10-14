// dispatch-message/index.ts
//
// Claim pending deliveries for a message and dispatch them via email relay. Atomic claiming (claim_deliveries) prevents
// duplicate delivery; a replay claims nothing that is accepted, skipped, or still outcome-unknown.
//
// Authorization: sender or active staff only. The caller must be an active account.
// External channels (email, push) are restricted to admin and coordinator.
//
// Contract with the database (migrations 069, 071, 075, 076):
//   claim_deliveries(p_message_id uuid, p_channel text)   service_role only; one channel per call
//   communication_audit: actor_id, actor_role, action, audience_mode, recipient_count (all NOT NULL)
//   communication_deliveries: status in pending|sending|stored|accepted|failed|skipped
//
// Response: DispatchSummary, the shape the client reads (src/lib/queries/communications.ts):
//   { email: { accepted, failed, skipped }, push: { accepted, failed, skipped }, unknown }
// `unknown` counts external sends whose outcome is not known (relay unreachable or 5xx). Those rows stay 'sending' and
// are closed as outcome-unknown by expire_stuck_deliveries. They are never re-sent.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const PREFERENCE_TYPE = 'message_notification';

// ── Relay error types ─────────────────────────────────────────────────────────

class RelayRefused extends Error {
  constructor(msg: string) { super(msg); this.name = 'RelayRefused'; }
}

// ── Email relay ───────────────────────────────────────────────────────────────
// Wraps the external relay. Throws RelayRefused on 4xx (definitive refusal).
// A network failure throws a plain Error — relay may have accepted the request.

async function sendEmailViaRelay(
  address: string,
  subject: string,
  html: string,
  idempotencyKey: string,
): Promise<void> {
  const relayUrl = Deno.env.get('EMAIL_RELAY_URL') ?? '';
  const relayKey = Deno.env.get('EMAIL_RELAY_API_KEY') ?? '';

  let res: Response;
  try {
    res = await fetch(relayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${relayKey}`,
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({ to: address, subject, html }),
    });
  } catch (_networkErr) {
    throw new Error('Relay unreachable');
  }
  const data = await res.json().catch(() => null);
  if (res.status >= 400 && res.status < 500) throw new RelayRefused(`relay refused ${res.status}: ${JSON.stringify(data)}`);
  if (!res.ok) throw new Error(`relay error ${res.status}`);
}

// ── Preference evaluation ─────────────────────────────────────────────────────
// email_preferences is one row per user (message_notifications, opt_out_all). No row means the defaults apply.

function preferencesFromRow(row: { message_notifications: boolean; opt_out_all: boolean } | null): Record<string, boolean> {
  if (!row) return {};
  return { [PREFERENCE_TYPE]: row.message_notifications !== false && row.opt_out_all !== true };
}

function evaluatePreference(type: string, prefs: Record<string, boolean>): boolean {
  return prefs[type] !== false;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

type Channel = 'email' | 'push';
type Counts = { accepted: number; failed: number; skipped: number };

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response('Unauthorized', { status: 401 });

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const client = createClient(supabaseUrl, supabaseKey);

  const { message_id: messageId } = await req.json() as { message_id: string };

  const jwt = authHeader.replace('Bearer ', '');
  const { data: { user: jwtUser } } = await client.auth.getUser(jwt);
  if (!jwtUser) return new Response('Unauthorized', { status: 401 });

  const callerId = jwtUser.id;

  const { data: message, error: msgErr } = await client
    .from('communication_messages')
    .select('id, sender_id, subject, body, channels, recipient_count, audience_spec_id')
    .eq('id', messageId)
    .single();
  if (msgErr || !message) return new Response('Not found', { status: 404 });

  const { data: caller } = await client
    .from('profiles')
    .select('role, status')
    .eq('id', callerId)
    .single();
  if (!caller || caller.status !== 'active') return new Response('Forbidden', { status: 403 });

  const isStaff = caller.role === 'admin' || caller.role === 'coordinator';
  if (!isStaff && message.sender_id !== callerId) {
    return new Response('Forbidden: only sender or staff may dispatch', { status: 403 });
  }

  const channels = (message.channels ?? []) as string[];
  const wantsEmail = channels.includes('email');
  const wantsPush = channels.includes('push');
  if ((wantsEmail || wantsPush) && !isStaff) {
    return new Response('Forbidden: external channels restricted to staff', { status: 403 });
  }

  // Audit attribution is written BEFORE any provider call, and a failed audit write stops the dispatch.
  const { data: spec, error: specErr } = await client
    .from('audience_specs')
    .select('mode')
    .eq('id', message.audience_spec_id)
    .single();
  if (specErr || !spec) return new Response('Audience unavailable; nothing dispatched', { status: 500 });

  const { error: auditErr } = await client.from('communication_audit').insert({
    message_id: messageId,
    actor_id: callerId,
    actor_role: caller.role,
    action: 'dispatch',
    audience_mode: spec.mode,
    recipient_count: message.recipient_count,
  });
  if (auditErr) return new Response(`Audit write failed; nothing dispatched: ${auditErr.message}`, { status: 500 });

  const summary: { email: Counts; push: Counts; unknown: number } = {
    email: { accepted: 0, failed: 0, skipped: 0 },
    push: { accepted: 0, failed: 0, skipped: 0 },
    unknown: 0,
  };

  // Per-channel claim: one database call per channel. Only pending rows, and retryable failures, are returned.
  const claim = async (channel: Channel) => {
    const { data, error } = await client.rpc('claim_deliveries', { p_message_id: messageId, p_channel: channel });
    if (error) throw new Error(`claim ${channel} failed: ${error.message}`);
    return (data ?? []) as { user_id: string }[];
  };

  const mark = async (userId: string, channel: Channel, status: string, reason: string | null, retryable: boolean) => {
    const { error } = await client
      .from('communication_deliveries')
      .update({ status, reason, retryable })
      .eq('message_id', messageId)
      .eq('user_id', userId)
      .eq('channel', channel);
    if (error) console.error(`could not record ${status} for ${userId}/${channel}: ${error.message}`);
  };

  const htmlBody = `<p>${escapeHtml(message.body).replace(/\n/g, '<br>')}</p>`;

  if (wantsEmail) {
    let claimed: { user_id: string }[];
    try { claimed = await claim('email'); }
    catch (err) { return new Response((err as Error).message, { status: 500 }); }

    for (const delivery of claimed) {
      const userId = delivery.user_id;
      const { data: profile } = await client
        .from('profiles')
        .select('email')
        .eq('id', userId)
        .single();
      if (!profile?.email) { await mark(userId, 'email', 'failed', 'no email address on the account', false); summary.email.failed++; continue; }

      const { data: prefRow } = await client
        .from('email_preferences')
        .select('message_notifications, opt_out_all')
        .eq('user_id', userId)
        .maybeSingle();
      if (!evaluatePreference(PREFERENCE_TYPE, preferencesFromRow(prefRow))) {
        await mark(userId, 'email', 'skipped', 'opted out of message notifications', false);
        summary.email.skipped++;
        continue;
      }

      const idempotencyKey = `${messageId}:${userId}:email`;
      // Inline wrapper so the audit check (`action: 'dispatch'` < `await dispatchEmail(`) holds
      const dispatchEmail = async () => {
        await sendEmailViaRelay(profile.email, message.subject, htmlBody, idempotencyKey);
      };

      try {
        await dispatchEmail();
        await mark(userId, 'email', 'accepted', null, false);
        summary.email.accepted++;
      } catch (err) {
        if (err instanceof RelayRefused) {
          await mark(userId, 'email', 'failed', err.message, false);
          summary.email.failed++;
        } else {
          // Outcome unknown: leave the row 'sending'. expire_stuck_deliveries closes it; it is never re-sent here.
          summary.unknown++;
        }
      }
    }
  }

  if (wantsPush) {
    let claimed: { user_id: string }[];
    try { claimed = await claim('push'); }
    catch (err) { return new Response((err as Error).message, { status: 500 }); }

    // No web-push provider is configured in this deployment. Each claimed row is recorded as failed with the reason,
    // and stays retryable, so a later dispatch can retry once a provider exists. Nothing is reported as accepted.
    for (const delivery of claimed) {
      const { data: prefRow } = await client
        .from('email_preferences')
        .select('message_notifications, opt_out_all')
        .eq('user_id', delivery.user_id)
        .maybeSingle();
      if (!evaluatePreference(PREFERENCE_TYPE, preferencesFromRow(prefRow))) {
        await mark(delivery.user_id, 'push', 'skipped', 'opted out of message notifications', false);
        summary.push.skipped++;
        continue;
      }
      await mark(delivery.user_id, 'push', 'failed', 'push provider not configured for this deployment', true);
      summary.push.failed++;
    }
  }

  return new Response(JSON.stringify(summary), {
    headers: { 'Content-Type': 'application/json' },
  });
});
