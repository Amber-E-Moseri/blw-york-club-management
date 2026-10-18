import React from 'react';
import { Search, X } from 'lucide-react';
import type { Cell } from '../../types';

const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All roles' },
  { value: 'coordinator', label: 'Coordinator' },
  { value: 'admin', label: 'Admin' },
  { value: 'cell_leader', label: 'Cell Leader' },
  { value: 'member', label: 'Member' },
];

interface PeopleFiltersProps {
  search: string;
  onSearch: (s: string) => void;
  role: string;
  onRole: (r: string) => void;
  cellId: string;
  onCellId: (id: string) => void;
  cells: Cell[];
}

const CONTROL_CLASS =
  'h-11 w-full px-3 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-york-500';

export const PeopleFilters: React.FC<PeopleFiltersProps> = ({
  search, onSearch, role, onRole, cellId, onCellId, cells,
}) => {
  const hasFilters = search || role || cellId;

  return (
    <div className="space-y-2.5">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        <input
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search by name or email"
          className={`${CONTROL_CLASS} pl-10 placeholder:text-gray-400 dark:placeholder:text-slate-500`}
        />
      </div>

      {/* Role + cell filters */}
      <div className="grid grid-cols-2 gap-2.5">
        <select
          value={role}
          onChange={(e) => onRole(e.target.value)}
          aria-label="Filter by role"
          className={CONTROL_CLASS}
        >
          {ROLE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        {cells.length > 0 && (
          <select
            value={cellId}
            onChange={(e) => onCellId(e.target.value)}
            aria-label="Filter by cell"
            className={CONTROL_CLASS}
          >
            <option value="">All cells</option>
            {cells.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* Clear */}
      {hasFilters && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => { onSearch(''); onRole(''); onCellId(''); }}
            className="flex items-center gap-1 text-xs font-semibold text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 transition-colors"
          >
            <X className="w-3.5 h-3.5" /> Clear filters
          </button>
        </div>
      )}
    </div>
  );
};
