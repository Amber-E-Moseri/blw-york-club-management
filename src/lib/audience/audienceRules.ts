// Audience for targeted affirmations. Pure rules: the database (migration 059, create_affirmation and
// can_see_confession) is the authority. Targeting is staff-only; recipients are never shown to other members.

export type AudienceKind = 'all' | 'cell' | 'group' | 'individuals';

export const AUDIENCE_KINDS: readonly AudienceKind[] = ['all', 'cell', 'group', 'individuals'];

export interface AudienceDraft {
  kind: AudienceKind;
  cellId: string | null;
  groupId: string | null;
  userIds: string[];
}

/** Returns the first problem with the audience, or null when it can be saved. */
export function validateAudience(draft: AudienceDraft): string | null {
  switch (draft.kind) {
    case 'all':
      return null;
    case 'cell':
      return draft.cellId ? null : 'Choose a cell.';
    case 'group':
      return draft.groupId ? null : 'Choose a saved group.';
    case 'individuals': {
      const ids = uniqueIds(draft.userIds);
      return ids.length > 0 ? null : 'Choose at least one person.';
    }
    default:
      return 'Choose who should receive this affirmation.';
  }
}

/** Builds the audience fields the create_affirmation RPC expects. Fields irrelevant to the kind are null. */
export function toAudiencePayload(draft: AudienceDraft): {
  p_audience: AudienceKind;
  p_cell_id: string | null;
  p_group_id: string | null;
  p_user_ids: string[] | null;
} {
  return {
    p_audience: draft.kind,
    p_cell_id: draft.kind === 'cell' ? draft.cellId : null,
    p_group_id: draft.kind === 'group' ? draft.groupId : null,
    p_user_ids: draft.kind === 'individuals' ? uniqueIds(draft.userIds) : null,
  };
}

export function canTargetAffirmations(role: string): boolean {
  return role === 'admin' || role === 'coordinator';
}

/** Short staff-facing label, for example "Cell: Riverside" or "Everyone". Never lists who declared. */
export function describeAudience(
  audience: { audience: AudienceKind; audience_cell_id?: string | null; audience_group_id?: string | null },
  names: { cells?: Record<string, string>; groups?: Record<string, string> } = {},
): string {
  switch (audience.audience) {
    case 'cell':
      return `Cell: ${names.cells?.[audience.audience_cell_id ?? ''] ?? 'Unknown cell'}`;
    case 'group':
      return `Group: ${names.groups?.[audience.audience_group_id ?? ''] ?? 'Unknown group'}`;
    case 'individuals':
      return 'Selected people';
    default:
      return 'Everyone';
  }
}

/** Removes blank and duplicate ids, keeping the first occurrence. */
export function uniqueIds(ids: readonly string[]): string[] {
  return Array.from(new Set(ids.map((id) => id.trim()).filter((id) => id !== '')));
}
