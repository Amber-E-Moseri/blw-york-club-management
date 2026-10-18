import fs from 'fs';
import path from 'path';
import { evaluateResend, isTestRecipient, RESEND_MAX_AGE_HOURS, type ResendCandidate } from '../lib/email/resendPolicy';

const root = path.resolve(__dirname, '../..');
const readRaw = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
// Working copies on Windows can use CRLF; the structure checks compare LF-normalized text.
const read = (rel: string) => readRaw(rel).replace(/\r\n/g, '\n');

const NOW = new Date('2026-10-17T21:00:00Z');
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();

function candidate(overrides: Partial<ResendCandidate> = {}): ResendCandidate {
  return {
    status: 'failed',
    recipient_email: 'member@gmail.com',
    subject: 'Cell fellowship reminder',
    template_type: 'generic',
    created_at: hoursAgo(2),
    ...overrides,
  };
}

describe('evaluateResend policy', () => {
  test('allows a recent failed message to a real recipient', () => {
    expect(evaluateResend(candidate(), NOW)).toEqual({ allowed: true });
  });

  test('refuses anything that is not failed', () => {
    for (const status of ['sent', 'queued', 'skipped', 'opened', 'clicked']) {
      const decision = evaluateResend(candidate({ status }), NOW);
      expect(decision).toEqual({ allowed: false, reason: 'Only failed emails can be resent.' });
    }
  });

  test('refuses reserved and documentation test domains', () => {
    for (const recipient_email of ['nobody@example.test', 'a@example.com', 'a@example.org', 'a@x.invalid', 'a@localhost.localhost', 'a@b.example']) {
      expect(evaluateResend(candidate({ recipient_email }), NOW)).toEqual({ allowed: false, reason: 'Test recipients cannot be resent.' });
    }
  });

  test('treats an address with no domain as a test recipient (fail closed)', () => {
    expect(isTestRecipient('no-at-sign')).toBe(true);
    expect(isTestRecipient('trailing@')).toBe(true);
  });

  test('does not treat real provider domains as test recipients', () => {
    expect(isTestRecipient('moseriewere@gmail.com')).toBe(false);
    expect(isTestRecipient('someone@york.ca')).toBe(false);
  });

  test('refuses messages whose subject is marked as a test', () => {
    expect(evaluateResend(candidate({ subject: '[Test] Email from BLW York Hub' }), NOW))
      .toEqual({ allowed: false, reason: 'Test emails cannot be resent.' });
  });

  test('refuses the test template type', () => {
    expect(evaluateResend(candidate({ template_type: 'test' }), NOW))
      .toEqual({ allowed: false, reason: 'Test emails cannot be resent.' });
  });

  test('allows up to the age limit and refuses older messages', () => {
    expect(evaluateResend(candidate({ created_at: hoursAgo(RESEND_MAX_AGE_HOURS) }), NOW)).toEqual({ allowed: true });
    const old = evaluateResend(candidate({ created_at: hoursAgo(RESEND_MAX_AGE_HOURS + 1) }), NOW);
    expect(old.allowed).toBe(false);
    if (!old.allowed) expect(old.reason).toMatch(/older than 72 hours/);
  });

  test('refuses an original send date that cannot be parsed', () => {
    expect(evaluateResend(candidate({ created_at: 'not-a-date' }), NOW))
      .toEqual({ allowed: false, reason: 'The original send date is missing, so this email cannot be resent.' });
  });

  test('the October 8 failures that were resent by the bulk button are refused', () => {
    const oldFailed = candidate({ recipient_email: 'nobody@example.test', subject: 'Cell', created_at: '2026-10-08T02:17:07Z' });
    expect(evaluateResend(oldFailed, NOW).allowed).toBe(false);
  });
});

describe('resend policy copies', () => {
  test('the UI copy and the edge-function copy are byte-identical', () => {
    expect(readRaw('src/lib/email/resendPolicy.ts')).toBe(readRaw('supabase/functions/_shared/email-resend-policy.ts'));
  });
});

