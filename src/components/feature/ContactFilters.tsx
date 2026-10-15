import React from 'react';
import { Input } from '../foundation/Input';
import { Button } from '../foundation/Button';
import { cn } from '../../lib/utils';
import type { ContactFilters as Filters, ContactTag, ContactStatus } from '../../types';

interface Props {
  filters: Filters;
  tags: ContactTag[];
  statuses: ContactStatus[];
  cells?: { id: string; name: string }[];
  onChange: (f: Filters) => void;
  onClear: () => void;
}

const DATE_PRESETS = [
  { label: 'All time',    from: '',                                   to: '' },
  { label: 'Last 7 days', from: daysAgo(7),                           to: today() },
  { label: 'Last 30 days',from: daysAgo(30),                          to: today() },
  { label: 'This month',  from: new Date().toISOString().slice(0, 7) + '-01', to: today() },
];

function today() { return new Date().toISOString().split('T')[0]; }
function daysAgo(n: number) {
  return new Date(Date.now() - n * 86400000).toISOString().split('T')[0];
}

function activeCount(f: Filters) {
  return [f.search, f.cell_id, f.tag, f.status, f.date_from || f.date_to]
    .filter(Boolean).length;
}

export const ContactFilters: React.FC<Props> = ({
  filters, tags, statuses, cells = [], onChange, onClear,
}) => {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  const count = activeCount(filters);

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3 dark:bg-slate-800 dark:border-slate-700">
      <div className="flex flex-wrap gap-3">
        {/* Search */}
        <div className="flex-1 min-w-[200px]">
          <Input
            placeholder="Search by name…"
            value={filters.search ?? ''}
            onChange={(v) => set({ search: v || undefined })}
            icon={
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            }
            iconPosition="left"
          />
        </div>

        {/* Cell */}
        {cells.length > 0 && (
          <div className="min-w-[140px]">
            <select
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-york-600"
              value={filters.cell_id ?? ''}
              onChange={(e) => set({ cell_id: e.target.value || undefined })}
            >
              <option value="">All Cells</option>
              {cells.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Tag */}
        <div className="min-w-[140px]">
          <select
            className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-york-600"
            value={filters.tag ?? ''}
            onChange={(e) => set({ tag: e.target.value || undefined })}
          >
            <option value="">All Tags</option>
            {tags.map((t) => (
              <option key={t.id} value={t.tag_name}>{t.tag_name}</option>
            ))}
          </select>
        </div>

        {/* Status */}
        <div className="min-w-[160px]">
          <select
            className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-york-600"
            value={filters.status ?? ''}
            onChange={(e) => set({ status: e.target.value || undefined })}
          >
            <option value="">All Statuses</option>
            {statuses.map((s) => (
              <option key={s.id} value={s.status_name}>{s.status_name}</option>
            ))}
          </select>
        </div>

        {/* Date range preset */}
        <div className="min-w-[140px]">
          <select
            className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-york-600"
            value={filters.date_from ? `${filters.date_from}|${filters.date_to}` : ''}
            onChange={(e) => {
              if (!e.target.value) { set({ date_from: undefined, date_to: undefined }); return; }
              const [from, to] = e.target.value.split('|');
              set({ date_from: from || undefined, date_to: to || undefined });
            }}
          >
            {DATE_PRESETS.map((p) => (
              <option key={p.label} value={p.from ? `${p.from}|${p.to}` : ''}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        {/* Clear */}
        {count > 0 && (
          <Button variant="ghost" size="small" onClick={onClear}>
            Clear ({count})
          </Button>
        )}
      </div>

      {/* Archived toggle */}
      <label className="inline-flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={filters.archived ?? false}
          onChange={(e) => set({ archived: e.target.checked })}
          className="w-4 h-4 rounded border-gray-300 text-york-600 focus:ring-york-600"
        />
        <span className={cn('text-sm', filters.archived ? 'text-gray-700 font-medium' : 'text-gray-500')}>
          Show archived
        </span>
      </label>
    </div>
  );
};
