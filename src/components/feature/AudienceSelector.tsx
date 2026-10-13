import React, { useEffect, useMemo, useState } from 'react';
import { Globe, Layers, Search, Users, X } from 'lucide-react';
import type {
  AudienceCandidate,
  AudienceCell,
  AudienceSavedGroup,
  AudienceScope,
  AudienceSpecDraft,
  AudienceValidationError,
} from '../../types/audience';
import { resolveAudience } from '../../lib/audience/resolveAudience';
import {
  AudienceTermChip,
  draftToTerms,
  flipEffect,
  removeTerm,
  termsToDraft,
  toggleInclude,
} from '../../lib/audience/spec';

export interface AudienceSelectorProps {
  value: AudienceSpecDraft;
  onChange: (next: AudienceSpecDraft) => void;
  candidates: AudienceCandidate[];
  cells: AudienceCell[];
  savedGroups: AudienceSavedGroup[];
  scope: AudienceScope;
  disabled?: boolean;
  label?: string;
  onValidityChange?: (errors: AudienceValidationError[]) => void;
}

const PREVIEW_LIMIT = 10;
const SEARCH_LIMIT = 8;

const ERROR_TEXT: Record<AudienceValidationError, string> = {
  no_include: 'Choose at least one group, cell or person to include.',
  mode_mismatch: 'This selection mixes options that cannot be saved together. Remove one and try again.',
  everyone_not_permitted: 'Only coordinators and admins can address everyone.',
  exclusions_not_permitted: 'Only coordinators and admins can exclude people.',
  out_of_scope_cell: 'That cell is outside your permissions.',
  out_of_scope_member: 'That person is outside your permissions.',
  unknown_group: 'That saved group is no longer available.',
  empty_audience: 'No active members match this audience.',
};

const chipKey = (t: AudienceTermChip) => `${t.effect}:${t.kind}:${t.id ?? ''}`;

