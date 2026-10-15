import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import {
  evaluatePreference,
  TRANSACTIONAL_TYPES,
  recipientMatchesIdentity,
  type EmailPreferenceRow,
} from '../_shared/email-preference-guard.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type SendBody =
  | { action: 'send'; to: string; subject: string; html: string; text?: string; memberId?: string; templateType?: string }
  | { action: 'batch'; recipients: Array<{ email: string; memberId?: string; data?: Record<string, unknown> }>; subject: string; html?: string; text?: string; templateType?: string }
  | { action: 'schedule'; to: string; subject: string; html: string; scheduledFor: string; memberId?: string; templateType?: string }
  | { action: 'resend'; messageId: string }
  | { action: 'track_open'; messageId: string; trackingToken: string };

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const emailRelayUrl = Deno.env.get('EMAIL_RELAY_URL') ?? '';
const emailRelaySecret = Deno.env.get('EMAIL_RELAY_SECRET') ?? '';

const supabase = createClient(supabaseUrl, serviceRoleKey);

class HttpError extends Error {
  constructor(message: string, public status = 500) {
    super(message);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const messageId = url.searchParams.get('messageId');
      const trackingToken = url.searchParams.get('trackingToken');
      if (messageId && trackingToken) {
        await supabase.rpc('track_email_open', { message_id: messageId, token: trackingToken });
      }
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const body = await req.json() as SendBody;

    if (body.action === 'track_open') {
      if (body.messageId && body.trackingToken) {
        await supabase.rpc('track_email_open', {
          message_id: body.messageId,
          token: body.trackingToken,
        });
      }
      return json({ ok: true });
    }

    if (body.action === 'schedule') {
      await requireAuthorizedCaller(req, 'notifications.send');
      const templateType = body.templateType ?? 'generic';
      const { data, error } = await supabase
        .from('scheduled_emails')
        .insert({
          recipient_email: body.to,
          subject: body.subject,
          html_content: body.html,
          scheduled_for: body.scheduledFor,
          member_id: body.memberId ?? null,
          template_type: templateType,
        })
        .select('id')
        .single();
      if (error) throw error;
      return json({ id: data.id });
    }

    if (body.action === 'resend') {
      await requireAuthorizedCaller(req, 'notifications.send');
      const { data: log, error } = await supabase
        .from('email_log')
        .select('*')
        .eq('id', body.messageId)
        .single();
      if (error) throw error;

      // Re-check preferences at resend time — the member may have opted out
      // since the original send attempt.
      const guardResult = await checkEmailPreference(log.member_id, log.template_type, log.recipient_email);
      if (!guardResult.send) {
        await supabase.from('email_log').update({
          status: 'skipped',
          failed_reason: `Resend skipped: ${guardResult.reason}`,
        }).eq('id', body.messageId);
        return json({ skipped: true, reason: guardResult.reason });
      }

      const html = withOpenTrackingPixel(
        log.html_content ?? `<p>${escapeHtml(log.subject)}</p>`,
        log.id,
        log.tracking_token,
      );
      const sent = await sendProviderEmail(log.recipient_email, log.subject, html, log.text_content ?? undefined);
      await supabase.from('email_log').update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        failed_reason: null,
        provider_message_id: sent.id,
        retry_count: (log.retry_count ?? 0) + 1,
      }).eq('id', body.messageId);
      return json({ id: sent.id });
    }

    if (body.action === 'batch') {
      await requireAuthorizedCaller(req, 'notifications.send');
      const templateType = body.templateType ?? 'generic';
      let sent = 0;
      let skipped = 0;
      for (const recipient of body.recipients) {
        const result = await sendAndLog({
          to: recipient.email,
          subject: body.subject,
          html: body.html ?? '<p>You have a new notification from BLW York Hub.</p>',
          text: body.text,
          memberId: recipient.memberId,
          templateType,
        });
        if (result.skipped) {
          skipped++;
        } else {
          sent++;
        }
      }
      // Return aggregate counts only — do not include per-recipient skip reasons
      // to avoid exposing private preference information in the API response.
      return json({ total: body.recipients.length, sent, skipped });
    }

    // action: 'send'
    await requireAuthorizedCaller(req, 'notifications.send');
    const result = await sendAndLog({
      to: body.to,
      subject: body.subject,
      html: body.html,
      text: body.text,
      memberId: body.memberId,
      templateType: body.templateType ?? 'generic',
    });
    if (result.skipped) {
      return json({ skipped: true, reason: result.reason });
    }
    return json({ id: result.id, logId: result.logId });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    return json({ error: error instanceof Error ? error.message : 'Unknown email error' }, status);
  }
});

