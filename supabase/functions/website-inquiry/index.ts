// Public inquiry intake (contact, New Here, prayer). Deploy with verify_jwt = false: visitors are anonymous.
//
// Order of checks (fail closed at each step):
//   1. Request shape (validateInquiry). 2. Client address must be readable, so it can be limited.
//   3. Turnstile must pass (server-side siteverify with the secret key). 4. Per-client limit (keyed hash, service role).
//   5. The database accepts or refuses the message (consent, honeypot, global per-kind limit, validation).
// The response never echoes the submitted content, and nothing here logs an address, a name or a message.
//
// Required secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, TURNSTILE_SECRET_KEY,
// CLIENT_HASH_SECRET (at least 32 random characters), WEBSITE_ALLOWED_ORIGINS (comma-separated https origins).

import { clientAddress, corsHeaders, keyedHash, turnstilePassed, validateInquiry } from '../_shared/website-guards.ts';

const CLIENT_LIMIT = 5;
const CLIENT_WINDOW_MINUTES = 10;
const TURNSTILE_VERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

Deno.serve(async (req: Request) => {
  const allowed = (Deno.env.get('WEBSITE_ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const cors = corsHeaders(req.headers.get('origin'), allowed);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'Method not allowed.' }, cors);

  const supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const turnstileSecret = Deno.env.get('TURNSTILE_SECRET_KEY') ?? '';
  const pepper = Deno.env.get('CLIENT_HASH_SECRET') ?? '';
  if (!supabaseUrl || !anonKey || !serviceKey || !turnstileSecret || pepper.length < 32) {
    console.error(JSON.stringify({ event: 'inquiry_misconfigured' }));
    return reply(503, { error: 'The form is temporarily unavailable. Please try again later.' }, cors);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: 'The message could not be read. Please try again.' }, cors);
  }
  const parsed = validateInquiry(body);
  if (!parsed.ok) return reply(400, { error: parsed.message }, cors);
  const input = parsed.value;

  const ip = clientAddress(req.headers);
  if (!ip) return reply(400, { error: 'We could not verify this request. Please try again from your usual connection.' }, cors);

  // Turnstile: the token is single-use and bound to this address.
  const verify = await fetch(TURNSTILE_VERIFY, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret: turnstileSecret, response: input.turnstileToken, remoteip: ip }),
  }).then((r) => r.json()).catch(() => null);
  if (!turnstilePassed(verify)) return reply(403, { error: 'Please complete the security check and try again.' }, cors);

  // Per-client limit. Only a keyed hash of the address is sent to the database.
  const clientHash = await keyedHash(pepper, ip);
  const limit = await rpc(supabaseUrl, serviceKey, serviceKey, 'web_consume_client_limit', {
    p_client_hash: clientHash, p_scope: 'inquiry', p_limit: CLIENT_LIMIT, p_window_minutes: CLIENT_WINDOW_MINUTES,
  });
  if (!limit.ok) return reply(503, { error: 'The form is temporarily unavailable. Please try again later.' }, cors);
  if (limit.value !== true) {
    return reply(429, { error: 'Too many messages were sent from this connection. Please try again in a few minutes.' }, cors);
  }

  // The database remains the rule-keeper: consent, honeypot and the global per-kind limit all apply here too.
  const submit = await rpc(supabaseUrl, anonKey, anonKey, 'web_submit_inquiry', {
    p_kind: input.kind, p_name: input.name, p_email: input.email, p_phone: input.phone, p_message: input.message,
    p_topic: input.topic, p_consent_version: input.consentVersion, p_consent_text_hash: input.consentTextHash,
    p_honeypot: input.honeypot,
  });
  if (!submit.ok) {
    if (submit.code === 'P0429') return reply(429, { error: submit.message }, cors);
    if (submit.code === '22023' || submit.code === '42501') return reply(400, { error: submit.message }, cors);
    return reply(503, { error: 'The form is temporarily unavailable. Please try again later.' }, cors);
  }
  return reply(202, { received: true }, cors);
});

type RpcResult = { ok: true; value: unknown } | { ok: false; code: string; message: string };

async function rpc(url: string, apiKey: string, bearer: string, fn: string, args: Record<string, unknown>): Promise<RpcResult> {
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: apiKey, authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (res.ok) return { ok: true, value: json };
  const err = (json ?? {}) as { code?: string; message?: string };
  // Only the database's own visitor-facing messages are passed on. Other errors are logged by code, without detail.
  return { ok: false, code: err.code ?? String(res.status), message: err.message ?? '' };
}

function reply(status: number, payload: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...headers, 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
