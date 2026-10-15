import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '..', '..');
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('Quick Add cell authorization', () => {
  test('does not silently assign contacts to the current user cell or first cell', () => {
    const quickAdd = read('src/components/feature/QuickAddModal.tsx');

    expect(quickAdd).not.toContain('user.cellId ?? cells[0]?.id');
    expect(quickAdd).toContain('selectedContactCellIsAllowed');
    expect(quickAdd).toContain('Select an authorized cell before logging this contact.');
  });

  test('coordinators and admins can choose from all loaded cells', () => {
    const quickAdd = read('src/components/feature/QuickAddModal.tsx');

    expect(quickAdd).toContain("if (user.role === 'coordinator' || user.role === 'admin') return cells;");
    expect(quickAdd).toContain('<CellSelect');
  });

  test('cell leaders can choose only cells they lead', () => {
    const quickAdd = read('src/components/feature/QuickAddModal.tsx');
    const policies = read('supabase/migrations/016_security_authorization_hardening.sql');

    expect(quickAdd).toContain("if (user.role === 'cell_leader') return cells.filter((cell) => cell.leader_id === user.id);");
    expect(policies).toContain('public.is_cell_leader_of(cell_id)');
  });

  test('ordinary members and users with no authorized cell get a useful disabled state', () => {
    const quickAdd = read('src/components/feature/QuickAddModal.tsx');

    expect(quickAdd).toContain('Your account is not authorized to log outreach contacts under the current contact permissions.');
    expect(quickAdd).toContain('No authorized cells');
    expect(quickAdd).toContain('disabled={saving || manageableCells.length === 0}');
  });

  test('Schedule Meeting uses the same authorized cell selection for cell meetings', () => {
    const quickAdd = read('src/components/feature/QuickAddModal.tsx');

    expect(quickAdd).toContain("meetingCategory === 'cell'");
    expect(quickAdd).toContain('selectedMeetingCellIsAllowed');
    expect(quickAdd).toContain("cell_id: meetingCategory === 'cell' ? meetingCellId : undefined");
    expect(quickAdd).toContain('Select an authorized cell before scheduling a cell meeting.');
  });

  test('contact RLS supports the UI role matrix without broad grants', () => {
    const policies = read('supabase/migrations/016_security_authorization_hardening.sql');

    expect(policies).toContain('create policy contacts_insert_scoped');
    expect(policies).toContain('public.is_admin_or_coordinator()');
    expect(policies).toContain('public.is_cell_leader_of(cell_id)');
    expect(policies).not.toMatch(/contacts_insert_scoped[\s\S]*auth\.uid\(\)\s*=\s*logged_by/);
  });
});
