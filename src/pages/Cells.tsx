import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, ChevronDown, ChevronUp, Plus, Users, UserPlus } from 'lucide-react';
import { fetchMembersFiltered, assignMemberToCell } from '../lib/queries/members';
import { createCell, fetchCells, assignCellLeader } from '../lib/queries/contacts';
import { fetchBscsByCell, createBsc, assignMemberToBsc, assignBscLeader } from '../lib/queries/bscs';
import { summarizeCells, validateCellName, type CellSummary } from '../lib/cells';
import { getMonthlyDevotional } from '../lib/queries/devotionals';
import type { AuthUser } from '../lib/auth';
import type { Bsc, Cell, Member, MonthlyDevotional } from '../types';
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

  // Member assignment state (coordinator-only)
  const [assigningCellId, setAssigningCellId] = useState<string | null>(null);
  const [assignMemberId, setAssignMemberId] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  // Cell leader assignment state (coordinator-only)
  const [settingLeaderCellId, setSettingLeaderCellId] = useState<string | null>(null);
  const [leaderMemberId, setLeaderMemberId] = useState('');
  const [settingLeader, setSettingLeader] = useState(false);
  const [setLeaderError, setSetLeaderError] = useState<string | null>(null);

  // BSC leader assignment state
  const [settingLeaderBscId, setSettingLeaderBscId] = useState<string | null>(null);
  const [bscLeaderMemberId, setBscLeaderMemberId] = useState('');
  const [settingBscLeader, setSettingBscLeader] = useState(false);
  const [setBscLeaderError, setSetBscLeaderError] = useState<string | null>(null);

  const handleAssignMember = async (cellId: string) => {
    if (!assignMemberId) return;
    setAssigning(true);
    setAssignError(null);
    try {
      await assignMemberToCell(assignMemberId, cellId);
      setMembers((prev) =>
        prev.map((m) => (m.id === assignMemberId ? { ...m, cell_id: cellId, bsc_id: null } : m)),
      );
      setAssignMemberId('');
      setAssigningCellId(null);
    } catch (e: unknown) {
      setAssignError(e instanceof Error ? e.message : 'Could not assign member.');
    } finally {
      setAssigning(false);
    }
  };

  const handleSetCellLeader = async (cellId: string) => {
    if (!leaderMemberId) return;
    setSettingLeader(true);
    setSetLeaderError(null);
    try {
      await assignCellLeader(cellId, leaderMemberId);
      setCells((prev) => prev.map((c) => c.id === cellId ? { ...c, leader_id: leaderMemberId } : c));
      setLeaderMemberId('');
      setSettingLeaderCellId(null);
    } catch (e: unknown) {
      setSetLeaderError(e instanceof Error ? e.message : 'Could not assign leader.');
    } finally {
      setSettingLeader(false);
    }
  };

  const handleSetBscLeader = async (bscId: string, cellId: string) => {
    if (!bscLeaderMemberId) return;
    setSettingBscLeader(true);
    setSetBscLeaderError(null);
    try {
      await assignBscLeader(bscId, bscLeaderMemberId);
      setBscsByCellId((prev) => ({
        ...prev,
        [cellId]: (prev[cellId] ?? []).map((b) => b.id === bscId ? { ...b, leader_id: bscLeaderMemberId } : b),
      }));
      setBscLeaderMemberId('');
      setSettingLeaderBscId(null);
    } catch (e: unknown) {
      setSetBscLeaderError(e instanceof Error ? e.message : 'Could not assign BSC leader.');
    } finally {
      setSettingBscLeader(false);
    }
  };

  // BSC state (coordinator-only)
  const [bscsByCellId, setBscsByCellId] = useState<Record<string, Bsc[]>>({});
  const [bscLoadingId, setBscLoadingId] = useState<string | null>(null);
  const [newBscName, setNewBscName] = useState<Record<string, string>>({});
  const [creatingBscId, setCreatingBscId] = useState<string | null>(null);
  const [bscCreateError, setBscCreateError] = useState<Record<string, string | null>>({});
  const [assigningBscId, setAssigningBscId] = useState<string | null>(null);
  const [bscAssignMemberId, setBscAssignMemberId] = useState('');
  const [bscAssigning, setBscAssigning] = useState(false);
  const [bscAssignError, setBscAssignError] = useState<string | null>(null);

  const loadBscs = async (cellId: string) => {
    if (bscsByCellId[cellId] !== undefined) return;
    setBscLoadingId(cellId);
    try {
      const rows = await fetchBscsByCell(cellId);
      setBscsByCellId((prev) => ({ ...prev, [cellId]: rows }));
    } catch {
      setBscsByCellId((prev) => ({ ...prev, [cellId]: [] }));
    } finally {
      setBscLoadingId(null);
    }
  };

  const handleOpenCell = (cellId: string, isOpen: boolean) => {
    setOpenId(isOpen ? null : cellId);
    if (!isOpen) loadBscs(cellId);
  };

  const handleCreateBsc = async (cellId: string) => {
    const name = (newBscName[cellId] ?? '').trim();
    if (!name) return;
    setCreatingBscId(cellId);
    setBscCreateError((prev) => ({ ...prev, [cellId]: null }));
    try {
      const bsc = await createBsc(cellId, name);
      setBscsByCellId((prev) => ({
        ...prev,
        [cellId]: [...(prev[cellId] ?? []), bsc].sort((a, b) => a.name.localeCompare(b.name)),
      }));
      setNewBscName((prev) => ({ ...prev, [cellId]: '' }));
    } catch (e: unknown) {
      setBscCreateError((prev) => ({ ...prev, [cellId]: e instanceof Error ? e.message : 'Could not create BSC.' }));
    } finally {
      setCreatingBscId(null);
    }
  };

  const handleAssignToBsc = async (bscId: string, cellId: string) => {
    if (!bscAssignMemberId) return;
    setBscAssigning(true);
    setBscAssignError(null);
    try {
      await assignMemberToBsc(bscAssignMemberId, bscId);
      setMembers((prev) =>
        prev.map((m) => {
          if (m.id !== bscAssignMemberId) return m;
          const bscName = bscsByCellId[cellId]?.find((b) => b.id === bscId)?.name ?? undefined;
          return { ...m, bsc_id: bscId, bsc_name: bscName };
        }),
      );
      setBscAssignMemberId('');
      setAssigningBscId(null);
    } catch (e: unknown) {
      setBscAssignError(e instanceof Error ? e.message : 'Could not assign member to BSC.');
    } finally {
      setBscAssigning(false);
    }
  };

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

  // Cell leaders can manage BSCs only in cells they personally lead; coordinators manage all.
  const bscManageableCells = useMemo(() => {
    if (user?.role === 'coordinator') return new Set(cells.map((c) => c.id));
    if (user?.role === 'cell_leader') return new Set(cells.filter((c) => c.leader_id === user.id).map((c) => c.id));
    return new Set<string>();
  }, [cells, user]);
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
        <p className="text-[11px] font-bold text-york-600 uppercase tracking-wider">People</p>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100 mt-1">Cells</h1>
        <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
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
            <Button type="submit" variant="primary" fullWidth loading={creating} disabled={creating || !newCellName.trim()}>
              + Add cell
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
                onClick={() => handleOpenCell(cell.id, isOpen)}
              >
                <span className="w-10 h-10 rounded-xl bg-york-50 dark:bg-york-900/30 flex items-center justify-center shrink-0">
                  <Users className="w-5 h-5 text-york-600 dark:text-york-300" aria-hidden="true" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[15px] font-bold text-gray-900 dark:text-slate-100 truncate">{cell.name}</span>
                  <span className="block text-sm text-gray-500 dark:text-slate-400 truncate">
                    Led by {cell.leaderName ?? 'no one yet'} · {cell.members.length}{' '}
                    {cell.members.length === 1 ? 'member' : 'members'}
                  </span>
                </span>
                {isOpen ? <ChevronUp className="w-4 h-4 shrink-0" /> : <ChevronDown className="w-4 h-4 shrink-0" />}
              </button>

              {isOpen && (
                <div className="border-t border-gray-100 dark:border-slate-700 px-4 py-4 space-y-4">

                  {/* ── Cell leader assignment ────────────────────────────── */}
                  {canCreate && (
                    <section>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400 mb-1.5">
                        Cell leader
                      </p>
                      {settingLeaderCellId === cell.id ? (
                        <div className="flex items-center gap-2 flex-wrap">
                          <select
                            className="flex-1 min-w-0 px-3 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-york-600"
                            value={leaderMemberId}
                            onChange={(e) => { setLeaderMemberId(e.target.value); setSetLeaderError(null); }}
                            disabled={settingLeader}
                          >
                            <option value="">Select member…</option>
                            {cell.members.map((m) => (
                              <option key={m.id} value={m.id}>{m.full_name}</option>
                            ))}
                          </select>
                          <Button type="button" variant="primary" size="small" loading={settingLeader} disabled={settingLeader || !leaderMemberId} onClick={() => handleSetCellLeader(cell.id)}>Set</Button>
                          <Button type="button" variant="ghost" size="small" disabled={settingLeader} onClick={() => { setSettingLeaderCellId(null); setLeaderMemberId(''); setSetLeaderError(null); }}>Cancel</Button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-gray-900 dark:text-slate-100">{cell.leaderName ?? 'Not assigned'}</span>
                          <button
                            type="button"
                            onClick={() => { setSettingLeaderCellId(cell.id); setLeaderMemberId(''); setSetLeaderError(null); }}
                            className="h-8 px-3 text-xs font-semibold text-gray-700 dark:text-slate-200 border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
                          >
                            {cell.leaderName ? 'Change' : 'Assign'}
                          </button>
                        </div>
                      )}
                      {setLeaderError && settingLeaderCellId === cell.id && (
                        <p className="mt-1 text-xs text-red-600">{setLeaderError}</p>
                      )}
                    </section>
                  )}

                  {/* ── Cell members not yet in a BSC ─────────────────────── */}
                  {(() => {
                    const unassignedToAnyBsc = cell.members.filter((m) => !m.bsc_id);
                    return (
                      <section>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400 mb-1.5">
                          Cell members — no BSC
                        </p>
                        {unassignedToAnyBsc.length === 0 ? (
                          <p className="text-xs text-gray-400 dark:text-slate-500 italic">All members are in a BSC.</p>
                        ) : (
                          <ul className="text-sm text-gray-800 dark:text-slate-200 space-y-0.5">
                            {unassignedToAnyBsc.map((m) => (
                              <li key={m.id} className="flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-slate-600 shrink-0" />
                                {m.full_name}
                              </li>
                            ))}
                          </ul>
                        )}
                      </section>
                    );
                  })()}

                  {/* ── Bible Study Classes ────────────────────────────────── */}
                  <section>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400 mb-2">
                      Bible Study Classes
                    </p>

                    {bscLoadingId === cell.id ? (
                      <p className="text-xs text-gray-400 dark:text-slate-500">Loading…</p>
                    ) : (bscsByCellId[cell.id] ?? []).length === 0 && !bscManageableCells.has(cell.id) ? (
                      <p className="text-xs text-gray-400 dark:text-slate-500 italic">No BSCs yet.</p>
                    ) : (
                      <ul className="space-y-2">
                        {(bscsByCellId[cell.id] ?? []).map((bsc) => {
                          const bscMembers = cell.members.filter((m) => m.bsc_id === bsc.id);
                          const isAssigningThisBsc = assigningBscId === bsc.id;
                          const eligibleForBsc = cell.members.filter((m) => m.bsc_id !== bsc.id);
                          return (
                            <li
                              key={bsc.id}
                              className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 space-y-2.5"
                            >
                              <div className="flex items-center gap-2">
                                <BookOpen className="w-4 h-4 text-york-600 dark:text-york-300 shrink-0" aria-hidden="true" />
                                <span className="text-sm font-bold text-gray-900 dark:text-slate-100">{bsc.name}</span>
                                <span className="ml-auto text-xs text-gray-500 dark:text-slate-400">{bscMembers.length} {bscMembers.length === 1 ? 'member' : 'members'}</span>
                              </div>
                              {bscMembers.length > 0 && (
                                <ul className="flex flex-wrap gap-1.5">
                                  {bscMembers.map((m) => (
                                    <li
                                      key={m.id}
                                      className="px-2.5 py-1 text-xs font-medium text-gray-700 dark:text-slate-300 border border-gray-200 dark:border-slate-600 rounded-full bg-white dark:bg-slate-800"
                                    >
                                      {m.full_name}
                                    </li>
                                  ))}
                                </ul>
                              )}

                              {bscManageableCells.has(cell.id) && (
                                <div className="space-y-1.5">
                                  {/* BSC leader */}
                                  {(() => {
                                    const leaderName = bscMembers.find((m) => m.id === bsc.leader_id)?.full_name ?? null;
                                    const isSettingThisBscLeader = settingLeaderBscId === bsc.id;
                                    return isSettingThisBscLeader ? (
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <select
                                          className="flex-1 min-w-0 px-2 py-1.5 text-xs border border-gray-200 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-york-600"
                                          value={bscLeaderMemberId}
                                          onChange={(e) => { setBscLeaderMemberId(e.target.value); setSetBscLeaderError(null); }}
                                          disabled={settingBscLeader}
                                        >
                                          <option value="">Select leader…</option>
                                          {cell.members.map((m) => (
                                            <option key={m.id} value={m.id}>{m.full_name}</option>
                                          ))}
                                        </select>
                                        <Button type="button" variant="primary" size="small" loading={settingBscLeader} disabled={settingBscLeader || !bscLeaderMemberId} onClick={() => handleSetBscLeader(bsc.id, cell.id)}>Set</Button>
                                        <Button type="button" variant="ghost" size="small" disabled={settingBscLeader} onClick={() => { setSettingLeaderBscId(null); setBscLeaderMemberId(''); setSetBscLeaderError(null); }}>Cancel</Button>
                                        {setBscLeaderError && <p className="w-full text-xs text-red-600">{setBscLeaderError}</p>}
                                      </div>
                                    ) : (
                                      <div className="flex items-center gap-2">
                                        <span className="text-[11px] text-gray-500 dark:text-slate-400">Leader: {leaderName ?? 'Not assigned'}</span>
                                        <button
                                          type="button"
                                          onClick={() => { setSettingLeaderBscId(bsc.id); setBscLeaderMemberId(''); setSetBscLeaderError(null); }}
                                          className="text-[11px] font-semibold text-york-600 hover:text-york-700 dark:text-york-400 transition-colors"
                                        >
                                          {leaderName ? 'Change' : 'Assign'}
                                        </button>
                                      </div>
                                    );
                                  })()}
                                </div>
                              )}
                              {bscManageableCells.has(cell.id) && (
                                <div>
                                  {isAssigningThisBsc ? (
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <select
                                        className="flex-1 min-w-0 px-2 py-1.5 text-xs border border-gray-200 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-york-600"
                                        value={bscAssignMemberId}
                                        onChange={(e) => { setBscAssignMemberId(e.target.value); setBscAssignError(null); }}
                                        disabled={bscAssigning}
                                      >
                                        <option value="">Select member…</option>
                                        {eligibleForBsc.map((m) => (
                                          <option key={m.id} value={m.id}>
                                            {m.full_name}{m.bsc_id ? ' (move)' : ''}
                                          </option>
                                        ))}
                                      </select>
                                      <Button type="button" variant="primary" size="small" loading={bscAssigning} disabled={bscAssigning || !bscAssignMemberId} onClick={() => handleAssignToBsc(bsc.id, cell.id)}>Add</Button>
                                      <Button type="button" variant="ghost" size="small" disabled={bscAssigning} onClick={() => { setAssigningBscId(null); setBscAssignMemberId(''); setBscAssignError(null); }}>Cancel</Button>
                                    </div>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => { setAssigningBscId(bsc.id); setBscAssignMemberId(''); setBscAssignError(null); }}
                                      className="flex items-center gap-1.5 text-xs font-semibold text-york-600 hover:text-york-700 dark:text-york-300 dark:hover:text-york-200 transition-colors"
                                    >
                                      <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
                                      Add member
                                    </button>
                                  )}
                                  {bscAssignError && isAssigningThisBsc && (
                                    <p className="mt-1 text-xs text-red-600">{bscAssignError}</p>
                                  )}
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}

                    {/* Create BSC form */}
                    {bscManageableCells.has(cell.id) && (
                      <div className="mt-2 space-y-2">
                        <input
                          type="text"
                          placeholder="New BSC name"
                          value={newBscName[cell.id] ?? ''}
                          onChange={(e) => setNewBscName((prev) => ({ ...prev, [cell.id]: e.target.value }))}
                          maxLength={80}
                          className="w-full h-11 px-3 text-sm border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-gray-800 dark:text-slate-200 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-york-600"
                        />
                        <Button
                          type="button"
                          variant="primary"
                          fullWidth
                          loading={creatingBscId === cell.id}
                          disabled={creatingBscId === cell.id || !(newBscName[cell.id] ?? '').trim()}
                          onClick={() => handleCreateBsc(cell.id)}
                        >
                          <Plus className="w-3.5 h-3.5 mr-1" aria-hidden="true" />
                          Create BSC
                        </Button>
                        {bscCreateError[cell.id] && (
                          <p className="w-full text-xs text-red-600">{bscCreateError[cell.id]}</p>
                        )}
                      </div>
                    )}
                  </section>

                  {/* ── Add member to cell ─────────────────────────────────── */}
                  {canCreate && (
                    <section className="border-t border-gray-100 dark:border-slate-700 pt-4">
                      {assigningCellId === cell.id ? (
                        <div className="flex items-center gap-2 flex-wrap">
                          <select
                            className="flex-1 min-w-0 px-3 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-york-600"
                            value={assignMemberId}
                            onChange={(e) => { setAssignMemberId(e.target.value); setAssignError(null); }}
                            disabled={assigning}
                          >
                            <option value="">Select member…</option>
                            {members.filter((m) => m.cell_id !== cell.id).map((m) => (
                              <option key={m.id} value={m.id}>{m.full_name}{m.cell_id ? ' (move)' : ''}</option>
                            ))}
                          </select>
                          <Button type="button" variant="primary" size="small" loading={assigning} disabled={assigning || !assignMemberId} onClick={() => handleAssignMember(cell.id)}>Assign</Button>
                          <Button type="button" variant="ghost" size="small" disabled={assigning} onClick={() => { setAssigningCellId(null); setAssignMemberId(''); setAssignError(null); }}>Cancel</Button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => { setAssigningCellId(cell.id); setAssignMemberId(''); setAssignError(null); }}
                          className="flex w-full h-11 items-center justify-center gap-2 text-sm font-semibold text-gray-700 dark:text-slate-200 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
                        >
                          <UserPlus className="w-4 h-4" aria-hidden="true" />
                          Add member to cell
                        </button>
                      )}
                      {assignError && assigningCellId === cell.id && (
                        <p className="mt-1 text-xs text-red-600">{assignError}</p>
                      )}
                    </section>
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
        <h2 className="text-[15px] font-bold text-gray-900 dark:text-slate-100">ROR reading overview</h2>
        <p className="text-xs text-gray-500 dark:text-slate-400">Organisation-wide, current month</p>
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
            <div className="rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm p-4">
              <h3 className="text-sm font-bold text-gray-900 dark:text-slate-100 mb-3">Progress by cell</h3>
              <ul className="space-y-3">
                {byCells.map((c) => (
                  <li key={c.name} className="flex items-center gap-3">
                    <span className="text-sm text-gray-700 dark:text-slate-300 w-24 truncate">{c.name}</span>
                    <div className="flex-1 bg-gray-100 dark:bg-slate-700 rounded-full h-2">
                      <div
                        className="bg-york-600 h-2 rounded-full transition-all"
                        style={{ width: `${c.count > 0 ? Math.round((c.done / c.count) * 100) : 0}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-500 dark:text-slate-400 w-16 text-right whitespace-nowrap">
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
  <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm px-3.5 py-3">
    <p className="text-xs text-gray-500 dark:text-slate-400">{label}</p>
    <p className="text-2xl font-bold text-gray-900 dark:text-slate-100 mt-1">{value}</p>
  </div>
);
