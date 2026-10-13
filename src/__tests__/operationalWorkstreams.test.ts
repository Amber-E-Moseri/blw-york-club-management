import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const mig = (n: string) => read(`supabase/migrations/${n}`);

// ─── Migration 059: Shared audience infrastructure ────────────────────────────

describe('059: shared audience infrastructure', () => {
  const sql = mig('059_shared_audience_infrastructure.sql');

  test('saved_groups table exists with RLS enabled', () => {
    expect(sql).toContain('create table if not exists public.saved_groups');
    expect(sql).toContain('alter table public.saved_groups enable row level security');
  });

  test('saved_group_members table exists with composite PK and RLS', () => {
    expect(sql).toContain('create table if not exists public.saved_group_members');
    expect(sql).toContain('primary key (group_id, profile_id)');
    expect(sql).toContain('alter table public.saved_group_members enable row level security');
  });

  test('audience_specs table has mode check constraint with all four modes', () => {
    expect(sql).toContain("check (mode in ('all', 'cells', 'saved_groups', 'explicit'))");
    expect(sql).toContain('alter table public.audience_specs enable row level security');
  });

  test('audience_specs consistency constraints enforce array presence per mode', () => {
    expect(sql).toContain("constraint audience_cells_requires_ids");
    expect(sql).toContain("constraint audience_groups_requires_ids");
    expect(sql).toContain("constraint audience_explicit_requires_ids");
  });

  test('resolve_audience() is security definer with pinned search_path', () => {
    expect(sql).toContain('create or replace function public.resolve_audience(p_spec_id uuid)');
    expect(sql).toContain('security definer');
    expect(sql).toContain('set search_path = public, pg_temp');
  });

  test('resolve_audience() filters to active members only', () => {
    expect(sql).toContain("p.status = 'active'");
  });

  test('resolve_audience() handles all four modes', () => {
    expect(sql).toContain("s.mode = 'all'");
    expect(sql).toContain("s.mode = 'cells'");
    expect(sql).toContain("s.mode = 'saved_groups'");
    expect(sql).toContain("s.mode = 'explicit'");
  });

  test('resolve_audience() is revoked from public and anon, granted to authenticated', () => {
    expect(sql).toContain('revoke all on function public.resolve_audience(uuid) from public, anon');
    expect(sql).toContain('grant execute on function public.resolve_audience(uuid) to authenticated, service_role');
  });

  test('saved_groups manage policy is admin/coordinator only', () => {
    expect(sql).toContain('create policy saved_groups_manage on public.saved_groups');
    expect(sql).toContain('public.is_admin_or_coordinator()');
    expect(sql).not.toMatch(/saved_groups_manage[^;]+cell_leader/s);
  });
});

// ─── Migration 060: Events audience extension ────────────────────────────────

describe('060: events audience spec extension', () => {
  const sql = mig('060_events_audience_spec.sql');

  test('events audience constraint extended to include new modes', () => {
    expect(sql).toContain("check (audience in ('all', 'meeting', 'cells', 'saved_groups', 'explicit'))");
  });

  test('audience_spec_id FK added to events', () => {
    expect(sql).toContain('add column if not exists audience_spec_id uuid references public.audience_specs(id)');
  });

  test('new audience modes require audience_spec_id', () => {
    expect(sql).toContain('events_new_audience_requires_spec');
    expect(sql).toContain("audience in ('all', 'meeting')");
    expect(sql).toContain('audience_spec_id is not null');
  });
});

// ─── Migration 061: Meeting explicit invitee read ─────────────────────────────