// ─── Authorization ────────────────────────────────────────────────────────────

/**
 * Internal dispatch: process-scheduled-emails invokes send-email with the
 * shared EMAIL_CRON_SECRET as x-internal-dispatch.  This avoids the GoTrue
 * user-JWT path, which rejects the service role key sent by functions.invoke().
 *
 * The secret is already present in Deno.env for process-scheduled-emails; no
 * additional secret is required.  Callers outside the Supabase project cannot
 * obtain it, and the 'send' action still enforces recipient preferences and
 * anti-spam rules through checkEmailPreference / sendAndLog.
 */
const INTERNAL_DISPATCH_HEADER = 'x-internal-dispatch';

function isInternalDispatch(req: Request): boolean {
  const cronSecret = Deno.env.get('EMAIL_CRON_SECRET') ?? '';
  return (
    cronSecret.length > 0 &&
    req.headers.get(INTERNAL_DISPATCH_HEADER) === cronSecret
  );
}

async function requireAuthorizedCaller(req: Request, permission: string): Promise<string> {
  // Internal server-to-server dispatch from process-scheduled-emails.
  if (isInternalDispatch(req)) {
    return 'internal-dispatch';
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!jwt) throw new HttpError('Authentication required', 401);

  const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
  const user = userData?.user;
  if (userError || !user) throw new HttpError('Invalid authentication token', 401);

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, status')
    .eq('id', user.id)
    .single();
  if (profileError || !profile) throw new HttpError('Profile not found', 403);
  // Only an approved (active) account may act; a pending or rejected account
  // never holds administrative power.
  if (profile.status !== 'active') throw new HttpError('Not authorised to send email', 403);
  if (['admin', 'coordinator'].includes(profile.role)) return user.id;

  const { data: assignments, error: assignmentError } = await supabase
    .from('admin_role_assignments')
    .select('role_id')
    .eq('user_id', user.id);
  if (assignmentError) throw new HttpError('Could not verify permissions', 403);
  const roleIds = (assignments ?? []).map((row: { role_id: string }) => row.role_id);
  if (roleIds.length > 0) {
    const { data: permissions, error: permissionError } = await supabase
      .from('admin_role_permissions')
      .select('role_id')
      .in('role_id', roleIds)
      .eq('permission_key', permission);
    if (permissionError) throw new HttpError('Could not verify permissions', 403);
    if ((permissions ?? []).length > 0) return user.id;
  }

  throw new HttpError('Not authorised to send email', 403);
}

// ─── Preference enforcement ───────────────────────────────────────────────────

/**
 * Fetch the email_preferences row for the given member and evaluate whether
 * this send should proceed.  Uses service_role so the query bypasses RLS —
 * the edge function acts on behalf of the system, not the recipient.
 *
 * Fail-closed: any DB error for a non-transactional type blocks delivery.
 */
async function checkEmailPreference(
  memberId: string | null | undefined,
  templateType: string,
  to: string,
): Promise<{ send: true; reason: string } | { send: false; reason: string }> {
  // Transactional emails skip preference checks. When they name a member, the destination address must still
  // be that member's address; with no memberId they are staff-initiated and remain permitted.
  if (TRANSACTIONAL_TYPES.has(templateType)) {
    if (memberId) {
      const { data: owner } = await supabase.from('profiles').select('email').eq('id', memberId).maybeSingle();
      if (!owner || !recipientMatchesIdentity(to, owner.email)) {
        return { send: false, reason: 'recipient-mismatch' };
      }
    }
    return { send: true, reason: 'transactional-exempt' };
  }

  // No identity → fail-closed.
  if (!memberId) {
    return { send: false, reason: 'no-identity' };
  }

  // Only active members are eligible recipients.
  const { data: profile } = await supabase
    .from('profiles')
    .select('status, email')
    .eq('id', memberId)
    .maybeSingle();
  if (!profile || profile.status !== 'active') {
    return { send: false, reason: 'non-active-member' };
  }
  // The destination must be this member's own address - a valid memberId cannot vouch for a different address.
  if (!recipientMatchesIdentity(to, profile.email)) {
    return { send: false, reason: 'recipient-mismatch' };
  }

  // Fetch the member's preference row.
  const { data: prefs, error } = await supabase
    .from('email_preferences')
    .select(
      'opt_out_all, meeting_reminders_8am, meeting_reminders_1hr, message_notifications, ' +
      'habit_milestones, devotional_reminders, testimony_approved, weekly_digest, admin_announcements',
    )
    .eq('user_id', memberId)
    .maybeSingle();

  if (error) {
    // DB error on a non-transactional send: fail-closed.
    return { send: false, reason: 'preference-lookup-failed' };
  }

  // null means no row exists → use schema defaults via the pure evaluator.
  return evaluatePreference(templateType, prefs as EmailPreferenceRow | null, memberId);
}

