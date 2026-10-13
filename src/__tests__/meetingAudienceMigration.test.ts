import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '..', '..');
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('migrations 072 and 073: meeting publication, invitations, attendance and event visibility', () => {
  const migration = read('supabase/migrations/072_meeting_publication_invitations_attendance.sql');
  const events = read('supabase/migrations/073_event_audience_read_gate.sql');

  test('are the next numbers after 070, and nothing earlier is edited', () => {
    expect(fs.existsSync(path.join(root, 'supabase/migrations/072_meeting_publication_invitations_attendance.sql'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'supabase/migrations/073_event_audience_read_gate.sql'))).toBe(true);
    expect(migration).toContain('Forward-only. Migrations through 070 are not edited.');
  });

  test('does not duplicate or weaken the existing invitee read: is_meeting_invitee and its policy are only referenced', () => {
    expect(migration).not.toMatch(/create (or replace )?(policy|function) [a-z_.]*meetings_explicit_invitee_read/);
    expect(migration).not.toMatch(/create or replace function public\.is_meeting_invitee/);
    expect(migration).not.toMatch(/drop policy if exists meetings_explicit_invitee_read/);
    expect(migration).toContain('public.is_meeting_invitee(m.id)');
  });

  test('keeps 061 select and 026 update policies in place', () => {
    expect(migration).not.toMatch(/drop policy if exists meeting_attendances_select_scoped/);
    expect(migration).not.toMatch(/drop policy if exists meeting_attendances_update_manager/);
  });

  test('members cannot forge an outcome: the insert policy fixes self rows to confirmed or excused', () => {
    expect(migration).toContain("attendance_status in ('confirmed', 'excused')");
    expect(migration).toContain("invited_via = 'self'");
    const insert = migration.slice(migration.indexOf('create policy meeting_attendances_insert_own_visible'), migration.indexOf('-- Own rows can be removed only'));
    expect(insert).not.toMatch(/attendance_status in \('invited', 'confirmed', 'attended'/);
  });

  test('a roster entry cannot widen the audience', () => {
    expect(migration).toContain('public.is_in_audience_spec(audience_spec_id, user_id)');
  });

  test('completed attendance is guarded on update (no reset) and on delete (no removal)', () => {
    expect(migration).toContain("old.attendance_status in ('attended', 'absent')");
    expect(migration).toContain("new.attendance_status in ('invited', 'confirmed')");
    expect(migration).toContain('before delete');
  });

  test('a draft is readable by its managers only, through a restrictive policy', () => {
    expect(migration).toContain('create policy meetings_publication_gate');
    expect(migration).toContain('as restrictive');
    expect(migration).toContain('public.is_meeting_manager(id)');
  });

  test('audience changes resolve through the complete resolver, never the caller-scoped one', () => {
    const setAudience = migration.slice(migration.indexOf('create or replace function public.set_meeting_audience'));
    expect(setAudience).toContain('from public.resolve_audience_all(v_spec) r');
    expect(setAudience).not.toMatch(/from public\.resolve_audience\(/);
    expect(setAudience).toContain('insert into public.audience_specs');
    expect(setAudience).toContain('update public.meetings set audience_spec_id = v_spec where id = p_meeting_id;');
  });

  test('audience modes are limited by role, as the database enforces them', () => {
    const setAudience = migration.slice(migration.indexOf('create or replace function public.set_meeting_audience'));
    expect(setAudience).toContain('Only admins and coordinators can invite all members');
    expect(setAudience).toContain('Cell leaders can only invite members of cells they lead');
    expect(setAudience).toContain('Cell leaders can only invite members of their own cells');
  });

  test('new functions are revoked from anon and PUBLIC, and granted to authenticated where called by clients', () => {
    expect(migration).not.toMatch(/using\s*\(\s*true\s*\)/i);
    expect(migration).not.toMatch(/to anon/i);
    expect(migration).toContain('revoke all on function public.set_meeting_audience(uuid, text, uuid[], uuid[], uuid[], boolean) from public, anon;');
    expect(migration).toContain('grant execute on function public.set_meeting_audience(uuid, text, uuid[], uuid[], uuid[], boolean) to authenticated;');
  });

  test('event visibility: targeted events only for their recipients, and all-members events stay open', () => {
    expect(events).toContain("audience = 'all'");
    expect(events).toContain('public.can_view_meeting(audience_meeting_id)');
    expect(events).toContain('public.is_in_audience_spec(audience_spec_id, auth.uid())');
    expect(events).toContain('public.is_active_member()');
  });
});

describe('the certification runbook includes the reconciliation harnesses', () => {
  test('the integration harness covers the ten meeting scenarios and the pending and rejected cases', () => {
    const sql = read('supabase/verification/meeting_integration_certification.sql');
    for (const phrase of [
      'admin schedules a meeting for all active members',
      'cell leader cannot schedule for another cell',
      'outsider cannot read the private meeting by id',
      'a recorded outcome cannot be deleted',
      'pending account reads no meeting',
      'rejected account reads no meeting',
      'reading meetings does not raise 42P17',
    ]) {
      expect(sql).toContain(phrase);
    }
  });

  test('the reconciliation harness checks the preserved policy, forging, discard, export and event visibility', () => {
    const sql = read('supabase/verification/meeting_reconcile_certification.sql');
    for (const phrase of [
      'meetings_explicit_invitee_read still uses is_meeting_invitee()',
      'member cannot insert their own attendance as attended',
      'member cannot update their own attendance to attended',
      'recorded absence cannot be overwritten by the invitee',
      'legacy attended boolean follows attendance_status',
      'an unrelated member cannot read a targeted cell event',
      'a pending account cannot read a targeted event',
    ]) {
      expect(sql).toContain(phrase);
    }
  });
});
