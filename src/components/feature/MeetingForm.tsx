import React, { useState, useEffect } from 'react';
import { Modal } from '../foundation/Modal';
import { Button } from '../foundation/Button';
import { Input } from '../foundation/Input';
import type { Meeting, MeetingInput, MeetingVisibility, MeetingCategory } from '../../types';
import { Building2, BookOpen, Star, Users, type LucideIcon } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSave: (input: MeetingInput, id?: string) => Promise<void>;
  meeting?: Meeting | null;
}

const CATEGORIES: { value: MeetingCategory; label: string; desc: string; icon: LucideIcon; defaultVis: MeetingVisibility }[] = [
  {
    value: 'general',
    label: 'General',
    desc: 'Org-wide meeting — all members can see and attend',
    icon: Building2,
    defaultVis: 'public',
  },
  {
    value: 'bsc',
    label: 'BSC',
    desc: 'Bible Study Cell — cell-level study, open to view by all',
    icon: BookOpen,
    defaultVis: 'public',
  },
  {
    value: 'cell',
    label: 'Cell Meeting',
    desc: 'Your cell only — only cell members can see this',
    icon: Users,
    defaultVis: 'cell',
  },
  {
    value: 'leadership',
    label: 'Leadership',
    desc: 'Leadership meeting — leaders only by default',
    icon: Star,
    defaultVis: 'leaders',
  },
];

const VISIBILITY_OPTIONS: { value: MeetingVisibility; label: string; desc: string }[] = [
  { value: 'public', label: 'All members', desc: 'Every active member can see it once it is published' },
  { value: 'leaders', label: 'Leaders only', desc: 'Cell leaders, admins and coordinators' },
  { value: 'cell', label: 'Cell members', desc: 'Members of the cell this meeting belongs to' },
  { value: 'explicit', label: 'Invite only', desc: 'Only the people you invite can see it. Invite them from the Invitations panel.' },
];

const EMPTY: MeetingInput = {
  title: '',
  description: '',
  date: new Date().toISOString().split('T')[0],
  time: '18:00',
  end_time: '',
  location: '',
  zoom_link: '',
  visibility: 'public',
  category: 'general',
  allow_join_requests: false,
  draft: false,
};

type Errors = Partial<Record<keyof MeetingInput, string>>;

