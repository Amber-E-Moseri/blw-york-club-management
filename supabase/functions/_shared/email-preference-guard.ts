/**
 * email-preference-guard.ts
 *
 * Pure preference-evaluation logic shared by the send-email edge function and
 * the Jest test suite.  No Deno APIs, no Supabase client — only deterministic
 * logic that the caller drives with already-fetched data.
 *
 * Identity note: `user_id` in email_preferences == profiles.id == auth.users.id.
 * The edge function passes this as `memberId`.
 */

// ─── Template-type → preference column mapping ────────────────────────────────

/**
 * Template types that must always be delivered regardless of preferences.
 * Auth emails (password reset, magic link) are handled by Supabase Auth itself
 * and never reach this function.
 */
export const TRANSACTIONAL_TYPES: ReadonlySet<string> = new Set([
  'account_approved',
]);

/**
 * Maps EmailTemplateType → the email_preferences column that gates delivery.
 * Mirrors the `preferenceByType` map in supabase/functions/unsubscribe/index.ts.
 * Any type not present here is treated as unknown and blocked (fail-closed).
 */
export const PREFERENCE_COLUMN_BY_TYPE: Readonly<Record<string, keyof EmailPreferenceRow>> = {
  meeting_reminder_8am:  'meeting_reminders_8am',
  meeting_reminder_1hr:  'meeting_reminders_1hr',
  message_notification:  'message_notifications',
  habit_milestone:       'habit_milestones',
  devotional_reminder:   'devotional_reminders',
  testimony_approved:    'testimony_approved',
  weekly_digest:         'weekly_digest',
  generic:               'admin_announcements',
  // account_approved is transactional — listed for completeness, never read here
  account_approved:      'admin_announcements',
};

// ─── Recipient identity ───────────────────────────────────────────────────────

/** Same rule as the database identity rule normalize_identity_email(): lower(trim(value)). */
export function normalizeRecipientEmail(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/**
 * A supplied memberId only vouches for a destination address if that address IS the member's address.
 * Without this check a caller could pair an eligible member's id (active, opted in) with any other address and
 * the preference guard would approve a send to a stranger.
 */
export function recipientMatchesIdentity(
  to: string | null | undefined,
  identityEmail: string | null | undefined,
): boolean {
  const destination = normalizeRecipientEmail(to);
  return destination !== '' && destination === normalizeRecipientEmail(identityEmail);
}

// ─── Types ────────────────────────────────────────────────────────────────────

/** Shape of a row read from public.email_preferences. */
export interface EmailPreferenceRow {
  opt_out_all: boolean;
  meeting_reminders_8am: boolean;
  meeting_reminders_1hr: boolean;
  message_notifications: boolean;
  habit_milestones: boolean;
  devotional_reminders: boolean;
  testimony_approved: boolean;
  weekly_digest: boolean;
  admin_announcements: boolean;
}

/**
 * Defaults that apply when a member has no row in email_preferences.
 * Mirrors the column defaults in migration 021_email_push_user_identity.sql.
 */
export const DEFAULT_PREFERENCES: Readonly<EmailPreferenceRow> = {
  opt_out_all:           false,
  meeting_reminders_8am: true,
  meeting_reminders_1hr: true,
  message_notifications: true,
  habit_milestones:      true,
  devotional_reminders:  true,
  testimony_approved:    true,
  weekly_digest:         false,
  admin_announcements:   true,
};

export type PreferenceGuardReason =
  | 'transactional-exempt'
  | 'preference-ok'
  | 'default-preference-ok'
  | 'opt-out-all'
  | 'type-disabled'
  | 'no-identity'
  | 'unknown-type'
  | 'recipient-mismatch';

export type PreferenceGuardResult =
  | { send: true;  reason: 'transactional-exempt' | 'preference-ok' | 'default-preference-ok' }
  | { send: false; reason: 'opt-out-all' | 'type-disabled' | 'no-identity' | 'unknown-type' };

// ─── Core evaluator ───────────────────────────────────────────────────────────

/**
 * Decide whether to send an email, given already-fetched preference data.
 *
 * @param templateType  The EmailTemplateType string from the send request.
 * @param prefs         The row from email_preferences for this member, or null
 *                      when the member has never saved preferences (use defaults).
 * @param memberId      The profiles.id of the recipient.  Required for all
 *                      non-transactional sends; null/undefined/empty blocks delivery.
 */
export function evaluatePreference(
  templateType: string,
  prefs: EmailPreferenceRow | null,
  memberId: string | null | undefined,
): PreferenceGuardResult {
  // 1. Transactional — bypass all preference checks.
  if (TRANSACTIONAL_TYPES.has(templateType)) {
    return { send: true, reason: 'transactional-exempt' };
  }

  // 2. No member identity — fail-closed for all ordinary sends.
  if (!memberId) {
    return { send: false, reason: 'no-identity' };
  }

  // 3. Unknown template type — fail-closed (defensive against future types).
  const prefColumn = PREFERENCE_COLUMN_BY_TYPE[templateType];
  if (!prefColumn) {
    return { send: false, reason: 'unknown-type' };
  }

  // 4. Use the member's row, or fall back to schema defaults.
  const effectivePrefs: EmailPreferenceRow = prefs ?? DEFAULT_PREFERENCES;
  const isDefault = prefs === null;

  if (effectivePrefs.opt_out_all) {
    return { send: false, reason: 'opt-out-all' };
  }

  if (!effectivePrefs[prefColumn]) {
    return { send: false, reason: 'type-disabled' };
  }

  return { send: true, reason: isDefault ? 'default-preference-ok' : 'preference-ok' };
}
