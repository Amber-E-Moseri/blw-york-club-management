import React, { useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Badge } from '../components/foundation/Badge';
import { Button } from '../components/foundation/Button';
import { getInitials } from '../lib/utils';
import { approvePendingMember } from '../lib/queries/members';
import { fetchCells } from '../lib/queries/contacts';
import { assignPendingApplicantToCell } from '../lib/queries/cellAdmin';
import { CELL_CHANGE_REASON_MAX, validateCellChangeReason } from '../lib/cells/cellAdmin';
import type { AuthUser } from '../lib/auth';
import type { Cell } from '../types';
import { PageHeader } from '../components/foundation/PageHeader';

interface Props { user: AuthUser | null; }

interface PendingProfile {
  id: string;
  email: string;
  full_name: string;
  student_number: string | null;
  joined_at: string;
  status: 'pending' | 'inactive' | 'rejected';
  cell_id: string | null;
}

const CAN_APPROVE = ['admin', 'coordinator'];

const selectClass =
  'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-york-600';

/**
 * Places one pending applicant in a cell, with a required reason. Only admins and coordinators see this control (the
 * page gate). The database refuses any other caller (migration 093). Approval and rejection are separate buttons.
 */
export const PlacementControl: React.FC<{
  applicant: PendingProfile;
  cells: Cell[];
  actor: AuthUser;
  onPlaced: (applicantId: string, cellName: string) => void;
}> = ({ applicant, cells, actor, onPlaced }) => {
  const [cellId, setCellId] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const reasonCheck = validateCellChangeReason(reason);
  const cell = cells.find((c) => c.id === cellId);

  const save = async () => {
    if (!cell || !reasonCheck.ok) return;
    setSaving(true);
    setError('');
    try {
      await assignPendingApplicantToCell(
        { id: applicant.id, full_name: applicant.full_name, status: 'pending' },
        cell.id,
        { role: actor.role, status: actor.status },
        cells,
        reasonCheck.value,
      );
      onPlaced(applicant.id, cell.name);
      setReason('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The applicant was not placed.');
    }
    setSaving(false);
  };

  return (
    <div className="mt-3 border-t border-gray-100 dark:border-slate-800 pt-3 space-y-2">
      <p className="text-xs font-semibold text-gray-700 dark:text-slate-300">Place in a cell</p>
      {cells.length === 0 ? (
        <p className="text-xs text-gray-500 dark:text-slate-400">No active cells exist yet. Create one on the Cells page first.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto] sm:items-start">
          <select
            aria-label={`Cell for ${applicant.full_name || applicant.email}`}
            className={selectClass}
            value={cellId}
            onChange={(e) => setCellId(e.target.value)}
            disabled={saving}
          >
            <option value="">Select a cell…</option>
            {cells.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <textarea
            aria-label={`Reason for placing ${applicant.full_name || applicant.email}`}
            className={selectClass}
            rows={2}
            maxLength={CELL_CHANGE_REASON_MAX}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={saving}
            placeholder="Reason (required), recorded in the cell history"
          />
          <Button
            variant="secondary"
            size="small"
            loading={saving}
            disabled={!cell || !reasonCheck.ok}
            onClick={save}
          >
            Place in cell
          </Button>
        </div>
      )}
      {error && <p role="alert" className="text-xs text-york-700 dark:text-york-300">{error}</p>}
    </div>
  );
};

