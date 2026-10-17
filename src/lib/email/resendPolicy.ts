/**
 * email-resend-policy.ts
 *
 * Pure policy for a manual resend of an email_log row.  Used by the send-email
 * edge function (enforcement) and mirrored by the admin UI for a pre-check.
 * src/lib/email/resendPolicy.ts must stay byte-identical to this file; a Jest
 * test enforces that.  No Deno APIs and no Supabase client here.
 */

export const RESEND_MAX_AGE_HOURS = 72;

export const TEST_SUBJECT_PREFIX = '[Test]';

const TEST_DOMAINS: ReadonlySet<string> = new Set(['example.com', 'example.net', 'example.org']);
const TEST_DOMAIN_SUFFIXES: readonly string[] = ['.test', '.invalid', '.localhost', '.example'];

export interface ResendCandidate {
  status: string;
  recipient_email: string;
  subject: string;
  template_type: string | null;
  created_at: string;
}

export type ResendDecision = { allowed: true } | { allowed: false; reason: string };

/**
 * Reserved and documentation domains are never real members.  An address with
 * no domain is treated as a test address (fail closed).
 */
export function isTestRecipient(email: string): boolean {
  const domain = (email.trim().toLowerCase().split('@')[1] ?? '').trim();
  if (domain === '') return true;
  if (TEST_DOMAINS.has(domain)) return true;
  return TEST_DOMAIN_SUFFIXES.some((suffix) => domain.endsWith(suffix));
}

function deny(reason: string): ResendDecision {
  return { allowed: false, reason };
}

export function evaluateResend(log: ResendCandidate, now: Date): ResendDecision {
  if (log.status !== 'failed') {
    return deny('Only failed emails can be resent.');
  }
  if (isTestRecipient(log.recipient_email)) {
    return deny('Test recipients cannot be resent.');
  }
  if (log.subject.trim().startsWith(TEST_SUBJECT_PREFIX) || log.template_type === 'test') {
    return deny('Test emails cannot be resent.');
  }
  const createdAt = Date.parse(log.created_at);
  if (Number.isNaN(createdAt)) {
    return deny('The original send date is missing, so this email cannot be resent.');
  }
  const ageHours = (now.getTime() - createdAt) / 3_600_000;
  if (ageHours > RESEND_MAX_AGE_HOURS) {
    return deny(`Emails older than ${RESEND_MAX_AGE_HOURS} hours cannot be resent. Compose a new message instead.`);
  }
  return { allowed: true };
}
