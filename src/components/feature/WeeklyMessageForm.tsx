import React, { useEffect, useState } from 'react';
import { Modal } from '../foundation/Modal';
import { Button } from '../foundation/Button';
import { Input } from '../foundation/Input';
import { cn } from '../../lib/utils';
import { addDays } from '../../lib/queries/weeklyMessages';
import type { WeeklyMessage, WeeklyMessageInput, MessageScope, RecurrenceType } from '../../types';
import { Building2, Lock } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSave: (input: WeeklyMessageInput, id?: string) => Promise<void>;
  message?: WeeklyMessage | null;
  defaultScope?: MessageScope;
  defaultWeekStart?: string;
  canSetOrgScope: boolean;
  saving?: boolean;
}

function todayMonday(): string {
  const d = new Date();
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return d.toISOString().split('T')[0];
}

const EMPTY: WeeklyMessageInput = {
  scope: 'org',
  title: '',
  body: '',
  drive_link: '',
  week_start: todayMonday(),
  week_end: addDays(todayMonday(), 6),
  is_recurring: false,
  recurrence_type: 'weekly',
  recurrence_weeks: 4,
};

export const WeeklyMessageForm: React.FC<Props> = ({
  isOpen, onClose, onSave, message, defaultScope = 'org',
  defaultWeekStart, canSetOrgScope, saving = false,
}) => {
  const [form, setForm] = useState<WeeklyMessageInput>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isOpen) return;
    if (message) {
      setForm({
        scope: message.scope,
        title: message.title,
        body: message.body,
        drive_link: message.drive_link ?? '',
        week_start: message.week_start,
        week_end: message.week_end,
        is_recurring: message.is_recurring,
        recurrence_type: message.recurrence_type,
        recurrence_weeks: message.recurrence_weeks,
      });
    } else {
      const ws = defaultWeekStart ?? todayMonday();
      setForm({
        ...EMPTY,
        scope: defaultScope,
        week_start: ws,
        week_end: addDays(ws, 6),
      });
    }
    setErrors({});
  }, [isOpen, message, defaultScope, defaultWeekStart]);

  function set<K extends keyof WeeklyMessageInput>(key: K, value: WeeklyMessageInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleWeekStart(ws: string) {
    set('week_start', ws);
    set('week_end', addDays(ws, 6));
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.title.trim()) e.title = 'Title is required.';
    if (!form.body.trim()) e.body = 'Message body is required.';
    if (!form.week_start) e.week_start = 'Week start is required.';
    if (form.drive_link && !/^https?:\/\//i.test(form.drive_link)) {
      e.drive_link = 'Must be a valid URL starting with http(s)://';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    await onSave(
      { ...form, drive_link: form.drive_link?.trim() || undefined },
      message?.id,
    );
    onClose();
  }

  const isEditing = !!message;
  const weekLabel = `${form.week_start} → ${form.week_end}`;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? 'Edit Message' : 'New Message'}
      size="medium"
    >
      <form onSubmit={handleSubmit} className="space-y-4 p-1">
        {canSetOrgScope && (
          <div>
            <span className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">Audience</span>
            <div className="flex gap-3">
              {(['org', 'personal'] as MessageScope[]).map((s) => (
                <label
                  key={s}
                  className={cn(
                    'flex items-center gap-2 cursor-pointer px-4 py-2 rounded-md border text-sm font-medium transition-colors',
                    form.scope === s
                      ? 'border-york-600 bg-york-50 dark:bg-york-900/30 text-york-700 dark:text-york-300'
                      : 'border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-300 hover:border-gray-300',
                  )}
                >
                  <input
                    type="radio"
                    name="scope"
                    value={s}
                    checked={form.scope === s}
                    onChange={() => set('scope', s)}
                    className="sr-only"
                  />
                  {s === 'org' ? <><Building2 className="w-3.5 h-3.5 inline mr-1 -mt-0.5" aria-hidden="true" />Organization</> : <><Lock className="w-3.5 h-3.5 inline mr-1 -mt-0.5" aria-hidden="true" />Personal (only me)</>}
                </label>
              ))}
            </div>
          </div>
        )}

        <Input
          label="Title"
          value={form.title}
          onChange={(v) => set('title', v)}
          error={errors.title}
          required
          placeholder="e.g. Stay Grounded in Faith"
        />

        <Input
          label="Message"
          type="textarea"
          value={form.body}
          onChange={(v) => set('body', v)}
          error={errors.body}
          required
          rows={5}
          placeholder="Write the weekly message or devotional note..."
        />

        <Input
          label="Google Drive Link (optional)"
          value={form.drive_link ?? ''}
          onChange={(v) => set('drive_link', v)}
          error={errors.drive_link}
          placeholder="https://drive.google.com/..."
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Input
              label="Week Start (Monday)"
              type="date"
              value={form.week_start}
              onChange={handleWeekStart}
              error={errors.week_start}
              required
            />
            <p className="text-xs text-gray-400 dark:text-slate-400 mt-1">Week: {weekLabel}</p>
          </div>
          <Input
            label="Week End"
            type="date"
            value={form.week_end}
            onChange={(v) => set('week_end', v)}
          />
        </div>

        {!isEditing && (
          <div className="border border-gray-200 dark:border-slate-700 rounded-lg p-4 space-y-3">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={form.is_recurring}
                onChange={(e) => set('is_recurring', e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 dark:border-slate-600 text-york-600 dark:text-york-400"
              />
              <span className="text-sm font-medium text-gray-700 dark:text-slate-300">Bulk schedule (repeat this message)</span>
            </label>

            {form.is_recurring && (
              <div className="grid grid-cols-2 gap-3 pl-6">
                <div>
                  <span className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">Repeat every</span>
                  <div className="flex gap-2">
                    {(['weekly', 'biweekly'] as RecurrenceType[]).map((r) => (
                      <label
                        key={r}
                        className={cn(
                          'flex-1 text-center cursor-pointer px-3 py-1.5 rounded border text-xs font-medium transition-colors',
                          form.recurrence_type === r
                            ? 'border-york-600 bg-york-50 dark:bg-york-900/30 text-york-700 dark:text-york-300'
                            : 'border-gray-200 dark:border-slate-700 text-gray-500 dark:text-slate-400 hover:border-gray-300',
                        )}
                      >
                        <input
                          type="radio"
                          name="recurrence_type"
                          value={r}
                          checked={form.recurrence_type === r}
                          onChange={() => set('recurrence_type', r)}
                          className="sr-only"
                        />
                        {r === 'weekly' ? '1 week' : '2 weeks'}
                      </label>
                    ))}
                  </div>
                </div>
                <Input
                  label="For how many weeks"
                  type="number"
                  value={String(form.recurrence_weeks)}
                  onChange={(v) => set('recurrence_weeks', Math.max(2, Math.min(52, Number(v) || 4)))}
                />
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving}>
            {isEditing ? 'Save Changes' : form.is_recurring ? `Schedule ${form.recurrence_weeks} Weeks` : 'Add Message'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
