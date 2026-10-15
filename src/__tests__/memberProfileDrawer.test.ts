import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '..', '..');
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('member profile drawer', () => {
  test('loads drawer profiles from the directory profile id, not person or membership ids', () => {
    const membersPage = read('src/pages/Members.tsx');
    const memberQueries = read('src/lib/queries/members.ts');
    const useUserProfile = read('src/hooks/useUserProfile.ts');

    expect(memberQueries).toContain(".from('member_directory')");
    expect(memberQueries).toContain('id, full_name, email');
    expect(membersPage).toContain('onClick={() => setSelectedId(m.id)}');
    expect(useUserProfile).toContain(".from('profiles')");
    expect(useUserProfile).toContain(".eq('id', targetUserId)");
    expect(useUserProfile).not.toContain('profiles!inner');
    expect(useUserProfile).not.toContain('bsc_assignment');
    expect(useUserProfile).not.toContain('spiritual_role');
    expect(useUserProfile).not.toContain("select('email, name");
  });

  test('distinguishes missing profiles from load errors in the drawer', () => {
    const panel = read('src/components/people/PersonDetailPanel.tsx');
    const hook = read('src/hooks/useUserProfile.ts');

    expect(hook).toContain('notFound');
    expect(hook).toContain('setNotFound(true)');
    expect(panel).toContain('Profile could not be loaded.');
    expect(panel).toContain('No visible member profile exists for this directory entry.');
  });

  test('saves only fields authorised by existing RLS policies', () => {
    const hook = read('src/hooks/useUserProfile.ts');
    const profileMigration = read('supabase/migrations/022_profile_authorization_hardening.sql');
    const hardeningMigration = read('supabase/migrations/028_release_lifecycle_profile_contact_hardening.sql');

    expect(hook).toContain(".from('profiles')");
    expect(hook).toContain(".update({");
    expect(hook).toContain("actorProfile?.role === 'coordinator'");
    expect(hook).toContain('actorIsActive');
    expect(hook).toContain('actorIsPending');
    expect(hook).toContain(".from('user_profiles')");
    expect(hook).toContain('.upsert({');
    expect(profileMigration).toContain('create policy profiles_coordinator_administer');
    expect(hardeningMigration).toContain('create policy profiles_update on public.user_profiles');
    expect(hardeningMigration).toContain('user_profiles_staff_update');
    expect(hardeningMigration).toContain('staff_profile_edit_audit');
    expect(profileMigration).not.toMatch(/grant update on table public\.profiles to authenticated/i);
    expect(profileMigration).not.toMatch(/grant update on table public\.people to authenticated/i);
  });

  test('drawer editing keeps role, status, cell, and email read-only', () => {
    const panel = read('src/components/people/PersonDetailPanel.tsx');

    expect(panel).toContain('Role, status, cell, and account email are managed separately.');
    expect(panel).toContain('Phone and bio are self-managed fields under current permissions.');
    expect(panel).toContain('readOnly');
    expect(panel).not.toContain('setRole');
    expect(panel).not.toContain('setStatus');
    expect(panel).not.toContain('setCell');
  });

  test('refreshes directory and drawer after saving without creating profile duplicates', () => {
    const membersPage = read('src/pages/Members.tsx');
    const panel = read('src/components/people/PersonDetailPanel.tsx');
    const hook = read('src/hooks/useUserProfile.ts');

    expect(membersPage).toContain('onSaved={fetchMembers}');
    expect(panel).toContain('setSuccess');
    expect(hook).not.toMatch(/insert\\s+into\\s+public\\.profiles/i);
    expect(hook).not.toMatch(/insert\\s+into\\s+public\\.people/i);
  });
});
