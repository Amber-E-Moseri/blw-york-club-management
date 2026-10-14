import React, { useEffect, useState } from 'react';
import { Modal } from '../foundation/Modal';
import { Button } from '../foundation/Button';
import { Input } from '../foundation/Input';
import {
  CELL_CHANGE_REASON_MAX,
  CELL_NAME_MAX_LENGTH,
  validateCellChangeReason,
  validateMemberPlacement,
} from '../../lib/cells/cellAdmin';
import type { Cell, Member } from '../../types';

const selectClass =
  'w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-york-600';

const errorClass = 'text-sm text-red-600 dark:text-red-400';

/** Runs an async save, shows its error inline, and closes on success. */
function useSave(onClose: () => void) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (task: () => Promise<void>) => {
    setSaving(true);
    setError(null);
    try {
      await task();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setSaving(false);
    }
  };
  const reset = () => { setError(null); setSaving(false); };
  return { saving, error, run, reset };
}

// ─── Create / rename ──────────────────────────────────────────────────────────

interface CellNameModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Present when renaming. Absent when creating. */
  cell?: Cell | null;
  onSave: (name: string) => Promise<void>;
}

export const CellNameModal: React.FC<CellNameModalProps> = ({ isOpen, onClose, cell, onSave }) => {
  const [name, setName] = useState('');
  const { saving, error, run, reset } = useSave(onClose);
  const isRename = !!cell;

  useEffect(() => {
    if (isOpen) { setName(cell?.name ?? ''); reset(); }
  }, [isOpen, cell]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isRename ? 'Rename cell' : 'New cell'}
      size="small"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={() => run(() => onSave(name))}>
            {isRename ? 'Save name' : 'Create cell'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          label="Cell name"
          value={name}
          onChange={setName}
          placeholder="e.g. North Campus"
          maxLength={CELL_NAME_MAX_LENGTH}
        />
        {error && <p role="alert" className={errorClass}>{error}</p>}
      </div>
    </Modal>
  );
};

// ─── Leader ───────────────────────────────────────────────────────────────────

interface CellLeaderModalProps {
  isOpen: boolean;
  onClose: () => void;
  cell: Cell | null;
  /** Full member directory. Only active members are offered as leaders. */
  members: Member[];
  onSave: (leaderId: string | null) => Promise<void>;
}

export const CellLeaderModal: React.FC<CellLeaderModalProps> = ({ isOpen, onClose, cell, members, onSave }) => {
  const [leaderId, setLeaderId] = useState('');
  const { saving, error, run, reset } = useSave(onClose);
  const candidates = members.filter((m) => m.status === 'active');

  useEffect(() => {
    if (isOpen) { setLeaderId(cell?.leader_id ?? ''); reset(); }
  }, [isOpen, cell]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Cell leader"
      subtitle={cell?.name}
      size="small"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={() => run(() => onSave(leaderId || null))}>
            Save leader
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="block text-sm font-bold text-gray-800 dark:text-slate-200 mb-1.5" htmlFor="cell-leader-select">
          Leader
        </label>
        <select
          id="cell-leader-select"
          className={selectClass}
          value={leaderId}
          onChange={(e) => setLeaderId(e.target.value)}
        >
          <option value="">No leader</option>
          {candidates.map((m) => (
            <option key={m.id} value={m.id}>{m.full_name}</option>
          ))}
        </select>
        {candidates.length === 0 && (
          <p className="text-xs text-gray-500 dark:text-slate-400">No active members are available to lead a cell.</p>
        )}
        {error && <p role="alert" className={errorClass}>{error}</p>}
      </div>
    </Modal>
  );
};

// ─── Add / transfer / remove member ───────────────────────────────────────────

interface MemberPlacementModalProps {
  isOpen: boolean;
  onClose: () => void;
  member: Member | null;
  /** Cell the member is moving from, if any. */
  currentCell: Cell | null;
  cells: Cell[];
  onSave: (targetCellId: string | null, reason: string) => Promise<void>;
}

