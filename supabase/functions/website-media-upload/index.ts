// Signed upload for website media. POST { bucket, mime, bytes } with the signed-in user's JWT.
// Deploy with verify_jwt = true (the default): anonymous requests never reach this code.
//
// Flow: (1) the user's own token asks web_media_upload_allowed; (2) the request is validated against MEDIA_RULES;
// (3) a short-lived signed upload URL is issued for a generated path; (4) the browser uploads the bytes to that URL;
// (5) the browser registers the object with web_register_media, again as the user. Storage has no direct write
// access for any role.
//
// Required secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, WEBSITE_ALLOWED_ORIGINS.

import { buildStorageUrl, corsHeaders, missingSecrets, uploadObjectPath, validateUploadRequest } from '../_shared/website-guards.ts';

Deno.serve(async (req: Request) => {
  const allowed = (Deno.env.get('WEBSITE_ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const cors = corsHeaders(req.headers.get('origin'), allowed);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'Method not allowed.' }, cors);

  const supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const auth = req.headers.get('authorization') ?? '';
  const userToken = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const missing = missingSecrets({ SUPABASE_URL: supabaseUrl, SUPABASE_ANON_KEY: anonKey, SUPABASE_SERVICE_ROLE_KEY: serviceKey });
  if (missing.length) {
    console.error(JSON.stringify({ event: 'configuration_error', function: 'website-media-upload', missing }));
    return reply(503, { error: 'Uploads are temporarily unavailable.' }, cors);
  }
  // A request without a user token, or with the public key, is not a signed-in user. Refuse it.
  if (!userToken || userToken === anonKey || userToken === serviceKey) return reply(401, { error: 'Please sign in to upload.' }, cors);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: 'The upload request could not be read.' }, cors);
  }
  const parsed = validateUploadRequest(body);
  if (!parsed.ok) return reply(400, { error: parsed.message }, cors);
  const { bucket, mime, bytes } = parsed.value;

  // Asked as the user, so the database applies the user's own website roles.
  const allowedRes = await fetch(`${supabaseUrl}/rest/v1/rpc/web_media_upload_allowed`, {
    method: 'POST',
    headers: { apikey: anonKey, authorization: `Bearer ${userToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ p_bucket: bucket }),
  }).catch(() => null);
  if (!allowedRes) {
    console.error(JSON.stringify({ event: 'media_permission_check_unreachable', function: 'website-media-upload' }));
    return reply(503, { error: 'Uploads are temporarily unavailable.' }, cors);
  }
  if (allowedRes.status === 401) return reply(401, { error: 'Your session has ended. Please sign in again.' }, cors);
  if (!allowedRes.ok || (await allowedRes.json()) !== true) {
    return reply(403, { error: 'You do not have permission to upload here.' }, cors);
  }

  // Links handed to the browser use the public address (WEBSITE_PUBLIC_URL, defaulting to SUPABASE_URL).
  const publicBase = (Deno.env.get('WEBSITE_PUBLIC_URL') ?? supabaseUrl).replace(/\/+$/, '');
  const path = uploadObjectPath(bucket, mime, crypto.randomUUID(), new Date());
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const signRes = await fetch(`${supabaseUrl}/storage/v1/object/upload/sign/${bucket}/${encodedPath}`, {
    method: 'POST',
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' },
    body: '{}',
  }).catch(() => null);
  const signed = signRes?.ok ? ((await signRes.json().catch(() => null)) as { url?: string } | null) : null;
  if (!signed?.url) {
    console.error(JSON.stringify({ event: 'storage_sign_failed', function: 'website-media-upload', status: signRes?.status ?? 0 }));
    return reply(503, { error: 'Uploads are temporarily unavailable.' }, cors);
  }
  const uploadUrl = buildStorageUrl(publicBase, signed.url);
  if (!uploadUrl) {
    // Diagnostic shape only: the origin of the base address, and the link with its token removed.
    console.error(JSON.stringify({
      event: 'storage_url_rejected',
      function: 'website-media-upload',
      base: publicBase.replace(/^(https?:\/\/[^/]+).*$/, '$1').slice(0, 80),
      shape: String(signed.url).replace(/token=[^&]*/, 'token=<redacted>').slice(0, 120),
    }));
    return reply(503, { error: 'Uploads are temporarily unavailable.' }, cors);
  }

  console.log(JSON.stringify({ event: 'media_upload_issued', bucket, mime, bytes }));
  return reply(200, { bucket, path, uploadUrl, mime, bytes }, cors);
});

function reply(status: number, payload: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...headers, 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
