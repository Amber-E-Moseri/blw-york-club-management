import React, { useEffect, useMemo, useState } from 'react';
import { Globe, Layers, Search, Users, X } from 'lucide-react';
import type {
  AudienceCandidate,
  AudienceDraft,
  AudienceEffect,
  AudienceCell,
  AudienceSavedGroup,
  AudienceScope,
  AudienceTerm,
  AudienceValidationError,
} from '../../types/audience';
import { resolveAudience } from '../../lib/audience/resolveAudience';

export interface AudienceSelectorProps {
  value: AudienceDraft;
  onChange: (next: AudienceDraft) => void;
  candidates: AudienceCandidate[];
  cells: AudienceCell[];
  savedGroups: AudienceSavedGroup[];
  scope: AudienceScope;
  disabled?: boolean;
  label?: string;
  showModeToggle?: boolean;
  onValidityChange?: (errors: AudienceValidationError[]) => void;
}

const PREVIEW_LIMIT = 10;
const SEARCH_LIMIT = 8;

const ERROR_TEXT: Record<AudienceValidationError, string> = {
  malformed_term: 'One of the selected recipients is not valid. Remove it and try again.',
  no_include_terms: 'Choose at least one group, cell or person to include.',
  everyone_not_permitted: 'Only coordinators and admins can address everyone.',
  out_of_scope_cell: 'That cell is outside your permissions.',
  out_of_scope_member: 'That person is outside your permissions.',
  unknown_group: 'That saved group no longer exists.',
  empty_audience: 'No active members match this audience.',
};

function termKey(term: AudienceTerm): string {
  return `${term.effect}:${term.type}:${term.refId ?? ''}`;
}

function hasTerm(terms: AudienceTerm[], type: AudienceTerm['type'], refId: string | null): AudienceTerm | undefined {
  return terms.find((t) => t.type === type && t.refId === refId);
}

