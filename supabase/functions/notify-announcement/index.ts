import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import webpush from 'npm:web-push@3.6.7';
import { classifyPushError, type DeliveryOutcome } from '../_shared/event-notification.ts';
import {
  announcementTargetUrl,
  buildAnnouncementDeliveryLogRows,
  buildAnnouncementPushPayload,
} from '../_shared/announcement-notification.ts';

// Sends one Web Push notification per active subscription to every active member.
// Called by the client right after an announcement is posted.
//
// Who may send: the announcement's author, or an admin or coordinator. Authors can be admins, coordinators or
// cell leaders, matching who may post in the first place.
//
// Sent at most once per announcement: a delivery log row keyed by the announcement's route is the marker.

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

const POSTING_ROLES = ['admin', 'coordinator', 'cell_leader'];
const MANAGING_ROLES = ['admin', 'coordinator'];

async function requireCaller(req: Request): Promise<{ userId: string; role: string }> {
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
  if (profile.status !== 'active' || !POSTING_ROLES.includes(profile.role)) {
    throw new HttpError('Not authorised to notify members', 403);
  }
  return { userId: userData.user.id, role: profile.role };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
      throw new HttpError('Push notifications are not configured', 500);
    }
    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

    const caller = await requireCaller(req);

    const body = await req.json().catch(() => null);
    const announcementId = typeof body?.announcement_id === 'string' ? body.announcement_id : '';
    if (!UUID.test(announcementId)) throw new HttpError('announcement_id must be a UUID', 400);

    const { data: announcement, error: announcementError } = await supabase
      .from('announcements')
      .select('id, title, body, author_id')
      .eq('id', announcementId)
      .maybeSingle();
    if (announcementError) throw new HttpError(announcementError.message, 500);
    if (!announcement) throw new HttpError('Announcement not found', 404);

    if (!MANAGING_ROLES.includes(caller.role) && announcement.author_id !== caller.userId) {
      throw new HttpError('Not authorised to notify members', 403);
    }

    // Already sent? The delivery log row for this announcement's route is the marker.
    const { data: existing, error: existingError } = await supabase
      .from('push_notification_log')
      .select('id')
      .eq('notification_type', 'announcement')
      .eq('target_url', announcementTargetUrl(announcement.id))
      .limit(1);
    if (existingError) throw new HttpError(existingError.message, 500);
    if ((existing ?? []).length > 0) throw new HttpError('Announcement already notified', 409);

    const { data: members, error: membersError } = await supabase
      .from('profiles')
      .select('id')
      .eq('status', 'active');
    if (membersError) throw new HttpError(membersError.message, 500);
    const memberIds = (members ?? []).map((row: { id: string }) => row.id);

    const subscriptions: Array<{ id: string; user_id: string; endpoint: string; p256dh: string; auth: string }> = [];
    if (memberIds.length > 0) {
      const { data, error } = await supabase
        .from('push_subscriptions')
        .select('id, user_id, endpoint, p256dh, auth')
        .in('user_id', memberIds)
        .eq('is_active', true);
      if (error) throw new HttpError(error.message, 500);
      subscriptions.push(...(data ?? []));
    }

    const recipientCount = new Set(subscriptions.map((sub) => sub.user_id)).size;
    if (subscriptions.length === 0) {
      return json({ announcement_id: announcementId, recipients: 0, devices: 0, sent: 0, failed: 0, expired: 0 });
    }

    const payload = buildAnnouncementPushPayload(announcement);
    const outcomes: Array<DeliveryOutcome & { endpointId: string }> = await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
            { TTL: 60 * 60 * 24 }
          );
          return { endpointId: sub.id, userId: sub.user_id, status: 'sent' as const, error: null };
        } catch (err) {
          const statusCode = (err as { statusCode?: number }).statusCode;
          const message = err instanceof Error ? err.message : String(err);
          const { status, error } = classifyPushError(statusCode, message);
          if (status === 'expired') {
            await supabase.from('push_subscriptions').update({ is_active: false }).eq('id', sub.id);
          }
          return { endpointId: sub.id, userId: sub.user_id, status, error };
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
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error('notify-announcement failed', err instanceof Error ? err.message : err);
    return json({ error: 'Could not send announcement notifications' }, 500);
  }
});
