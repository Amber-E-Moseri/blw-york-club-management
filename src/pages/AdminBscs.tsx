import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '../components/foundation';
import { PageHeader } from '../components/foundation/PageHeader';
import {
  assignMemberToBsc,
  createBsc,
  listActiveMembers,
  listBscs,
  listCells,
  type BscRow,
  type CellOption,
  type MemberRow,
} from '../lib/queries/bscs';
import type { AuthUser } from '../lib/auth';

interface Props {
  user: AuthUser | null;
}

const CAN_MANAGE = ['admin', 'coordinator'];

export const AdminBscs: React.FC<Props> = ({ user }) => {
  const canManage = CAN_MANAGE.includes(user?.role ?? '');
  const [cells, setCells] = useState<CellOption[]>([]);
  const [bscs, setBscs] = useState<BscRow[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const [cellId, setCellId] = useState('');
  const [name, setName] = useState('');
  const [leaderId, setLeaderId] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [c, b, m] = await Promise.all([listCells(), listBscs(), listActiveMembers()]);
      setCells(c);
      setBscs(b);
      setMembers(m);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load BSCs.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canManage) load();
    else setLoading(false);
  }, [canManage, load]);

  if (!canManage) {
    return <p className="text-sm text-gray-500 dark:text-slate-400">Only coordinators and admins can manage BSCs.</p>;
  }

  const cellName = (id: string) => cells.find((c) => c.id === id)?.name ?? 'Unknown cell';
  const bscLabel = (b: BscRow) => `${cellName(b.cell_id)} · ${b.name}`;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cellId || name.trim().length < 2) {
      setError('Choose a cell and enter a BSC name of at least 2 characters.');
      return;
    }
    setBusy('create');
    setError('');
    setNotice('');
    try {
      await createBsc({ cell_id: cellId, name: name.trim(), leader_id: leaderId || null });
      setName('');
      setLeaderId('');
      setNotice('BSC created.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create BSC.');
    } finally {
      setBusy(null);
    }
  };

  const handleAssign = async (memberId: string, bscId: string) => {
    setBusy(memberId);
    setError('');
    setNotice('');
    try {
      await assignMemberToBsc(memberId, bscId || null);
      setMembers((prev) => prev.map((m) => (m.id === memberId ? { ...m, bsc_id: bscId || null } : m)));
      setNotice('Member assignment saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save assignment.');
    } finally {
      setBusy(null);
    }
  };

  const inputClass =
    'w-full h-10 px-3 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-york-500';

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="People"
        title="BSCs"
        description="Bible Study Classes inside each cell. Each member belongs to one BSC."
      />

      {error && (
        <div className="bg-york-50 dark:bg-york-900/30 border border-york-200 dark:border-york-800 text-york-700 dark:text-york-300 rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}
      {notice && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300 rounded-lg px-4 py-3 text-sm">
          {notice}
        </div>
      )}

      <form onSubmit={handleCreate} className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl p-5 space-y-3">
        <p className="text-sm font-bold text-gray-900 dark:text-slate-100">Create a BSC</p>
        <select className={inputClass} value={cellId} onChange={(e) => setCellId(e.target.value)} aria-label="Cell">
          <option value="">Choose a cell</option>
          {cells.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <input className={inputClass} placeholder="BSC name" value={name} onChange={(e) => setName(e.target.value)} aria-label="BSC name" />
        <select className={inputClass} value={leaderId} onChange={(e) => setLeaderId(e.target.value)} aria-label="BSC leader">
          <option value="">No leader yet</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>{m.full_name || m.email}</option>
          ))}
        </select>
        <Button type="submit" variant="primary" loading={busy === 'create'} disabled={busy !== null}>
          Create BSC
        </Button>
      </form>

      <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl p-5 space-y-3">
        <p className="text-sm font-bold text-gray-900 dark:text-slate-100">Assign members</p>
        {loading && <p className="text-sm text-gray-500 dark:text-slate-400">Loading…</p>}
        {!loading && members.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-slate-400">No active members yet.</p>
        )}
        {members.map((m) => (
          <div key={m.id} className="flex flex-col gap-2 border-t border-gray-100 dark:border-slate-700 pt-3 first:border-t-0 first:pt-0 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900 dark:text-slate-100 truncate">{m.full_name || m.email}</p>
              <p className="text-xs text-gray-500 dark:text-slate-400 truncate">{m.email}</p>
            </div>
            <select
              className={`${inputClass} sm:w-64`}
              value={m.bsc_id ?? ''}
              disabled={busy === m.id}
              onChange={(e) => handleAssign(m.id, e.target.value)}
              aria-label={`BSC for ${m.full_name || m.email}`}
            >
              <option value="">No BSC</option>
              {bscs.map((b) => (
                <option key={b.id} value={b.id}>{bscLabel(b)}</option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
};
