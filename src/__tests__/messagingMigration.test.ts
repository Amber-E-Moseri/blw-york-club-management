import fs from 'fs';
import path from 'path';

// Static guards for migration 066 and the dispatcher. They run without a database. The real-database checks
// live in supabase/verification/messaging_certification.sql and are run by the certification owner.

const root = path.resolve(__dirname, '..', '..');
const migration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '066_targeted_messages.sql'), 'utf8');
const dispatcher = fs.readFileSync(path.join(root, 'supabase', 'functions', 'dispatch-message', 'index.ts'), 'utf8');

// Code only: comments are stripped so a word in a comment cannot satisfy or break a check.
const sqlCode = migration.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
const dispatcherCode = dispatcher.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');

const TABLES = [
  'communication_messages',
  'communication_recipients',
  'communication_deliveries',
  'communication_audit',
];

describe('migration 066: tables and row-level security', () => {
  test.each(TABLES)('%s enables RLS in the same migration', (table) => {
    expect(sqlCode).toMatch(new RegExp(`alter table public\\.${table}\\s+enable row level security`));
  });

  test('no client role can insert, update or delete any messaging table directly', () => {
    expect(migration).not.toMatch(/grant\s+(insert|update|delete)[^;]*\bto\s+(authenticated|anon|public)/i);
    expect(migration).not.toMatch(/for\s+(insert|update|delete)\b/i);
  });

  test('anon and PUBLIC get nothing on messaging tables', () => {
    expect(migration).toMatch(/revoke all on public\.communication_messages[\s\S]*from public, anon/);
  });

  test('a message is visible only to the sender, staff, or a snapshot recipient', () => {
    expect(migration).toMatch(
      /communication_messages_select[\s\S]*is_admin_or_coordinator\(\)[\s\S]*is_message_sender\(id\)[\s\S]*is_message_recipient\(id\)/,
    );
  });

  test('a recipient row is visible only to its owner (active members), the sender, or staff', () => {
    expect(migration).toMatch(
      /communication_recipients_select[\s\S]*is_admin_or_coordinator\(\)[\s\S]*is_message_sender\(message_id\)[\s\S]*user_id = auth\.uid\(\) and public\.is_active_member\(\)/,
    );
  });
});

describe('migration 066: honest delivery states', () => {
  test("'stored' is allowed only on the inbox channel", () => {
    expect(migration).toMatch(/status <> 'stored' or channel = 'inbox'/);
  });

  test("'accepted' is allowed only on external channels", () => {
    expect(migration).toMatch(/status <> 'accepted' or channel in \('email','push'\)/);
  });

  test("no 'delivered' status exists in the schema or the dispatcher", () => {
    expect(sqlCode).not.toMatch(/'delivered'/);
    expect(dispatcherCode).not.toMatch(/'delivered'/);
  });
});

describe('migration 066: server-side authorization', () => {
  test('send_message and preview_audience both call the shared authorization check', () => {
    const sendBody = migration.slice(migration.indexOf('function public.send_message'));
    const previewBody = migration.slice(migration.indexOf('function public.preview_audience'), migration.indexOf('function public.send_message'));
    expect(sendBody).toMatch(/perform public\.assert_can_send_message\(/);
    expect(previewBody).toMatch(/perform public\.assert_can_send_message\(/);
  });

  test('the send is idempotent on (sender, idempotency key)', () => {
    expect(migration).toMatch(/unique \(sender_id, idempotency_key\)/);
    expect(migration).toMatch(/if v_existing is not null then\s+return v_existing/);
  });

  test('recipients are resolved only through resolve_audience()', () => {
    expect(migration).toMatch(/from public\.resolve_audience\(v_spec\)/);
  });

  test('every SECURITY DEFINER function pins search_path', () => {
    const definers = migration.match(/security definer[\s\S]*?\$\$;/g) ?? [];
    expect(definers.length).toBeGreaterThanOrEqual(6);
    for (const block of definers) {
      expect(block).toMatch(/set search_path = public, pg_temp/);
    }
  });

  test('send_message is executable only by authenticated, never PUBLIC or anon', () => {
    expect(migration).toMatch(/revoke all on function public\.send_message[^;]*from public, anon/);
    expect(migration).toMatch(/grant execute on function public\.send_message[^;]*to authenticated;/);
  });

  test('the migration drops and truncates nothing', () => {
    expect(migration).not.toMatch(/\b(drop\s+table|drop\s+schema|truncate)\b/i);
  });
});

describe('dispatch-message: idempotent external delivery', () => {
  test('each pending row is claimed before any provider call', () => {
    const claim = dispatcher.indexOf(".eq('status', 'pending')");
    expect(claim).toBeGreaterThan(-1);
    expect(dispatcher.indexOf("status: 'sending'")).toBeLessThan(dispatcher.indexOf('sendEmailViaRelay(profile.email'));
  });

  test('a push device is never notified before its member is claimed', () => {
    expect(dispatcher.indexOf('claimPending(messageId, \'push\')')).toBeLessThan(dispatcher.indexOf('webpush.sendNotification'));
  });

  test('email respects the same preference rule as send-email', () => {
    expect(dispatcher).toMatch(/evaluatePreference\('generic'/);
  });

  test('the push body names no message content', () => {
    expect(dispatcher).toMatch(/body: 'Open the app to read it\.'/);
  });

  test('a message can be dispatched only by its sender or active staff', () => {
    expect(dispatcher).toMatch(/if \(!isStaff && message\.sender_id !== callerId\)/);
  });
});
