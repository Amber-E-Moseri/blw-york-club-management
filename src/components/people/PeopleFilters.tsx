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

export const PeopleFilters: React.FC<PeopleFiltersProps> = ({
  search, onSearch, role, onRole, cellId, onCellId, cells,
}) => {
  const hasFilters = search || role || cellId;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Search */}
      <div className="relative flex-1 min-w-[180px] max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        <input
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search by name or email…"
          className="w-full h-9 pl-9 pr-3 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-york-500 focus:border-transparent"
        />
      </div>

      {/* Role filter */}
      <select
        value={role}
        onChange={(e) => onRole(e.target.value)}
        className="h-9 px-3 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-york-500"
      >
        {ROLE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>

      {/* Cell filter */}
      {cells.length > 0 && (
        <select
          value={cellId}
          onChange={(e) => onCellId(e.target.value)}
          className="h-9 px-3 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-york-500"
        >
          <option value="">All cells</option>
          {cells.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      )}

      {/* Clear */}
      {hasFilters && (
        <button
          type="button"
          onClick={() => { onSearch(''); onRole(''); onCellId(''); }}
          className="flex items-center gap-1 h-9 px-3 text-sm text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 transition-colors"
        >
          <X className="w-3.5 h-3.5" /> Clear
        </button>
      )}
    </div>
  );
};
