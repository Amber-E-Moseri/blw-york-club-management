import fs from 'fs';
import path from 'path';
import {
  canTargetAffirmations,
  describeAudience,
  toAudiencePayload,
  uniqueIds,
  validateAudience,
  type AudienceDraft,
} from '../lib/audience/audienceRules';

const base: AudienceDraft = { kind: 'all', cellId: null, groupId: null, userIds: [] };

describe('validateAudience', () => {
  test('everyone needs no further choice', () => {
    expect(validateAudience(base)).toBeNull();
  });

  test('a cell, a saved group or a person must be chosen', () => {
    expect(validateAudience({ ...base, kind: 'cell' })).toMatch(/cell/);
    expect(validateAudience({ ...base, kind: 'group' })).toMatch(/group/);
    expect(validateAudience({ ...base, kind: 'individuals', userIds: ['  ', ''] })).toMatch(/person/);
    expect(validateAudience({ ...base, kind: 'individuals', userIds: ['u1'] })).toBeNull();
  });
});

describe('toAudiencePayload', () => {
  test('only the field for the chosen kind is sent; the rest are null', () => {
    expect(toAudiencePayload({ ...base, kind: 'cell', cellId: 'c1', groupId: 'g1', userIds: ['u1'] })).toEqual({
      p_audience: 'cell',
      p_cell_id: 'c1',
      p_group_id: null,
      p_user_ids: null,
    });
  });

  test('individual recipients are de-duplicated before they are sent', () => {
    expect(toAudiencePayload({ ...base, kind: 'individuals', userIds: ['u1', 'u1', 'u2'] }).p_user_ids).toEqual(['u1', 'u2']);
  });
});

describe('authorisation and labels', () => {
  test('only admins and coordinators may target affirmations', () => {
    expect(canTargetAffirmations('coordinator')).toBe(true);
    expect(canTargetAffirmations('admin')).toBe(true);
    expect(canTargetAffirmations('cell_leader')).toBe(false);
    expect(canTargetAffirmations('member')).toBe(false);
  });

  test('labels describe the audience without naming anyone who declared', () => {
    expect(describeAudience({ audience: 'all' })).toBe('Everyone');
    expect(describeAudience({ audience: 'cell', audience_cell_id: 'c1' }, { cells: { c1: 'Riverside' } })).toBe('Cell: Riverside');
    expect(describeAudience({ audience: 'individuals' })).toBe('Selected people');
  });

  test('uniqueIds keeps the first occurrence and drops blanks', () => {
    expect(uniqueIds([' a ', 'b', 'a', ''])).toEqual(['a', 'b']);
  });
});

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
