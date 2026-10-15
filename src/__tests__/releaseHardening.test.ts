import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '..', '..');
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('final release hardening', () => {
  test('inactive lifecycle state is represented in database and app access gates', () => {
    const migration = read('supabase/migrations/028_release_lifecycle_profile_contact_hardening.sql');
    const app = read('src/App.tsx');
    const auth = read('src/lib/auth.ts');

    expect(migration).toContain("check (status in ('pending', 'active', 'inactive', 'rejected'))");
    expect(app).toContain("user.status === 'inactive'");
    expect(auth).toContain("'inactive'");
  });

  test('pending and active accounts may edit ordinary own profile fields only', () => {
    const migration = read('supabase/migrations/028_release_lifecycle_profile_contact_hardening.sql');
    const hook = read('src/hooks/useUserProfile.ts');

    expect(migration).toContain('profiles_self_onboarding_update');
    expect(migration).toContain("old.status not in ('pending', 'active')");
    expect(migration).toContain("p.status in ('pending', 'active')");
    expect(migration).toContain("array['email', 'role', 'status', 'cell_id', 'admin_role', 'joined_at', 'person_id']");
    expect(hook).toContain('except pending members may update their own onboarding details');
  });

  test('staff profile edits are audited without storing phone-number values', () => {
    const migration = read('supabase/migrations/028_release_lifecycle_profile_contact_hardening.sql');
    const contract = read('supabase/verification/schema_contract.json');

    expect(migration).toContain('create table if not exists public.staff_profile_edit_audit');
    expect(migration).toContain("field = 'phone' then to_jsonb('[redacted]'::text)");
    expect(migration).toContain('user_profiles_staff_update');
    expect(migration).toContain('profiles_staff_edit_audit');
    expect(contract).toContain('staff_profile_edit_audit');
    expect(contract).toContain('audit_staff_profile_edits()');
  });

  test('outreach allows repeat interactions and deduplicates retries by idempotency key', () => {
    const migration = read('supabase/migrations/028_release_lifecycle_profile_contact_hardening.sql');
    const contacts = read('src/lib/queries/contacts.ts');
    const quickAdd = read('src/components/feature/QuickAddModal.tsx');

    expect(migration).toContain('add column if not exists idempotency_key text');
    expect(migration).toContain('contacts_logged_by_idempotency_key_unique');
    expect(migration).not.toMatch(/unique.*person_id.*date_contacted/i);
    expect(contacts).toContain('.eq(\'idempotency_key\', input.idempotency_key)');
    expect(quickAdd).toContain('idempotency_key: contactIdempotencyKey.current');
  });

  test('phone-only people matches are not automatically merged', () => {
    const people = read('src/lib/queries/people.ts');

    expect(people).toContain('Phone-only');
    expect(people).not.toContain('if (!personId && input.phone)');
  });

  test('email open tracking requires message id and token', () => {
    const migration = read('supabase/migrations/029_secure_email_open_tracking.sql');
    const edge = read('supabase/functions/send-email/index.ts');
    const service = read('src/lib/email/emailService.ts');

    expect(migration).toContain('tracking_token uuid not null default gen_random_uuid()');
    expect(migration).toContain('where id = message_id');
    expect(migration).toContain('and tracking_token = token');
    expect(edge).toContain('trackingToken');
    expect(edge).toContain("supabase.rpc('track_email_open'");
    expect(service).toContain('trackEmailOpen(messageId: string, trackingToken: string)');
  });

  test('custom email composer keeps sends disabled until relay is configured', () => {
    const page = read('src/pages/AdminEmailLog.tsx');

    expect(page).toContain('Sending is disabled until the email relay is configured');
    expect(page).toContain('<Button variant="warning"');
    expect(page).toContain('disabled onClick=');
  });
});