/** Choose a destination cell for a member. Choosing "No cell" removes them from their current cell. */
export const MemberPlacementModal: React.FC<MemberPlacementModalProps> = ({
  isOpen, onClose, member, currentCell, cells, onSave,
}) => {
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('');
  const { saving, error, run, reset } = useSave(onClose);
  const destinations = cells.filter((c) => c.id !== currentCell?.id);
  const isActive = member?.status === 'active';
  const title = currentCell ? 'Transfer member' : 'Add to cell';
  // Blocks that do not depend on the destination: a Bible Study Class or a led cell must be resolved first.
  const preflight = member && currentCell ? validateMemberPlacement(member, null, cells) : null;
  const reasonCheck = validateCellChangeReason(reason);

  useEffect(() => {
    if (isOpen) { setTarget(''); setReason(''); reset(); }
  }, [isOpen, member]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      subtitle={member?.full_name}
      size="small"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button
            variant="primary"
            loading={saving}
            disabled={!isActive || !target || !!preflight || !reasonCheck.ok}
            onClick={() => run(() => onSave(target, reasonCheck.ok ? reasonCheck.value : ''))}
          >
            {currentCell ? 'Transfer' : 'Add to cell'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {currentCell && (
          <p className="text-sm text-gray-500 dark:text-slate-400">
            Currently in <span className="font-semibold text-gray-700 dark:text-slate-200">{currentCell.name}</span>
          </p>
        )}
        {!isActive && (
          <p role="alert" className={errorClass}>
            Only active members can be placed in a cell. This account is {member?.status ?? 'not active'}.
          </p>
        )}
        {isActive && preflight && (
          <p role="alert" className={errorClass}>{preflight}</p>
        )}
        <label className="block text-sm font-bold text-gray-800 dark:text-slate-200 mb-1.5" htmlFor="member-cell-select">
          Destination cell
        </label>
        <select
          id="member-cell-select"
          className={selectClass}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          disabled={!isActive}
        >
          <option value="">Select a cell…</option>
          {destinations.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <label className="block text-sm font-bold text-gray-800 dark:text-slate-200 mb-1.5" htmlFor="member-cell-reason">
          Reason
        </label>
        <textarea
          id="member-cell-reason"
          className={selectClass}
          rows={2}
          maxLength={CELL_CHANGE_REASON_MAX}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={!isActive}
          placeholder="Why this change is being made. Recorded in the cell history."
        />
        {error && <p role="alert" className={errorClass}>{error}</p>}
      </div>
    </Modal>
  );
};

// ─── Confirmation ─────────────────────────────────────────────────────────────

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  message: string;
  confirmLabel: string;
  /** When set, the user must enter a reason, which is passed to onConfirm (a cell change needs one). */
  requireReason?: boolean;
  onConfirm: (reason: string) => Promise<void>;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen, onClose, title, message, confirmLabel, requireReason = false, onConfirm,
}) => {
  const [reason, setReason] = useState('');
  const { saving, error, run, reset } = useSave(onClose);
  const reasonCheck = validateCellChangeReason(reason);

  useEffect(() => {
    if (isOpen) { setReason(''); reset(); }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const blocked = requireReason && !reasonCheck.ok;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="small"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button
            variant="danger"
            loading={saving}
            disabled={blocked}
            onClick={() => run(() => onConfirm(requireReason && reasonCheck.ok ? reasonCheck.value : ''))}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-gray-700 dark:text-slate-300">{message}</p>
        {requireReason && (
          <>
            <label className="block text-sm font-bold text-gray-800 dark:text-slate-200 mb-1.5" htmlFor="confirm-cell-reason">
              Reason
            </label>
            <textarea
              id="confirm-cell-reason"
              className={selectClass}
              rows={2}
              maxLength={CELL_CHANGE_REASON_MAX}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why this change is being made. Recorded in the cell history."
            />
          </>
        )}
        {error && <p role="alert" className={errorClass}>{error}</p>}
      </div>
    </Modal>
  );
};
