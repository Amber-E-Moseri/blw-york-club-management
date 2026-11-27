import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import webpush from 'npm:web-push@3.6.7';
import { classifyPushError, type DeliveryOutcome } from '../_shared/event-notification.ts';
import {
  buildAnnouncementDeliveryLogRows,
  buildAnnouncementPushPayload,
} from '../_shared/announcement-notification.ts';

// Sends one Web Push notification per active device of the announcement's recipients.
//
// Authority and recipients are decided by the database (migration 069), never by this function or by the request:
//  - The caller is identified from a verified JWT. Role labels are not read here.
//  - claim_announcement_dispatch checks authority from live state (staff for organization-wide; an active leader of
//    the announcement's cell for a cell announcement) and atomically claims the announcement. A claim that already
//    exists means the announcement was dispatched: the request is refused and nothing is sent.
//  - resolve_announcement_recipients returns only devices the scope allows. Any recipient list in the body is ignored.
//  - A claim is released only if the failure happened before the first push. After a push starts, a claim is kept.

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
const NOT_AUTHORISED = 'Not authorised to notify members';

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

async function callerUserId(req: Request): Promise<string> {
  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!jwt) throw new HttpError('Authentication required', 401);

  const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
  if (userError || !userData?.user) throw new HttpError('Invalid authentication token', 401);
  return userData.user.id;
}

/** Maps a database refusal to the HTTP status: 42501 is an authority refusal, anything else is a server error. */
function refusal(error: { code?: string; message: string }, fallback: string): HttpError {
  if (error.code === '42501') return new HttpError(NOT_AUTHORISED, 403);
  console.error(fallback, error.message);
  return new HttpError('Could not send announcement notifications', 500);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // Set once the first push is attempted. Before that point a failure may release the claim; after it, never.
  let pushStarted = false;
  // True only when this request created the claim. A 409 for an existing claim must never release it.
  let claimedHere = false;
  let actorId = '';
  let announcementId = '';

  try {
    if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
      throw new HttpError('Push notifications are not configured', 500);
    }
    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

    actorId = await callerUserId(req);

    const body = await req.json().catch(() => null);
    announcementId = typeof body?.announcement_id === 'string' ? body.announcement_id : '';
    if (!UUID.test(announcementId)) throw new HttpError('announcement_id must be a UUID', 400);

    const { data: announcement, error: announcementError } = await supabase
      .from('announcements')
      .select('id, title, body')
      .eq('id', announcementId)
      .maybeSingle();
    if (announcementError) throw new HttpError('Could not load the announcement', 500);
    if (!announcement) throw new HttpError('Announcement not found', 404);

    // Atomic: authority is checked and the dispatch claimed in one database call.
    const { data: claimed, error: claimError } = await supabase.rpc('claim_announcement_dispatch', {
      p_announcement_id: announcementId,
      p_actor: actorId,
    });
    if (claimError) throw refusal(claimError, 'claim_announcement_dispatch failed');
    if (claimed !== true) throw new HttpError('Announcement already notified', 409);
    claimedHere = true;

    const { data: recipients, error: resolveError } = await supabase.rpc('resolve_announcement_recipients', {
      p_announcement_id: announcementId,
      p_actor: actorId,
    });
    if (resolveError) throw refusal(resolveError, 'resolve_announcement_recipients failed');

    const subscriptions = (recipients ?? []) as Array<{
      user_id: string;
      subscription_id: string;
      endpoint: string;
      p256dh: string;
      auth: string;
    }>;
    const recipientCount = new Set(subscriptions.map((sub) => sub.user_id)).size;
    if (subscriptions.length === 0) {
      return json({ announcement_id: announcementId, recipients: 0, devices: 0, sent: 0, failed: 0, expired: 0 });
    }

    const payload = buildAnnouncementPushPayload(announcement);
    pushStarted = true;
    const outcomes: Array<DeliveryOutcome & { endpointId: string }> = await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
            { TTL: 60 * 60 * 24 }
          );
          return { endpointId: sub.subscription_id, userId: sub.user_id, status: 'sent' as const, error: null };
        } catch (err) {
          const statusCode = (err as { statusCode?: number }).statusCode;
          const message = err instanceof Error ? err.message : String(err);
          const { status, error } = classifyPushError(statusCode, message);
          if (status === 'expired') {
            await supabase.from('push_subscriptions').update({ is_active: false }).eq('id', sub.subscription_id);
          }
          return { endpointId: sub.subscription_id, userId: sub.user_id, status, error };
        }
      })
    );

    const logRows = buildAnnouncementDeliveryLogRows(announcement, outcomes);
    if (logRows.length > 0) {
      const { error: logError } = await supabase.from('push_notification_log').insert(logRows);
      if (logError) console.error('push_notification_log insert failed', logError.message);
    }

    return json({
      announcement_id: announcementId,
      recipients: recipientCount,
      devices: subscriptions.length,
      sent: outcomes.filter((o) => o.status === 'sent').length,
      failed: outcomes.filter((o) => o.status === 'failed').length,
      expired: outcomes.filter((o) => o.status === 'expired').length,
    });
  } catch (err) {
    // A failure before any push leaves nothing sent, so the claim is released and a retry is possible.
    if (claimedHere && !pushStarted && announcementId && actorId) {
      const { error: releaseError } = await supabase.rpc('release_announcement_dispatch', {
        p_announcement_id: announcementId,
        p_actor: actorId,
      });
      if (releaseError) console.error('release_announcement_dispatch failed', releaseError.message);
    }
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error('notify-announcement failed', err instanceof Error ? err.message : err);
    return json({ error: 'Could not send announcement notifications' }, 500);
  }
});