export const MeetingForm: React.FC<Props> = ({ isOpen, onClose, onSave, meeting }) => {
  const [form, setForm] = useState<MeetingInput>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (meeting) {
      setForm({
        title: meeting.title,
        description: meeting.description ?? '',
        date: meeting.date,
        time: meeting.time,
        end_time: meeting.end_time ?? '',
        location: meeting.location ?? '',
        zoom_link: meeting.zoom_link ?? '',
        visibility: meeting.visibility,
        category: meeting.category ?? 'general',
        cell_id: meeting.cell_id,
        allow_join_requests: meeting.allow_join_requests ?? false,
      });
    } else {
      setForm(EMPTY);
    }
    setErrors({});
  }, [meeting, isOpen]);

  const set = <K extends keyof MeetingInput>(k: K, v: MeetingInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const selectCategory = (cat: MeetingCategory) => {
    const cfg = CATEGORIES.find((c) => c.value === cat)!;
    setForm((f) => ({ ...f, category: cat, visibility: cfg.defaultVis }));
  };

  const validate = (): boolean => {
    const e: Errors = {};
    if (!form.title.trim()) e.title = 'Title is required.';
    if (!form.date) e.date = 'Date is required.';
    if (!form.time) e.time = 'Time is required.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      await onSave(form, meeting?.id);
      onClose();
    } catch (e) {
      setErrors({ title: e instanceof Error ? e.message : 'Save failed.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={meeting ? 'Edit Meeting' : 'Create Meeting'}
      size="medium"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={handleSave}>
            {meeting ? 'Save Changes' : 'Create Meeting'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">

        {/* Category */}
        <div>
          <label className="block text-sm font-bold text-gray-800 dark:text-slate-200 mb-2">Meeting Type</label>
          <div className="grid grid-cols-2 gap-2">
            {CATEGORIES.map((c) => (
              <label
                key={c.value}
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  form.category === c.value
                    ? 'border-york-600 bg-york-50 dark:bg-york-900/30'
                    : 'border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800'
                }`}
              >
                <input
                  type="radio"
                  name="meeting-cat"
                  value={c.value}
                  checked={form.category === c.value}
                  onChange={() => selectCategory(c.value)}
                  className="mt-0.5 text-york-600 dark:text-york-400 focus:ring-york-600"
                />
                <div>
                  <p className="text-sm font-semibold text-gray-800 dark:text-slate-200">
                    <c.icon className="w-4 h-4 inline mr-1.5 -mt-0.5" aria-hidden="true" />{c.label}
                  </p>
                  <p className="text-xs text-gray-400 leading-snug mt-0.5">{c.desc}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Who can see it */}
        <div>
          <label className="block text-sm font-bold text-gray-800 mb-2">Who can see it</label>
          <div className="grid grid-cols-2 gap-2">
            {VISIBILITY_OPTIONS.map((v) => (
              <label
                key={v.value}
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  form.visibility === v.value ? 'border-york-600 bg-red-50' : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                <input
                  type="radio"
                  name="meeting-visibility"
                  value={v.value}
                  checked={form.visibility === v.value}
                  onChange={() => set('visibility', v.value)}
                  className="mt-0.5 text-york-600 focus:ring-york-600"
                />
                <div>
                  <p className="text-sm font-semibold text-gray-800">{v.label}</p>
                  <p className="text-xs text-gray-400 leading-snug mt-0.5">{v.desc}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {!meeting && (
          <label className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 bg-gray-50 cursor-pointer">
            <input
              type="checkbox"
              checked={form.draft ?? false}
              onChange={(e) => set('draft', e.target.checked)}
              className="rounded text-york-600 focus:ring-york-600"
            />
            <div>
              <p className="text-sm font-semibold text-gray-800">Save as draft</p>
              <p className="text-xs text-gray-400">Only you can see a draft. Publish it after you have reviewed the invitations.</p>
            </div>
          </label>
        )}

        {/* Leadership: join request toggle */}
        {form.category === 'leadership' && (
          <label className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900 cursor-pointer">
            <input
              type="checkbox"
              checked={form.allow_join_requests ?? false}
              onChange={(e) => set('allow_join_requests', e.target.checked)}
              className="rounded text-york-600 dark:text-york-400 focus:ring-york-600"
            />
            <div>
              <p className="text-sm font-semibold text-gray-800 dark:text-slate-200">Allow others to request to join</p>
              <p className="text-xs text-gray-400">Non-leaders will see this meeting and can request access</p>
            </div>
          </label>
        )}

        <Input
          label="Meeting Title"
          placeholder="e.g. Cell Meeting – October"
          value={form.title}
          onChange={(v) => set('title', v)}
          error={errors.title}
          required
          maxLength={100}
        />

        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <Input label="Date" type="date" value={form.date} onChange={(v) => set('date', v)} error={errors.date} required />
          </div>
          <Input label="Start Time" type="time" value={form.time} onChange={(v) => set('time', v)} error={errors.time} required />
        </div>

        <Input
          label="End Time"
          type="time"
          value={form.end_time ?? ''}
          onChange={(v) => set('end_time', v)}
          helpText="Optional"
        />

        <Input
          label="Location"
          placeholder="e.g. Room 201, York Lanes"
          value={form.location ?? ''}
          onChange={(v) => set('location', v)}
        />

        <Input
          label="Zoom / Meeting Link"
          placeholder="https://zoom.us/j/..."
          value={form.zoom_link ?? ''}
          onChange={(v) => set('zoom_link', v)}
          helpText="Optional. Shared with attendees."
        />

        <Input
          label="Description"
          type="textarea"
          placeholder="What's happening at this meeting?"
          value={form.description ?? ''}
          onChange={(v) => set('description', v)}
          maxLength={500}
        />
      </div>
    </Modal>
  );
};
