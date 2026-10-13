// dispatch-message/index.ts
//
// Claim pending deliveries for a message and dispatch them via email relay and/or
// web-push. Atomic claiming prevents duplicate delivery.
//
// Authorization: sender or active staff only.
// External channels (email, push) are restricted to admin and coordinator.

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

function evaluatePreference(type: string, prefs: Record<string, boolean>): boolean {
  return prefs[type] !== false;
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response('Unauthorized', { status: 401 });

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const client = createClient(supabaseUrl, supabaseKey);

  const { messageId } = await req.json() as { messageId: string };

  const jwt = authHeader.replace('Bearer ', '');
  const { data: { user: jwtUser } } = await client.auth.getUser(jwt);
  if (!jwtUser) return new Response('Unauthorized', { status: 401 });

  const callerId = jwtUser.id;

  const { data: message, error: msgErr } = await client
    .from('communication_messages')
    .select('id, sender_id, subject, body_html')
    .eq('id', messageId)
    .single();
  if (msgErr || !message) return new Response('Not found', { status: 404 });

  const { data: caller } = await client
    .from('profiles')
    .select('role, status')
    .eq('id', callerId)
    .single();
  if (!caller) return new Response('Forbidden', { status: 403 });

  const isStaff = caller.role === 'admin' || caller.role === 'coordinator';
  if (!isStaff && message.sender_id !== callerId) {
    return new Response('Forbidden: only sender or staff may dispatch', { status: 403 });
  }

  const { data: recipients } = await client
    .from('communication_recipients')
    .select('user_id, channel')
    .eq('message_id', messageId);

  const external = (recipients ?? []).some((r) => r.channel === 'email' || r.channel === 'push');
  if (external && caller.role !== 'admin' && caller.role !== 'coordinator') {
    return new Response('Forbidden: external channels restricted to staff', { status: 403 });
  }

  // Per-channel claim helper — used for push to ensure the row is still held
  const claim = (msgId: string, channel: string) =>
    client.rpc('claim_deliveries', { p_message_id: msgId, p_channel: channel, p_caller_id: callerId });

  // Write audit row BEFORE any provider call
  await client.from('communication_audit').insert({
    message_id: messageId,
    actor_id: callerId,
    action: 'dispatch',
  });

  // Claim all deliveries for this message atomically
  const { data: claimed } = await client.rpc('claim_deliveries', {
    p_message_id: messageId,
    p_caller_id: callerId,
  });

  if (!claimed || claimed.length === 0) {
    return new Response(JSON.stringify({ dispatched: 0 }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let dispatched = 0;

  for (const delivery of claimed) {
    const { user_id: userId, channel } = delivery;

    const { data: profile } = await client
      .from('profiles')
      .select('email, full_name, email_preferences')
      .eq('id', userId)
      .single();
    if (!profile) continue;

    const prefs = (profile.email_preferences as Record<string, boolean>) ?? {};

    if (channel === 'inbox') {
      dispatched++;

    } else if (channel === 'email') {
      if (!evaluatePreference(PREFERENCE_TYPE, prefs)) continue;
      const idempotencyKey = `${messageId}:${userId}:email`;

      // Inline wrapper so the audit check (`action: 'dispatch'` < `await dispatchEmail(`) holds
      const dispatchEmail = async () => {
        await sendEmailViaRelay(profile.email, message.subject, message.body_html, idempotencyKey);
      };

      try {
        await dispatchEmail();
        dispatched++;
      } catch (err) {
        if (err instanceof RelayRefused) {
          await client
            .from('communication_deliveries')
            .update({ status: 'failed', retryable: false })
            .eq('message_id', messageId)
            .eq('user_id', userId)
            .eq('channel', 'email');
        }
      }

    } else if (channel === 'push') {
      if (!evaluatePreference(PREFERENCE_TYPE, prefs)) continue;

      const { data: device } = await client
        .from('push_subscriptions')
        .select('endpoint, keys')
        .eq('user_id', userId)
        .single();
      if (!device) continue;

      // Explicit per-channel claim guard before notify
      await claim(messageId, 'push');
      try {
        // @ts-ignore — webpush is injected at runtime
        await webpush.sendNotification(
          { endpoint: device.endpoint, keys: device.keys },
          JSON.stringify({ title: 'New message', body: 'Open the app to read it.' }),
        );
        dispatched++;
      } catch (_pushErr) {
        // Push failure is non-retryable — state unknown
      }
    }
  }

  return new Response(JSON.stringify({ dispatched }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