// ─── Send and log ─────────────────────────────────────────────────────────────

type SendAndLogResult =
  | { skipped: false; id: string; logId: string | undefined }
  | { skipped: true;  reason: string; logId: string | undefined };

async function sendAndLog(input: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  memberId?: string;
  templateType: string;
}): Promise<SendAndLogResult> {
  // Enforce preferences BEFORE writing any log row.  This keeps the log clean:
  // a skipped row documents the skip; an aborted check never logs at all.
  const guardResult = await checkEmailPreference(input.memberId, input.templateType, input.to);

  if (!guardResult.send) {
    // Unknown address (no identity) or non-active member: skip silently — there
    // is no legitimate account to audit against, so no log row is written.
    if (
      guardResult.reason === 'no-identity' ||
      guardResult.reason === 'non-active-member' ||
      guardResult.reason === 'recipient-mismatch'
    ) {
      return { skipped: true, reason: guardResult.reason, logId: undefined };
    }
    // All other skip reasons (opt-out, preference): write a skipped log row so
    // coordinators can see the delivery history and diagnose preference issues.
    const { data: skippedLog } = await supabase
      .from('email_log')
      .insert({
        member_id: input.memberId ?? null,
        recipient_email: input.to,
        subject: input.subject,
        template_type: input.templateType,
        status: 'skipped',
        failed_reason: guardResult.reason,
      })
      .select('id')
      .single();
    return { skipped: true, reason: guardResult.reason, logId: skippedLog?.id };
  }

  // Allowed: proceed with the normal send-and-log flow.
  const { data: log } = await supabase
    .from('email_log')
    .insert({
      member_id: input.memberId ?? null,
      recipient_email: input.to,
      subject: input.subject,
      template_type: input.templateType,
      status: 'queued',
      html_content: input.html,
      text_content: input.text ?? stripHtml(input.html),
    })
    .select('id, tracking_token')
    .single();

  try {
    const html = log?.id && log?.tracking_token
      ? withOpenTrackingPixel(input.html, log.id, log.tracking_token)
      : input.html;
    const sent = await sendProviderEmail(input.to, input.subject, html, input.text);
    if (log?.id) {
      await supabase.from('email_log').update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        provider_message_id: sent.id,
      }).eq('id', log.id);
    }
    return { skipped: false, id: sent.id, logId: log?.id };
  } catch (error) {
    if (log?.id) {
      await supabase
        .from('email_log')
        .update({ status: 'failed', failed_reason: error instanceof Error ? error.message : 'Provider error' })
        .eq('id', log.id);
    }
    throw error;
  }
}

// ─── Provider ─────────────────────────────────────────────────────────────────

async function sendProviderEmail(to: string, subject: string, html: string, text?: string): Promise<{ id: string }> {
  if (emailRelayUrl && emailRelaySecret) {
    const res = await fetch(emailRelayUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${emailRelaySecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to, subject, html, text }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.message ?? `Gmail relay error ${res.status}`);
    return { id: data.messageId ?? crypto.randomUUID() };
  }
  throw new Error('EMAIL_PROVIDER_NOT_CONFIGURED. Set EMAIL_RELAY_URL + EMAIL_RELAY_SECRET in Supabase project secrets.');
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function stripHtml(html: string) {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function withOpenTrackingPixel(html: string, messageId: string, trackingToken: string) {
  const baseUrl = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/send-email`;
  const pixel = `<img src="${baseUrl}?messageId=${encodeURIComponent(messageId)}&trackingToken=${encodeURIComponent(trackingToken)}" alt="" width="1" height="1" style="display:none" />`;
  return html.includes('</body>') ? html.replace('</body>', `${pixel}</body>`) : `${html}${pixel}`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char));
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
