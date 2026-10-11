import React, { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../components/foundation/PageHeader';
import {
  listConfessionDeclarations,
  listRhapsodyReads,
  listVisibleBscMembers,
  type ConfessionDeclaration,
  type RhapsodyRead,
  type VisibleMember,
} from '../lib/queries/bscs';
import type { AuthUser } from '../lib/auth';

interface Props {
  user: AuthUser | null;
}

const LEADER_ROLES = ['admin', 'coordinator', 'cell_leader'];

export const MyBsc: React.FC<Props> = ({ user }) => {
  const canView = LEADER_ROLES.includes(user?.role ?? '');
  const today = useMemo(() => new Date(), []);
  const month = today.getMonth() + 1;
  const year = today.getFullYear();

  const [members, setMembers] = useState<VisibleMember[]>([]);
  const [reads, setReads] = useState<RhapsodyRead[]>([]);
  const [confessions, setConfessions] = useState<ConfessionDeclaration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!canView) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const visible = await listVisibleBscMembers();
        const ids = visible.map((m) => m.id);
        const [r, c] = await Promise.all([
          listRhapsodyReads(ids, month, year),
          listConfessionDeclarations(ids, month, year),
        ]);
        if (cancelled) return;
        setMembers(visible);
        setReads(r);
        setConfessions(c);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load your members.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canView, month, year]);

  const grouped = useMemo(() => {
    const byBsc = new Map<string, { name: string; members: VisibleMember[] }>();
    members.forEach((m) => {
      const group = byBsc.get(m.bsc_id) ?? { name: m.bsc_name, members: [] };
      group.members.push(m);
      byBsc.set(m.bsc_id, group);
    });
    return Array.from(byBsc.values());
  }, [members]);

  if (!canView) {
    return <p className="text-sm text-gray-500 dark:text-slate-400">Your BSC view is for leaders only.</p>;
  }

  const monthLabel = today.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="People"
        title="My BSC"
        description={`Rhapsody reads and confessions for ${monthLabel}.`}
      />

      {error && (
        <div className="bg-york-50 dark:bg-york-900/30 border border-york-200 dark:border-york-800 text-york-700 dark:text-york-300 rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}
      {loading && <p className="text-sm text-gray-500 dark:text-slate-400">Loading…</p>}
      {!loading && !error && members.length === 0 && (
        <p className="text-sm text-gray-500 dark:text-slate-400">No members are assigned to a BSC you lead yet.</p>
      )}

      {grouped.map((group) => (
        <section key={group.name} className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 dark:text-slate-400">{group.name}</h2>
          {group.members.map((m) => {
            const readDays = Array.from(new Set(reads.filter((r) => r.member_id === m.id).map((r) => r.day_of_month))).sort((a, b) => a - b);
            const confessionCount = confessions.filter((c) => c.user_id === m.id).length;
            return (
              <div key={m.id} className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl p-4">
                <p className="text-sm font-semibold text-gray-900 dark:text-slate-100">{m.full_name || m.email}</p>
                <p className="text-xs text-gray-500 dark:text-slate-400">{m.email}</p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500">Rhapsody reads</p>
                    <p className="text-lg font-bold text-gray-900 dark:text-slate-100">{readDays.length} days</p>
                    <p className="text-xs text-gray-500 dark:text-slate-400">
                      {readDays.length > 0 ? `Days ${readDays.join(', ')}` : 'None yet'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500">Confessions</p>
                    <p className="text-lg font-bold text-gray-900 dark:text-slate-100">{confessionCount}</p>
                    <p className="text-xs text-gray-500 dark:text-slate-400">declared this month</p>
                  </div>
                </div>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
};
