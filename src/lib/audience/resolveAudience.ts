// Client-side preview of the canonical audience. Mirrors public.resolve_audience_all() and the checks in
// public.create_audience_spec() (migrations 068, 069) so the composer can show a count and validation before submit.
//
// NOT a security boundary. The server re-runs both checks and its answer is authoritative.

import type {
  AudienceData,
  AudienceResolution,
  AudienceScope,
  AudienceSpecDraft,
  AudienceValidationError,
} from '../../types/audience';

const includeTotal = (d: AudienceSpecDraft) => d.cellIds.length + d.groupIds.length + d.profileIds.length;

/** Validation without resolving. Returns errors in a stable order. */
export function validateAudienceSpec(
  draft: AudienceSpecDraft,
  data: AudienceData,
  scope: AudienceScope,
): AudienceValidationError[] {
  const errors = new Set<AudienceValidationError>();
  const total = includeTotal(draft);
  const exclusionTotal = draft.excludedCellIds.length + draft.excludedGroupIds.length + draft.excludedProfileIds.length;
  const groupById = new Map(data.groups.map((g) => [g.id, g]));
  const candidateById = new Map(data.candidates.map((c) => [c.id, c]));
  const cellIds = new Set(data.cells.map((c) => c.id));

  // Mode consistency, the same rules create_audience_spec() applies.
  if (draft.mode === 'all') {
    if (total > 0) errors.add('mode_mismatch');
  } else if (total === 0) {
    errors.add('no_include');
  } else if (draft.mode === 'cells' && (draft.groupIds.length + draft.profileIds.length > 0 || draft.cellIds.length === 0)) {
    errors.add('mode_mismatch');
  } else if (draft.mode === 'saved_groups' && (draft.cellIds.length + draft.profileIds.length > 0 || draft.groupIds.length === 0)) {
    errors.add('mode_mismatch');
  } else if (draft.mode === 'explicit' && (draft.cellIds.length + draft.groupIds.length > 0 || draft.profileIds.length === 0)) {
    errors.add('mode_mismatch');
  }

  if (exclusionTotal > 0 && !scope.canExclude) errors.add('exclusions_not_permitted');

  if (!scope.canUseEveryone) {
    if (draft.mode === 'all') {
      errors.add('everyone_not_permitted');
    } else if (draft.mode !== 'cells' || draft.cellIds.length !== 1) {
      // A cell leader may target exactly one cell they lead, and nothing else.
      errors.add('mode_mismatch');
    }
  }

  for (const id of draft.cellIds) {
    if (!cellIds.has(id) || (!scope.canUseEveryone && !scope.ledCellIds.includes(id))) {
      errors.add('out_of_scope_cell');
    }
  }
  for (const id of draft.groupIds) {
    const g = groupById.get(id);
    if (!g || !g.isActive) errors.add('unknown_group');
  }
  for (const id of draft.profileIds) {
    if (!candidateById.has(id)) errors.add('out_of_scope_member');
  }
  // The database validates exclusions for existence too, so the preview does the same.
  for (const id of draft.excludedCellIds) {
    if (!cellIds.has(id)) errors.add('out_of_scope_cell');
  }
  for (const id of draft.excludedGroupIds) {
    const g = groupById.get(id);
    if (!g || !g.isActive) errors.add('unknown_group');
  }

  return ORDER.filter((e) => errors.has(e));
}

const ORDER: AudienceValidationError[] = [
  'no_include',
  'mode_mismatch',
  'everyone_not_permitted',
  'exclusions_not_permitted',
  'out_of_scope_cell',
  'out_of_scope_member',
  'unknown_group',
  'empty_audience',
];

/** Recipients the server would derive. Mirrors resolve_audience_all(). Sorted and unique. */
export function resolveRecipientIds(draft: AudienceSpecDraft, data: AudienceData, scope: AudienceScope): string[] {
  const activeProfiles = data.candidates.filter((c) => c.status === 'active');
  const groupById = new Map(data.groups.map((g) => [g.id, g]));

  const included = new Set<string>();
  const add = (ids: string[]) => ids.forEach((id) => included.add(id));

  if (draft.mode === 'all') activeProfiles.forEach((c) => included.add(c.id));
  if (draft.mode === 'cells' || draft.mode === 'composite') {
    add(activeProfiles.filter((c) => c.cellId !== null && draft.cellIds.includes(c.cellId)).map((c) => c.id));
  }
  if (draft.mode === 'explicit' || draft.mode === 'composite') {
    add(activeProfiles.filter((c) => draft.profileIds.includes(c.id)).map((c) => c.id));
  }
  if (draft.mode === 'saved_groups' || draft.mode === 'composite') {
    const memberIds = new Set<string>();
    draft.groupIds.forEach((gid) => {
      const g = groupById.get(gid);
      if (g && g.isActive) g.memberIds.forEach((m) => memberIds.add(m));
    });
    add(activeProfiles.filter((c) => memberIds.has(c.id)).map((c) => c.id));
  }

  // Exclusions apply to every mode. They are not limited to active members, matching the database.
  const excluded = new Set<string>();
  data.candidates.forEach((c) => {
    if (c.cellId !== null && draft.excludedCellIds.includes(c.cellId)) excluded.add(c.id);
    if (draft.excludedProfileIds.includes(c.id)) excluded.add(c.id);
  });
  draft.excludedGroupIds.forEach((gid) => {
    const g = groupById.get(gid);
    if (g) g.memberIds.forEach((m) => excluded.add(m));
  });

  const inScope = (id: string) => {
    if (scope.canUseEveryone) return true;
    const c = data.candidates.find((x) => x.id === id);
    return !!c && c.cellId !== null && scope.ledCellIds.includes(c.cellId);
  };

  return Array.from(included)
    .filter((id) => !excluded.has(id) && inScope(id))
    .sort();
}

/**
 * Preview entry point. Hard errors return no recipients: the server rejects the whole request the same way.
 * `empty_audience` is a validation result, not an exception.
 */
export function resolveAudience(
  draft: AudienceSpecDraft,
  data: AudienceData,
  scope: AudienceScope,
): AudienceResolution {
  const errors = validateAudienceSpec(draft, data, scope);
  const hard = errors.length > 0;
  if (hard) return { recipientIds: [], errors };
  const recipientIds = resolveRecipientIds(draft, data, scope);
  return {
    recipientIds,
    errors: recipientIds.length === 0 ? ['empty_audience'] : [],
  };
}
