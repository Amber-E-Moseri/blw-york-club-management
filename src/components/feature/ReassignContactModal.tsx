import React, { useState, useEffect } from 'react';
import { Modal } from '../foundation/Modal';
import { Button } from '../foundation/Button';
import { Input } from '../foundation/Input';
import type { Contact } from '../../types';
import { AlertCircle } from 'lucide-react';

interface AssignableUser { id: string; email: string; full_name: string; }

interface Props {
  isOpen: boolean;
  onClose: () => void;
  contact: Contact | null;
  users: AssignableUser[];
  onSave: (assigneeId: string, reason?: string) => Promise<void>;
}

export const ReassignContactModal: React.FC<Props> = ({
  isOpen, onClose, contact, users, onSave,
}) => {
  const [assigneeId, setAssigneeId] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setAssigneeId(contact?.follow_up_assignee ?? '');
      setReason('');
      setError(null);
    }
  }, [isOpen, contact]);

  const handleSave = async () => {
    if (!assigneeId) { setError('Please select a person.'); return; }
    setSaving(true);
    setError(null);
    try {
      await onSave(assigneeId, reason || undefined);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reassign.');
    } finally {
      setSaving(false);
    }
  };

  const currentUser = users.find((u) => u.id === contact?.follow_up_assignee);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Reassign Follow-up"
      subtitle={contact ? `Contact: ${contact.contact_name}` : undefined}
      size="small"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={handleSave} loading={saving}>Reassign</Button>
        </>
      }
    >
      <div className="space-y-4">
        {currentUser && (
          <p className="text-sm text-gray-500">
            Currently assigned to: <span className="font-semibold text-gray-700">{currentUser.full_name}</span>
          </p>
        )}

        <div>
          <label className="block text-sm font-bold text-gray-800 mb-1.5">
            Assign to <span className="text-york-600">*</span>
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

        <Input
          label="Reason (optional)"
          type="textarea"
          placeholder="Why is this being reassigned?"
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
