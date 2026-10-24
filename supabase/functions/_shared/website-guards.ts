// Shared helpers for the website Edge Functions (inquiries, Rhapsody PDF delivery, media upload, media cleanup).
// Validation uses Zod (AGENTS.md: Zod on every write path), pinned to 3.23.8. Deno fetches the exact version from esm.sh;
// the Node tests and the type checker map the same URL to site/node_modules/zod.
//
// Privacy rules: raw network addresses and user agents never leave these helpers. Only keyed hashes are stored or
// sent to the database, and the secret that keys them is server-side only.

import { z } from 'https://esm.sh/zod@3.23.8';

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

/**
 * Lists the secrets a function needs that are missing or too short. Used to fail with an explicit configuration error
 * (logged by name, never by value) instead of a misleading success or a silent refusal.
 */
export function missingSecrets(required: Record<string, string | undefined>, minLength: Record<string, number> = {}): string[] {
  return Object.keys(required).filter((k) => {
    const v = required[k] ?? '';
    return v.trim() === '' || v.length < (minLength[k] ?? 1);
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Result helper
// ---------------------------------------------------------------------------------------------------------------------

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

/** Turns a Zod failure into the first visitor-facing message. Field-specific wording is kept for common mistakes. */
function firstMessage(error: z.ZodError, friendly: Record<string, string>, fallback: string): string {
  const issue = error.issues[0];
  const field = String(issue?.path[0] ?? '');
  return friendly[field] ?? fallback;
}

// ---------------------------------------------------------------------------------------------------------------------
// Media upload rules. These mirror the storage bucket limits and the web_media constraints in migration 110.
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

const UploadSchema = z
  .object({
    bucket: z.enum(['site-media', 'rhapsody-pdfs']),
    mime: z.string().max(100),
    bytes: z.number().int().positive(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const rules = MEDIA_RULES[v.bucket];
    if (!(v.mime in rules.mimes)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['mime'], message: 'type' });
    if (v.bytes > rules.maxBytes) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['bytes'], message: 'size' });
  });

export function validateUploadRequest(body: unknown): Parsed<UploadRequest> {
  const parsed = UploadSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue?.path[0] === 'bucket') return { ok: false, message: 'That storage area is not available.' };
    if (issue?.path[0] === 'mime' || issue?.message === 'type') return { ok: false, message: 'That file type is not allowed here.' };
    if (issue?.path[0] === 'bytes' && issue.message === 'size') {
      return { ok: false, message: 'That file is too large for this area.' };
    }
    return { ok: false, message: 'Files must be between 1 byte and the size limit for their area.' };
  }
  return { ok: true, value: parsed.data };
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

const InquirySchema = z
  .object({
    kind: z.enum(['contact', 'new_here', 'prayer']),
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().max(254).regex(EMAIL),
    phone: z.string().trim().max(40),
    message: z.string().max(4000),
    topic: z.string().max(120),
    consentVersion: z.string().max(20),
    consentTextHash: z.string().regex(/^[0-9a-f]{64}$/),
    honeypot: z.string().max(500),
    turnstileToken: z.string().min(1).max(2048),
  })
  .strict();

const INQUIRY_MESSAGES: Record<string, string> = {
  kind: 'Please choose a valid form.',
  name: 'Please enter your name.',
  email: 'Please enter a valid email address.',
  consentTextHash: 'Please confirm the consent statement and try again.',
  turnstileToken: 'Please complete the security check and try again.',
};

export function validateInquiry(body: unknown): Parsed<InquiryRequest> {
  const parsed = InquirySchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, message: firstMessage(parsed.error, INQUIRY_MESSAGES, 'Some fields are missing or too long. Please check the form.') };
  }
  return { ok: true, value: parsed.data };
}
