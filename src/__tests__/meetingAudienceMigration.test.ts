import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '..', '..');
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('migrations 066 and 067: meeting audience, invitations and attendance', () => {
  const migration = read('supabase/migrations/066_meeting_audience_invitations_attendance.sql');
  const events = read('supabase/migrations/067_event_audience_read_gate.sql');

  test('are forward-only, and 061 is repaired without being edited', () => {
    expect(migration).toContain('Forward-only. Does not alter migrations <= 065.');
    expect(migration).toContain('Migration 061 itself is not edited.');
    expect(events).toContain('drop policy if exists events_read on public.events;');
  });

  test('do not reuse the historical migration 039 from feat/blwyork-meetings-audience', () => {
    expect(fs.existsSync(path.join(root, 'supabase/migrations/039_meeting_audience_and_invitations.sql'))).toBe(false);
    expect(migration).not.toContain('member_groups');
    expect(migration).toContain('saved_groups');
  });

  test('the 061 recursion is removed: explicit-meeting and attendance policies go through definer helpers', () => {
    const explicit = migration.slice(migration.indexOf('create policy meetings_explicit_invitee_read'));
    expect(explicit.slice(0, 400)).toContain('public.is_meeting_participant(id)');
    expect(explicit.slice(0, 400)).not.toContain('from public.meeting_attendances');
    const select = migration.slice(migration.indexOf('create policy meeting_attendances_select_scoped'));
    expect(select.slice(0, 500)).toContain('public.can_view_meeting(meeting_id)');
    expect(select.slice(0, 500)).not.toMatch(/from public\.meetings m/);
  });

  test('drafts and inactive accounts are excluded by a restrictive policy on top of every permissive read policy', () => {
    expect(migration).toContain('create policy meetings_publication_gate');
    expect(migration).toContain('as restrictive');
    expect(migration).toContain('public.is_meeting_manager(id)');
    expect(migration).toContain('or (public.is_active_member() and published_at is not null)');
  });

  test('private meeting details are readable only by managers, invitees and visibility-rule holders', () => {
    const canView = migration.slice(migration.indexOf('create or replace function public.can_view_meeting'));
    expect(canView).toContain('public.is_active_member()');
    expect(canView).toContain('m.published_at is not null');
    expect(canView).toContain('public.is_meeting_participant(m.id)');
  });

  test('audience changes are one transaction that writes an immutable spec and reconciles invitations', () => {
    const setAudience = migration.slice(migration.indexOf('create or replace function public.set_meeting_audience'));
    expect(setAudience).toContain('insert into public.audience_specs');
    expect(setAudience).toContain('from public.resolve_audience(v_spec)');
    expect(setAudience).toContain('update public.meetings set audience_spec_id = v_spec where id = p_meeting_id;');
    expect(setAudience).toContain("raise exception '% invitee(s) have recorded attendance and cannot be removed.");
    expect(setAudience).toContain("Cell leaders can only invite members of cells they lead");
    expect(setAudience).toContain("Only admins and coordinators can invite all members");
  });

  test('completed attendance cannot be silently discarded: no reset to invited or confirmed, and no delete', () => {
    expect(migration).toContain("new.attendance_status in ('invited', 'confirmed')");
    expect(migration).toContain('create or replace function public.meeting_attendance_guard_delete()');
    expect(migration).toContain('before delete');
  });

  test('an invitee cannot write their own row, and a self registration is never stored for someone else', () => {
    const update = migration.slice(migration.indexOf('create policy meeting_attendances_update_manager'), migration.indexOf('drop policy if exists meeting_attendances_delete_own_or_manager'));
    expect(update).not.toContain('user_id = auth.uid()');
    expect(migration).toContain("if new.user_id is distinct from auth.uid() and new.invited_via = 'self' then");
  });

  test('new functions are revoked from anon and PUBLIC, and granted to authenticated', () => {
    expect(migration).not.toMatch(/using\s*\(\s*true\s*\)/i);
    expect(migration).not.toMatch(/to anon/i);
    expect(migration).toContain('revoke all on function public.set_meeting_audience(uuid, text, uuid[], uuid[], uuid[], boolean) from public, anon;');
    expect(migration).toContain('grant execute on function public.set_meeting_audience(uuid, text, uuid[], uuid[], uuid[], boolean) to authenticated;');
  });

  test('event audiences: only the audience, managers, participants and resolved recipients can read a targeted event', () => {
    expect(events).toContain("audience = 'all'");
    expect(events).toContain('public.is_meeting_participant(audience_meeting_id)');
    expect(events).toContain('public.is_meeting_manager(audience_meeting_id)');
    expect(events).toContain('from public.resolve_audience(audience_spec_id) r');
    expect(events).toContain('revoke all on function public.assignments_completed_at_stamp()');
  });
});

describe('the certification runbook includes the integration harness', () => {
  test('the SQL harness covers the ten meeting scenarios and the pending and rejected cases', () => {
    const sql = read('supabase/verification/meeting_integration_certification.sql');
    for (const phrase of [
      'E2E-01',
      'admin schedules a meeting for all active members',
      'E2E-02',
      'E2E-03',
      'E2E-04',
      'cell leader cannot schedule for another cell',
      'E2E-05',
      'outsider cannot read the private meeting by id',
      'E2E-06',
      'E2E-07',
      'E2E-08',
      'a recorded outcome cannot be deleted',
      'E2E-10',
      'pending account reads no meeting',
      'rejected account reads no meeting',
      'reading meetings does not raise 42P17',
    ]) {
      expect(sql).toContain(phrase);
    }
  });
});
