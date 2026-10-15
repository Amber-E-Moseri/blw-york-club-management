import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '..', '..');
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('meeting attendance access hardening', () => {
  test('dashboard and meeting list reads do not embed meeting_attendances', () => {
    const dashboardStats = read('src/lib/queries/dashboardStats.ts');
    const meetings = read('src/lib/queries/meetings.ts');

    expect(dashboardStats).not.toMatch(/select\(['"`][^'"`]*meeting_attendances\(/);
    expect(meetings).not.toMatch(/select\(['"`][^'"`]*meeting_attendances\(/);
  });

  test('meeting list checks only the signed-in user attendance state', () => {
    const meetings = read('src/lib/queries/meetings.ts');

    expect(meetings).toContain(".from('meeting_attendances')");
    expect(meetings).toContain(".select('meeting_id')");
    expect(meetings).toContain(".eq('user_id', userId)");
    expect(meetings).toContain('attendanceError');
  });

  test('optimistic attendance updates do not fabricate aggregate counts', () => {
    const useMeetings = read('src/hooks/useMeetings.ts');
    const meetingCard = read('src/components/feature/MeetingCard.tsx');

    expect(useMeetings).toContain("typeof m.attendance_count === 'number'");
    expect(meetingCard).toContain("typeof m.attendance_count === 'number'");
    expect(meetingCard).not.toContain('{m.attendance_count ?? 0} confirmed');
  });

  test('migration grants only scoped authenticated attendance access', () => {
    const migration = read('supabase/migrations/026_meeting_attendance_scoped_access.sql');

    expect(migration).toContain('grant select, insert, update, delete on table public.meeting_attendances to authenticated');
    expect(migration).toContain('public.is_active_member()');
    expect(migration).toContain('user_id = auth.uid()');
    expect(migration).toContain("public.has_admin_permission('attendance.view_all')");
    expect(migration).toContain('public.is_cell_leader_of(m.cell_id)');
    expect(migration).not.toMatch(/using\s*\(\s*true\s*\)/i);
    expect(migration).not.toMatch(/to anon/i);
  });

  test('SQL certification covers member, pending, rejected, coordinator, owner, and leader cases', () => {
    const sql = read('supabase/verification/meeting_attendance_access_certification.sql');

    expect(sql).toContain('active member sees only their own attendance row');
    expect(sql).toContain('pending member cannot read attendance rows');
    expect(sql).toContain('rejected member cannot read attendance rows');
    expect(sql).toContain('coordinator reads all attendance rows for export/management');
    expect(sql).toContain('cell leader reads all attendance rows for their cell meeting');
    expect(sql).toContain('meeting owner reads all attendance rows for owned meeting');
    expect(sql).toContain('dashboard meeting query without attendance embedding remains readable');
  });
});
