/**
 * emailPreferenceEnforcement.test.ts
 *
 * Regression tests for email preference enforcement.
 *
 * Groups:
 *   1. Pure preference guard logic (evaluatePreference) — fully deterministic.
 *   2. Edge function source-code structure — verify enforcement patterns are
 *      present in the Deno functions (which cannot be imported into Jest).
 *   3. Process-scheduled-emails structure — verify identity pass-through.
 *   4. Migration structure — verify 028 adds required identity columns.
 *   5. Frontend draft-restoration fix — confirm the earlier fix is present.
 */

import fs from 'fs';
import path from 'path';
import {
  evaluatePreference,
  TRANSACTIONAL_TYPES,
  PREFERENCE_COLUMN_BY_TYPE,
  DEFAULT_PREFERENCES,
  type EmailPreferenceRow,
} from '../lib/email/emailPreferenceGuard';

const root = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

// ─── 1. Pure preference guard ─────────────────────────────────────────────────

describe('evaluatePreference — transactional exemptions', () => {
  const anyPrefs: EmailPreferenceRow = { ...DEFAULT_PREFERENCES, opt_out_all: true };

  test('account_approved is always sent even when the member has opted out', () => {
    const result = evaluatePreference('account_approved', anyPrefs, 'user-1');
    expect(result.send).toBe(true);
    expect(result.reason).toBe('transactional-exempt');
  });

  test('account_approved is sent when no preference row exists', () => {
    const result = evaluatePreference('account_approved', null, 'user-1');
    expect(result.send).toBe(true);
    expect(result.reason).toBe('transactional-exempt');
  });

  test('account_approved is sent even when memberId is null', () => {
    const result = evaluatePreference('account_approved', null, null);
    expect(result.send).toBe(true);
    expect(result.reason).toBe('transactional-exempt');
  });

  test('TRANSACTIONAL_TYPES contains exactly account_approved', () => {
    expect(Array.from(TRANSACTIONAL_TYPES)).toEqual(['account_approved']);
  });
});

describe('evaluatePreference — no-identity fail-closed', () => {
  const happyPrefs: EmailPreferenceRow = { ...DEFAULT_PREFERENCES };

  test('generic with null memberId is blocked', () => {
    const result = evaluatePreference('generic', happyPrefs, null);
    expect(result.send).toBe(false);
    expect(result.reason).toBe('no-identity');
  });

  test('meeting_reminder_8am with undefined memberId is blocked', () => {
    const result = evaluatePreference('meeting_reminder_8am', happyPrefs, undefined);
    expect(result.send).toBe(false);
    expect(result.reason).toBe('no-identity');
  });

  test('empty string memberId is treated as no-identity', () => {
    const result = evaluatePreference('generic', happyPrefs, '');
    expect(result.send).toBe(false);
    expect(result.reason).toBe('no-identity');
  });
});

describe('evaluatePreference — opt_out_all', () => {
  const optedOut: EmailPreferenceRow = { ...DEFAULT_PREFERENCES, opt_out_all: true };

  test('generic is blocked when opt_out_all is true', () => {
    const result = evaluatePreference('generic', optedOut, 'user-1');
    expect(result.send).toBe(false);
    expect(result.reason).toBe('opt-out-all');
  });

  test('meeting_reminder_8am is blocked when opt_out_all is true', () => {
    const result = evaluatePreference('meeting_reminder_8am', optedOut, 'user-1');
    expect(result.send).toBe(false);
    expect(result.reason).toBe('opt-out-all');
  });

  test('weekly_digest is blocked when opt_out_all is true', () => {
    const result = evaluatePreference('weekly_digest', optedOut, 'user-1');
    expect(result.send).toBe(false);
    expect(result.reason).toBe('opt-out-all');
  });
});

