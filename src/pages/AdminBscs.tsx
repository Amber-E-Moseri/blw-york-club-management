import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../components/foundation';
import { PageHeader } from '../components/foundation/PageHeader';
import { deriveBscCapabilities, type BscCapabilities } from '../lib/bscAccess';
import {
  assignMemberToBsc,
  createBsc,
  fetchLedBscIds,
  fetchLedCellIds,
  listActiveMembers,
  listBscs,
  listCells,
  setBscLeader,
  type BscRow,
  type CellOption,
  type MemberRow,
} from '../lib/queries/bscs';
import type { AuthUser } from '../lib/auth';

interface Props {
  user: AuthUser | null;
}

type Notice = { kind: 'success' | 'error'; text: string } | null;

const inputClass =
  'w-full h-10 px-3 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-york-500';

const errorMessage = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/** Bible Study Class management. Shows only what the signed-in actor may do; the database enforces every write. */
export const AdminBscs: React.FC<Props> = ({ user }) => {
  const [caps, setCaps] = useState<BscCapabilities | null>(null);
  const [cells, setCells] = useState<CellOption[]>([]);
  const [bscs, setBscs] = useState<BscRow[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [newCellId, setNewCellId] = useState('');
  const [newName, setNewName] = useState('');
  const [newLeaderId, setNewLeaderId] = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    setLoadError('');
    try {
      const [ledCells, ledBscs, allCells, allBscs, activeMembers] = await Promise.all([
        fetchLedCellIds(user.id),
        fetchLedBscIds(user.id),
        listCells(),
        listBscs(),
        listActiveMembers(),
      ]);
      const capabilities = deriveBscCapabilities(user, { ledCellIds: ledCells, ledBscIds: ledBscs });
      setCaps(capabilities);
      setCells(capabilities.isStaff ? allCells : allCells.filter((c) => ledCells.includes(c.id)));
      setBscs(capabilities.isStaff ? allBscs : allBscs.filter((b) => ledCells.includes(b.cell_id)));
      setMembers(activeMembers);
    } catch (e) {
      setLoadError(errorMessage(e, 'Could not load Bible Study Classes.'));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const membersByCell = useMemo(() => {
    const map = new Map<string, MemberRow[]>();
    members.forEach((m) => {
      if (!m.cell_id) return;
      map.set(m.cell_id, [...(map.get(m.cell_id) ?? []), m]);
    });
    return map;
  }, [members]);

  const cellName = (id: string) => cells.find((c) => c.id === id)?.name ?? 'Cell';
  const memberLabel = (m: MemberRow) => m.full_name || m.email || 'Member';
  const leaderOptionsFor = (cellId: string) => membersByCell.get(cellId) ?? [];

  if (!user || loading) {
    return <p className="text-sm text-gray-500 dark:text-slate-400">Loading Bible Study Classes…</p>;
  }
  if (loadError) {
    return (
      <div role="alert" className="bg-york-50 dark:bg-york-900/30 border border-york-200 dark:border-york-800 text-york-700 dark:text-york-300 rounded-lg px-4 py-3 text-sm">
        {loadError}
      </div>
    );
  }
  if (!caps?.canOpenManagement) {
    return (
      <p className="text-sm text-gray-500 dark:text-slate-400">
        Bible Study Classes are managed by coordinators, admins and the leaders of a cell.
      </p>
    );
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCellId || newName.trim().length < 2) {
      setNotice({ kind: 'error', text: 'Choose a cell and enter a class name of at least 2 characters.' });
      return;
    }
    setBusy('create');
    setNotice(null);
    try {
      const created = await createBsc({ cell_id: newCellId, name: newName.trim(), leader_id: newLeaderId || null });
      setBscs((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName('');
      setNewLeaderId('');
      setNotice({ kind: 'success', text: `Bible Study Class “${created.name}” created.` });
    } catch (err) {
      setNotice({ kind: 'error', text: errorMessage(err, 'Could not create the Bible Study Class.') });
    } finally {
      setBusy(null);
    }
  };

  const handleLeader = async (bsc: BscRow, leaderId: string) => {
    setBusy(`leader-${bsc.id}`);
    setNotice(null);
    try {
      const saved = await setBscLeader(bsc.id, leaderId || null);
      setBscs((prev) => prev.map((b) => (b.id === saved.id ? saved : b)));
      setNotice({ kind: 'success', text: `Leader saved for “${saved.name}”.` });
    } catch (err) {
      setNotice({ kind: 'error', text: errorMessage(err, 'Could not save the leader.') });
    } finally {
      setBusy(null);
    }
  };

  const handleMove = async (member: MemberRow, bscId: string) => {
    setBusy(member.id);
    setNotice(null);
    try {
      await assignMemberToBsc(member.id, bscId || null);
      setMembers((prev) => prev.map((m) => (m.id === member.id ? { ...m, bsc_id: bscId || null } : m)));
      setNotice({ kind: 'success', text: `${memberLabel(member)} moved.` });
    } catch (err) {
      setNotice({ kind: 'error', text: errorMessage(err, 'Could not move the member.') });
    } finally {
      setBusy(null);
    }
  };

  const creatableCells = cells;
  const newCellLeaders = newCellId ? leaderOptionsFor(newCellId) : [];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="People"
        title="Bible Study Classes"
        description="Bible Study Classes sit inside each cell. Each member belongs to one class."
      />

      {notice && (
        <div
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className={
            notice.kind === 'error'
              ? 'bg-york-50 dark:bg-york-900/30 border border-york-200 dark:border-york-800 text-york-700 dark:text-york-300 rounded-lg px-4 py-3 text-sm'
              : 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300 rounded-lg px-4 py-3 text-sm'
          }
        >
          {notice.text}
        </div>
      )}

      <form onSubmit={handleCreate} className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl p-5 space-y-3">
        <p className="text-sm font-bold text-gray-900 dark:text-slate-100">Create a Bible Study Class</p>
        {creatableCells.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-slate-400">You do not lead a cell yet.</p>
        ) : (
          <>
            <select
              className={inputClass}
              value={newCellId}
              onChange={(e) => {
                setNewCellId(e.target.value);
                setNewLeaderId('');
              }}
              aria-label="Cell"
            >
              <option value="">Choose a cell</option>
              {creatableCells.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <input className={inputClass} placeholder="Class name" value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="Class name" />
            <select className={inputClass} value={newLeaderId} onChange={(e) => setNewLeaderId(e.target.value)} aria-label="Class leader" disabled={!newCellId}>
              <option value="">No leader yet</option>
              {newCellLeaders.map((m) => (
                <option key={m.id} value={m.id}>{memberLabel(m)}</option>
              ))}
            </select>
            <Button type="submit" variant="primary" loading={busy === 'create'} disabled={busy !== null}>
              Create class
            </Button>
          </>
        )}
      </form>

      <section className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl p-5 space-y-3">
        <p className="text-sm font-bold text-gray-900 dark:text-slate-100">Classes and leaders</p>
        {bscs.length === 0 && <p className="text-sm text-gray-500 dark:text-slate-400">No Bible Study Classes yet.</p>}
        {bscs.map((b) => {
          const options = leaderOptionsFor(b.cell_id);
          const leaderActive = b.leader_id === null || options.some((m) => m.id === b.leader_id);
          return (
            <div key={b.id} className="flex flex-col gap-2 border-t border-gray-100 dark:border-slate-700 pt-3 first:border-t-0 first:pt-0 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900 dark:text-slate-100 truncate">{b.name}</p>
                <p className="text-xs text-gray-500 dark:text-slate-400 truncate">{cellName(b.cell_id)}</p>
                {!leaderActive && (
                  <p className="text-xs text-york-700 dark:text-york-300">The leader is no longer an active member of this cell. Choose a replacement.</p>
                )}
              </div>
              <select
                className={`${inputClass} sm:w-64`}
                value={leaderActive ? b.leader_id ?? '' : ''}
                disabled={busy === `leader-${b.id}`}
                onChange={(e) => handleLeader(b, e.target.value)}
                aria-label={`Leader of ${b.name}`}
              >
                <option value="">No leader</option>
                {options.map((m) => (
                  <option key={m.id} value={m.id}>{memberLabel(m)}</option>
                ))}
              </select>
            </div>
          );
        })}
      </section>

      {caps.canManageRoster && (
        <section className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl p-5 space-y-3">
          <p className="text-sm font-bold text-gray-900 dark:text-slate-100">Assign members</p>
          <p className="text-xs text-gray-500 dark:text-slate-400">Members can only be placed in a class inside their own cell.</p>
          {members.length === 0 && <p className="text-sm text-gray-500 dark:text-slate-400">No active members yet.</p>}
          {members.map((m) => {
            const classes = bscs.filter((b) => b.cell_id === m.cell_id);
            return (
              <div key={m.id} className="flex flex-col gap-2 border-t border-gray-100 dark:border-slate-700 pt-3 first:border-t-0 first:pt-0 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-slate-100 truncate">{memberLabel(m)}</p>
                  <p className="text-xs text-gray-500 dark:text-slate-400 truncate">{m.cell_id ? cellName(m.cell_id) : 'No cell yet'}</p>
                </div>
                <select
                  className={`${inputClass} sm:w-64`}
                  value={m.bsc_id ?? ''}
                  disabled={busy === m.id || !m.cell_id}
                  onChange={(e) => handleMove(m, e.target.value)}
                  aria-label={`Class for ${memberLabel(m)}`}
                >
                  <option value="">No class</option>
                  {classes.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
};
