// Removes abandoned uploads: storage objects that were uploaded but never registered, and that no website content mentions.
// The database decides what is an orphan (web_orphaned_uploads: no web_media row, no reference in any content version or
// draft, older than the grace period). This function deletes only that list, and only with the service role.
//
// Invoke on a schedule (Supabase cron / pg_net or an external scheduler) with the service-role key as the bearer token.
// Deploy with verify_jwt = false and rely on the explicit bearer check below. A request without the exact service key is
// refused. Nothing here logs object names, which may contain personal details.
//
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { missingSecrets } from '../_shared/website-guards.ts';

const GRACE_MINUTES = 24 * 60; // Uploads younger than a day are never removed, so an in-progress form cannot lose its file.
const MAX_PER_RUN = 200;

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return reply(405, { error: 'Method not allowed.' });

  const supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const missing = missingSecrets({ SUPABASE_URL: supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: serviceKey });
  if (missing.length) {
    console.error(JSON.stringify({ event: 'configuration_error', function: 'website-media-cleanup', missing }));
    return reply(503, { error: 'configuration', missing });
  }

  const auth = req.headers.get('authorization') ?? '';
  if (auth !== `Bearer ${serviceKey}`) return reply(401, { error: 'Not authorised.' });

  const listed = await fetch(`${supabaseUrl}/rest/v1/rpc/web_orphaned_uploads`, {
    method: 'POST',
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ p_older_than_minutes: GRACE_MINUTES }),
  }).then((r) => (r.ok ? r.json() : null)).catch(() => null) as Array<{ bucket_id: string; object_name: string }> | null;
  if (!Array.isArray(listed)) return reply(503, { error: 'The cleanup list could not be read.' });

  let deleted = 0;
  let failed = 0;
  for (const row of listed.slice(0, MAX_PER_RUN)) {
    // Only the two website buckets are ever touched, whatever the database returns.
    if (row.bucket_id !== 'site-media' && row.bucket_id !== 'rhapsody-pdfs') { failed++; continue; }
    const encoded = row.object_name.split('/').map(encodeURIComponent).join('/');
    const res = await fetch(`${supabaseUrl}/storage/v1/object/${row.bucket_id}/${encoded}`, {
      method: 'DELETE',
      headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
    }).catch(() => null);
    if (res?.ok) deleted++;
    else failed++;
  }
  console.log(JSON.stringify({ event: 'media_cleanup', candidates: listed.length, deleted, failed }));
  return reply(200, { candidates: listed.length, deleted, failed });
});

function reply(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