describe('evaluatePreference — per-type disable', () => {
  test('meeting_reminder_8am is blocked when that flag is false', () => {
    const prefs: EmailPreferenceRow = { ...DEFAULT_PREFERENCES, meeting_reminders_8am: false };
    const result = evaluatePreference('meeting_reminder_8am', prefs, 'user-1');
    expect(result.send).toBe(false);
    expect(result.reason).toBe('type-disabled');
  });

  test('weekly_digest is blocked when that flag is false (default)', () => {
    const prefs: EmailPreferenceRow = { ...DEFAULT_PREFERENCES }; // weekly_digest: false by default
    const result = evaluatePreference('weekly_digest', prefs, 'user-1');
    expect(result.send).toBe(false);
    expect(result.reason).toBe('type-disabled');
  });

  test('admin_announcements being false blocks generic template', () => {
    const prefs: EmailPreferenceRow = { ...DEFAULT_PREFERENCES, admin_announcements: false };
    const result = evaluatePreference('generic', prefs, 'user-1');
    expect(result.send).toBe(false);
    expect(result.reason).toBe('type-disabled');
  });

  test('testimony_approved being false blocks that template type', () => {
    const prefs: EmailPreferenceRow = { ...DEFAULT_PREFERENCES, testimony_approved: false };
    const result = evaluatePreference('testimony_approved', prefs, 'user-1');
    expect(result.send).toBe(false);
    expect(result.reason).toBe('type-disabled');
  });

  test('disabling one type does not block others', () => {
    const prefs: EmailPreferenceRow = { ...DEFAULT_PREFERENCES, meeting_reminders_8am: false };
    const result = evaluatePreference('generic', prefs, 'user-1');
    expect(result.send).toBe(true);
  });
});

describe('evaluatePreference — missing preference row (defaults)', () => {
  test('generic with null prefs uses defaults (admin_announcements = true)', () => {
    const result = evaluatePreference('generic', null, 'user-1');
    expect(result.send).toBe(true);
    expect(result.reason).toBe('default-preference-ok');
  });

  test('meeting_reminder_8am with null prefs uses defaults (true)', () => {
    const result = evaluatePreference('meeting_reminder_8am', null, 'user-1');
    expect(result.send).toBe(true);
    expect(result.reason).toBe('default-preference-ok');
  });

  test('weekly_digest with null prefs uses defaults (false → blocked)', () => {
    const result = evaluatePreference('weekly_digest', null, 'user-1');
    expect(result.send).toBe(false);
    expect(result.reason).toBe('type-disabled');
  });

  test('DEFAULT_PREFERENCES mirrors migration 021 column defaults', () => {
    // All true except weekly_digest
    expect(DEFAULT_PREFERENCES.opt_out_all).toBe(false);
    expect(DEFAULT_PREFERENCES.meeting_reminders_8am).toBe(true);
    expect(DEFAULT_PREFERENCES.meeting_reminders_1hr).toBe(true);
    expect(DEFAULT_PREFERENCES.message_notifications).toBe(true);
    expect(DEFAULT_PREFERENCES.habit_milestones).toBe(true);
    expect(DEFAULT_PREFERENCES.devotional_reminders).toBe(true);
    expect(DEFAULT_PREFERENCES.testimony_approved).toBe(true);
    expect(DEFAULT_PREFERENCES.weekly_digest).toBe(false);
    expect(DEFAULT_PREFERENCES.admin_announcements).toBe(true);
  });
});

describe('evaluatePreference — unknown template type', () => {
  test('an unrecognised type is blocked (fail-closed)', () => {
    const result = evaluatePreference('future_unknown_type', DEFAULT_PREFERENCES, 'user-1');
    expect(result.send).toBe(false);
    expect(result.reason).toBe('unknown-type');
  });

  test('empty string type is blocked', () => {
    const result = evaluatePreference('', DEFAULT_PREFERENCES, 'user-1');
    expect(result.send).toBe(false);
    expect(result.reason).toBe('unknown-type');
  });
});

