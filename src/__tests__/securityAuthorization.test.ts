import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '..', '..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('security hardening regression checks', () => {
  const migration = read('supabase/migrations/016_security_authorization_hardening.sql');

  test('profiles self-update and cell-leader broad profile management are removed', () => {
    expect(migration).toContain('drop policy if exists profiles_update_own on public.profiles');
    expect(migration).toContain('drop policy if exists "leaders_manage_profiles" on public.profiles');
    expect(migration).toContain('create policy profiles_select_scoped');
    expect(migration).toContain('create policy profiles_coordinator_administer');
    expect(migration).not.toContain("role in ('admin', 'coordinator', 'cell_leader')");
  });

  test('member approval is only exposed through authorized database RPCs', () => {
    expect(migration).toContain('create or replace function public.approve_pending_member');
    expect(migration).toContain('create or replace function public.reject_pending_member');
    expect(migration).toContain('if not public.is_admin_or_coordinator() then');
    expect(migration).toContain("raise exception 'Not authorised to approve members.'");
    expect(migration).toContain("raise exception 'Not authorised to reject members.'");
  });

  test('private directory/export data is served through safe database surfaces', () => {
    expect(migration).toContain('create or replace view public.member_directory');
    expect(migration).toContain('with (security_invoker = true)');
    expect(migration).toContain('case when p.id = auth.uid() or public.is_admin_or_coordinator() then p.email else null end as email');
    expect(migration).toContain('create or replace function public.export_members_authorized');
    expect(migration).toContain("public.has_admin_permission('reports.generate')");
  });

  test('contact, meeting, Zoom, and audit policies are narrowed', () => {
    expect(migration).toContain('create policy contacts_update_scoped');
    expect(migration).toContain('create policy contacts_delete_admin_only');
    expect(migration).toContain('create policy contact_audit_log_insert_admin');
    expect(migration).toContain('create policy meetings_manage_scoped');
    expect(migration).toContain('create policy zoom_attendance_read_scoped');
  });

  test('send-email authenticates and authorizes privileged actions before service-role work', () => {
    const fn = read('supabase/functions/send-email/index.ts');
    expect(fn).toContain('async function requireAuthorizedCaller');
    expect(fn).toContain("await requireAuthorizedCaller(req, 'notifications.send')");
    expect(fn).toContain("throw new HttpError('Authentication required', 401)");
    expect(fn).toContain("throw new HttpError('Not authorised to send email', 403)");
    expect(fn.indexOf("body.action === 'schedule'")).toBeLessThan(fn.indexOf(".from('scheduled_emails')"));
  });

  test('scheduled email processor and unsubscribe function reject unauthenticated privileged use', () => {
    const scheduled = read('supabase/functions/process-scheduled-emails/index.ts');
    const unsubscribe = read('supabase/functions/unsubscribe/index.ts');

    expect(scheduled).toContain('EMAIL_CRON_SECRET');
    expect(scheduled).toContain("req.headers.get('x-cron-secret') !== cronSecret");
    expect(unsubscribe).toContain('UNSUBSCRIBE_SECRET');
    expect(unsubscribe).toContain('verifyToken');
    expect(unsubscribe).not.toContain('JSON.parse(atob(token))');
  });
});

