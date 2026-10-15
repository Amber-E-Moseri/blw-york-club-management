import fs from 'fs';
import path from 'path';
import type { EmailPreferences, PushNotificationLog, PushSubscriptionRecord } from '../types';

// One identity contract for account-owned notification state:
//   user_id   = the authenticated account (profiles.id = auth.users.id)
//   person_id = the human in the People model (never a substitute for user_id here)
// email_log.member_id and contacts.member_id are different concepts and are intentionally not covered.

const root = path.resolve(__dirname, '..', '..');
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const stripComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/--.*$/gm, '');

describe('email/push identity contract (TypeScript side)', () => {
  test('types are keyed by user_id', () => {
    const prefs: EmailPreferences = {
      user_id: 'u',
      meeting_reminders_8am: true,
      meeting_reminders_1hr: true,
      message_notifications: true,
      habit_milestones: true,
      devotional_reminders: true,
      testimony_approved: true,
      weekly_digest: false,
      admin_announcements: true,
      opt_out_all: false,
      created_at: '',
      updated_at: '',
    };
    const sub: PushSubscriptionRecord = {
      id: 'i',
      user_id: 'u',
      endpoint: 'e',
      auth: 'a',
      p256dh: 'p',
      user_agent: null,
      is_active: true,
      subscribed_at: '',
      last_used: null,
      created_at: '',
    };
    const log: PushNotificationLog = {
      id: 'i',
      user_id: 'u',
      notification_type: 'meeting',
      title: 't',
      body: 'b',
      status: 'queued',
      sent_at: '',
      clicked_at: null,
      response_data: null,
      created_at: '',
    };
    expect(Object.keys(prefs)).toContain('user_id');
    expect(Object.keys(prefs)).not.toContain('member_id');
    expect(Object.keys(sub)).not.toContain('member_id');
    expect(Object.keys(log)).not.toContain('member_id');
  });

  test.each([
    'src/lib/queries/pushNotifications.ts',
    'src/hooks/usePushNotifications.ts',
    'src/pages/EmailPreferences.tsx',
    'supabase/functions/unsubscribe/index.ts',
  ])('%s uses no member_id / memberId', (file) => {
    expect(stripComments(read(file))).not.toMatch(/member_id|memberId/);
  });

  test('email preference queries use user_id and never member_id', () => {
    const source = stripComments(read('src/lib/queries/emailNotifications.ts'));
    const prefsSection = source.slice(source.indexOf('fetchEmailPreferences'), source.indexOf('export interface EmailLogInput'));
    expect(prefsSection).toContain(".eq('user_id', userId)");
    expect(prefsSection).toContain("onConflict: 'user_id'");
    expect(prefsSection).not.toMatch(/member_id|memberId/);
  });

  test('push subscription writes and reads are keyed by user_id', () => {
    const queries = stripComments(read('src/lib/queries/pushNotifications.ts'));
    const hook = stripComments(read('src/hooks/usePushNotifications.ts'));
    expect(queries).toContain('user_id: userId');
    expect(queries).toContain(".eq('user_id', userId)");
    expect(hook).toContain('user_id: userId');
    expect(queries).toContain("onConflict: 'endpoint'");
  });

  test('the client has no insert path into push_notification_log (the backend writes it)', () => {
    const queries = stripComments(read('src/lib/queries/pushNotifications.ts'));
    const section = queries.slice(queries.indexOf('push_notification_log'));
    expect(section).not.toMatch(/\.insert\(/);
  });

  test('unsubscribe tokens identify the account by userId and write user_id', () => {
    const fn = stripComments(read('supabase/functions/unsubscribe/index.ts'));
    expect(fn).toContain('userId?: string');
    expect(fn).toContain("upsert({ user_id: userId, [preference]: false }, { onConflict: 'user_id' })");
    expect(fn).toContain('upsertError');
  });
});

describe('email/push identity contract (database side)', () => {
  const migration = stripComments(read('supabase/migrations/021_email_push_user_identity.sql'));

  test('021 makes user_id the key / foreign key and removes member_id', () => {
    expect(migration).toContain('add constraint email_preferences_pkey primary key (user_id)');
    expect(migration).toContain('foreign key (user_id) references public.profiles(id) on delete cascade');
    expect(migration).toMatch(/alter table public\.email_preferences\s+drop column if exists id,\s+drop column if exists member_id/);
    expect(migration).toMatch(/alter table public\.push_subscriptions\s+drop column if exists member_id/);
    expect(migration).toMatch(/alter table public\.push_notification_log\s+drop column if exists member_id/);
    expect(migration).toContain('alter table public.push_subscriptions alter column user_id set not null');
    expect(migration).toContain('alter table public.push_notification_log alter column user_id set not null');
  });

  test('021 allows many devices per account but one row per endpoint', () => {
    expect(migration).not.toMatch(/unique\s*\(\s*user_id\s*\)/i);
    expect(migration).not.toMatch(/create unique index[^;]*push_subscriptions[^;]*\(user_id\)/i);
  });

  test('021 refuses to discard data it cannot convert', () => {
    expect(migration).toContain('cannot prove identity');
    expect(migration).toContain('have no recipient');
    expect(migration).toContain('holds non-default values');
  });

  test('policies on the three tables compare user_id with auth.uid() only', () => {
    const policies = migration.match(/create policy[\s\S]*?;/g) ?? [];
    expect(policies.length).toBeGreaterThanOrEqual(9);
    policies.forEach((policy) => expect(policy).not.toMatch(/member_id/));
  });

  test('the notification log has no client write policy', () => {
    const logPolicies = (migration.match(/create policy push_notification_log[\s\S]*?;/g) ?? []).join('\n');
    expect(logPolicies).not.toMatch(/for insert|for update|for delete|for all/i);
  });
});