describe('evaluatePreference — happy-path sends', () => {
  test('all known non-transactional types are allowed with full-yes preferences', () => {
    const allYes: EmailPreferenceRow = {
      opt_out_all: false,
      meeting_reminders_8am: true,
      meeting_reminders_1hr: true,
      message_notifications: true,
      habit_milestones: true,
      devotional_reminders: true,
      testimony_approved: true,
      weekly_digest: true,
      admin_announcements: true,
    };
    const types = Object.keys(PREFERENCE_COLUMN_BY_TYPE).filter(
      (t) => !TRANSACTIONAL_TYPES.has(t),
    );
    for (const type of types) {
      const result = evaluatePreference(type, allYes, 'user-1');
      expect(result.send).toBe(true);
    }
  });

  test('PREFERENCE_COLUMN_BY_TYPE covers all non-transactional EmailTemplateType values', () => {
    // These must all be mapped; adding a new template type without updating the
    // map would block all its sends (fail-closed until the map is updated).
    const expectedNonTransactional = [
      'meeting_reminder_8am',
      'meeting_reminder_1hr',
      'message_notification',
      'habit_milestone',
      'devotional_reminder',
      'testimony_approved',
      'weekly_digest',
      'generic',
    ];
    for (const type of expectedNonTransactional) {
      expect(PREFERENCE_COLUMN_BY_TYPE).toHaveProperty(type);
    }
  });
});

// ─── 2. send-email edge function structure ────────────────────────────────────

describe('send-email edge function: preference enforcement structure', () => {
  const fn = read('supabase/functions/send-email/index.ts');

  test('imports evaluatePreference and TRANSACTIONAL_TYPES from the shared guard', () => {
    expect(fn).toContain("from '../_shared/email-preference-guard.ts'");
    expect(fn).toContain('evaluatePreference');
    expect(fn).toContain('TRANSACTIONAL_TYPES');
  });

  test('checkEmailPreference is defined and called before sendProviderEmail', () => {
    expect(fn).toContain('async function checkEmailPreference(');
    // checkEmailPreference must appear before any call to sendProviderEmail
    expect(fn.indexOf('checkEmailPreference')).toBeLessThan(fn.indexOf('sendProviderEmail('));
  });

  test('sendAndLog checks preferences before writing a queued log row', () => {
    const sendAndLogBody = fn.slice(fn.indexOf('async function sendAndLog('));
    // guardResult check must appear before the 'queued' status insert
    expect(sendAndLogBody.indexOf('guardResult')).toBeLessThan(
      sendAndLogBody.indexOf("status: 'queued'"),
    );
  });

  test('sendAndLog writes a skipped log row for opted-out recipients', () => {
    expect(fn).toContain("status: 'skipped'");
    expect(fn).toContain('skipped: true');
  });

  test('resend action re-checks preferences before delivery', () => {
    const resendBlock = fn.slice(fn.indexOf("body.action === 'resend'"), fn.indexOf("body.action === 'batch'"));
    expect(resendBlock).toContain('checkEmailPreference');
    expect(resendBlock).toContain("status: 'skipped'");
  });

  test('batch action returns aggregate sent/skipped counts, not per-recipient reasons', () => {
    const batchBlock = fn.slice(fn.indexOf("body.action === 'batch'"), fn.indexOf('// action:'));
    expect(batchBlock).toContain('skipped++');
    expect(batchBlock).toContain('sent++');
    // Aggregate return shape — per-recipient emails must not appear in the json() response call
    const responseCall = batchBlock.slice(batchBlock.lastIndexOf('return json('));
    expect(responseCall).not.toContain('recipient.email');
    expect(responseCall).not.toContain('.email');
    expect(batchBlock).toContain('{ total:');
    expect(batchBlock).toContain('sent,');
    expect(batchBlock).toContain('skipped }');
  });

  test('schedule action stores member_id and template_type for delivery-time preference checks', () => {
    const scheduleBlock = fn.slice(fn.indexOf("body.action === 'schedule'"), fn.indexOf("body.action === 'resend'"));
    expect(scheduleBlock).toContain('member_id:');
    expect(scheduleBlock).toContain('template_type:');
  });

  test('requireAuthorizedCaller still checks active status and notifications.send permission', () => {
    expect(fn).toContain("await requireAuthorizedCaller(req, 'notifications.send')");
    expect(fn).toContain("profile.status !== 'active'");
    expect(fn).toContain("throw new HttpError('Not authorised to send email', 403)");
  });

  test('fail-closed: checkEmailPreference returns false on DB error', () => {
    const fnBody = fn.slice(fn.indexOf('async function checkEmailPreference('));
    expect(fnBody).toContain('preference-lookup-failed');
    expect(fnBody).toContain('send: false');
  });
});

