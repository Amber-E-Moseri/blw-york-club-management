// Pure helpers for the website Edge Functions (inquiries, Rhapsody PDF delivery, media upload). No Deno APIs and no
// network, so the same file is unit-tested under Node in site/src/__tests__/website-guards.test.ts.
//
// Privacy rules: raw network addresses and user agents never leave these helpers. Only keyed hashes are stored or
// sent to the database, and the secret that keys them is server-side only.

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const IPV6 = /^[0-9a-fA-F:]{2,45}$/;

/**
 * The caller's address as the edge sees it. Cloudflare's header is trusted first because the functions sit behind
 * Cloudflare. Anything that is not a plain IP address is rejected, so a malformed header cannot become a rate-limit key.
 */
export function clientAddress(headers: Headers): string | null {
  const candidates = [
    headers.get('cf-connecting-ip'),
    headers.get('x-real-ip'),
    (headers.get('x-forwarded-for') ?? '').split(',')[0],
  ];
  for (const raw of candidates) {
    const ip = (raw ?? '').trim();
    if (!ip) continue;
    if (IPV4.test(ip) || (IPV6.test(ip) && ip.includes(':'))) return ip;
  }
  return null;
}

/** HMAC-SHA256 as lowercase hex. The key is a server secret; the output is what the database stores. */
export async function keyedHash(secret: string, value: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(value));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Only a success flag is trusted from Turnstile's siteverify response. Anything else is treated as a failed check. */
export function turnstilePassed(body: unknown): boolean {
  return typeof body === 'object' && body !== null && (body as { success?: unknown }).success === true;
}

/** Campaign labels are stored for analytics. Anything outside a short safe alphabet is dropped, not truncated. */
export function cleanLabel(value: string | null): string {
  const v = (value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : '';
}

/** Builds the URL for a signed object from the path Supabase Storage returns (e.g. "/object/sign/bucket/x.pdf?token=…"). */
export function buildStorageUrl(supabaseUrl: string, signedPath: string): string | null {
  const base = supabaseUrl.replace(/\/+$/, '');
  if (!isTrustedBase(base)) return null;
  if (!/^\/object\/(sign|upload\/sign)\/[A-Za-z0-9._\-/]+\?token=[A-Za-z0-9._\-]+$/.test(signedPath)) return null;
  // No parent-directory segments: a signed path must stay inside its bucket.
  if (signedPath.split('?')[0].split('/').includes('..')) return null;
  return `${base}/storage/v1${signedPath}`;
}

function isTrustedBase(base: string): boolean {
  return /^https:\/\/[^\s/@]+$/.test(base) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base);
}

/** CORS: only the configured site origins may call the browser-facing functions. */
export function corsHeaders(origin: string | null, allowed: string[]): Record<string, string> {
  const headers: Record<string, string> = {
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, authorization, apikey, x-client-info',
    'Access-Control-Max-Age': '600',
  };
  if (origin && allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

// ---------------------------------------------------------------------------------------------------------------------
// Media upload rules. These mirror the storage bucket limits and the web_media constraints in migration 107.
// ---------------------------------------------------------------------------------------------------------------------

export type MediaBucket = 'site-media' | 'rhapsody-pdfs';

export const MEDIA_RULES: Record<MediaBucket, { maxBytes: number; mimes: Record<string, string> }> = {
  'site-media': {
    maxBytes: 5 * 1024 * 1024,
    mimes: { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' },
  },
  'rhapsody-pdfs': {
    maxBytes: 25 * 1024 * 1024,
    mimes: { 'application/pdf': 'pdf' },
  },
};

export type UploadRequest = { bucket: MediaBucket; mime: string; bytes: number };

export function validateUploadRequest(body: unknown): { ok: true; value: UploadRequest } | { ok: false; message: string } {
  if (typeof body !== 'object' || body === null) return { ok: false, message: 'The upload request is not valid.' };
  const { bucket, mime, bytes } = body as Record<string, unknown>;
  if (bucket !== 'site-media' && bucket !== 'rhapsody-pdfs') return { ok: false, message: 'That storage area is not available.' };
  const rules = MEDIA_RULES[bucket];
  if (typeof mime !== 'string' || !(mime in rules.mimes)) return { ok: false, message: 'That file type is not allowed here.' };
  if (typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes < 1 || bytes > rules.maxBytes) {
    return { ok: false, message: `Files must be between 1 byte and ${Math.round(rules.maxBytes / (1024 * 1024))} MB.` };
  }
  return { ok: true, value: { bucket, mime, bytes } };
}

/**
 * Object path inside the bucket. The original file name is never used: it could carry personal data or path tricks.
 * The path is year/month/random-id.ext, so it is unique and cannot collide with another upload.
 */
export function uploadObjectPath(bucket: MediaBucket, mime: string, id: string, when: Date): string {
  const ext = MEDIA_RULES[bucket].mimes[mime];
  if (!ext || !isUuid(id)) throw new Error('Invalid upload path inputs.');
  const yyyy = String(when.getUTCFullYear());
  const mm = String(when.getUTCMonth() + 1).padStart(2, '0');
  return `${yyyy}/${mm}/${id.toLowerCase()}.${ext}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Inquiry validation (the database validates again; this keeps malformed requests out of the RPC path)
// ---------------------------------------------------------------------------------------------------------------------

export type InquiryRequest = {
  kind: 'contact' | 'new_here' | 'prayer';
  name: string;
  email: string;
  phone: string;
  message: string;
  topic: string;
  consentVersion: string;
  consentTextHash: string;
  honeypot: string;
  turnstileToken: string;
};

const EMAIL = /^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,20}$/;

export function validateInquiry(body: unknown): { ok: true; value: InquiryRequest } | { ok: false; message: string } {
  if (typeof body !== 'object' || body === null) return { ok: false, message: 'The message could not be read. Please try again.' };
  const b = body as Record<string, unknown>;
  const str = (k: string, max: number): string | null => {
    const v = b[k];
    if (typeof v !== 'string') return null;
    if (v.length > max) return null;
    return v;
  };
  const kind = b.kind;
  if (kind !== 'contact' && kind !== 'new_here' && kind !== 'prayer') return { ok: false, message: 'Please choose a valid form.' };
  const name = str('name', 120);
  const email = str('email', 254);
  const phone = str('phone', 40);
  const message = str('message', 4000);
  const topic = str('topic', 120);
  const consentVersion = str('consentVersion', 20);
  const consentTextHash = str('consentTextHash', 64);
  const honeypot = str('honeypot', 500);
  const turnstileToken = str('turnstileToken', 2048);
  if (name === null || email === null || phone === null || message === null || topic === null || consentVersion === null
      || consentTextHash === null || honeypot === null || turnstileToken === null) {
    return { ok: false, message: 'Some fields are missing or too long. Please check the form.' };
  }
  if (!name.trim() || !EMAIL.test(email.trim())) return { ok: false, message: 'Please enter your name and a valid email address.' };
  if (!/^[0-9a-f]{64}$/.test(consentTextHash)) return { ok: false, message: 'Please confirm the consent statement and try again.' };
  if (!turnstileToken) return { ok: false, message: 'Please complete the security check and try again.' };
  return {
    ok: true,
    value: {
      kind, name: name.trim(), email: email.trim(), phone: phone.trim(), message, topic, consentVersion,
      consentTextHash, honeypot, turnstileToken,
    },
  };
}
