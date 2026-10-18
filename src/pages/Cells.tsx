import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Users } from 'lucide-react';
import { fetchMembersFiltered } from '../lib/queries/members';
import { createCell, fetchCells } from '../lib/queries/contacts';
import { summarizeCells, validateCellName, type CellSummary } from '../lib/cells';
import { getMonthlyDevotional } from '../lib/queries/devotionals';
import type { AuthUser } from '../lib/auth';
import type { Cell, Member, MonthlyDevotional } from '../types';
import { Button } from '../components/foundation/Button';
import { Input } from '../components/foundation/Input';
import { RorProgressTable } from '../components/feature/RorProgressTable';
import { RorMemberDetailModal } from '../components/feature/RorMemberDetailModal';
import { useCellRorProgress, useOrgRorProgress } from '../hooks/useRorStreak';
import type { CellMemberRorRow } from '../lib/queries/rorStreaks';

const ROLE_LEVEL: Record<AuthUser['role'], number> = {
  member: 0, cell_leader: 1, admin: 2, coordinator: 3,
};

interface Props { user: AuthUser | null; }

/** List of cells, their leaders and members. Visible to cell leaders, admins and coordinators; only coordinators can add a cell. */
export const Cells: React.FC<Props> = ({ user }) => {
  const level = ROLE_LEVEL[user?.role ?? 'member'] ?? 0;
  const canCreate = user?.role === 'coordinator';
  const [cells, setCells] = useState<Cell[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ROR progress state
  const isLeader = user?.role === 'cell_leader';
  const isCoordinator = user?.role === 'coordinator' || user?.role === 'admin';
  const { rows: rorRows, loading: rorLoading } = useCellRorProgress();
  const { rows: orgRows, loading: orgLoading } = useOrgRorProgress();
  const [rorSelectedMember, setRorSelectedMember] = useState<CellMemberRorRow | null>(null);
  const [currentDevotional, setCurrentDevotional] = useState<MonthlyDevotional | null>(null);

  useEffect(() => {
    if (!isLeader && !isCoordinator) return;
    const now = new Date();
    getMonthlyDevotional(now.getMonth() + 1, now.getFullYear())
      .then((d) => setCurrentDevotional(d))
      .catch(() => null);
  }, [isLeader, isCoordinator]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [newCellName, setNewCellName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createNotice, setCreateNotice] = useState<string | null>(null);

  useEffect(() => {
    if (level < 1) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchCells(), fetchMembersFiltered()])
      .then(([cellRows, memberRows]) => {
        if (cancelled) return;
        setCells(cellRows);
        setMembers(memberRows);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load cells.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [level]);

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const problem = validateCellName(newCellName);
    if (problem) {
      setCreateError(problem);
      return;
    }
    setCreating(true);
    setCreateError(null);
    setCreateNotice(null);
    try {
      const created = await createCell(newCellName.trim());
      setCells((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setNewCellName('');
      setCreateNotice(`Added ${created.name}.`);
    } catch (e: unknown) {
      setCreateError(e instanceof Error ? e.message : 'Could not create the cell.');
    } finally {
      setCreating(false);
    }
  };

  const summaries = useMemo<CellSummary[]>(() => summarizeCells(cells, members), [cells, members]);
  const unassigned = members.filter((m) => !m.cell_id).length;

  if (level < 1) {
    return (
      <div className="p-6 text-sm text-gray-600 dark:text-slate-400">
        Cells are visible to cell leaders, admins and coordinators.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100">Cells</h1>
        <p className="text-sm text-gray-500 dark:text-slate-400">
          {cells.length} {cells.length === 1 ? 'cell' : 'cells'}
          {unassigned > 0 && ` · ${unassigned} ${unassigned === 1 ? 'member' : 'members'} not in a cell`}
        </p>
      </div>

      {canCreate && (
        <form
          onSubmit={handleCreate}
          aria-label="Add a cell"
          className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl shadow-sm p-4 space-y-3"
        >
          <Input
            label="New cell name"
            value={newCellName}
            onChange={setNewCellName}
            placeholder="e.g. Cell 7"
            maxLength={80}
            error={createError ?? undefined}
          />
          <div className="flex items-center gap-3">
            <Button type="submit" variant="primary" loading={creating} disabled={creating || !newCellName.trim()}>
              Add cell
            </Button>
            {createNotice && <span role="status" className="text-sm text-gray-600 dark:text-slate-400">{createNotice}</span>}
          </div>
        </form>
      )}

      {error && (
        <div role="alert" className="rounded-lg border border-york-200 bg-york-50 px-3 py-2 text-sm text-york-700">
          {error}
        </div>
      )}

      {loading && <p className="text-sm text-gray-500 dark:text-slate-400">Loading cells…</p>}

      {!loading && !error && summaries.length === 0 && (
        <p className="text-sm text-gray-500 dark:text-slate-400">No cells yet.</p>
      )}

      {isCoordinator && (
        <OrgRorSection
          rows={orgRows}
          loading={orgLoading}
          onViewMember={setRorSelectedMember}
        />
      )}

      {isLeader && (
        <div className="pt-2">
          {rorLoading ? (
            <div className="rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6">
              <div className="h-4 w-48 bg-gray-100 dark:bg-slate-700 rounded animate-pulse mb-3" />
              <div className="h-24 bg-gray-50 dark:bg-slate-700 rounded animate-pulse" />
            </div>
          ) : (
            <RorProgressTable
              rows={rorRows}
              title="ROR Reading Progress — My Cell"
              onViewMember={setRorSelectedMember}
            />
          )}
        </div>
      )}

      {rorSelectedMember && (
        <RorMemberDetailModal
          member={rorSelectedMember}
          devotionalId={currentDevotional?.id ?? null}
          devotionalTotalDays={currentDevotional?.total_days ?? 0}
          devotionalMonth={currentDevotional?.month ?? new Date().getMonth() + 1}
          devotionalYear={currentDevotional?.year ?? new Date().getFullYear()}
          onClose={() => setRorSelectedMember(null)}
        />
      )}

      <div className="pt-2">
        <ul className="space-y-3">
        {summaries.map((cell) => {
          const isOpen = openId === cell.id;
          return (
            <li
              key={cell.id}
              className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl shadow-sm"
            >
              <button
                type="button"
                className="w-full flex items-center gap-3 p-4 text-left"
                aria-expanded={isOpen}
                onClick={() => setOpenId(isOpen ? null : cell.id)}
              >
                <Users className="w-5 h-5 text-york-600 shrink-0" aria-hidden="true" />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-bold text-gray-900 dark:text-slate-100 truncate">{cell.name}</span>
                  <span className="block text-xs text-gray-500 dark:text-slate-400">
                    Leader: {cell.leaderName ?? 'Not assigned'} · {cell.members.length}{' '}
                    {cell.members.length === 1 ? 'member' : 'members'}
                  </span>
                </span>
                {isOpen ? <ChevronUp className="w-4 h-4 shrink-0" /> : <ChevronDown className="w-4 h-4 shrink-0" />}
              </button>

              {isOpen && (
                <div className="border-t border-gray-100 dark:border-slate-700 px-4 py-3">
                  {cell.members.length === 0 ? (
                    <p className="text-sm text-gray-500 dark:text-slate-400">No members yet.</p>
                  ) : (
                    <ul className="text-sm text-gray-800 dark:text-slate-200 space-y-1">
                      {cell.members.map((m) => (
                        <li key={m.id}>{m.full_name}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          );
        })}
        </ul>
      </div>
    </div>
  );
};

// ─── Coordinator org-wide ROR section ────────────────────────────────────────

interface OrgRorSectionProps {
  rows: CellMemberRorRow[];
  loading: boolean;
  onViewMember: (row: CellMemberRorRow) => void;
}

const OrgRorSection: React.FC<OrgRorSectionProps> = ({ rows, loading, onViewMember }) => {
  const today = new Date().toISOString().split('T')[0];
  const totalMembers = rows.length;
  const completedToday = rows.filter((r) => r.last_completed === today).length;
  const avgStreak = totalMembers > 0
    ? Math.round(rows.reduce((s, r) => s + r.current_streak, 0) / totalMembers)
    : 0;
  const monthlyPct = totalMembers > 0
    ? Math.round(
        rows.reduce((s, r) => s + (r.monthly_total > 0 ? r.monthly_completed / r.monthly_total : 0), 0)
        / totalMembers * 100,
      )
    : 0;

  // group by cell for progress-by-cell display
  const byCellMap = new Map<string, { name: string; count: number; done: number }>();
  for (const r of rows) {
    const key = r.cell_id ?? '__none';
    const existing = byCellMap.get(key) ?? { name: r.cell_name ?? 'No cell', count: 0, done: 0 };
    existing.count++;
    if (r.monthly_total > 0 && r.monthly_completed === r.monthly_total) existing.done++;
    byCellMap.set(key, existing);
  }
  const byCells = Array.from(byCellMap.values()).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-4 pt-2">
      <div>
        <h2 className="text-base font-bold text-gray-900 dark:text-white">ROR Reading Overview</h2>
        <p className="text-xs text-gray-500 dark:text-slate-400">Organisation-wide for current month</p>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 rounded-2xl bg-gray-100 dark:bg-slate-700 animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <OrgStat label="Participating" value={totalMembers} />
            <OrgStat label="Read today" value={completedToday} />
            <OrgStat label="Monthly avg" value={`${monthlyPct}%`} />
            <OrgStat label="Avg streak" value={`${avgStreak}d`} />
          </div>

          {byCells.length > 0 && (
            <div className="rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Progress by cell</h3>
              <ul className="space-y-2">
                {byCells.map((c) => (
                  <li key={c.name} className="flex items-center gap-3">
                    <span className="text-sm text-gray-700 dark:text-slate-300 w-32 truncate">{c.name}</span>
                    <div className="flex-1 bg-gray-100 dark:bg-slate-700 rounded-full h-2">
                      <div
                        className="bg-york-600 h-2 rounded-full transition-all"
                        style={{ width: `${c.count > 0 ? Math.round((c.done / c.count) * 100) : 0}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-500 w-20 text-right">
                      {c.done}/{c.count} full
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <RorProgressTable
            rows={rows}
            title="All Members"
            showCell
            onViewMember={onViewMember}
          />
        </>
      )}
    </div>
  );
};

const OrgStat: React.FC<{ label: string; value: string | number }> = ({ label, value }) => (
  <div className="rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3">
    <p className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider">{label}</p>
    <p className="text-2xl font-bold text-gray-900 dark:text-white mt-0.5">{value}</p>
  </div>
);