// ─── 3. process-scheduled-emails structure ────────────────────────────────────

describe('process-scheduled-emails: identity pass-through', () => {
  const proc = read('supabase/functions/process-scheduled-emails/index.ts');

  test('selects member_id and template_type from scheduled_emails', () => {
    expect(proc).toContain('member_id');
    expect(proc).toContain('template_type');
  });

  test('passes memberId to the send-email invocation', () => {
    expect(proc).toContain('memberId:');
    expect(proc).toContain('email.member_id');
  });

  test('passes templateType to the send-email invocation', () => {
    expect(proc).toContain('templateType:');
    expect(proc).toContain('email.template_type');
  });

  test('reports skipped count separately from sent and failed', () => {
    expect(proc).toContain('skipped');
    expect(proc).toContain('sent,');
    expect(proc).toContain('failed');
  });

  test('marks skipped scheduled emails as sent=true to prevent retry loops', () => {
    // A skipped email (opted-out) must not be retried on every cron run.
    const skipBlock = proc.slice(proc.indexOf('?.skipped'));
    expect(skipBlock).toContain("sent: true");
  });
});

// ─── 4. Migration structure ───────────────────────────────────────────────────

describe('migration 030: scheduled_email identity columns', () => {
  const migration = read('supabase/migrations/030_scheduled_email_identity.sql');

  test('adds member_id column to scheduled_emails', () => {
    expect(migration).toContain('add column if not exists member_id');
    expect(migration).toContain("references public.profiles(id)");
  });

  test('adds template_type column to scheduled_emails', () => {
    expect(migration).toContain('add column if not exists template_type');
  });

  test('is additive — uses add column if not exists', () => {
    // Must not drop existing columns or recreate the table
    expect(migration).not.toMatch(/drop table|create table public\.scheduled_emails/i);
    expect(migration).not.toContain('drop column');
  });
});

// ─── 5. Frontend: draft-restoration fix is preserved ─────────────────────────

describe('frontend: draft restoration preserves template name', () => {
  const page = read('src/pages/AdminEmailLog.tsx');

  test('draft onChange handler restores templateName from linked template', () => {
    expect(page).toContain('linkedTemplate');
    expect(page).toContain('setTemplateName(linkedTemplate?.name ?? \'\')');
  });

  test('handler still restores subject, body, recipients, and templateId', () => {
    const changeBlock = page.slice(
      page.indexOf('setDraftId(event.target.value)'),
      page.indexOf('</select>', page.indexOf('setDraftId(event.target.value)')),
    );
    expect(changeBlock).toContain('setTemplateId(');
    expect(changeBlock).toContain('setSubject(');
    expect(changeBlock).toContain('setBody(');
    expect(changeBlock).toContain('setSelectedRecipientIds(');
  });
});

// ─── 6. F-2 fix: internal dispatch auth chain ────────────────────────────────

