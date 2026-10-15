import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { Modal } from '../foundation/Modal';
import { useTagsAndStatuses, useCells } from '../../hooks/useContacts';
import { createContact } from '../../lib/queries/contacts';
import { createMeeting } from '../../lib/queries/meetings';
import type { AuthUser } from '../../lib/auth';

const ROLE_LEVEL: Record<AuthUser['role'], number> = {
  member: 0, cell_leader: 1, admin: 2, coordinator: 3,
};

type Tab = 'contact' | 'meeting';

function today() {
  return new Date().toISOString().split('T')[0];
}

interface QuickAddContentProps {
  user: AuthUser;
  onClose: () => void;
}

const QuickAddContent: React.FC<QuickAddContentProps> = ({ user, onClose }) => {
  const level = ROLE_LEVEL[user.role] ?? 0;
  const canLogContact = level >= 1;

  const [tab, setTab] = useState<Tab>(canLogContact ? 'contact' : 'meeting');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const contactIdempotencyKey = useRef(makeIdempotencyKey());

  // Contact form state
  const [contactName, setContactName] = useState('');
  const [contactDate, setContactDate] = useState(today());
  const [contactTag, setContactTag] = useState('');
  const [contactCellId, setContactCellId] = useState('');

  // Meeting form state
  const [meetingTitle, setMeetingTitle] = useState('');
  const [meetingDate, setMeetingDate] = useState(today());
  const [meetingTime, setMeetingTime] = useState('10:00');
  const [meetingCategory, setMeetingCategory] = useState<'general' | 'bsc' | 'cell' | 'leadership'>('cell');
  const [meetingCellId, setMeetingCellId] = useState('');

  const { tags } = useTagsAndStatuses();
  const { cells } = useCells();

  const manageableCells = useMemo(() => {
    if (user.role === 'coordinator' || user.role === 'admin') return cells;
    if (user.role === 'cell_leader') return cells.filter((cell) => cell.leader_id === user.id);
    return [];
  }, [cells, user.id, user.role]);

  const selectedContactCellIsAllowed = manageableCells.some((cell) => cell.id === contactCellId);
  const selectedMeetingCellIsAllowed = manageableCells.some((cell) => cell.id === meetingCellId);
  const contactCellHelp =
    manageableCells.length === 0
      ? user.role === 'member'
        ? 'Your account is not authorized to log outreach contacts under the current contact permissions.'
        : 'No cells are available for your role. Ask a coordinator to assign you as the cell leader.'
      : null;

  useEffect(() => {
    if (!contactCellId || !selectedContactCellIsAllowed) {
      setContactCellId(manageableCells[0]?.id ?? '');
    }
  }, [contactCellId, manageableCells, selectedContactCellIsAllowed]);

  useEffect(() => {
    if (!meetingCellId || !selectedMeetingCellIsAllowed) {
      setMeetingCellId(manageableCells[0]?.id ?? '');
    }
  }, [manageableCells, meetingCellId, selectedMeetingCellIsAllowed]);

  const handleSuccess = () => {
    setSuccess(true);
    setTimeout(onClose, 1200);
  };

  const submitContact = async () => {
    if (!contactName.trim()) { setError('Contact name is required.'); return; }
    if (!contactCellId || !selectedContactCellIsAllowed) {
      setError(contactCellHelp ?? 'Select an authorized cell before logging this contact.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createContact({
        contact_name: contactName.trim(),
        cell_id: contactCellId,
        date_contacted: contactDate,
        tag: contactTag,
        follow_up_status: '',
        phone_hidden: false,
        is_member: false,
        logged_by: user.id,
        idempotency_key: contactIdempotencyKey.current,
      });
      contactIdempotencyKey.current = makeIdempotencyKey();
      handleSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save contact.');
    } finally {
      setSaving(false);
    }
  };

  const submitMeeting = async () => {
    if (!meetingTitle.trim()) { setError('Meeting title is required.'); return; }
    if (meetingCategory === 'cell' && (!meetingCellId || !selectedMeetingCellIsAllowed)) {
      setError('Select an authorized cell before scheduling a cell meeting.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createMeeting({
        title: meetingTitle.trim(),
        date: meetingDate,
        time: meetingTime,
        visibility: 'public',
        category: meetingCategory,
        cell_id: meetingCategory === 'cell' ? meetingCellId : undefined,
        created_by: user.id,
      });
      handleSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save meeting.');
    } finally {
      setSaving(false);
    }
  };

  if (success) {
    return (
      <div className="flex flex-col items-center justify-center py-10 gap-3">
        <div className="w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
          <Check className="w-8 h-8 text-emerald-600" />
        </div>
        <p className="text-sm font-semibold text-gray-700 dark:text-slate-200">Saved!</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Tabs */}
      {canLogContact && (
        <div className="flex rounded-xl bg-gray-100 dark:bg-slate-700 p-1 gap-1">
          {(['contact', 'meeting'] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => { setTab(t); setError(null); }}
              className={
                tab === t
                  ? 'flex-1 py-1.5 text-sm font-semibold rounded-lg bg-white dark:bg-slate-600 text-york-600 dark:text-york-300 shadow-sm'
                  : 'flex-1 py-1.5 text-sm font-medium rounded-lg text-gray-500 dark:text-slate-400 hover:text-gray-700'
              }
            >
              {t === 'contact' ? 'Log Contact' : 'Schedule Meeting'}
            </button>
          ))}
        </div>
      )}

      {error && (
        <p className="text-xs text-york-600 bg-york-50 dark:bg-york-900/20 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {/* Contact form */}
      {tab === 'contact' && canLogContact && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">
              Name <span className="text-york-600">*</span>
            </label>
            <input
              type="text"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder="Contact name"
              className="w-full rounded-xl border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-york-600"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">
              Date contacted
            </label>
            <input
              type="date"
              value={contactDate}
              onChange={(e) => setContactDate(e.target.value)}
              className="w-full rounded-xl border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-york-600"
            />
          </div>
          {tags.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">
                Tag
              </label>
              <select
                value={contactTag}
                onChange={(e) => setContactTag(e.target.value)}
                className="w-full rounded-xl border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-york-600"
              >
                <option value="">No tag</option>
                {tags.map((tag) => (
                  <option key={tag.id} value={tag.tag_name}>{tag.tag_name}</option>
                ))}
              </select>
            </div>
          )}
          <CellSelect
            label="Cell"
            value={contactCellId}
            onChange={setContactCellId}
            cells={manageableCells}
            helpText={contactCellHelp ?? undefined}
          />
          <button
            type="button"
            onClick={submitContact}
            disabled={saving || manageableCells.length === 0}
            className="w-full py-2.5 rounded-xl bg-york-600 text-white text-sm font-semibold hover:bg-york-700 disabled:opacity-60 transition-colors"
          >
            {saving ? 'Saving…' : 'Log Contact'}
          </button>
        </div>
      )}

      {/* Meeting form */}
      {tab === 'meeting' && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">
              Title <span className="text-york-600">*</span>
            </label>
            <input
              type="text"
              value={meetingTitle}
              onChange={(e) => setMeetingTitle(e.target.value)}
              placeholder="Meeting title"
              className="w-full rounded-xl border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-york-600"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Date</label>
              <input
                type="date"
                value={meetingDate}
                onChange={(e) => setMeetingDate(e.target.value)}
                className="w-full rounded-xl border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-york-600"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Time</label>
              <input
                type="time"
                value={meetingTime}
                onChange={(e) => setMeetingTime(e.target.value)}
                className="w-full rounded-xl border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-york-600"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Category</label>
            <select
              value={meetingCategory}
              onChange={(e) => { setMeetingCategory(e.target.value as typeof meetingCategory); setError(null); }}
              className="w-full rounded-xl border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-york-600"
            >
              <option value="cell">Cell</option>
              <option value="general">General</option>
              <option value="bsc">BSC</option>
              <option value="leadership">Leadership</option>
            </select>
          </div>
          {meetingCategory === 'cell' && (
            <CellSelect
              label="Cell"
              value={meetingCellId}
              onChange={setMeetingCellId}
              cells={manageableCells}
              helpText={
                manageableCells.length === 0
                  ? 'No cells are available for your role. Select a non-cell meeting category or ask a coordinator to update assignments.'
                  : undefined
              }
            />
          )}
          <button
            type="button"
            onClick={submitMeeting}
            disabled={saving || (meetingCategory === 'cell' && manageableCells.length === 0)}
            className="w-full py-2.5 rounded-xl bg-york-600 text-white text-sm font-semibold hover:bg-york-700 disabled:opacity-60 transition-colors"
          >
            {saving ? 'Saving…' : 'Schedule Meeting'}
          </button>
        </div>
      )}
    </div>
  );
};

function makeIdempotencyKey() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const CellSelect: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  cells: Array<{ id: string; name: string }>;
  helpText?: string;
}> = ({ label, value, onChange, cells, helpText }) => (
  <div>
    <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">
      {label} <span className="text-york-600">*</span>
    </label>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={cells.length === 0}
      className="w-full rounded-xl border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-york-600 disabled:opacity-60"
      aria-describedby={helpText ? `${label.toLowerCase()}-cell-help` : undefined}
    >
      {cells.length === 0 ? (
        <option value="">No authorized cells</option>
      ) : (
        cells.map((cell) => (
          <option key={cell.id} value={cell.id}>{cell.name}</option>
        ))
      )}
    </select>
    {helpText && (
      <p id={`${label.toLowerCase()}-cell-help`} className="mt-1 text-xs text-gray-500 dark:text-slate-400">
        {helpText}
      </p>
    )}
  </div>
);

export interface QuickAddModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: AuthUser | null;
}

export const QuickAddModal: React.FC<QuickAddModalProps> = ({ isOpen, onClose, user }) => (
  <Modal isOpen={isOpen} onClose={onClose} title="Quick Add" size="small">
    {user ? (
      <QuickAddContent user={user} onClose={onClose} />
    ) : null}
  </Modal>
);
