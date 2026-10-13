// Client-side audience preview. Mirrors audience_resolve() in the database so the UI can show a live count and
// validation before submit.
//
// This is NOT a security boundary. The database re-runs resolution and its result is authoritative. Nothing here
// may be used to grant access, and the server never accepts recipient ids from the client.

import type {
  AudienceCandidate,
  AudienceData,
  AudienceDraft,
  AudienceResolution,
  AudienceScope,
  AudienceTerm,
  AudienceValidationError,
} from '../../types/audience';

/** Row shape written to audience_selection_terms. */
export interface AudienceTermRow {
  term_type: AudienceTerm['type'];
  ref_id: string | null;
  effect: AudienceTerm['effect'];
}

function termKey(term: AudienceTerm): string {
  return `${term.effect}:${term.type}:${term.refId ?? ''}`;
}

/** True when the term has the shape the database constraint requires (everyone has no ref, others have one). */
export function isWellFormedTerm(term: AudienceTerm): boolean {
  if (term.type === 'everyone') return term.refId === null;
  return typeof term.refId === 'string' && term.refId.length > 0;
}

/** Removes exact duplicate terms and returns a stable order. The database unique index enforces the same rule. */
export function normalizeTerms(terms: AudienceTerm[]): AudienceTerm[] {
  const seen = new Map<string, AudienceTerm>();
  for (const term of terms) {
    if (!isWellFormedTerm(term)) continue;
    const key = termKey(term);
    if (!seen.has(key)) seen.set(key, { type: term.type, refId: term.refId, effect: term.effect });
  }
  return Array.from(seen.values()).sort((a, b) => termKey(a).localeCompare(termKey(b)));
}

/** Rows for an INSERT into audience_selection_terms, with duplicates removed. */
export function toSelectionTermRows(draft: AudienceDraft): AudienceTermRow[] {
  return normalizeTerms(draft.terms).map((t) => ({
    term_type: t.type,
    ref_id: t.refId,
    effect: t.effect,
  }));
}

function isActive(candidate: AudienceCandidate): boolean {
  return candidate.status === 'active';
}

/** Mirrors audience_profile_in_scope(): admins see everyone, leaders see profiles in cells they lead. */
function inScope(candidate: AudienceCandidate, scope: AudienceScope): boolean {
  if (scope.canUseEveryone) return true;
  return candidate.cellId !== null && scope.ledCellIds.includes(candidate.cellId);
}

function cellInScope(cellId: string, scope: AudienceScope): boolean {
  return scope.canUseEveryone || scope.ledCellIds.includes(cellId);
}

/**
 * Validation only. Hard errors make the whole selection unusable; the server rejects it the same way.
 * Errors are returned in a stable order so tests and UI do not flicker.
 */
export function validateAudienceDraft(
  draft: AudienceDraft,
  data: AudienceData,
  scope: AudienceScope,
): AudienceValidationError[] {
  const errors = new Set<AudienceValidationError>();
  const terms = normalizeTerms(draft.terms);
  const byId = new Map(data.candidates.map((c) => [c.id, c]));
  const groupById = new Map(data.groups.map((g) => [g.id, g]));

  // Check the raw draft: normalisation drops malformed terms, so checking `terms` would never report them.
  if (draft.terms.some((t) => !isWellFormedTerm(t))) errors.add('malformed_term');

  if (!terms.some((t) => t.effect === 'include')) errors.add('no_include_terms');

  for (const term of terms) {
    if (term.type === 'everyone' && !scope.canUseEveryone) {
      errors.add('everyone_not_permitted');
    }
    if (term.type === 'cell' && term.refId !== null && !cellInScope(term.refId, scope)) {
      errors.add('out_of_scope_cell');
    }
    if (term.type === 'member' && term.refId !== null) {
      const candidate = byId.get(term.refId);
      // Unknown ids are treated the same as out-of-scope ids, matching the database (no enumeration).
      if (!candidate || !inScope(candidate, scope)) errors.add('out_of_scope_member');
    }
    if (term.type === 'saved_group' && term.refId !== null) {
      const group = groupById.get(term.refId);
      if (!group || group.archivedAt !== null) errors.add('unknown_group');
    }
  }

  const hardErrors = errors.size > 0;
  if (!hardErrors && resolveRecipientIds(terms, data, scope).length === 0) {
    errors.add('empty_audience');
  }

  return ORDER.filter((e) => errors.has(e));
}

const ORDER: AudienceValidationError[] = [
  'malformed_term',
  'no_include_terms',
  'everyone_not_permitted',
  'out_of_scope_cell',
  'out_of_scope_member',
  'unknown_group',
  'empty_audience',
];

/** Set-based resolution: includes minus excludes, active only, in scope, deduplicated, sorted. */
function resolveRecipientIds(terms: AudienceTerm[], data: AudienceData, scope: AudienceScope): string[] {
  const active = data.candidates.filter(isActive);
  const groupById = new Map(data.groups.map((g) => [g.id, g]));

  const membersOf = (term: AudienceTerm): Set<string> => {
    const out = new Set<string>();
    switch (term.type) {
      case 'everyone':
        active.forEach((c) => out.add(c.id));
        break;
      case 'cell':
        active.filter((c) => c.cellId === term.refId).forEach((c) => out.add(c.id));
        break;
      case 'member':
        active.filter((c) => c.id === term.refId).forEach((c) => out.add(c.id));
        break;
      case 'saved_group': {
        const group = term.refId ? groupById.get(term.refId) : undefined;
        if (!group || group.archivedAt !== null) break;
        const memberSet = new Set(group.memberIds);
        active.filter((c) => memberSet.has(c.id)).forEach((c) => out.add(c.id));
        break;
      }
    }
    return out;
  };

  const included = new Set<string>();
  const excluded = new Set<string>();
  for (const term of terms) {
    const target = term.effect === 'include' ? included : excluded;
    membersOf(term).forEach((id) => target.add(id));
  }

  const byId = new Map(active.map((c) => [c.id, c]));
  const result: string[] = [];
  included.forEach((id) => {
    if (excluded.has(id)) return;
    const candidate = byId.get(id);
    if (!candidate || !inScope(candidate, scope)) return;
    result.push(id);
  });
  return result.sort();
}

/**
 * Preview entry point. Returns recipients only when there are no hard errors. An empty recipient list with
 * `empty_audience` is a validation result, not a crash.
 */
export function resolveAudience(
  draft: AudienceDraft,
  data: AudienceData,
  scope: AudienceScope,
): AudienceResolution {
  const errors = validateAudienceDraft(draft, data, scope);
  const hardErrors = errors.some((e) => e !== 'empty_audience');
  if (hardErrors) return { recipientIds: [], errors };
  const terms = normalizeTerms(draft.terms);
  return { recipientIds: resolveRecipientIds(terms, data, scope), errors };
}
