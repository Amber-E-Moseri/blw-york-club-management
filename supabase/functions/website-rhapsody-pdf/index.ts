// Rhapsody PDF delivery. GET /website-rhapsody-pdf?edition=<uuid>[&src=<label>&utm_source=<label>&utm_campaign=<label>]
// Deploy with verify_jwt = false: readers are anonymous. Private PDFs are never public: each request resolves the
// edition, records the download, and then redirects to a signed URL that lives for SIGNED_URL_SECONDS.
//
// Fail closed. The PDF is served only when:
//   * the edition is published, has an authorizer and an authorization date, and has an active PDF (checked by the
//     database function web_resolve_edition_pdf, which only the service role can call);
//   * the download was recorded (the database rate limit may refuse it, and then no link is issued).
// Responses are never cached, and the redirect carries no-referrer so the signed link is not leaked onward.
//
// Required secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, CLIENT_HASH_SECRET (32+ characters).

import { buildStorageUrl, cleanLabel, clientAddress, isUuid, keyedHash } from '../_shared/website-guards.ts';

const SIGNED_URL_SECONDS = 120;

Deno.serve(async (req: Request) => {
  if (req.method !== 'GET') return text(405, 'Method not allowed.');

  const url = new URL(req.url);
  const edition = url.searchParams.get('edition');
  if (!isUuid(edition)) return text(404, 'Not found.');

  const supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const pepper = Deno.env.get('CLIENT_HASH_SECRET') ?? '';
  if (!supabaseUrl || !anonKey || !serviceKey || pepper.length < 32) {
    console.error(JSON.stringify({ event: 'pdf_misconfigured' }));
    return text(503, 'The document is temporarily unavailable.');
  }

  // 1. Resolve the private path. Unpublished, unauthorized or archived editions resolve to nothing.
  const resolved = await rpc(supabaseUrl, serviceKey, 'web_resolve_edition_pdf', { p_edition_id: edition });
  const row = Array.isArray(resolved) ? (resolved[0] as { storage_bucket?: string; storage_path?: string } | undefined) : undefined;
  if (!resolved || !row || row.storage_bucket !== 'rhapsody-pdfs' || !row.storage_path) {
    return text(404, 'That document is not available.');
  }

  // 2. Record the download. The visitor is a keyed hash of address and user agent, never stored in the clear.
  const ip = clientAddress(req.headers);
  if (!ip) return text(400, 'We could not verify this request. Please try again.');
  const ua = (req.headers.get('user-agent') ?? '').slice(0, 300);
  const visitorHash = await keyedHash(pepper, `${ip}|${ua}`);
  const recorded = await call(supabaseUrl, anonKey, 'web_record_download', {
    p_edition_id: edition,
    p_source: cleanLabel(url.searchParams.get('src')),
    p_utm_source: cleanLabel(url.searchParams.get('utm_source')),
    p_utm_campaign: cleanLabel(url.searchParams.get('utm_campaign')),
    p_visitor_hash: visitorHash,
  });
  if (!recorded.ok && recorded.refused === 'rate') return text(429, 'Too many requests. Please try again in a few minutes.');
  if (!recorded.ok) return text(503, 'The document is temporarily unavailable.');

  // 3. Sign a short-lived link for the private object.
  const encodedPath = row.storage_path.split('/').map(encodeURIComponent).join('/');
  const signed = await fetch(`${supabaseUrl}/storage/v1/object/sign/rhapsody-pdfs/${encodedPath}`, {
    method: 'POST',
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ expiresIn: SIGNED_URL_SECONDS }),
  }).then((r) => (r.ok ? r.json() : null)).catch(() => null) as { signedURL?: string } | null;
  const target = signed?.signedURL ? buildStorageUrl(supabaseUrl, signed.signedURL) : null;
  if (!target) return text(503, 'The document is temporarily unavailable.');

  return new Response(null, {
    status: 302,
    headers: {
      location: target,
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'x-robots-tag': 'noindex',
    },
  });
});

type RpcOutcome = { ok: true; value: unknown } | { ok: false; refused?: 'rate' };

async function rpc(url: string, bearer: string, fn: string, args: Record<string, unknown>): Promise<unknown> {
  const outcome = await call(url, bearer, fn, args);
  return outcome.ok ? outcome.value : null;
}

async function call(url: string, bearer: string, fn: string, args: Record<string, unknown>): Promise<RpcOutcome> {
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: bearer, authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: JSON.stringify(args),
  }).catch(() => null);
  if (!res) return { ok: false };
  if (res.ok) {
    const body = await res.text();
    return { ok: true, value: body ? JSON.parse(body) : null };
  }
  const err = (await res.json().catch(() => ({}))) as { code?: string };
  return err.code === 'P0429' ? { ok: false, refused: 'rate' } : { ok: false };
}

function text(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
  });
}
