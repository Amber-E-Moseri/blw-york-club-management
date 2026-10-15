import React, { useState, useEffect } from 'react';
import { Modal } from '../foundation/Modal';
import { Button } from '../foundation/Button';
import { Input } from '../foundation/Input';
import { Tag } from '../foundation/Tag';
import type { Contact, ContactInput, ContactTag, ContactStatus } from '../../types';

interface AssignableUser { id: string; email: string; full_name: string; }

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSave: (input: ContactInput, id?: string) => Promise<void>;
  contact?: Contact | null;
  tags: ContactTag[];
  statuses: ContactStatus[];
  users?: AssignableUser[];
  cellId: string;
}

const EMPTY: ContactInput = {
  cell_id: '',
  contact_name: '',
  contact_phone: '',
  phone_hidden: false,
  tag: '',
  follow_up_status: '',
  date_contacted: new Date().toISOString().split('T')[0],
  notes: '',
  is_member: false,
};

type Errors = Partial<Record<keyof ContactInput, string>>;

function validate(form: ContactInput): Errors {
  const e: Errors = {};
  if (!form.contact_name.trim() || form.contact_name.trim().length < 2)
    e.contact_name = 'Name must be at least 2 characters.';
  if (!form.tag)
    e.tag = 'Please select a tag.';
  if (!form.follow_up_status)
    e.follow_up_status = 'Please select a status.';
  if (!form.date_contacted)
    e.date_contacted = 'Date is required.';
  else if (form.date_contacted > new Date().toISOString().split('T')[0])
    e.date_contacted = 'Date cannot be in the future.';
  if (form.contact_phone) {
    const clean = form.contact_phone.replace(/\D/g, '');
    if (clean.length < 10) e.contact_phone = 'Enter a valid phone number (min 10 digits).';
  }
  return e;
}

export const ContactForm: React.FC<Props> = ({
  isOpen, onClose, onSave, contact, tags, statuses, users = [], cellId,
}) => {
  const [form, setForm] = useState<ContactInput>({ ...EMPTY, cell_id: cellId });
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (contact) {
      setForm({
        cell_id: contact.cell_id,
        contact_name: contact.contact_name,
        contact_phone: contact.contact_phone ?? '',
        phone_hidden: contact.phone_hidden,
        email: contact.email ?? '',
        tag: contact.tag,
        follow_up_status: contact.follow_up_status,
        follow_up_assignee: contact.follow_up_assignee ?? '',
        date_contacted: contact.date_contacted,
        notes: contact.notes ?? '',
        is_member: contact.is_member,
      });
    } else {
      setForm({ ...EMPTY, cell_id: cellId });
    }
    setErrors({});
  }, [contact, cellId, isOpen]);

  const set = (key: keyof ContactInput, value: string | boolean) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSave = async () => {
    const e = validate(form);
    if (Object.keys(e).length) { setErrors(e); return; }
    setSaveError(null);
    setSaving(true);
    try {
      await onSave(form, contact?.id);
      onClose();
    } catch (err) {
      // Keep the dialog open and say what went wrong. A silent close looks like a successful save.
      setSaveError(err instanceof Error && err.message ? err.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  const selectedTag = tags.find((t) => t.tag_name === form.tag);
  const selectedStatus = statuses.find((s) => s.status_name === form.follow_up_status);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={contact ? 'Edit Contact' : 'Add New Contact'}
      subtitle="Outreach CRM — Contact Log"
      size="medium"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={handleSave} loading={saving}>
            {contact ? 'Save Changes' : 'Add Contact'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {saveError && (
          <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            Could not save contact: {saveError}
          </p>
        )}
        {/* Name */}
        <Input
          label="Contact Name"
          placeholder="Full name"
          value={form.contact_name}
          onChange={(v) => set('contact_name', v)}
          error={errors.contact_name}
          required
          maxLength={100}
        />

        {/* Phone */}
        <div>
          <Input
            label="Phone Number"
            type="tel"
            placeholder="+1 (416) 555-0100"
            value={form.contact_phone ?? ''}
            onChange={(v) => set('contact_phone', v)}
            error={errors.contact_phone}
            helpText="Optional. Used for follow-up."
          />
          <label className="inline-flex items-center gap-2 mt-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.phone_hidden}
              onChange={(e) => set('phone_hidden', e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-york-600 focus:ring-york-600"
            />
            <span className="text-sm text-gray-600">Hide phone from other members</span>
          </label>
        </div>

        <Input
          label="Email"
          type="email"
          placeholder="name@example.com"
          value={form.email ?? ''}
          onChange={(v) => set('email', v)}
          helpText="Optional. Useful when follow-up happens by email."
        />

        <div className="grid grid-cols-2 gap-4">
          {/* Tag */}
          <div>
            <label className="block text-sm font-bold text-gray-800 mb-1.5">
              Tag <span className="text-york-600">*</span>
            </label>
            <select
              className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-york-600"
              value={form.tag}
              onChange={(e) => set('tag', e.target.value)}
            >
              <option value="">Select tag…</option>
              {tags.map((t) => (
                <option key={t.id} value={t.tag_name}>{t.tag_name}</option>
              ))}
            </select>
            {errors.tag && <p className="text-xs text-red-600 mt-1">⚠️ {errors.tag}</p>}
            {selectedTag && (
              <div className="mt-2">
                <Tag color={selectedTag.color} variant="light">{selectedTag.tag_name}</Tag>
              </div>
            )}
          </div>

          {/* Status */}
          <div>
            <label className="block text-sm font-bold text-gray-800 mb-1.5">
              Follow-up Status <span className="text-york-600">*</span>
            </label>
            <select
              className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-york-600"
              value={form.follow_up_status}
              onChange={(e) => set('follow_up_status', e.target.value)}
            >
              <option value="">Select status…</option>
              {statuses.map((s) => (
                <option key={s.id} value={s.status_name}>{s.status_name}</option>
              ))}
            </select>
            {errors.follow_up_status && (
              <p className="text-xs text-red-600 mt-1">⚠️ {errors.follow_up_status}</p>
            )}
            {selectedStatus && (
              <div className="mt-2">
                <Tag color={selectedStatus.color} variant="light">{selectedStatus.status_name}</Tag>
              </div>
            )}
          </div>
        </div>

        {users.length > 0 && (
          <div>
            <label className="block text-sm font-bold text-gray-800 mb-1.5">
              Follow-up Assignee
            </label>
            <select
              className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-york-600"
              value={form.follow_up_assignee ?? ''}
              onChange={(e) => set('follow_up_assignee', e.target.value)}
            >
              <option value="">Unassigned</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
              ))}
            </select>
          </div>
        )}

        {/* Date contacted */}
        <Input
          label="Date Contacted"
          type="date"
          value={form.date_contacted}
          onChange={(v) => set('date_contacted', v)}
          error={errors.date_contacted}
          required
        />

        {/* Notes */}
        <Input
          label="Notes"
          type="textarea"
          placeholder="Any relevant notes about this contact…"
          value={form.notes ?? ''}
          onChange={(v) => set('notes', v)}
          maxLength={500}
          helpText="Optional. Max 500 characters."
        />

        {/* Is member */}
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={form.is_member}
            onChange={(e) => set('is_member', e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 text-york-600 focus:ring-york-600"
          />
          <span className="text-sm text-gray-700 font-medium">
            This person is already a cell member
          </span>
        </label>
      </div>
    </Modal>
  );
};
