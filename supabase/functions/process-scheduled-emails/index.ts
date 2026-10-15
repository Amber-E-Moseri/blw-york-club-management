import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
);
const cronSecret = Deno.env.get('EMAIL_CRON_SECRET') ?? '';

Deno.serve(async (req) => {
  if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) {
    return json({ error: 'Not authorised' }, 401);
  }

  // Select member_id and template_type added in migration 028 so that
  // preference enforcement can run at delivery time.
  const { data: emails, error } = await supabase
    .from('scheduled_emails')
    .select('id, recipient_email, subject, html_content, member_id, template_type')
    .eq('sent', false)
    .lte('scheduled_for', new Date().toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(100);

  if (error) return json({ error: error.message }, 500);

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const email of emails ?? []) {
    const { data: result, error: invokeError } = await supabase.functions.invoke('send-email', {
      body: {
        action: 'send',
        to: email.recipient_email,
        subject: email.subject,
        html: email.html_content,
        // Pass identity so send-email can enforce email_preferences.
        // Rows created before migration 030 will have member_id = null; those
        // sends are blocked by the preference guard (fail-closed on no-identity).
        memberId: email.member_id ?? undefined,
        templateType: email.template_type ?? 'generic',
      },
      // Use the shared cron secret for server-to-server auth so send-email
      // does not attempt to validate the service role key as a user JWT.
      headers: { 'x-internal-dispatch': cronSecret },
    });
    if (invokeError) {
      failed++;
    } else if ((result as { skipped?: boolean })?.skipped) {
      skipped++;
      // Mark as sent=true so the scheduler does not retry a skipped send.
      // The send-email function already wrote a skipped log row.
      await supabase.from('scheduled_emails')
        .update({ sent: true, sent_at: new Date().toISOString() })
        .eq('id', email.id);
    } else {
      sent++;
      await supabase.from('scheduled_emails')
        .update({ sent: true, sent_at: new Date().toISOString() })
        .eq('id', email.id);
    }
  }

  return json({ processed: emails?.length ?? 0, sent, skipped, failed });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
