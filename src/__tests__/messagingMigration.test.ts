import fs from 'fs';
import path from 'path';

// Static guards for migrations 066 (audience scope correction) and 067 (messaging) and the dispatcher.
// They run without a database. Real-database behaviour is checked by supabase/verification/messaging_certification.sql,
// which the certification owner runs against a replayed database.

const root = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const migration = read('supabase/migrations/067_targeted_messages.sql');
const correction = read('supabase/migrations/066_audience_resolution_scope.sql');
const dispatcher = read('supabase/functions/dispatch-message/index.ts');

// Code only: comments are stripped so a word in a comment cannot satisfy or break a check.
const stripSql = (sql: string) => sql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
const sqlCode = stripSql(migration);
const correctionCode = stripSql(correction);
const dispatcherCode = dispatcher.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');

const TABLES = [
  'communication_messages',
  'communication_recipients',
  'communication_deliveries',
  'communication_audit',
];

describe('066: audience resolution cannot be used to enumerate recipients', () => {
  test('resolve_audience returns the full list only to admin and coordinator, otherwise the caller alone', () => {
    expect(correctionCode).toMatch(
      /from public\.resolve_audience_all\(p_spec_id\) r[\s\S]*where public\.is_admin_or_coordinator\(\)[\s\S]*or r\.profile_id = auth\.uid\(\)/,
    );
  });

  test('the complete resolver is not executable by any client role', () => {
    expect(correctionCode).toMatch(
      /revoke all on function public\.resolve_audience_all\(uuid\) from public, anon, authenticated, service_role/,
    );
    expect(correctionCode).not.toMatch(/grant execute on function public\.resolve_audience_all/);
  });

  test('the caller-scoped resolver keeps the grant the RLS policies in 063 and 064 rely on', () => {
    expect(correctionCode).toMatch(/grant execute on function public\.resolve_audience\(uuid\) to authenticated, service_role/);
  });

  test('saved groups and their memberships are readable only by staff', () => {
    expect(correctionCode).toMatch(
      /create policy saved_group_members_read on public\.saved_group_members\s+for select to authenticated\s+using \(public\.is_admin_or_coordinator\(\)\)/,
    );
    expect(correctionCode).toMatch(
      /create policy saved_groups_read on public\.saved_groups\s+for select to authenticated\s+using \(public\.is_admin_or_coordinator\(\)\)/,
    );
  });
});

describe('067: tables and row-level security', () => {
  test.each(TABLES)('%s enables RLS in the same migration', (table) => {
    expect(sqlCode).toMatch(new RegExp(`alter table public\\.${table}\\s+enable row level security`));
  });

  test('no client role can insert, update or delete any messaging table directly', () => {
    expect(sqlCode).not.toMatch(/grant\s+(insert|update|delete)[^;]*\bto\s+(authenticated|anon|public)/i);
    expect(sqlCode).not.toMatch(/for\s+(insert|update|delete)\b/i);
  });

  test('a message is visible only to the sender, staff, or a snapshot recipient', () => {
    expect(sqlCode).toMatch(
      /communication_messages_select[\s\S]*is_admin_or_coordinator\(\)[\s\S]*is_message_sender\(id\)[\s\S]*is_message_recipient\(id\)/,
    );
  });

  test('a recipient row is visible only to its owner (active members), the sender, or staff', () => {
    expect(sqlCode).toMatch(
      /communication_recipients_select[\s\S]*is_admin_or_coordinator\(\)[\s\S]*is_message_sender\(message_id\)[\s\S]*user_id = auth\.uid\(\) and public\.is_active_member\(\)/,
    );
  });

  test('the delivery claim and recovery functions are executable only by service_role', () => {
    expect(sqlCode).toMatch(/revoke all on function public\.claim_deliveries\(uuid, text\)\s+from public, anon, authenticated/);
    expect(sqlCode).toMatch(/grant execute on function public\.claim_deliveries\(uuid, text\)\s+to service_role/);
    expect(sqlCode).toMatch(/revoke all on function public\.expire_stuck_deliveries\(interval\)\s+from public, anon, authenticated/);
  });
});

