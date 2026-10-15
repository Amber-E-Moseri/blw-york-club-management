import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

// Read env-vars once at module load; they are available before the first request.
const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const unsubscribeSecret = Deno.env.get('UNSUBSCRIBE_SECRET') ?? '';

const preferenceByType: Record<string, string> = {
  meeting_reminder_8am: 'meeting_reminders_8am',
  meeting_reminder_1hr: 'meeting_reminders_1hr',
  message_notification: 'message_notifications',
  habit_milestone: 'habit_milestones',
  devotional_reminder: 'devotional_reminders',
  testimony_approved: 'testimony_approved',
  weekly_digest: 'weekly_digest',
  generic: 'admin_announcements',
};

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get('token') ?? '';
    // The token subject is the authenticated account: user_id (= profiles.id = auth.users.id).
    const payload = await verifyToken(token) as { userId?: string; notifType?: string; exp?: number };
    const userId = payload.userId;
    const preference = preferenceByType[payload.notifType || ''];
    if (!userId || !preference) throw new Error('Invalid unsubscribe token');

    // Create a per-request service-role client with an explicit Authorization header.
    // Unsubscribe links arrive as bare GETs from email clients (no auth headers).
    // A module-level client can lose its service-role context when the Supabase auth
    // module detects no incoming JWT, causing PostgREST to reject the upsert.
    // Forcing the key in global.headers guarantees service-role bypass of RLS for
    // every request, regardless of whether the caller supplied an Authorization header.
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${supabaseServiceRoleKey}` } },
    });

    const { error: upsertError } = await supabase
      .from('email_preferences')
      .upsert({ user_id: userId, [preference]: false }, { onConflict: 'user_id' });
    if (upsertError) throw new Error('Could not update email preferences');

    return new Response(successHtml(preference), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch (error) {
    return new Response(errorHtml(error instanceof Error ? error.message : 'Invalid unsubscribe link'), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
});

async function verifyToken(token: string): Promise<unknown> {
  if (!unsubscribeSecret) throw new Error('Unsubscribe signing is not configured');
  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) throw new Error('Invalid unsubscribe token');

  const expected = await hmacHex(encodedPayload, unsubscribeSecret);
  if (!timingSafeEqual(signature, expected)) throw new Error('Invalid unsubscribe token');

  const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encodedPayload))) as { exp?: number };
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Unsubscribe token expired');
  }
  return payload;
}

async function hmacHex(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

function successHtml(preference: string) {
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;padding:32px;"><h1>Unsubscribed</h1><p>${preference.replace(/_/g, ' ')} emails have been disabled.</p><p><a href="/email-preferences">Manage email preferences</a></p></body></html>`;
}

function errorHtml(message: string) {
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;padding:32px;"><h1>Unsubscribe failed</h1><p>${message}</p></body></html>`;
}
