import React, { useState } from 'react';
import { Search, ChevronUp, ChevronDown, Flame, Trophy, Calendar, Clock } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { CellMemberRorRow } from '../../lib/queries/rorStreaks';

export type ProgressStatus = 'Consistent' | 'Improving' | 'Needs Follow-up';

function deriveStatus(row: CellMemberRorRow, today: Date): ProgressStatus {
  const lastDone = row.last_completed ? new Date(row.last_completed) : null;
  const daysSinceLast = lastDone
    ? Math.floor((today.getTime() - lastDone.getTime()) / 86_400_000)
    : Infinity;
  const pct = row.monthly_total > 0
    ? Math.round((row.monthly_completed / row.monthly_total) * 100)
    : 0;

  if (row.current_streak >= 7 && pct >= 70) return 'Consistent';
  if (daysSinceLast <= 3 || row.current_streak >= 3 || pct >= 40) return 'Improving';
  return 'Needs Follow-up';
}

const STATUS_CHIP: Record<ProgressStatus, string> = {
  Consistent:       'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400',
  Improving:        'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400',
  'Needs Follow-up':'bg-york-50 text-york-700 dark:bg-york-900/20 dark:text-york-300',
};

const STATUS_NOTE: Record<ProgressStatus, string> = {
  Consistent:        'Reading consistently this month',
  Improving:         'Making progress',
  'Needs Follow-up': 'Not an attendance record — provided for pastoral support',
};

type SortKey = 'full_name' | 'current_streak' | 'longest_streak' | 'monthly_pct' | 'last_completed';

interface Props {
  rows: CellMemberRorRow[];
  onViewMember?: (row: CellMemberRorRow) => void;
  title?: string;
  showCell?: boolean;
}

export const RorProgressTable: React.FC<Props> = ({
  rows, onViewMember, title = 'ROR Reading Progress', showCell = false,
}) => {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('full_name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const today = new Date();

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  }

  const filtered = rows
    .filter((r) => r.full_name.toLowerCase().includes(search.toLowerCase()) ||
      (showCell && r.cell_name?.toLowerCase().includes(search.toLowerCase())))
    .map((r) => ({ ...r, status: deriveStatus(r, today) as ProgressStatus,
      monthly_pct: r.monthly_total > 0 ? Math.round((r.monthly_completed / r.monthly_total) * 100) : 0 }))
    .sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'full_name') cmp = a.full_name.localeCompare(b.full_name);
      else if (sortKey === 'current_streak') cmp = a.current_streak - b.current_streak;
      else if (sortKey === 'longest_streak') cmp = a.longest_streak - b.longest_streak;
      else if (sortKey === 'monthly_pct') cmp = a.monthly_pct - b.monthly_pct;
      else if (sortKey === 'last_completed') {
        const da = a.last_completed ? new Date(a.last_completed).getTime() : 0;
        const db = b.last_completed ? new Date(b.last_completed).getTime() : 0;
        cmp = da - db;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

  const SortIcon = ({ k }: { k: SortKey }) => {
    if (sortKey !== k) return <ChevronUp className="w-3 h-3 opacity-20" />;
    return sortDir === 'asc'
      ? <ChevronUp className="w-3 h-3" />
      : <ChevronDown className="w-3 h-3" />;
  };

  function Th({ k, children }: { k: SortKey; children: React.ReactNode }) {
    return (
      <th
        className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500 cursor-pointer select-none whitespace-nowrap"
        onClick={() => toggleSort(k)}
        aria-sort={sortKey === k ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        <span className="flex items-center gap-1">{children}<SortIcon k={k} /></span>
      </th>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
      <div className="px-4 py-4 border-b border-gray-100 dark:border-slate-700 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-base font-bold text-gray-900 dark:text-white">{title}</h2>
        <div className="relative max-w-xs w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search members…"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-600 bg-gray-50 dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-york-600"
            aria-label="Search members"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm" role="table" aria-label={title}>
          <thead>
            <tr className="border-b border-gray-100 dark:border-slate-700">
              <Th k="full_name">Member</Th>
              {showCell && <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">Cell</th>}
              <Th k="current_streak"><Flame className="w-3.5 h-3.5 inline mr-0.5 text-orange-400" aria-hidden="true" />Streak</Th>
              <Th k="longest_streak"><Trophy className="w-3.5 h-3.5 inline mr-0.5 text-amber-400" aria-hidden="true" />Best</Th>
              <Th k="monthly_pct"><Calendar className="w-3.5 h-3.5 inline mr-0.5 text-blue-400" aria-hidden="true" />Monthly</Th>
              <Th k="last_completed"><Clock className="w-3.5 h-3.5 inline mr-0.5 text-gray-400" aria-hidden="true" />Last read</Th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">Status</th>
              {onViewMember && <th className="px-4 py-3" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={showCell ? 8 : 7} className="px-4 py-8 text-center text-sm text-gray-400">
                  No members found.
                </td>
              </tr>
            ) : filtered.map((r) => (
              <tr key={r.member_id} className="hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors">
                <td className="px-4 py-3 font-medium text-gray-900 dark:text-white whitespace-nowrap">{r.full_name}</td>
                {showCell && <td className="px-4 py-3 text-gray-500 dark:text-slate-400 whitespace-nowrap">{r.cell_name ?? '—'}</td>}
                <td className="px-4 py-3 text-orange-600 font-semibold">{r.current_streak}d</td>
                <td className="px-4 py-3 text-amber-600 font-semibold">{r.longest_streak}d</td>
                <td className="px-4 py-3">
                  <span className="font-semibold text-gray-900 dark:text-white">{r.monthly_pct}%</span>
                  <span className="ml-1 text-xs text-gray-400">({r.monthly_completed}/{r.monthly_total})</span>
                </td>
                <td className="px-4 py-3 text-gray-500 dark:text-slate-400 text-xs whitespace-nowrap">
                  {r.last_completed
                    ? new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(new Date(r.last_completed))
                    : '—'}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={cn('inline-block px-2 py-0.5 rounded-full text-xs font-semibold', STATUS_CHIP[r.status])}
                    title={STATUS_NOTE[r.status]}
                    aria-label={`${r.status} — ${STATUS_NOTE[r.status]}`}
                  >
                    {r.status}
                  </span>
                </td>
                {onViewMember && (
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => onViewMember(r)}
                      className="text-xs font-semibold text-york-600 hover:underline"
                      aria-label={`View ${r.full_name}'s reading progress`}
                    >
                      View
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-4 py-2 text-[11px] text-gray-400 dark:text-slate-500 border-t border-gray-100 dark:border-slate-700">
        Status indicators reflect self-reported reading activity. They are not verified attendance records.
      </p>
    </div>
  );
};