export const AudienceSelector: React.FC<AudienceSelectorProps> = ({
  value,
  onChange,
  candidates,
  cells,
  savedGroups,
  scope,
  disabled = false,
  label = 'Audience',
  showModeToggle = true,
  onValidityChange,
}) => {
  const [query, setQuery] = useState('');

  const visibleCells = useMemo(
    () => cells.filter((c) => scope.canUseEveryone || scope.ledCellIds.includes(c.id)),
    [cells, scope],
  );

  const visibleGroups = useMemo(() => savedGroups.filter((g) => g.archivedAt === null), [savedGroups]);

  const eligible = useMemo(
    () =>
      candidates.filter(
        (c) =>
          c.status === 'active' &&
          (scope.canUseEveryone || (c.cellId !== null && scope.ledCellIds.includes(c.cellId))),
      ),
    [candidates, scope],
  );

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return [];
    return eligible
      .filter((c) => c.fullName.toLowerCase().includes(q) || (c.email ?? '').toLowerCase().includes(q))
      .slice(0, SEARCH_LIMIT);
  }, [eligible, query]);

  const result = useMemo(
    () => resolveAudience(value, { candidates, groups: savedGroups, cells }, scope),
    [value, candidates, savedGroups, cells, scope],
  );

  const errorKey = result.errors.join('|');
  useEffect(() => {
    onValidityChange?.(result.errors);
    // Re-report only when the error set changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errorKey]);

  const nameById = useMemo(() => new Map(candidates.map((c) => [c.id, c.fullName])), [candidates]);
  const cellNameById = useMemo(() => new Map(cells.map((c) => [c.id, c.name])), [cells]);
  const groupNameById = useMemo(() => new Map(savedGroups.map((g) => [g.id, g.name])), [savedGroups]);

  const setTerms = (terms: AudienceTerm[]) => onChange({ ...value, terms });

  /** Adds an include term, or removes the term if it is already selected (any effect). */
  const toggleTerm = (type: AudienceTerm['type'], refId: string | null) => {
    if (disabled) return;
    const existing = hasTerm(value.terms, type, refId);
    if (existing) {
      setTerms(value.terms.filter((t) => termKey(t) !== termKey(existing)));
    } else {
      setTerms([...value.terms, { type, refId, effect: 'include' }]);
    }
  };

  /** Flips one selected term between include and exclude. */
  const flipEffect = (term: AudienceTerm) => {
    if (disabled) return;
    const next: AudienceEffect = term.effect === 'include' ? 'exclude' : 'include';
    setTerms(value.terms.map((t) => (termKey(t) === termKey(term) ? { ...t, effect: next } : t)));
  };

  const removeTerm = (term: AudienceTerm) => {
    if (disabled) return;
    setTerms(value.terms.filter((t) => termKey(t) !== termKey(term)));
  };

  const termLabel = (term: AudienceTerm): string => {
    if (term.type === 'everyone') return 'Everyone';
    if (term.type === 'cell') return cellNameById.get(term.refId ?? '') ?? 'Cell';
    if (term.type === 'saved_group') return groupNameById.get(term.refId ?? '') ?? 'Saved group';
    return nameById.get(term.refId ?? '') ?? 'Person';
  };

  const previewNames = result.recipientIds.slice(0, PREVIEW_LIMIT).map((id) => nameById.get(id) ?? 'Member');
  const moreCount = Math.max(0, result.recipientIds.length - PREVIEW_LIMIT);
  const hasHardErrors = result.errors.some((e) => e !== 'empty_audience');

  const checkboxClass =
    'h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 disabled:opacity-50';
  const chipBase =
    'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors';
  const listButton =
    'flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50';

  return (
    <fieldset disabled={disabled} className="space-y-4">
      <legend className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">{label}</legend>

      {/* Quick sources */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-3">
          {scope.canUseEveryone && (
            <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
              <input
                type="checkbox"
                className={checkboxClass}
                checked={Boolean(hasTerm(value.terms, 'everyone', null))}
                onChange={() => toggleTerm('everyone', null)}
              />
              <Globe className="h-4 w-4 text-gray-500" aria-hidden="true" />
              Everyone (all active members)
            </label>
          )}

          <div>
            <p className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              <Layers className="h-3.5 w-3.5" aria-hidden="true" /> Cells
            </p>
            {visibleCells.length === 0 ? (
              <p className="text-xs text-gray-500 dark:text-gray-400">No cells available to you.</p>
            ) : (
              <ul className="max-h-48 overflow-y-auto">
                {visibleCells.map((cell) => (
                  <li key={cell.id}>
                    <label className={listButton}>
                      <span>{cell.name}</span>
                      <input
                        type="checkbox"
                        className={checkboxClass}
                        checked={Boolean(hasTerm(value.terms, 'cell', cell.id))}
                        onChange={() => toggleTerm('cell', cell.id)}
                      />
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <p className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              <Users className="h-3.5 w-3.5" aria-hidden="true" /> Saved groups
            </p>
            {visibleGroups.length === 0 ? (
              <p className="text-xs text-gray-500 dark:text-gray-400">No saved groups yet.</p>
            ) : (
              <ul className="max-h-48 overflow-y-auto">
                {visibleGroups.map((group) => (
                  <li key={group.id}>
                    <label className={listButton}>
                      <span>{group.name}</span>
                      <input
                        type="checkbox"
                        className={checkboxClass}
                        checked={Boolean(hasTerm(value.terms, 'saved_group', group.id))}
                        onChange={() => toggleTerm('saved_group', group.id)}
                      />
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Member search */}
        <div className="space-y-2">
          <label htmlFor="audience-member-search" className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Specific members
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" aria-hidden="true" />
            <input
              id="audience-member-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or email"
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 py-2 pl-9 pr-3 text-sm text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          {query.trim().length > 0 && (
            <ul className="max-h-48 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700">
              {searchResults.length === 0 && (
                <li className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">No active members match.</li>
              )}
              {searchResults.map((c) => {
                const selected = Boolean(hasTerm(value.terms, 'member', c.id));
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => toggleTerm('member', c.id)}
                      aria-pressed={selected}
                      className={listButton}
                    >
                      <span className="truncate">{c.fullName}</span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">{selected ? 'Added' : 'Add'}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Selected terms: include / exclude and removal */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Selected</p>
          {value.terms.length > 0 && (
            <button
              type="button"
              onClick={() => setTerms([])}
              className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
            >
              Clear selection
            </button>
          )}
        </div>
        {value.terms.length === 0 ? (
          <p className="text-xs text-gray-500 dark:text-gray-400">Nothing selected yet.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {value.terms.map((term) => {
              const excluded = term.effect === 'exclude';
              return (
                <li
                  key={termKey(term)}
                  className={`${chipBase} ${
                    excluded
                      ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300'
                      : 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => flipEffect(term)}
                    className="font-semibold uppercase tracking-wide"
                    title={excluded ? 'Excluded. Click to include.' : 'Included. Click to exclude.'}
                    aria-label={`${termLabel(term)}: ${excluded ? 'excluded' : 'included'}. Toggle.`}
                  >
                    {excluded ? 'Not' : ''} {termLabel(term)}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeTerm(term)}
                    aria-label={`Remove ${termLabel(term)}`}
                    className="rounded-full p-0.5 hover:bg-black/5 dark:hover:bg-white/10"
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Live preview (client-side; the server result is authoritative) */}
      <div
        className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 p-3 text-sm"
        aria-live="polite"
      >
        <p className="font-semibold text-gray-900 dark:text-gray-100">
          {hasHardErrors ? '—' : result.recipientIds.length} recipient{result.recipientIds.length === 1 ? '' : 's'}
        </p>
        {!hasHardErrors && previewNames.length > 0 && (
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
            {previewNames.join(', ')}
            {moreCount > 0 ? ` and ${moreCount} more` : ''}
          </p>
        )}
        {result.errors.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs text-red-600 dark:text-red-400" role="alert">
            {result.errors.map((e) => (
              <li key={e}>{ERROR_TEXT[e]}</li>
            ))}
          </ul>
        )}
      </div>

      {showModeToggle && (
        <fieldset className="space-y-1">
          <legend className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Recipients when sent</legend>
          <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
            <input
              type="radio"
              name="audience-resolution-mode"
              className={checkboxClass}
              checked={value.resolutionMode === 'dynamic'}
              onChange={() => onChange({ ...value, resolutionMode: 'dynamic' })}
            />
            Live: follows current membership
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
            <input
              type="radio"
              name="audience-resolution-mode"
              className={checkboxClass}
              checked={value.resolutionMode === 'snapshot'}
              onChange={() => onChange({ ...value, resolutionMode: 'snapshot' })}
            />
            Frozen at send: recipients never change after sending
          </label>
        </fieldset>
      )}
    </fieldset>
  );
};

export default AudienceSelector;
