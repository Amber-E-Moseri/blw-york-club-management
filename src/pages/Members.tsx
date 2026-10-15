import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getInitials } from '../lib/utils';
import { PersonStatusBadge } from '../components/people/PersonStatusBadge';
import { PeopleFilters } from '../components/people/PeopleFilters';
import { PersonCard } from '../components/people/PersonCard';
import { PersonDetailPanel } from '../components/people/PersonDetailPanel';
import { Skeleton } from '../components/dashboard/DashboardCard';
import { fetchMembersFiltered } from '../lib/queries/members';
import { fetchCells } from '../lib/queries/contacts';
import type { AuthUser } from '../lib/auth';
import type { Cell, Member } from '../types';

const ROLE_LEVEL: Record<AuthUser['role'], number> = {
  member: 0, cell_leader: 1, admin: 2, coordinator: 3,
};

interface Props { user: AuthUser | null; }

type MemberWithCell = Member & { cellName?: string };

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export const Members: React.FC<Props> = ({ user }) => {
  const level = ROLE_LEVEL[user?.role ?? 'member'] ?? 0;
  const isAdmin = level >= 2;

  const [members, setMembers] = useState<Member[]>([]);
  const [cells, setCells] = useState<Cell[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters (live state — debounced before fetching)
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [cellFilter, setCellFilter] = useState('');
  const debouncedSearch = useDebouncedValue(search, 280);

  // Detail panel
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Cell id → name map
  const cellMap = useMemo(() => {
    const m = new Map<string, string>();
    cells.forEach((c) => m.set(c.id, c.name));
    return m;
  }, [cells]);

  const enriched: MemberWithCell[] = useMemo(
    () => members.map((m) => ({ ...m, cellName: m.cell_id ? cellMap.get(m.cell_id) : undefined })),
    [members, cellMap],
  );

  const fetchMembers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMembersFiltered({
        search: debouncedSearch || undefined,
        role: roleFilter || undefined,
        cellId: cellFilter || undefined,
      });
      setMembers(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load people.');
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, roleFilter, cellFilter]);

  useEffect(() => { fetchMembers(); }, [fetchMembers]);

  // Load cells once
  const cellsLoaded = useRef(false);
  useEffect(() => {
    if (cellsLoaded.current) return;
    cellsLoaded.current = true;
    fetchCells().then(setCells).catch(console.error);
  }, []);

  // Access gate: cell_leader+
  if (level < 1) {
    return (
      <div className="flex-1 p-8 flex items-center justify-center">
        <p className="text-sm text-york-600 font-medium">Leaders only — access denied.</p>
      </div>
    );
  }

  const totalMembers = members.length;
  const leaderCount = members.filter((m) => m.role !== 'member').length;
  const canSeeContact = isAdmin;

  return (
    <div className="space-y-5 pb-4">
      {/* Header */}
      <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl shadow-sm overflow-hidden">
        <div className="border-t-4 border-york-600 px-5 py-5">
          <p className="text-xs font-semibold text-york-600 uppercase tracking-wider">Community</p>
          <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100 mt-1">People</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
            Your ministry directory — members, leaders, and cells.
          </p>
        </div>
      </div>

      {/* Stats strip */}
      {!loading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <StatChip label="Total members" value={totalMembers} />
          <StatChip label="Leaders" value={leaderCount} />
          <StatChip label="Cells" value={cells.length} className="hidden sm:block" />
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-york-200 bg-york-50 dark:bg-york-900/20 p-4 text-sm text-york-700 dark:text-york-300">
          {error}
        </div>
      )}

      {/* Filters */}
      <PeopleFilters
        search={search} onSearch={setSearch}
        role={roleFilter} onRole={setRoleFilter}
        cellId={cellFilter} onCellId={setCellFilter}
        cells={cells}
      />

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-2xl" />)}
        </div>
      ) : enriched.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl p-10 text-center">
          <p className="text-sm font-semibold text-gray-600 dark:text-slate-300">No people match your filters</p>
          <button
            type="button"
            onClick={() => { setSearch(''); setRoleFilter(''); setCellFilter(''); }}
            className="mt-3 text-xs font-semibold text-york-600 hover:underline"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="sm:hidden space-y-2">
            {enriched.map((m) => (
              <PersonCard
                key={m.id}
                member={m}
                onSelect={() => setSelectedId(m.id)}
                canSeeContact={canSeeContact}
              />
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden sm:block bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px]">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-slate-700">
                    {['Member', 'Role', 'Cell', 'Joined'].concat(canSeeContact ? ['Contact'] : []).map((h) => (
                      <th
                        key={h}
                        className="px-5 py-3 text-left text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
                  {enriched.map((m) => (
                    <tr
                      key={m.id}
                      onClick={() => setSelectedId(m.id)}
                      className="hover:bg-gray-50 dark:hover:bg-slate-700/30 cursor-pointer transition-colors"
                    >
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-york-600 text-white flex items-center justify-center text-xs font-bold shrink-0 overflow-hidden">
                            {m.avatar_url ? (
                              <img src={m.avatar_url} alt={m.full_name} className="w-full h-full object-cover" />
                            ) : (
                              getInitials(m.full_name)
                            )}
                          </div>
                          <span className="text-sm font-semibold text-gray-900 dark:text-slate-100">{m.full_name}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <PersonStatusBadge role={m.role} size="xs" />
                      </td>
                      <td className="px-5 py-3.5 text-sm text-gray-500 dark:text-slate-400">
                        {m.cellName ?? <span className="text-gray-300 dark:text-slate-600">—</span>}
                      </td>
                      <td className="px-5 py-3.5 text-sm text-gray-400 dark:text-slate-500 whitespace-nowrap">
                        {m.joined_at ? new Date(m.joined_at).toLocaleDateString('en-CA', { year: 'numeric', month: 'short' }) : '—'}
                      </td>
                      {canSeeContact && (
                        <td className="px-5 py-3.5">
                          <p className="text-sm text-gray-500 dark:text-slate-400 truncate max-w-[180px]">{m.email}</p>
                          {m.phone && (
                            <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">{m.phone}</p>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="px-5 py-3 border-t border-gray-100 dark:border-slate-700">
              <p className="text-xs text-gray-400 dark:text-slate-500">
                {totalMembers} {totalMembers === 1 ? 'person' : 'people'} shown
                {(search || roleFilter || cellFilter) ? ' · filtered view' : ''}
              </p>
            </div>
          </div>
        </>
      )}

      {/* Person detail panel */}
      {selectedId && user && (
        <PersonDetailPanel
          memberId={selectedId}
          onClose={() => setSelectedId(null)}
          currentUser={user}
          onSaved={fetchMembers}
        />
      )}
    </div>
  );
};

const StatChip: React.FC<{ label: string; value: number; className?: string }> = ({ label, value, className }) => (
  <div className={`bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl shadow-sm px-4 py-3 ${className ?? ''}`}>
    <p className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider">{label}</p>
    <p className="text-2xl font-bold text-gray-900 dark:text-slate-100 mt-0.5">{value}</p>
  </div>
);
