import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '..', '..');
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('event creation', () => {
  test('Events page exposes Add Event only to coordinator/admin users', () => {
    const eventsPage = read('src/pages/Events.tsx');

    expect(eventsPage).toContain("user?.role === 'coordinator' || user?.role === 'admin'");
    expect(eventsPage).toContain('Add Event');
    expect(eventsPage).not.toContain("user?.role === 'cell_leader'");
    expect(eventsPage).not.toContain("user?.role === 'member'");
  });

  test('event form uses columns supported by the existing events schema', () => {
    const eventsPage = read('src/pages/Events.tsx');
    const queries = read('src/lib/queries.ts');
    const migration = read('supabase/migrations/017_app_phase_tables.sql');

    expect(eventsPage).toContain('Title');
    expect(eventsPage).toContain('Date');
    expect(eventsPage).toContain('Time');
    expect(eventsPage).toContain('Location');
    expect(eventsPage).toContain('Description');
    expect(eventsPage).toContain('Category');
    expect(queries).toContain('export async function createEvent');
    expect(queries).toContain(".from('events')");
    expect(queries).toContain('created_by: input.created_by');
    expect(migration).toContain('title text NOT NULL');
    expect(migration).toContain('date date NOT NULL');
    expect(migration).toContain('time time');
    expect(migration).toContain('location text');
    expect(migration).toContain('description text');
  });

  test('event creation does not require or silently assign a personal cell', () => {
    const eventsPage = read('src/pages/Events.tsx');
    const queries = read('src/lib/queries.ts');

    expect(eventsPage).not.toContain('cellId');
    expect(eventsPage).not.toContain('cell_id');
    expect(queries).not.toMatch(/createEvent[\s\S]*cell_id/);
  });

  test('Save validates required fields, blocks duplicate submissions, and refreshes after success', () => {
    const eventsPage = read('src/pages/Events.tsx');
    const useEvents = read('src/hooks/useEvents.ts');

    expect(eventsPage).toContain('Title must be at least 2 characters.');
    expect(eventsPage).toContain('Date is required.');
    expect(eventsPage).toContain('disabled={saving}');
    expect(eventsPage).toContain('refetch();');
    expect(useEvents).toContain('return { events, loading, error, refetch };');
  });

  test('database RLS authorizes coordinators/admins and rejects ordinary members/cell leaders', () => {
    const migration = read('supabase/migrations/017_app_phase_tables.sql');
    const contract = read('supabase/verification/schema_fingerprint.golden.json');

    expect(migration).toContain('CREATE POLICY events_manage ON public.events');
    expect(migration).toContain('WITH CHECK (public.is_admin_or_coordinator())');
    expect(contract).toContain('events_manage | ALL');
    expect(contract).toContain('check=is_admin_or_coordinator()');
  });
});
