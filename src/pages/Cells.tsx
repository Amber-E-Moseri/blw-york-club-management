import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Users } from 'lucide-react';
import { fetchMembersFiltered } from '../lib/queries/members';
import { createCell, fetchCells } from '../lib/queries/contacts';
import { summarizeCells, validateCellName, type CellSummary } from '../lib/cells';
import type { AuthUser } from '../lib/auth';
import type { Cell, Member } from '../types';
import { Button } from '../components/foundation/Button';
import { Input } from '../components/foundation/Input';

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
  );
};