describe('061: meeting explicit invitee read', () => {
  const sql = mig('061_meeting_explicit_invitee_read.sql');

  test('meetings_explicit_invitee_read policy exists for visibility=explicit', () => {
    expect(sql).toContain("drop policy if exists meetings_explicit_invitee_read on public.meetings");
    expect(sql).toContain("create policy meetings_explicit_invitee_read on public.meetings");
    expect(sql).toContain("visibility = 'explicit'");
    expect(sql).toContain('public.is_active_member()');
  });

  test('invitee read checks meeting_attendances for the calling user', () => {
    expect(sql).toContain('from public.meeting_attendances ma');
    expect(sql).toContain('ma.meeting_id = meetings.id');
    expect(sql).toContain('ma.user_id = auth.uid()');
  });

  test('meeting_attendances_select_scoped is replaced (isolation tightened)', () => {
    expect(sql).toContain('drop policy if exists meeting_attendances_select_scoped on public.meeting_attendances');
    expect(sql).toContain('create policy meeting_attendances_select_scoped');
    // Non-invitee must see meeting via RLS before seeing own attendance row
    expect(sql).toContain('user_id = auth.uid()');
    expect(sql).toContain('public.is_admin_or_coordinator()');
  });

  test('attendance select policy requires active member', () => {
    expect(sql).toContain('public.is_active_member()');
  });
});

// ─── Migration 062: Assignments ───────────────────────────────────────────────

describe('062: assignments', () => {
  const sql = mig('062_assignments.sql');

  test('assignments table with status check and composite indexes', () => {
    expect(sql).toContain("create table if not exists public.assignments");
    expect(sql).toContain("check (status in ('pending', 'in_progress', 'completed', 'cancelled'))");
    expect(sql).toContain('alter table public.assignments enable row level security');
  });

  test('completed_at is auto-stamped by trigger', () => {
    expect(sql).toContain('assignments_completed_at_stamp');
    expect(sql).toContain("new.status = 'completed'");
    expect(sql).toContain('new.completed_at := now()');
  });

  test('assignee can see their own assignments', () => {
    expect(sql).toContain('assigned_to = auth.uid()');
  });

  test('cell leader can see their cell members\' assignments', () => {
    expect(sql).toContain('public.is_cell_leader_of(p.cell_id)');
  });

  test('INSERT restricted to active assignee and authorized staff/leader', () => {
    expect(sql).toContain('create policy assignments_insert on public.assignments');
    expect(sql).toContain('public.is_active_profile(assigned_to)');
    expect(sql).toContain('assigned_by = auth.uid()');
  });

  test('assignee can only advance status — not cancel', () => {
    // The WITH CHECK clause must only allow pending/in_progress/completed (not cancelled).
    // The USING clause legitimately blocks updating already-cancelled/completed rows, so
    // we check the WITH CHECK section specifically.
    const withCheckMatch = sql.match(/create policy assignments_update_own_status[\s\S]*?with check\s*\(([\s\S]*?)\)\s*;/i)?.[1] ?? '';
    expect(withCheckMatch).toContain("status in ('pending', 'in_progress', 'completed')");
    expect(withCheckMatch).not.toContain("'cancelled'");
  });

  test('no DELETE policy exists (soft-delete via cancelled status only)', () => {
    expect(sql).not.toMatch(/create policy.*assignments.*for delete/i);
  });
});

// ─── Migration 063: Affirmation audience targeting ────────────────────────────

describe('063: affirmation audience targeting', () => {
  const sql = mig('063_affirmation_audience_targeting.sql');

  test('audience_spec_id column added to confessions', () => {
    expect(sql).toContain('add column if not exists audience_spec_id uuid references public.audience_specs(id)');
  });

  test('can_see_affirmation() helper is security definer with pinned search_path', () => {
    expect(sql).toContain('create or replace function public.can_see_affirmation(p_confession_id uuid)');
    expect(sql).toContain('security definer');
    expect(sql).toContain('set search_path = public, pg_temp');
  });

  test('broadcast affirmations still visible when audience_spec_id is null', () => {
    expect(sql).toContain('audience_spec_id is null');
  });

  test('targeted affirmations use resolve_audience', () => {
    expect(sql).toContain('from public.resolve_audience(');
    expect(sql).toContain('ra.profile_id = auth.uid()');
  });

  test('admin/coordinator always see targeted affirmations', () => {
    expect(sql).toContain('public.is_admin_or_coordinator()');
  });

  test('declaration write policy enforces can_see_affirmation', () => {
    const writePolicy = sql.match(/create policy confession_declarations_write_own[\s\S]*?;/)?.[0] ?? '';
    expect(writePolicy).toContain('public.can_see_affirmation(confession_id)');
  });

  test('confessions_read requires active member', () => {
    expect(sql).toContain('public.is_active_member()');
  });

  test('can_see_affirmation revoked from public and anon', () => {
    expect(sql).toContain('revoke all on function public.can_see_affirmation(uuid) from public, anon');
  });
});

