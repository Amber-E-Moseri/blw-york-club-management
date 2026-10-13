import fs from 'fs';
import path from 'path';
import { allowedStatusChanges } from '../lib/queries/members';

// Source-level checks for migrations 083 and 084. The behavioural negative tests run on PGlite in
// supabase/verification/member_status_assignment_authz_test.mjs. These guard the text the database is built from.

const root = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r/g, '');

describe('set_member_status (migration 083)', () => {
  const sql = read('supabase/migrations/083_member_status_transitions_and_staff_guard.sql');

  test('replaces the 080 function forward-only and keeps the caller, reason and audit rules', () => {
    expect(sql).toContain('create or replace function public.set_member_status(p_member_id uuid, p_status text, p_reason text default null)');
    expect(sql).toContain('if not public.is_admin_or_coordinator() then');
    expect(sql).toContain("raise exception 'Give a reason for this change.' using errcode = '22023';");
    expect(sql).toContain('insert into public.member_status_audit');
  });

  test('a coordinator account cannot be changed, and an admin account needs a coordinator', () => {
    expect(sql).toContain("if v_role = 'coordinator' then");
    expect(sql).toContain("if (v_role = 'admin' or v_admin_role is not null) and not public.is_coordinator() then");
  });

  test('activation only starts from inactive, so no path skips approve_pending_member', () => {
    expect(sql).toContain("(v_from = 'inactive' and p_status = 'active')");
    expect(sql).not.toMatch(/v_from = 'rejected' and p_status = 'active'/);
    expect(sql).toContain('A rejected member cannot be reactivated here.');
  });

  test('the transition table in the database matches the client table the UI uses', () => {
    const pairs = Array.from(sql.matchAll(/\(v_from = '(\w+)' and p_status = '(\w+)'\)/g))
      .map((m) => `${m[1]}->${m[2]}`)
      .sort();
    const client = (['active', 'inactive', 'rejected', 'pending'] as const)
      .flatMap((from) => allowedStatusChanges(from).map((to) => `${from}->${to}`))
      .sort();
    expect(pairs).toEqual(client);
  });

  test('the client offers no change the database refuses', () => {
    expect(allowedStatusChanges('pending')).toEqual([]);
    expect(allowedStatusChanges('rejected')).not.toContain('active');
    expect(allowedStatusChanges('inactive')).toEqual(['active']);
  });

  test('stays callable only by authenticated users', () => {
    expect(sql).toContain('revoke all on function public.set_member_status(uuid, text, text) from public, anon;');
    expect(sql).toContain('grant execute on function public.set_member_status(uuid, text, text) to authenticated;');
  });
});

describe('assignment assignee guard (migration 084)', () => {
  const sql = read('supabase/migrations/084_assignment_guard_trusted_roles.sql');
  const prior = read('supabase/migrations/081_assignment_assignee_guard.sql');

  test('trusted database roles are exempt, as 048 does for profiles', () => {
    expect(sql).toContain("if current_user in ('postgres', 'supabase_admin', 'service_role') then");
  });

  test('the client-facing rules are unchanged from 081', () => {
    for (const column of ['title', 'description', 'due_date', 'priority', 'assigned_to', 'assigned_by', 'batch_id', 'reviewed_at']) {
      expect(sql).toContain(`new.${column} is distinct from old.${column}`);
      expect(prior).toContain(`new.${column} is distinct from old.${column}`);
    }
    expect(sql).toContain("raise exception 'Only a coordinator or admin can change a task’s details or its review.'");
  });

  test('the manager check still reads the profile, not the JWT', () => {
    expect(sql).toContain('if public.is_admin_or_coordinator() then');
    expect(sql).not.toMatch(/request\.jwt|user_metadata|app_metadata/);
  });
});

describe('email preference guard copies', () => {
  test('the app copy and the edge-function copy are identical, so the tested rules are the deployed rules', () => {
    expect(read('src/lib/email/emailPreferenceGuard.ts')).toBe(read('supabase/functions/_shared/email-preference-guard.ts'));
  });
});