export const AudienceSelector: React.FC<AudienceSelectorProps> = ({
  value,
  onChange,
  candidates,
  cells,
  savedGroups,
  scope,
  disabled = false,
  label = 'Audience',
  onValidityChange,
}) => {
  const [query, setQuery] = useState('');

  const terms = useMemo(() => draftToTerms(value), [value]);

  const visibleCells = useMemo(
    () => cells.filter((c) => scope.canUseEveryone || scope.ledCellIds.includes(c.id)),
    [cells, scope],
  );
  const visibleGroups = useMemo(() => savedGroups.filter((g) => g.isActive), [savedGroups]);

  // Only active people in scope are offered. The server still checks every id.
  const eligible = useMemo(
    () =>
      candidates.filter(
        (c) => c.status === 'active' && (scope.canUseEveryone || (c.cellId !== null && scope.ledCellIds.includes(c.cellId))),
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

  const result = useMemo(() => resolveAudience(value, { candidates, groups: savedGroups, cells }, scope), [
    value,
    candidates,
    savedGroups,
    cells,
    scope,
  ]);

  const errorKey = result.errors.join('|');
  useEffect(() => {
    onValidityChange?.(result.errors);
    // Report only when the error set changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errorKey]);

  const nameById = useMemo(() => new Map(candidates.map((c) => [c.id, c.fullName])), [candidates]);
  const cellNameById = useMemo(() => new Map(cells.map((c) => [c.id, c.name])), [cells]);
  const groupNameById = useMemo(() => new Map(savedGroups.map((g) => [g.id, g.name])), [savedGroups]);

  const commit = (nextTerms: AudienceTermChip[]) => onChange(termsToDraft(nextTerms));

  const toggle = (kind: AudienceTermChip['kind'], id: string | null) => {
    if (disabled) return;
    commit(toggleInclude(terms, { kind, id, effect: 'include' }));
  };

  const termLabel = (t: AudienceTermChip): string => {
    if (t.kind === 'everyone') return 'Everyone';
    if (t.kind === 'cell') return cellNameById.get(t.id ?? '') ?? 'Cell';
    if (t.kind === 'group') return groupNameById.get(t.id ?? '') ?? 'Saved group';
    return nameById.get(t.id ?? '') ?? 'Person';
  };

  const isSelected = (kind: AudienceTermChip['kind'], id: string | null) =>
    terms.some((t) => t.kind === kind && t.id === id);

  const previewNames = result.recipientIds.slice(0, PREVIEW_LIMIT).map((id) => nameById.get(id) ?? 'Member');
  const moreCount = Math.max(0, result.recipientIds.length - PREVIEW_LIMIT);
  const hasHardErrors = result.errors.some((e) => e !== 'empty_audience');

  const checkbox =
    'h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50 dark:border-gray-600';
  const row = 'flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-800';

  return (
    <fieldset disabled={disabled} className="space-y-4">
      <legend className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">{label}</legend>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-3">
          {scope.canUseEveryone && (
            <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
              <input
                type="checkbox"
                className={checkbox}
                checked={isSelected('everyone', null)}
                onChange={() => toggle('everyone', null)}
              />
              <Globe className="h-4 w-4 text-gray-500" aria-hidden="true" />
              Everyone (all active members)
            </label>
          )}

          <div>
            <p className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
              <Layers className="h-3.5 w-3.5" aria-hidden="true" /> Cells
            </p>
            {visibleCells.length === 0 ? (
              <p className="text-xs text-gray-500">No cells available to you.</p>
            ) : (
              <ul className="max-h-48 overflow-y-auto">
                {visibleCells.map((cell) => (
                  <li key={cell.id}>
                    <label className={row}>
                      <span>{cell.name}</span>
                      <input
                        type="checkbox"
                        className={checkbox}
                        checked={isSelected('cell', cell.id)}
                        onChange={() => toggle('cell', cell.id)}
                      />
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <p className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
              <Users className="h-3.5 w-3.5" aria-hidden="true" /> Saved groups
            </p>
            {visibleGroups.length === 0 ? (
              <p className="text-xs text-gray-500">No saved groups yet.</p>
            ) : (
              <ul className="max-h-48 overflow-y-auto">
                {visibleGroups.map((group) => (
                  <li key={group.id}>
                    <label className={row}>
                      <span>{group.name}</span>
                      <input
                        type="checkbox"
                        className={checkbox}
                        checked={isSelected('group', group.id)}
                        onChange={() => toggle('group', group.id)}
                      />
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="audience-member-search" className="text-xs font-semibold uppercase tracking-wide text-gray-500">
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
              className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
            />
          </div>
          {query.trim().length > 0 && (
            <ul className="max-h-48 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700">
              {searchResults.length === 0 && <li className="px-3 py-2 text-xs text-gray-500">No active members match.</li>}
              {searchResults.map((c) => {
                const selected = isSelected('person', c.id);
                return (
                  <li key={c.id}>
                    <button type="button" onClick={() => toggle('person', c.id)} aria-pressed={selected} className={row}>
                      <span className="truncate">{c.fullName}</span>
                      <span className="text-xs text-gray-500">{selected ? 'Added' : 'Add'}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Selected</p>
          {terms.length > 0 && (
            <button
              type="button"
              onClick={() => commit([])}
              className="text-xs font-medium text-blue-600 hover:underline disabled:opacity-50 dark:text-blue-400"
            >
              Clear selection
            </button>
          )}
        </div>
        {terms.length === 0 ? (
          <p className="text-xs text-gray-500">Nothing selected yet.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {terms.map((t) => {
              const excluded = t.effect === 'exclude';
              return (
                <li
                  key={chipKey(t)}
                  className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium ${
                    excluded
                      ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300'
                      : 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => !disabled && commit(flipEffect(terms, t))}
                    title={excluded ? 'Excluded. Click to include.' : 'Included. Click to exclude.'}
                    aria-label={`${termLabel(t)}: ${excluded ? 'excluded' : 'included'}. Toggle.`}
                  >
                    {excluded ? 'Not ' : ''}
                    {termLabel(t)}
                  </button>
                  <button
                    type="button"
                    onClick={() => !disabled && commit(removeTerm(terms, t))}
                    aria-label={`Remove ${termLabel(t)}`}
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

      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm dark:border-gray-700 dark:bg-gray-800/60" aria-live="polite">
        <p className="font-semibold text-gray-900 dark:text-gray-100">
          {hasHardErrors ? '—' : result.recipientIds.length} recipient{result.recipientIds.length === 1 ? '' : 's'}
        </p>
        {!hasHardErrors && previewNames.length > 0 && (
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
            {previewNames.join(', ')}
            {moreCount > 0 ? ` and ${moreCount} more` : ''}
          </p>
        )}
        <p className="mt-1 text-xs text-gray-500">Recipients are fixed when this is sent. Later changes to groups or cells do not change them.</p>
        {result.errors.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs text-red-600 dark:text-red-400" role="alert">
            {result.errors.map((e) => (
              <li key={e}>{ERROR_TEXT[e]}</li>
            ))}
          </ul>
        )}
      </div>
    </fieldset>
  );
};

export default AudienceSelector;
