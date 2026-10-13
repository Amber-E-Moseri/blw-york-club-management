import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Archive, RotateCcw, Pencil, Plus, UserMinus, Users, Crown, ArrowRightLeft } from 'lucide-react';
import { fetchMembersFiltered } from '../lib/queries/members';
import { fetchCells } from '../lib/queries/contacts';
import { summarizeCells, type CellSummary } from '../lib/cells';
import { canManageCells, validateMemberPlacement } from '../lib/cells/cellAdmin';
import {
  createCell,
  fetchArchivedCells,
  fetchBscMembershipNames,
  renameCell,
  setCellArchived,
  setCellLeader,
  setMemberCell,
} from '../lib/queries/cellAdmin';
import { CellNameModal, CellLeaderModal, MemberPlacementModal, ConfirmModal } from '../components/cells/CellAdminModals';
import { Button } from '../components/foundation/Button';
import type { AuthUser } from '../lib/auth';
import type { Cell, Member } from '../types';

const ROLE_LEVEL: Record<AuthUser['role'], number> = {
  member: 0, cell_leader: 1, admin: 2, coordinator: 3,
};

type Dialog =
  | { kind: 'create' }
  | { kind: 'rename'; cell: Cell }
  | { kind: 'leader'; cell: Cell }
  | { kind: 'place'; member: Member; from: Cell | null }
  | { kind: 'remove'; member: Member; from: Cell }
  | { kind: 'archive'; cell: Cell }
  | { kind: 'restore'; cell: Cell };

interface Props { user: AuthUser | null; }

/**
 * Cells list. Cell leaders and members see the read-only list of their cells. Active coordinators and admins can
 * create and rename cells, assign leaders, and add, remove or transfer members. Every write is validated first and
 * then checked by the database through RLS.
 */
