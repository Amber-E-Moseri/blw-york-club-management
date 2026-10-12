import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import webpush from 'npm:web-push@3.6.7';

// Sends one Web Push notification per active subscription to the people an event is aimed at.
// Called by the client right after an admin or coordinator saves a new event.
//
// Audience:
//   'all'      every active member with an active push subscription
//   'meeting'  the people assigned to the event's meeting (meeting_attendances), if still active

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const vapidSubject = Deno.env.get('VAPID_SUBJECT') ?? '';

const supabase = createClient(supabaseUrl, serviceRoleKey);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

async function requireAdminOrCoordinator(req: Request): Promise<string> {
  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!jwt) throw new HttpError('Authentication required', 401);

  const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
  if (userError || !userData?.user) throw new HttpError('Invalid authentication token', 401);

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, status')
    .eq('id', userData.user.id)
    .single();
  if (profileError || !profile) throw new HttpError('Profile not found', 403);
  if (profile.status !== 'active') throw new HttpError('Not authorised to notify members', 403);
  if (!['admin', 'coordinator'].includes(profile.role)) {
    throw new HttpError('Not authorised to notify members', 403);
  }
  return userData.user.id;
}

/** Active members who should receive this event's notification. */
async function resolveRecipientIds(event: {
  audience: string;
  audience_meeting_id: string | null;
}): Promise<string[]> {
  let candidateIds: string[];

  if (event.audience === 'meeting') {
    if (!event.audience_meeting_id) throw new Error('Event has a meeting audience but no meeting');
    const { data, error } = await supabase
      .from('meeting_attendances')
      .select('user_id')
      .eq('meeting_id', event.audience_meeting_id);
    if (error) throw new Error(error.message);
    candidateIds = (data ?? []).map((row: { user_id: string }) => row.user_id);
  } else {
    const { data, error } = await supabase.from('profiles').select('id').eq('status', 'active');
    if (error) throw new Error(error.message);
    candidateIds = (data ?? []).map((row: { id: string }) => row.id);
  }

  if (candidateIds.length === 0) return [];

  // A person assigned to a meeting who has since been rejected or deactivated must not be notified.
  const { data: active, error: activeError } = await supabase
    .from('profiles')
    .select('id')
    .in('id', candidateIds)
    .eq('status', 'active');
  if (activeError) throw new Error(activeError.message);
  return (active ?? []).map((row: { id: string }) => row.id);
}

function buildPayload(event: {
  id: string;
  title: string;
  date: string;
  time: string | null;
  location: string | null;
}): string {
  const when = [event.date, event.time ? `at ${event.time.slice(0, 5)}` : null].filter(Boolean).join(' ');
  const where = event.location ? ` · ${event.location}` : '';
  // `data` is what the service worker reads for the click target; the top-level url is kept for older workers.
  return JSON.stringify({
    title: `New event: ${event.title}`,
    body: `${when}${where}`,
    url: '/events',
    type: 'event',
    eventId: event.id,
    data: { url: '/events', type: 'event', eventId: event.id },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
      throw new HttpError('Push notifications are not configured', 500);
    }
    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

    await requireAdminOrCoordinator(req);

    const body = await req.json().catch(() => null);
    const eventId = typeof body?.event_id === 'string' ? body.event_id : '';
    if (!UUID.test(eventId)) throw new HttpError('event_id must be a UUID', 400);

    // Claim the event atomically so a double click or retry cannot send the notification twice.
    const { data: event, error: claimError } = await supabase
      .from('events')
      .update({ notified_at: new Date().toISOString() })
      .eq('id', eventId)
      .is('notified_at', null)
      .select('id, title, date, time, location, audience, audience_meeting_id')
      .maybeSingle();
    if (claimError) throw new HttpError(claimError.message, 500);
    if (!event) throw new HttpError('Event not found or already notified', 409);

    let recipientIds: string[];
    let subscriptions: Array<{ id: string; user_id: string; endpoint: string; p256dh: string; auth: string }>;
    try {
      recipientIds = await resolveRecipientIds(event);
      if (recipientIds.length === 0) {
        return json({
          event_id: eventId,
          recipients: 0,
          members_sent: 0,
          members_failed: 0,
          devices: 0,
          sent: 0,
          failed: 0,
          expired: 0,
          log_saved: true,
        });
      }
      const { data, error } = await supabase
        .from('push_subscriptions')
        .select('id, user_id, endpoint, p256dh, auth')
        .in('user_id', recipientIds)
        .eq('is_active', true);
      if (error) throw new Error(error.message);
      subscriptions = data ?? [];
    } catch (e) {
      // Release the claim so an admin can retry once the problem is fixed.
      await supabase.from('events').update({ notified_at: null }).eq('id', eventId);
      throw e;
    }

    const payload = buildPayload(event);
    const outcomes = await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
            { TTL: 60 * 60 * 24 }
          );
          return { sub, status: 'sent' as const, error: null };
        } catch (err) {
          const statusCode = (err as { statusCode?: number }).statusCode;
          // 404 and 410 mean the browser no longer accepts this endpoint.
          if (statusCode === 404 || statusCode === 410) {
            await supabase.from('push_subscriptions').update({ is_active: false }).eq('id', sub.id);
            return { sub, status: 'expired' as const, error: `Subscription gone (${statusCode})` };
          }
          return { sub, status: 'failed' as const, error: err instanceof Error ? err.message : String(err) };
        }
      })
    );

    // One log row per member: sent if any of their devices received it.
    const byUser = new Map<string, { sent: boolean; error: string | null }>();
    for (const { sub, status, error } of outcomes) {
      const current = byUser.get(sub.user_id) ?? { sent: false, error: null };
      if (status === 'sent') current.sent = true;
      if (error) current.error = error;
      byUser.set(sub.user_id, current);
    }
    const logRows = [...byUser.entries()].map(([userId, result]) => ({
      user_id: userId,
      notification_type: 'event',
      title: `New event: ${event.title}`,
      body: `${event.date}${event.location ? ` · ${event.location}` : ''}`,
      status: result.sent ? 'sent' : 'failed',
      response_data: { target_url: '/events', error: result.sent ? null : result.error },
    }));
    // The pushes have already gone out, so the event cannot be re-claimed. Retry the log once and report if it still fails.
    let logSaved = logRows.length === 0;
    for (let attempt = 1; attempt <= 2 && !logSaved; attempt++) {
      const { error: logError } = await supabase.from('push_notification_log').insert(logRows);
      if (!logError) logSaved = true;
      else console.error(`push_notification_log insert failed (attempt ${attempt})`, logError.message);
    }

    return json({
      event_id: eventId,
      recipients: recipientIds.length,
      // Member counts: one log row per member. Device counts: one per push subscription.
      members_sent: logRows.filter((r) => r.status === 'sent').length,
      members_failed: logRows.filter((r) => r.status === 'failed').length,
      devices: subscriptions.length,
      sent: outcomes.filter((o) => o.status === 'sent').length,
      failed: outcomes.filter((o) => o.status === 'failed').length,
      expired: outcomes.filter((o) => o.status === 'expired').length,
      log_saved: logSaved,
    });
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error('notify-event failed', err instanceof Error ? err.message : err);
    return json({ error: 'Could not send event notifications' }, 500);
  }
});
