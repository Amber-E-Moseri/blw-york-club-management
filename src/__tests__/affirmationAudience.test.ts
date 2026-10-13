import fs from 'fs';
import path from 'path';

// The affirmation audience rules now live in the canonical model (src/lib/audience). Their guarantees are tested in
// src/__tests__/audienceResolution.test.ts: validation of an empty or mismatched audience, the payload with
// duplicate ids removed, and staff-only "everyone" targeting. This file keeps the migration 063 invariants.

describe('migration 063 affirmation audience targeting invariants', () => {
  // The assignments branch combined assignments + affirmation targeting in a single file.
  // In this branch they are separate: 062 = assignments, 063 = affirmation audience targeting.
  const sql = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'supabase', 'migrations', '063_affirmation_audience_targeting.sql'),
    'utf8',
  );

  test('affirmation reads use resolve_audience for targeted specs or broadcast for null', () => {
    expect(sql).toMatch(/create policy confessions_read on public\.confessions[\s\S]*?resolve_audience\(audience_spec_id\)/);
  });

  test('declaration writes are gated through can_see_affirmation', () => {
    expect(sql).toMatch(/and public\.can_see_affirmation\(confession_id\)/);
  });

  test('declarations cannot be written for an affirmation the caller cannot see', () => {
    expect(sql).toMatch(/create policy confession_declarations_write_own[\s\S]*?can_see_affirmation\(confession_id\)/);
  });

  test('can_see_affirmation is a SECURITY DEFINER function revoked from anon', () => {
    expect(sql).toMatch(/revoke all on function public\.can_see_affirmation\(uuid\) from public, anon/);
  });

  test('no migration in this file drops a table or truncates data', () => {
    expect(sql).not.toMatch(/\b(drop\s+table|truncate|drop\s+schema)\b/i);
  });
});