describe('profile authorization, approval and privilege hardening (022-025)', () => {
  const strip = (text: string) => text.replace(/--.*$/gm, '');
  const m022 = strip(read('supabase/migrations/022_profile_authorization_hardening.sql'));
  const m023 = strip(read('supabase/migrations/023_function_security_hardening.sql'));
  const m024 = strip(read('supabase/migrations/024_api_privileges_and_defaults.sql'));
  const m025 = strip(read('supabase/migrations/025_storage_buckets_and_policies.sql'));

  test('profile policies are reduced to an allow-list, not dropped by remembered name', () => {
    expect(m022).toContain("policyname not in ('profiles_select_scoped', 'profiles_coordinator_administer')");
    expect(m022).toContain("policyname not in ('profiles_delete', 'profiles_insert', 'profiles_update', 'user_profiles_select_scoped')");
  });

  test('a trigger protects role, status and admin_role even if a policy is wrong', () => {
    expect(m022).toContain('create trigger profiles_guard_privileged_columns');
    expect(m022).toContain("current_user in ('postgres', 'supabase_admin', 'service_role')");
    expect(m022).toContain('Not authorised to change role or admin_role.');
    expect(m022).toContain('Not authorised to change account status.');
  });

  test('approval is enforced by the database: no policy accepts any signed-in account', () => {
    expect(m022).toContain('create or replace function public.is_active_member()');
    expect(m022).toContain("raise exception '022: a policy still authorises any signed-in account");
    ['current_user_role', 'is_core_admin', 'is_cell_leader_for_profile'].forEach((fn) => {
      expect(m022).toMatch(new RegExp(`function public\\.${fn}[\\s\\S]*?status = 'active'`));
    });
  });

  test('the first administrator bootstrap is owner-only, one-time and audited', () => {
    expect(m022).toContain("if session_user not in ('postgres', 'supabase_admin')");
    expect(m022).toContain('Bootstrap already completed.');
    expect(m022).toContain('An active administrator already exists');
    expect(m022).toContain('insert into public.admin_bootstrap_audit');
    expect(m022).toContain('revoke all on function public.bootstrap_first_administrator(text, text) from public, anon, authenticated, service_role');
    expect(m022).not.toMatch(/crypt\(|password/i);
  });

  test('functions: user-editable JWT metadata is never trusted, search_path is pinned, EXECUTE starts from nothing', () => {
    expect(m023).not.toContain('user_metadata');
    expect(m023).toContain("alter function %s set search_path = public, pg_temp");
    expect(m023).toContain('revoke all on function %s from public, anon, authenticated, service_role');
    expect(m023).not.toMatch(/grant execute[^;]*\bto (anon|public)\b/i);
  });

  test('privileges: anon gets nothing, defaults grant the API roles nothing, no TRUNCATE-class grants', () => {
    expect(m024).toContain('revoke all on all tables in schema public from anon, authenticated, service_role');
    expect(m024).not.toMatch(/grant (?!usage on schema)[^;]*\bto anon\b/i);
    expect(m024).toContain('alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated, service_role');
    expect(m024).not.toMatch(/grant[^;]*\b(truncate|references|trigger|maintain)\b/i);
  });

  test('storage: three buckets with limits; every write needs ownership or admin; nothing applies to anon', () => {
    ['devotional-images', 'testimony-images', 'user-media'].forEach((bucket) => expect(m025).toContain(`'${bucket}'`));
    expect(m025).not.toMatch(/to (anon|public)/i);
    expect(m025).toContain("(storage.foldername(name))[1] = auth.uid()::text");
    expect(m025).toContain("split_part(storage.filename(name), '.', 1) = auth.uid()::text");
    expect(m025).toContain('public.is_devotional_admin()');
  });

  test('the client never derives role or status from user-editable metadata', () => {
    const auth = strip(read('src/lib/auth.ts')).replace(/\/\*[\s\S]*?\*\//g, '');
    const builder = auth.slice(auth.indexOf('function buildAuthUser'), auth.indexOf('/** Build an AuthUser from a Supabase'));
    expect(builder).not.toMatch(/user_metadata\?\.\['(role|status|admin_role|cell_id)'\]/);
    expect(builder).toContain("role: 'member'");
    expect(builder).toContain("status: 'pending'");
  });

  test('send-email refuses accounts that are not active', () => {
    const fn = read('supabase/functions/send-email/index.ts');
    expect(fn).toContain("profile.status !== 'active'");
    expect(fn.indexOf("profile.status !== 'active'")).toBeLessThan(fn.indexOf("['admin', 'coordinator'].includes(profile.role)"));
  });
});
