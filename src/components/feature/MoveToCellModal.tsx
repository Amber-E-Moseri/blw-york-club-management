import React, { useState, useEffect } from 'react';
import { Modal } from '../foundation/Modal';
import { Button } from '../foundation/Button';
import { Input } from '../foundation/Input';
import type { Contact, Cell } from '../../types';
import { AlertCircle } from 'lucide-react';

interface AssignableUser { id: string; email: string; full_name: string; }

interface Props {
  isOpen: boolean;
  onClose: () => void;
  contact: Contact | null;
  cells: Cell[];
  users: AssignableUser[];
  onSave: (newCellId: string, newAssigneeId?: string, reason?: string) => Promise<void>;
}

export const MoveToCellModal: React.FC<Props> = ({
  isOpen, onClose, contact, cells, users, onSave,
}) => {
  const [cellId, setCellId] = useState('');
  const [reassign, setReassign] = useState(false);
  const [assigneeId, setAssigneeId] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setCellId('');
      setReassign(false);
      setAssigneeId('');
      setReason('');
      setError(null);
    }
  }, [isOpen]);

  const availableCells = cells.filter((c) => c.id !== contact?.cell_id);

  const handleSave = async () => {
    if (!cellId) { setError('Please select a cell.'); return; }
    if (reassign && !assigneeId) { setError('Please select the new follow-up person.'); return; }
    setSaving(true);
    setError(null);
    try {
      await onSave(cellId, reassign ? assigneeId : undefined, reason || undefined);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to move contact.');
    } finally {
      setSaving(false);
    }
  };

  const currentCell = cells.find((c) => c.id === contact?.cell_id);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Move to Cell"
      subtitle={contact ? `Contact: ${contact.contact_name}` : undefined}
      size="small"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={handleSave} loading={saving}>Move Contact</Button>
        </>
      }
    >
      <div className="space-y-4">
        {currentCell && (
          <p className="text-sm text-gray-500">
            Currently in: <span className="font-semibold text-gray-700">{currentCell.name}</span>
          </p>
        )}

        <div>
          <label className="block text-sm font-bold text-gray-800 mb-1.5">
            Move to Cell <span className="text-york-600">*</span>
          </label>
          <select
            className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-york-600"
            value={cellId}
            onChange={(e) => setCellId(e.target.value)}
          >
            <option value="">Select cell…</option>
            {availableCells.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={reassign}
            onChange={(e) => setReassign(e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 text-york-600 focus:ring-york-600"
          />
          <span className="text-sm text-gray-700">Reassign follow-up to someone in new cell</span>
        </label>

        {reassign && (
          <div>
            <label className="block text-sm font-bold text-gray-800 mb-1.5">
              New follow-up person <span className="text-york-600">*</span>
            </label>
            <select
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-york-600"
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
            >
              <option value="">Select person…</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.full_name}</option>
              ))}
            </select>
          </div>
        )}

        <Input
          label="Reason (optional)"
          type="textarea"
          placeholder="Why is this contact being moved?"
          value={reason}
          onChange={setReason}
          maxLength={300}
        />

        {error && (
          <p className="text-sm text-york-600"><AlertCircle className="inline w-3.5 h-3.5 mr-1 -mt-0.5" aria-hidden="true" />{error}</p>
        )}
      </div>
    </Modal>
  );
};