// ─── Migration 064: Announcement audience targeting ──────────────────────────

describe('064: announcement audience targeting', () => {
  const sql = mig('064_announcements_audience_targeting.sql');

  test('audience_spec_id and is_active columns added to announcements', () => {
    expect(sql).toContain('add column if not exists is_active');
    expect(sql).toContain('add column if not exists audience_spec_id uuid references public.audience_specs(id)');
  });

  test('announcements_read requires active member and active announcement', () => {
    expect(sql).toContain('is_active = true');
    expect(sql).toContain('public.is_active_member()');
  });

  test('broadcast announcements visible when audience_spec_id is null', () => {
    expect(sql).toContain('audience_spec_id is null');
  });

  test('targeted announcements use resolve_audience', () => {
    expect(sql).toContain('from public.resolve_audience(audience_spec_id) ra');
    expect(sql).toContain('ra.profile_id = auth.uid()');
  });

  test('cell leaders restricted to own-authored or own-cell announcements in USING', () => {
    expect(sql).toContain("author_id = auth.uid()");
    expect(sql).toContain("c.leader_id = auth.uid()");
  });

  test('cell leader WITH CHECK restricts insert to own-cell audience', () => {
    expect(sql).toContain("s.mode = 'cells'");
  });
});

// ─── Cross-migration contract invariants ─────────────────────────────────────

describe('operational workstream contract invariants', () => {
  test('all new migrations are numbered 059-067 with no gaps', () => {
    for (let n = 59; n <= 67; n++) {
      const pad = String(n).padStart(3, '0');
      const files = fs.readdirSync(path.join(root, 'supabase/migrations'))
        .filter(f => f.startsWith(pad + '_'));
      expect(files).toHaveLength(1);
    }
  });

  test('all new security definer functions pin search_path to public, pg_temp', () => {
    const newMigs = [59, 60, 61, 62, 63, 64, 65, 66, 67].map(n =>
      mig(`${String(n).padStart(3, '0')}_${fs.readdirSync(path.join(root, 'supabase/migrations'))
        .find(f => f.startsWith(String(n).padStart(3, '0') + '_'))!.replace(/^\d+_/, '')}`)
    );
    for (const sql of newMigs) {
      const definerFns = [...sql.matchAll(/security definer/g)];
      const searchPathMatches = [...sql.matchAll(/set search_path = public, pg_temp/g)];
      expect(searchPathMatches.length).toBeGreaterThanOrEqual(definerFns.length);
    }
  });

  test('no new migration grants execute to public or anon on security definer functions', () => {
    const newMigFiles = fs.readdirSync(path.join(root, 'supabase/migrations'))
      .filter(f => /^(059|060|061|062|063|064|065|066|067)_/.test(f));
    for (const file of newMigFiles) {
      const sql = mig(`${file}`);
      expect(sql).not.toMatch(/grant execute on function[^;]+to\s+public\b/i);
      expect(sql).not.toMatch(/grant execute on function[^;]+to\s+anon\b/i);
    }
  });

  test('recipient expansion never inlines saved_group_members or profile_id arrays', () => {
    // Checking audience_specs.mode for access-control is fine.
    // What is prohibited: inlining the full recipient JOIN (saved_group_members or profile_ids
    // iteration) outside of resolve_audience() itself.
    const newMigFiles = fs.readdirSync(path.join(root, 'supabase/migrations'))
      .filter(f => /^(060|061|062|063|064|065|066|067)_/.test(f));
    for (const file of newMigFiles) {
      const sql = mig(`${file}`);
      // No inline join to saved_group_members for recipient resolution
      expect(sql).not.toMatch(/from public\.saved_group_members\b/i);
      // No inline unnest of profile_ids for recipient resolution
      expect(sql).not.toMatch(/unnest\s*\(\s*profile_ids\s*\)/i);
    }
  });

  test('migration contracts document exists and references all six migrations', () => {
    const contracts = read('docs/ops-shared-contracts.md');
    for (let n = 59; n <= 64; n++) {
      expect(contracts).toContain(String(n));
    }
  });
});

