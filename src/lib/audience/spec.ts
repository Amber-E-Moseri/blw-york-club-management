// Canonical spec helpers. Pure functions, no I/O.
//
// The composer edits a list of TERMS (one chip each). Conversions here turn terms into the spec that
// create_audience_spec() accepts, and back again. Nothing in this file grants access.

import type { AudienceMode, AudienceSpecDraft } from '../../types/audience';

export type AudienceTermKind = 'everyone' | 'cell' | 'group' | 'person';
export type AudienceTermEffect = 'include' | 'exclude';

export interface AudienceTermChip {
  kind: AudienceTermKind;
  /** null for everyone */
  id: string | null;
  effect: AudienceTermEffect;
}

export const emptySpecDraft = (): AudienceSpecDraft => ({
  mode: 'composite',
  cellIds: [],
  groupIds: [],
  profileIds: [],
  excludedCellIds: [],
  excludedGroupIds: [],
  excludedProfileIds: [],
});

const unique = (ids: string[]): string[] => Array.from(new Set(ids)).sort();

/** The mode the server will store for these include kinds. 'all' only when everyone is chosen. */
export function deriveMode(draft: Pick<AudienceSpecDraft, 'mode' | 'cellIds' | 'groupIds' | 'profileIds'>): AudienceMode {
  if (draft.mode === 'all') return 'all';
  const kinds = [draft.cellIds.length > 0, draft.groupIds.length > 0, draft.profileIds.length > 0]
    .filter(Boolean).length;
  if (kinds === 0) return 'composite'; // invalid until something is included; validation reports no_include
  if (kinds > 1) return 'composite';
  if (draft.cellIds.length > 0) return 'cells';
  if (draft.groupIds.length > 0) return 'saved_groups';
  return 'explicit';
}

/** Terms as shown to the composer. Duplicates are collapsed. Order is stable. */
export function draftToTerms(draft: AudienceSpecDraft): AudienceTermChip[] {
  const terms: AudienceTermChip[] = [];
  if (draft.mode === 'all') terms.push({ kind: 'everyone', id: null, effect: 'include' });
  unique(draft.cellIds).forEach((id) => terms.push({ kind: 'cell', id, effect: 'include' }));
  unique(draft.groupIds).forEach((id) => terms.push({ kind: 'group', id, effect: 'include' }));
  unique(draft.profileIds).forEach((id) => terms.push({ kind: 'person', id, effect: 'include' }));
  unique(draft.excludedCellIds).forEach((id) => terms.push({ kind: 'cell', id, effect: 'exclude' }));
  unique(draft.excludedGroupIds).forEach((id) => terms.push({ kind: 'group', id, effect: 'exclude' }));
  unique(draft.excludedProfileIds).forEach((id) => terms.push({ kind: 'person', id, effect: 'exclude' }));
  return terms;
}

/**
 * Terms back to a spec draft. Kinds are taken exactly as chosen. A contradiction (everyone plus a named kind) is
 * NOT silently resolved here: mode 'all' keeps the kinds, so validation refuses it. The composer never produces that
 * state, because toggleInclude() removes 'everyone' when a real include is added.
 */
export function termsToDraft(terms: AudienceTermChip[]): AudienceSpecDraft {
  const includes = terms.filter((t) => t.effect === 'include');
  const excludes = terms.filter((t) => t.effect === 'exclude');
  const everyone = includes.some((t) => t.kind === 'everyone');
  const pick = (kind: AudienceTermKind) =>
    unique(includes.filter((t) => t.kind === kind && t.id !== null).map((t) => t.id as string));
  const draft: AudienceSpecDraft = {
    mode: 'composite',
    cellIds: pick('cell'),
    groupIds: pick('group'),
    profileIds: pick('person'),
    excludedCellIds: unique(excludes.filter((t) => t.kind === 'cell' && t.id).map((t) => t.id as string)),
    excludedGroupIds: unique(excludes.filter((t) => t.kind === 'group' && t.id).map((t) => t.id as string)),
    excludedProfileIds: unique(excludes.filter((t) => t.kind === 'person' && t.id).map((t) => t.id as string)),
  };
  draft.mode = everyone ? 'all' : deriveMode(draft);
  return draft;
}

/** Arguments for create_audience_spec(). Empty arrays become null, matching the database's nullif(). */
export function toCreateSpecArgs(draft: AudienceSpecDraft) {
  const nullIfEmpty = (xs: string[]) => (xs.length === 0 ? null : unique(xs));
  return {
    p_mode: draft.mode,
    p_cell_ids: nullIfEmpty(draft.cellIds),
    p_group_ids: nullIfEmpty(draft.groupIds),
    p_profile_ids: nullIfEmpty(draft.profileIds),
    p_excluded_cell_ids: nullIfEmpty(draft.excludedCellIds),
    p_excluded_group_ids: nullIfEmpty(draft.excludedGroupIds),
    p_excluded_profile_ids: nullIfEmpty(draft.excludedProfileIds),
  };
}

/**
 * Adds an include term, or removes the term if it is already present with either effect.
 * Choosing everyone clears the other includes (exclusions stay). Choosing a named include clears everyone.
 * This keeps the composer from ever producing "everyone plus a named kind".
 */
export function toggleInclude(terms: AudienceTermChip[], chip: AudienceTermChip): AudienceTermChip[] {
  const exists = terms.some((t) => t.kind === chip.kind && t.id === chip.id);
  if (exists) return terms.filter((t) => !(t.kind === chip.kind && t.id === chip.id));
  const kept =
    chip.kind === 'everyone'
      ? terms.filter((t) => t.effect === 'exclude')
      : terms.filter((t) => !(t.effect === 'include' && t.kind === 'everyone'));
  return [...kept, { ...chip, effect: 'include' }];
}

export function flipEffect(terms: AudienceTermChip[], chip: AudienceTermChip): AudienceTermChip[] {
  return terms.map((t) =>
    t.kind === chip.kind && t.id === chip.id
      ? { ...t, effect: t.effect === 'include' ? 'exclude' : 'include' }
      : t,
  );
}

export function removeTerm(terms: AudienceTermChip[], chip: AudienceTermChip): AudienceTermChip[] {
  return terms.filter((t) => !(t.kind === chip.kind && t.id === chip.id));
}