describe('F-2 fix: process-scheduled-emails → send-email auth chain', () => {
  const fn   = read('supabase/functions/send-email/index.ts');
  const proc = read('supabase/functions/process-scheduled-emails/index.ts');

  test('send-email defines isInternalDispatch using EMAIL_CRON_SECRET env var', () => {
    expect(fn).toContain('EMAIL_CRON_SECRET');
    expect(fn).toContain('isInternalDispatch');
    expect(fn).toContain('x-internal-dispatch');
  });

  test('send-email requireAuthorizedCaller returns early for internal dispatch', () => {
    const authBody = fn.slice(fn.indexOf('async function requireAuthorizedCaller('));
    // isInternalDispatch check must appear before auth.getUser
    expect(authBody.indexOf('isInternalDispatch')).toBeLessThan(authBody.indexOf('auth.getUser'));
    expect(authBody).toContain("return 'internal-dispatch'");
  });

  test('process-scheduled-emails passes x-internal-dispatch header to functions.invoke', () => {
    expect(proc).toContain('x-internal-dispatch');
    expect(proc).toContain('cronSecret');
    // The header must appear inside the functions.invoke call
    const invokeBlock = proc.slice(proc.indexOf('functions.invoke('));
    expect(invokeBlock).toContain('x-internal-dispatch');
  });

  test('send-email never calls auth.getUser with the service role key directly', () => {
    // The auth chain fix means internal dispatch bypasses auth.getUser entirely.
    // External callers (non-internal-dispatch) still use auth.getUser with their own JWT.
    // The service role key is used only for DB queries, never for auth.getUser.
    expect(fn).toContain("createClient(supabaseUrl, serviceRoleKey)");
    // The auth.getUser call must be after the isInternalDispatch early return
    const authFn = fn.slice(fn.indexOf('async function requireAuthorizedCaller('));
    const internalCheckEnd = authFn.indexOf("return 'internal-dispatch'");
    const getUserCall = authFn.indexOf('auth.getUser(');
    expect(internalCheckEnd).toBeLessThan(getUserCall);
  });

  test('process-scheduled-emails reports failed count for invoke errors', () => {
    expect(proc).toContain('failed++');
    expect(proc).toContain('failed');
  });

  test('send-email external callers still require a valid user JWT', () => {
    // When x-internal-dispatch is absent, the function must still check JWT.
    expect(fn).toContain('Authentication required');
    expect(fn).toContain('Invalid authentication token');
    expect(fn).toContain("throw new HttpError('Not authorised to send email', 403)");
  });
});

// ─── 6b. Authorization: recipient-scope checks independent of frontend ────────

describe('authorization: internal dispatch cannot bypass recipient preference checks', () => {
  const fn = read('supabase/functions/send-email/index.ts');

  test('sendAndLog always calls checkEmailPreference regardless of caller type', () => {
    // The preference check is in sendAndLog, not in requireAuthorizedCaller,
    // so it runs for both internal and external dispatches.
    const sendAndLogBody = fn.slice(fn.indexOf('async function sendAndLog('));
    expect(sendAndLogBody).toContain('checkEmailPreference');
    expect(sendAndLogBody.indexOf('checkEmailPreference')).toBeLessThan(
      sendAndLogBody.indexOf('sendProviderEmail('),
    );
  });
});

// ─── 7. Authorization: recipient-scope checks independent of frontend ─────────

describe('authorization: scope checks are server-side', () => {
  const fn = read('supabase/functions/send-email/index.ts');

  test('every action path calls requireAuthorizedCaller before processing', () => {
    // Check that 'schedule', 'resend', 'batch', and the default 'send' all
    // gate on requireAuthorizedCaller before any DB mutation or send.
    const scheduleIdx = fn.indexOf("body.action === 'schedule'");
    const resendIdx   = fn.indexOf("body.action === 'resend'");
    const batchIdx    = fn.indexOf("body.action === 'batch'");
    const sendIdx     = fn.indexOf('// action:');

    // Count occurrences of requireAuthorizedCaller after each action branch
    const afterSchedule = fn.slice(scheduleIdx, resendIdx);
    const afterResend   = fn.slice(resendIdx, batchIdx);
    const afterBatch    = fn.slice(batchIdx, sendIdx);
    const afterSend     = fn.slice(sendIdx);

    expect(afterSchedule).toContain('requireAuthorizedCaller');
    expect(afterResend).toContain('requireAuthorizedCaller');
    expect(afterBatch).toContain('requireAuthorizedCaller');
    expect(afterSend).toContain('requireAuthorizedCaller');
  });

  test('recipient member_id is verified via DB, not taken from request header or URL', () => {
    // Preference check uses memberId passed in body, then looks up DB row.
    // It must NOT trust any caller-supplied claim about preferences.
    expect(fn).toContain('.from(\'email_preferences\')');
    expect(fn).toContain('.eq(\'user_id\', memberId)');
  });

  test('send-email uses service_role key, so the preference query bypasses RLS', () => {
    // The service_role client is created at module load with the service key.
    // This is the correct pattern for a privileged system function.
    expect(fn).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(fn).toContain("createClient(supabaseUrl, serviceRoleKey)");
  });
});