describe('admin email log UI', () => {
  const page = read('src/pages/AdminEmailLog.tsx');
  const hook = read('src/hooks/useEmailNotifications.ts');

  test('the bulk Resend Failed Emails action is removed', () => {
    expect(page).not.toMatch(/Resend Failed Emails/);
    expect(page).not.toMatch(/resendFailed/);
    expect(page).not.toMatch(/useResendFailedEmails/);
    expect(page).not.toMatch(/Admin Tools/);
    expect(hook).not.toMatch(/useResendFailedEmails/);
    expect(hook).not.toMatch(/resendFailed/);
  });

  test('a single resend is only reachable through the confirmation handler', () => {
    const calls = page.match(/resendEmail\(/g) ?? [];
    expect(calls).toHaveLength(1);
    const handlerStart = page.indexOf('const handleResend');
    expect(handlerStart).toBeGreaterThan(-1);
    expect(page.indexOf('resendEmail(')).toBeGreaterThan(handlerStart);
    expect(page.indexOf('window.confirm(')).toBeLessThan(page.indexOf('resendEmail('));
  });

  test('the confirmation shows recipient, subject and original send date', () => {
    const handler = page.slice(page.indexOf('const handleResend'), page.indexOf('resendEmail('));
    expect(handler).toMatch(/log\.recipient_email/);
    expect(handler).toMatch(/log\.subject/);
    expect(handler).toMatch(/Originally created/);
    expect(handler).toMatch(/new Date\(log\.created_at\)/);
  });

  test('no effect on page load sends or resends an email', () => {
    const effects = page.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[[^\]]*\]\);/g) ?? [];
    expect(effects.length).toBeGreaterThan(0);
    for (const effect of effects) {
      expect(effect).not.toMatch(/resendEmail|sendEmail|handleResend|Resend|sendTest/);
    }
  });

  test('the Send Test action is unchanged and still calls sendEmail', () => {
    expect(page).toMatch(/await sendEmail\(\{/);
    expect(page).toMatch(/Test send uses the backend sender/);
  });

  test('useEmailLog exposes an explicit reload that does not send', () => {
    expect(hook).toMatch(/const reload = useCallback\(\(\) => setReloadToken/);
    expect(hook).toMatch(/return \{ logs, loading, reload \}/);
  });
});

describe('send-email resend enforcement', () => {
  const fn = read('supabase/functions/send-email/index.ts');
  const start = fn.indexOf("if (body.action === 'resend')");
  const catchIndex = fn.indexOf('} catch (sendError)', start);
  // The resend branch ends at the first closing brace of the action block after its catch.
  const resendBranch = fn.slice(start, fn.indexOf('\n    }\n', catchIndex) + 7);

  test('the resend branch exists and is reached only after authorization', () => {
    expect(start).toBeGreaterThan(-1);
    const authIndex = resendBranch.indexOf("requireAuthorizedCaller(req, 'notifications.send')");
    expect(authIndex).toBeGreaterThanOrEqual(0);
    expect(authIndex).toBeLessThan(resendBranch.indexOf('.from(\'email_log\')'));
  });

  test('the policy is enforced before any provider call and before the row is claimed', () => {
    const policyIndex = resendBranch.indexOf('evaluateResend(log, new Date())');
    const claimIndex = resendBranch.indexOf("status: 'queued'");
    const sendIndex = resendBranch.indexOf('sendProviderEmail(log.recipient_email');
    expect(policyIndex).toBeGreaterThan(-1);
    expect(claimIndex).toBeGreaterThan(policyIndex);
    expect(sendIndex).toBeGreaterThan(claimIndex);
  });

  test('the claim only succeeds for a row that is still failed', () => {
    expect(resendBranch).toMatch(/\.update\(\{ status: 'queued' \}\)\s*\.eq\('id', body\.messageId\)\s*\.eq\('status', 'failed'\)/);
  });

  test('a failed send returns the row to failed and rethrows; nothing retries', () => {
    expect(resendBranch).toMatch(/catch \(sendError\)[\s\S]*update\(\{ status: 'failed' \}\)[\s\S]*throw sendError/);
    expect(resendBranch).not.toMatch(/setTimeout|setInterval|scheduled_emails/);
  });

  test('audit records never include the recipient address, subject or body', () => {
    const auditCalls = fn.match(/auditResend\([^;]*\);/g) ?? [];
    expect(auditCalls.length).toBeGreaterThanOrEqual(5);
    for (const call of auditCalls) {
      expect(call).not.toMatch(/recipient|subject|html|text_content/);
    }
    expect(fn).toMatch(/console\.info\(JSON\.stringify\(\{ event, actor: actorId, messageId, detail/);
  });

  test('the blocked response uses 422 for policy and 409 for a row that is no longer failed', () => {
    expect(resendBranch).toMatch(/RESEND_NOT_ALLOWED[^)]*\}, 422\)/);
    expect(resendBranch).toMatch(/RESEND_NOT_ALLOWED[^)]*\}, 409\)/);
  });

  test('the send-email function imports the shared policy', () => {
    expect(fn).toMatch(/import \{ evaluateResend \} from '\.\.\/_shared\/email-resend-policy\.ts';/);
  });
});