export const Cells: React.FC<Props> = ({ user }) => {
  const level = ROLE_LEVEL[user?.role ?? 'member'] ?? 0;
  const canManage = canManageCells(user ? { role: user.role, status: user.status } : null);
  const [cells, setCells] = useState<Cell[]>([]);
  const [archivedCells, setArchivedCells] = useState<Cell[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (cancelled: () => boolean = () => false) => {
    setLoading(true);
    try {
      const [cellRows, memberRows, bscNames, archivedRows] = await Promise.all([
        fetchCells(),
        fetchMembersFiltered(),
        // Guidance only: a failed lookup must not block the page, because the transfer RPC refuses a BSC member anyway.
        fetchBscMembershipNames().catch(() => ({} as Record<string, string>)),
        canManage ? fetchArchivedCells() : Promise.resolve([] as Cell[]),
      ]);
      if (cancelled()) return;
      setCells(cellRows);
      setArchivedCells(archivedRows);
      setMembers(memberRows.map((m) => ({ ...m, bsc_name: bscNames[m.id] ?? null })));
      setError(null);
    } catch (e: unknown) {
      if (!cancelled()) setError(e instanceof Error ? e.message : 'Could not load cells.');
    } finally {
      if (!cancelled()) setLoading(false);
    }
  }, [canManage]);

  useEffect(() => {
    if (level < 1) return;
    let cancelled = false;
    load(() => cancelled);
    return () => { cancelled = true; };
  }, [level, load]);

  const summaries = useMemo<CellSummary[]>(() => summarizeCells(cells, members), [cells, members]);
  const unassigned = members.filter((m) => !m.cell_id).length;
  const actor = user ? { role: user.role, status: user.status } : null;

  const reportSaved = (message: string) => {
    setNotice(message);
    load();
  };

  if (level < 1) {
    return (
      <div className="p-6 text-sm text-gray-600 dark:text-slate-400">
        Cells are visible to cell leaders, admins and coordinators.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100">Cells</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400">
            {cells.length} {cells.length === 1 ? 'cell' : 'cells'}
            {unassigned > 0 && ` · ${unassigned} ${unassigned === 1 ? 'member' : 'members'} not in a cell`}
          </p>
        </div>
        {canManage && (
          <Button variant="primary" size="small" onClick={() => setDialog({ kind: 'create' })}>
            <Plus className="w-4 h-4 mr-1" aria-hidden="true" /> New cell
          </Button>
        )}
      </div>

      {notice && (
        <div role="status" className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200">
          {notice}
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-lg border border-york-200 bg-york-50 px-3 py-2 text-sm text-york-700">
          {error}
        </div>
      )}

      {loading && <p className="text-sm text-gray-500 dark:text-slate-400">Loading cells…</p>}

      {!loading && !error && summaries.length === 0 && (
        <div className="text-sm text-gray-500 dark:text-slate-400 space-y-2">
          <p>No cells yet.</p>
          {canManage && <p>Use “New cell” to create the first one.</p>}
        </div>
      )}

      <ul className="space-y-3">
        {summaries.map((cell) => {
          const isOpen = openId === cell.id;
          const cellRecord = cells.find((c) => c.id === cell.id) ?? null;
          const addable = members.filter((m) => !m.cell_id && m.status === 'active');
          return (
            <li
              key={cell.id}
              className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg shadow-sm"
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
                <div className="border-t border-gray-100 dark:border-slate-700 px-4 py-3 space-y-3">
                  {canManage && cellRecord && (
                    <div className="flex flex-wrap gap-2">
                      <Button variant="secondary" size="small" onClick={() => setDialog({ kind: 'rename', cell: cellRecord })}>
                        <Pencil className="w-3.5 h-3.5 mr-1" aria-hidden="true" /> Rename
                      </Button>
                      <Button variant="secondary" size="small" onClick={() => setDialog({ kind: 'leader', cell: cellRecord })}>
                        <Crown className="w-3.5 h-3.5 mr-1" aria-hidden="true" /> {cell.leaderName ? 'Change leader' : 'Assign leader'}
                      </Button>
                      <Button
                        variant="secondary"
                        size="small"
                        disabled={cell.members.length > 0}
                        onClick={() => setDialog({ kind: 'archive', cell: cellRecord })}
                      >
                        <Archive className="w-3.5 h-3.5 mr-1" aria-hidden="true" /> Archive
                      </Button>
                    </div>
                  )}
                  {canManage && cellRecord && cell.members.length > 0 && (
                    <p className="text-xs text-gray-500 dark:text-slate-400">
                      Move or remove the members in this cell before archiving it.
                    </p>
                  )}

                  {cell.members.length === 0 ? (
                    <p className="text-sm text-gray-500 dark:text-slate-400">No members yet.</p>
                  ) : (
                    <ul className="divide-y divide-gray-100 dark:divide-slate-800">
                      {cell.members.map((m) => (
                        <li key={m.id} className="flex items-center gap-2 py-2">
                          <span className="flex-1 min-w-0 text-sm text-gray-800 dark:text-slate-200 truncate">
                            {m.full_name}
                            {m.status !== 'active' && (
                              <span className="ml-2 text-xs font-semibold text-york-700">
                                ({m.status ?? 'not active'})
                              </span>
                            )}
                            {m.bsc_name && (
                              <span className="ml-2 text-xs text-gray-500 dark:text-slate-400">in {m.bsc_name}</span>
                            )}
                          </span>
                          {canManage && cellRecord && (
                            <>
                              <Button
                                variant="ghost"
                                size="small"
                                aria-label={`Transfer ${m.full_name}`}
                                onClick={() => setDialog({ kind: 'place', member: m, from: cellRecord })}
                              >
                                <ArrowRightLeft className="w-3.5 h-3.5" aria-hidden="true" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="small"
                                aria-label={`Remove ${m.full_name} from ${cell.name}`}
                                onClick={() => setDialog({ kind: 'remove', member: m, from: cellRecord })}
                              >
                                <UserMinus className="w-3.5 h-3.5" aria-hidden="true" />
                              </Button>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}

                  {canManage && cellRecord && addable.length > 0 && (
                    <div>
                      <label className="block text-xs font-bold text-gray-700 dark:text-slate-300 mb-1" htmlFor={`add-${cell.id}`}>
                        Add a member
                      </label>
                      <select
                        id={`add-${cell.id}`}
                        className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100"
                        value=""
                        onChange={(e) => {
                          const picked = members.find((m) => m.id === e.target.value);
                          if (picked) setDialog({ kind: 'place', member: picked, from: null });
                        }}
                      >
                        <option value="">Choose an active member not in a cell…</option>
                        {addable.map((m) => (
                          <option key={m.id} value={m.id}>{m.full_name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {canManage && archivedCells.length > 0 && (
        <section className="space-y-2" aria-label="Archived cells">
          <h2 className="text-sm font-bold text-gray-700 dark:text-slate-300">Archived cells</h2>
          <ul className="space-y-2">
            {archivedCells.map((cell) => (
              <li
                key={cell.id}
                className="flex items-center gap-2 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg px-4 py-2"
              >
                <span className="flex-1 min-w-0 text-sm text-gray-600 dark:text-slate-400 truncate">{cell.name}</span>
                <Button variant="secondary" size="small" onClick={() => setDialog({ kind: 'restore', cell })}>
                  <RotateCcw className="w-3.5 h-3.5 mr-1" aria-hidden="true" /> Restore
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {canManage && (
        <>
          <CellNameModal
            isOpen={dialog?.kind === 'create'}
            onClose={() => setDialog(null)}
            onSave={async (name) => {
              await createCell(name, actor!, cells);
              reportSaved('Cell created.');
            }}
          />
          <CellNameModal
            isOpen={dialog?.kind === 'rename'}
            cell={dialog?.kind === 'rename' ? dialog.cell : null}
            onClose={() => setDialog(null)}
            onSave={async (name) => {
              if (dialog?.kind !== 'rename') return;
              await renameCell(dialog.cell.id, name, actor!, cells);
              reportSaved('Cell renamed.');
            }}
          />
          <CellLeaderModal
            isOpen={dialog?.kind === 'leader'}
            cell={dialog?.kind === 'leader' ? dialog.cell : null}
            members={members}
            onClose={() => setDialog(null)}
            onSave={async (leaderId) => {
              if (dialog?.kind !== 'leader') return;
              await setCellLeader(dialog.cell.id, leaderId, actor!, members);
              reportSaved('Cell leader saved.');
            }}
          />
          <MemberPlacementModal
            isOpen={dialog?.kind === 'place'}
            member={dialog?.kind === 'place' ? dialog.member : null}
            currentCell={dialog?.kind === 'place' ? dialog.from : null}
            cells={cells}
            onClose={() => setDialog(null)}
            onSave={async (targetCellId) => {
              if (dialog?.kind !== 'place' || !targetCellId) throw new Error('Choose a destination cell.');
              await setMemberCell(dialog.member, targetCellId, actor!, cells);
              reportSaved(`${dialog.member.full_name} moved.`);
            }}
          />
          <ConfirmModal
            isOpen={dialog?.kind === 'remove'}
            onClose={() => setDialog(null)}
            title="Remove from cell?"
            message={
              dialog?.kind === 'remove'
                ? validateMemberPlacement(dialog.member, null, cells)
                  ?? `${dialog.member.full_name} will be removed from ${dialog.from.name}. They will stay in the directory.`
                : ''
            }
            confirmLabel="Remove"
            onConfirm={async () => {
              if (dialog?.kind !== 'remove') return;
              await setMemberCell(dialog.member, null, actor!, cells);
              reportSaved(`${dialog.member.full_name} removed from the cell.`);
            }}
          />
          <ConfirmModal
            isOpen={dialog?.kind === 'archive'}
            onClose={() => setDialog(null)}
            title="Archive cell?"
            message={
              dialog?.kind === 'archive'
                ? `${dialog.cell.name} will be hidden from cell lists and pickers. Its history is kept, and it can be restored later.`
                : ''
            }
            confirmLabel="Archive"
            onConfirm={async () => {
              if (dialog?.kind !== 'archive') return;
              await setCellArchived(dialog.cell, true, actor!, members);
              reportSaved(`${dialog.cell.name} archived.`);
            }}
          />
          <ConfirmModal
            isOpen={dialog?.kind === 'restore'}
            onClose={() => setDialog(null)}
            title="Restore cell?"
            message={dialog?.kind === 'restore' ? `${dialog.cell.name} will appear in cell lists and pickers again.` : ''}
            confirmLabel="Restore"
            onConfirm={async () => {
              if (dialog?.kind !== 'restore') return;
              await setCellArchived(dialog.cell, false, actor!, members);
              reportSaved(`${dialog.cell.name} restored.`);
            }}
          />
        </>
      )}
    </div>
  );
};