describe('067: honest delivery states', () => {
  test("'stored' is allowed only on the inbox channel", () => {
    expect(sqlCode).toMatch(/status <> 'stored' or channel = 'inbox'/);
  });

  test("'accepted' is allowed only on external channels", () => {
    expect(sqlCode).toMatch(/status <> 'accepted' or channel in \('email','push'\)/);
  });

  test("no 'delivered' status exists in the schema or the dispatcher", () => {
    expect(sqlCode).not.toMatch(/'delivered'/);
    expect(dispatcherCode).not.toMatch(/'delivered'/);
  });

  test('failures are retryable only when the provider definitively refused or was never reached', () => {
    expect(dispatcherCode).toMatch(/class RelayRefused/);
    expect(dispatcherCode).toMatch(/if \(res\.status >= 400 && res\.status < 500\) throw new RelayRefused/);
    // A network error is not retryable: the relay may already have accepted the request.
    expect(dispatcherCode).toMatch(/Relay unreachable[\s\S]*\}\s*\n?\s*const data/);
  });

  test('stuck sending rows are closed as outcome-unknown and never retried', () => {
    expect(sqlCode).toMatch(/outcome-unknown[\s\S]*retryable = false/);
  });
});

describe('067: server-side authorization', () => {
  test('send_message and preview_audience both call the shared authorization check', () => {
    const sendBody = sqlCode.slice(sqlCode.indexOf('function public.send_message'));
    const previewBody = sqlCode.slice(sqlCode.indexOf('function public.preview_audience'), sqlCode.indexOf('function public.send_message'));
    expect(sendBody).toMatch(/perform public\.assert_can_send_message\(/);
    expect(previewBody).toMatch(/perform public\.assert_can_send_message\(/);
  });

  test('recipients are resolved only through the complete resolver, never the caller-scoped one', () => {
    expect(sqlCode).toMatch(/from public\.resolve_audience_all\(v_spec\)/);
    expect(sqlCode).not.toMatch(/public\.resolve_audience\(v_spec\)/);
  });

  test('the send is idempotent on (sender, idempotency key)', () => {
    expect(sqlCode).toMatch(/unique \(sender_id, idempotency_key\)/);
    expect(sqlCode).toMatch(/if v_existing is not null then\s+return v_existing/);
  });

  test('every SECURITY DEFINER function pins search_path', () => {
    const definers = sqlCode.match(/security definer[\s\S]*?\$\$;/g) ?? [];
    expect(definers.length).toBeGreaterThanOrEqual(8);
    for (const block of definers) {
      expect(block).toMatch(/set search_path = public, pg_temp/);
    }
  });

  test('send_message is executable only by authenticated, never PUBLIC or anon', () => {
    expect(sqlCode).toMatch(/revoke all on function public\.send_message[^;]*from public, anon/);
    expect(sqlCode).toMatch(/grant execute on function public\.send_message[^;]*to authenticated;/);
  });

  test('the migration drops and truncates nothing', () => {
    expect(sqlCode).not.toMatch(/\b(drop\s+table|drop\s+schema|truncate)\b/i);
  });
});

describe('dispatch-message: atomic claiming and no duplicate delivery', () => {
  test('rows are claimed through the database function before any provider call', () => {
    const claim = dispatcherCode.indexOf("rpc('claim_deliveries'");
    expect(claim).toBeGreaterThan(-1);
    expect(claim).toBeLessThan(dispatcherCode.indexOf('sendEmailViaRelay(profile.email'));
  });

  test('a push device is never notified before its member is claimed', () => {
    expect(dispatcherCode.indexOf("claim(messageId, 'push')")).toBeLessThan(dispatcherCode.indexOf('webpush.sendNotification'));
  });

  test('each email carries a stable idempotency key for the provider', () => {
    expect(dispatcherCode).toMatch(/'Idempotency-Key': idempotencyKey/);
    expect(dispatcherCode).toMatch(/`\$\{messageId\}:\$\{userId\}:email`/);
  });

  test('messages use the message-notification preference, not the announcement preference', () => {
    expect(dispatcherCode).toMatch(/const PREFERENCE_TYPE = 'message_notification'/);
    expect(dispatcherCode).toMatch(/evaluatePreference\(PREFERENCE_TYPE/);
  });

  test('the push body names no message content', () => {
    expect(dispatcherCode).toMatch(/body: 'Open the app to read it\.'/);
  });

  test('a message can be dispatched only by its sender or active staff', () => {
    expect(dispatcherCode).toMatch(/if \(!isStaff && message\.sender_id !== callerId\)/);
  });

  test('nothing retries automatically: dispatch runs only on an explicit call', () => {
    expect(dispatcherCode).not.toMatch(/setTimeout|setInterval|while \(true\)/);
  });
});