// ─── Migration 065: Audience grants and policy fixes ─────────────────────────

describe('065: audience grants and policy fixes', () => {
  const sql = mig('065_audience_grants_and_policy_fixes.sql');

  test('adds service_role full-DML grants for all four new tables', () => {
    const tables = ['saved_groups', 'saved_group_members', 'audience_specs', 'assignments'];
    for (const t of tables) {
      expect(sql).toMatch(new RegExp(`grant select, insert, update, delete on public\\.${t}\\s+to service_role`, 'i'));
    }
  });

  test('adds write grants for saved_groups to authenticated', () => {
    expect(sql).toMatch(/grant insert, update, delete on public\.saved_groups\s+to authenticated/i);
  });

  test('adds write grants for saved_group_members to authenticated', () => {
    expect(sql).toMatch(/grant insert, update, delete on public\.saved_group_members\s+to authenticated/i);
  });

  test('adds insert grant for audience_specs to authenticated', () => {
    expect(sql).toMatch(/grant insert\s+on public\.audience_specs\s+to authenticated/i);
  });

  test('replaces saved_groups_read with is_active_member() gate', () => {
    expect(sql).toContain('drop policy if exists saved_groups_read on public.saved_groups');
    expect(sql).toContain('create policy saved_groups_read on public.saved_groups');
    expect(sql).toContain('public.is_active_member()');
    expect(sql).not.toContain("auth.role() = 'authenticated'");
  });

  test('replaces saved_group_members_read with is_active_member() gate', () => {
    expect(sql).toContain('drop policy if exists saved_group_members_read on public.saved_group_members');
    expect(sql).toContain('create policy saved_group_members_read on public.saved_group_members');
  });
});

// ─── Migration 066: Meeting invitee read fix ──────────────────────────────────

describe('066: meeting invitee read fix', () => {
  const sql = mig('066_meeting_invitee_read_fix.sql');

  test('is_meeting_invitee() is security definer with pinned search_path', () => {
    expect(sql).toContain('create or replace function public.is_meeting_invitee(p_meeting_id uuid)');
    expect(sql).toContain('security definer');
    expect(sql).toContain('set search_path = public, pg_temp');
  });

  test('is_meeting_invitee() reads meeting_attendances directly (bypasses RLS loop)', () => {
    expect(sql).toContain('from public.meeting_attendances');
    expect(sql).toContain('meeting_id = p_meeting_id');
    expect(sql).toContain('user_id = auth.uid()');
  });

  test('is_meeting_invitee() is revoked from public and anon', () => {
    expect(sql).toContain('revoke all on function public.is_meeting_invitee(uuid) from public, anon');
    expect(sql).toContain('grant execute on function public.is_meeting_invitee(uuid) to authenticated, service_role');
  });

  test('meetings_explicit_invitee_read is replaced to use is_meeting_invitee()', () => {
    expect(sql).toContain('drop policy if exists meetings_explicit_invitee_read on public.meetings');
    expect(sql).toContain('create policy meetings_explicit_invitee_read on public.meetings');
    expect(sql).toContain('public.is_meeting_invitee(id)');
  });
});

// ─── Migration 067: Fix trigger execute grants ────────────────────────────────

describe('067: fix trigger execute grants', () => {
  const sql = mig('067_fix_trigger_execute_grants.sql');

  test('revokes PUBLIC execute from assignments_completed_at_stamp()', () => {
    expect(sql).toContain('revoke all on function public.assignments_completed_at_stamp()');
    expect(sql).toContain('from public');
    expect(sql).toContain('anon');
  });

  test('revoke includes authenticated and service_role (trigger needs no direct-call grant)', () => {
    expect(sql).toContain('authenticated');
    expect(sql).toContain('service_role');
  });
});