export const AdminPendingApprovals: React.FC<Props> = ({ user }) => {
  const [pending, setPending] = useState<PendingProfile[]>([]);
  const [cells, setCells] = useState<Cell[]>([]);
  const [placed, setPlaced] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const canApprove = CAN_APPROVE.includes(user?.role ?? '');

  useEffect(() => {
    if (!canApprove) { setLoading(false); return; }
    supabase
      .from('member_directory')
      .select('id, email, full_name, student_number, joined_at, status, cell_id')
      .in('status', ['pending', 'rejected'])
      .order('joined_at', { ascending: true })
      .then(({ data, error: e }) => {
        if (e) setError(e.message);
        else setPending((data ?? []) as PendingProfile[]);
        setLoading(false);
      });
    fetchCells().then(setCells).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : 'Could not load cells.');
    });
  }, [canApprove]);

  const handleApprove = async (id: string) => {
    if (!user?.id) return;
    setWorking(id);
    setError('');
    setNotice('');
    try {
      const result = await approvePendingMember(id, user.id);
      if (result.approval === 'success') {
        setPending((prev) => prev.filter((p) => p.id !== id));
        setNotice(
          result.email === 'sent'
            ? 'Member approved and notification sent.'
            : 'Member approved, but the notification email could not be sent.',
        );
      } else if (result.approval === 'not_pending') {
        setPending((prev) => prev.filter((p) => p.id !== id));
        setNotice('Member is already active.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Approval failed.');
    }
    setWorking(null);
  };

  const handleReject = async (id: string) => {
    setWorking(id);
    setError('');
    setNotice('');
    const { error: e } = await supabase.rpc('reject_pending_member', { target_member_id: id });
    if (e) { setError(e.message); }
    else { setPending((prev) => prev.filter((p) => p.id !== id)); }
    setWorking(null);
  };

  if (!canApprove) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <p className="text-sm text-gray-400 dark:text-slate-400">Access denied.</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <PageHeader
        eyebrow="People / Approvals"
        title="Pending Approvals"
        description="New members waiting for access to BLW York Hub"
      />

      {error && (
        <div className="bg-york-50 dark:bg-york-900/30 border border-york-200 dark:border-york-800 text-york-700 dark:text-york-300 rounded-lg px-4 py-3 text-sm">{error}</div>
      )}
      {notice && (
        <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg px-4 py-3 text-sm">{notice}</div>
      )}

      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-20 bg-gray-100 dark:bg-slate-700 rounded-lg animate-pulse" />)}
        </div>
      )}

      {!loading && pending.length === 0 && (
          <div className="text-center py-16 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg">
            <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-green-400" aria-hidden="true" />
            <p className="text-base font-semibold text-gray-700 dark:text-slate-300">No pending requests</p>
            <p className="text-sm text-gray-400 dark:text-slate-400 mt-1">All accounts are up to date</p>
          </div>
        )}

      {!loading && pending.length > 0 && (
        <div className="space-y-3">
          {pending.map((p) => (
            <div key={p.id} className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg p-5 flex flex-wrap items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-york-600 text-white flex items-center justify-center text-sm font-bold shrink-0">
                {getInitials(p.full_name || p.email)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-gray-900 dark:text-slate-100">{p.full_name || '(no name)'}</p>
                  {p.status === 'rejected' && <Badge variant="error" size="small">Previously rejected</Badge>}
                </div>
                <p className="text-sm text-gray-500 dark:text-slate-400">{p.email}</p>
                {p.student_number && (
                  <p className="text-xs text-gray-400 dark:text-slate-400 font-mono mt-0.5">#{p.student_number}</p>
                )}
                <p className="text-xs text-gray-400 dark:text-slate-400 mt-0.5">
                  Applied {new Date(p.joined_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
                <Button
                  variant="primary"
                  size="small"
                  loading={working === p.id}
                  onClick={() => handleApprove(p.id)}
                >
                  Approve
                </Button>
                <Button
                  variant="ghost"
                  size="small"
                  loading={working === p.id}
                  onClick={() => handleReject(p.id)}
                >
                  Reject
                </Button>
              </div>
              {p.status === 'pending' && user && (
                <div className="w-full">
                  {placed[p.id] ? (
                    <p className="text-xs text-green-700 dark:text-green-400 mt-2">Placed in {placed[p.id]}. The applicant is still pending approval.</p>
                  ) : (
                    <PlacementControl
                      applicant={p}
                      cells={cells}
                      actor={user}
                      onPlaced={(id, name) => setPlaced((prev) => ({ ...prev, [id]: name }))}
                    />
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
