import React, { useState, useEffect } from 'react';
import { Leaf, Flame, Settings } from 'lucide-react';
import { Button } from '../components/foundation/Button';
import { Input } from '../components/foundation/Input';
import { Modal } from '../components/foundation/Modal';
import { Badge } from '../components/foundation/Badge';
import { HabitCard } from '../components/feature/HabitCard';
import { useHabits, useHabitAdmin } from '../hooks/useHabits';
import type { AuthUser } from '../lib/auth';
import type { HabitTemplate, HabitTemplateInput } from '../types';

interface Props { user: AuthUser | null; }

const EMOJI_PRESETS = ['📖', '🙏', '✍️', '🏃', '💪', '🧘', '🌅', '💧', '🥗', '📵', '🎵', '💝'];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const canAdmin = (role: string) => ['coordinator', 'admin'].includes(role);

function defaultInput(): HabitTemplateInput {
  return { name: '', description: '', icon: '✅', target_days: null };
}

function HabitTemplateFormModal({
  isOpen, onClose, onSave, template, saving,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSave: (input: HabitTemplateInput, id?: string) => Promise<void>;
  template?: HabitTemplate | null;
  saving: boolean;
}) {
  const [form, setForm] = useState<HabitTemplateInput>(defaultInput);
  const [useDays, setUseDays] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isOpen) return;
    if (template) {
      setForm({ name: template.name, description: template.description ?? '', icon: template.icon, target_days: template.target_days });
      setUseDays(template.target_days !== null);
    } else {
      setForm(defaultInput());
      setUseDays(false);
    }
    setErrors({});
  }, [isOpen, template]);

  function toggleDay(d: number) {
    setForm((f) => {
      const days = f.target_days ?? [];
      return {
        ...f,
        target_days: days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort(),
      };
    });
  }

  function handleUseDays(checked: boolean) {
    setUseDays(checked);
    setForm((f) => ({ ...f, target_days: checked ? [1, 2, 3, 4, 5] : null }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = 'Name is required.';
    if (!form.icon.trim()) errs.icon = 'Icon is required.';
    if (useDays && (!form.target_days || form.target_days.length === 0)) {
      errs.days = 'Select at least one day.';
    }
    if (Object.keys(errs).length) { setErrors(errs); return; }
    await onSave({ ...form, target_days: useDays ? form.target_days : null }, template?.id);
    onClose();
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={template ? 'Edit Habit' : 'New Habit'} size="small">
      <form onSubmit={handleSubmit} className="space-y-4 p-1">
        {/* Emoji picker */}
        <div>
          <span className="block text-sm font-medium text-gray-700 mb-2">Icon</span>
          <div className="flex flex-wrap gap-2">
            {EMOJI_PRESETS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => setForm((f) => ({ ...f, icon: emoji }))}
                className={`w-9 h-9 rounded-md text-xl flex items-center justify-center border-2 transition-colors ${
                  form.icon === emoji ? 'border-york-600 bg-red-50' : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                {emoji}
              </button>
            ))}
          </div>
          {errors.icon && <p className="text-xs text-red-600 mt-1">{errors.icon}</p>}
        </div>

        <Input
          label="Habit name"
          value={form.name}
          onChange={(v) => setForm((f) => ({ ...f, name: v }))}
          error={errors.name}
          required
          placeholder="e.g. Daily Bible Reading"
        />

        <Input
          label="Description (optional)"
          value={form.description ?? ''}
          onChange={(v) => setForm((f) => ({ ...f, description: v }))}
          placeholder="Short description of the habit"
        />

        {/* Target days */}
        <div className="space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={useDays}
              onChange={(e) => handleUseDays(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300"
            />
            <span className="text-sm font-medium text-gray-700">Specific days only (default: every day)</span>
          </label>
          {useDays && (
            <div className="flex gap-2 flex-wrap pl-6">
              {DAY_NAMES.map((name, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => toggleDay(i)}
                  className={`px-2.5 py-1 rounded text-xs font-semibold border transition-colors ${
                    form.target_days?.includes(i)
                      ? 'bg-york-600 text-white border-york-600'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>
          )}
          {errors.days && <p className="text-xs text-red-600 pl-6">{errors.days}</p>}
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving}>
            {template ? 'Save Changes' : 'Create Habit'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export const HabitTracker: React.FC<Props> = ({ user }) => {
  const [adminOpen, setAdminOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<HabitTemplate | null>(null);
  const [analyticsVisible, setAnalyticsVisible] = useState(false);

  const { habitsWithStats, loading, error, checkIn } = useHabits(user?.id);
  const admin = useHabitAdmin();

  const isAdmin = canAdmin(user?.role ?? 'member');

  const today = new Date().toLocaleDateString('en-CA', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  async function handleSaveTemplate(input: HabitTemplateInput, id?: string) {
    if (!user) return;
    await admin.saveTemplate(input, user.id, id);
  }

  async function handleAnalytics() {
    setAnalyticsVisible(true);
    await admin.loadAnalytics();
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Habit Tracker</h1>
          <p className="text-sm text-gray-500 mt-0.5">{today}</p>
        </div>
        {isAdmin && (
          <Button variant="secondary" onClick={() => setAdminOpen((v) => !v)}>
            <Settings className="w-4 h-4 mr-1.5 inline-block" />
            {adminOpen ? 'Hide Admin' : 'Manage Habits'}
          </Button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>
      )}

      {/* Today's habits grid */}
      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-48 bg-gray-100 rounded-lg animate-pulse" />
          ))}
        </div>
      )}

      {!loading && habitsWithStats.length === 0 && (
        <div className="text-center py-16 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg">
          <Leaf className="w-10 h-10 mx-auto mb-3 text-gray-300 dark:text-slate-600" />
          <p className="text-base font-semibold text-gray-700">No habits set up yet</p>
          <p className="text-sm text-gray-400 mt-1">
            {isAdmin
              ? 'Create habit templates below for members to track.'
              : 'A coordinator will set up habits for the group.'}
          </p>
          {isAdmin && (
            <div className="mt-4">
              <Button variant="primary" size="small" onClick={() => { setAdminOpen(true); setFormOpen(true); }}>
                Create First Habit
              </Button>
            </div>
          )}
        </div>
      )}

      {!loading && habitsWithStats.length > 0 && (
        <>
          {/* Summary row */}
          <div className="flex gap-4 flex-wrap">
            <div className="text-sm text-gray-500">
              <span className="font-bold text-gray-900">
                {habitsWithStats.filter((h) => h.today_status === 'done').length}
              </span>{' '}
              / {habitsWithStats.length} done today
            </div>
            {habitsWithStats.some((h) => h.streak >= 7) && (
              <div className="flex items-center gap-1.5 text-sm text-orange-600 font-semibold">
                <Flame className="w-4 h-4" />
                On a roll! {Math.max(...habitsWithStats.map((h) => h.streak))} day streak
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {habitsWithStats.map((h) => (
              <HabitCard key={h.template.id} habit={h} onCheckIn={checkIn} />
            ))}
          </div>
        </>
      )}

      {/* Admin panel */}
      {isAdmin && adminOpen && (
        <div className="border border-gray-200 dark:border-slate-700 rounded-lg overflow-hidden bg-white dark:bg-slate-800">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-700 bg-gray-50 dark:bg-slate-900">
            <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Habit Templates</h2>
            <Button variant="primary" size="small" onClick={() => { setEditingTemplate(null); setFormOpen(true); }}>
              + New Habit
            </Button>
          </div>

          {admin.loading && <div className="h-16 bg-gray-50 animate-pulse m-4 rounded" />}

          {!admin.loading && admin.templates.length === 0 && (
            <p className="text-sm text-gray-400 p-5">No habit templates yet.</p>
          )}

          {!admin.loading && admin.templates.length > 0 && (
            <div className="divide-y divide-gray-100">
              {admin.templates.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{t.icon}</span>
                    <div>
                      <span className="text-sm font-semibold text-gray-900">{t.name}</span>
                      {t.description && (
                        <p className="text-xs text-gray-400">{t.description}</p>
                      )}
                      <p className="text-xs text-gray-400 mt-0.5">
                        {t.target_days === null
                          ? 'Every day'
                          : t.target_days.map((d) => DAY_NAMES[d]).join(', ')}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={t.is_active ? 'success' : 'gray'} size="small">
                      {t.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                    <button
                      onClick={() => admin.toggleActive(t.id, !t.is_active)}
                      className="text-xs text-gray-400 hover:text-gray-700"
                    >
                      {t.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                    <button
                      onClick={() => { setEditingTemplate(t); setFormOpen(true); }}
                      className="p-1.5 rounded text-gray-400 hover:text-york-600 hover:bg-red-50"
                      title="Edit"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => window.confirm(`Delete "${t.name}"?`) && admin.removeTemplate(t.id)}
                      className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"
                      title="Delete"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {admin.error && (
            <p className="text-xs text-red-600 px-5 pb-3">{admin.error}</p>
          )}

          {/* Analytics */}
          <div className="border-t border-gray-100 px-5 py-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-700">Engagement Analytics</h3>
              <Button variant="ghost" size="small" onClick={handleAnalytics}>
                {admin.analyticsLoading ? 'Loading...' : 'Load Stats'}
              </Button>
            </div>
            {analyticsVisible && admin.analytics.length > 0 && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="text-gray-400 border-b border-gray-100">
                      <th className="pb-2 font-semibold">Habit</th>
                      <th className="pb-2 font-semibold text-right">Active Members</th>
                      <th className="pb-2 font-semibold text-right">Done Today</th>
                      <th className="pb-2 font-semibold text-right">7-Day Rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {admin.analytics.map((a) => (
                      <tr key={a.template_id}>
                        <td className="py-2">
                          <span className="mr-1.5">{a.icon}</span>
                          {a.habit_name}
                        </td>
                        <td className="py-2 text-right text-gray-600">{a.member_count}</td>
                        <td className="py-2 text-right text-gray-600">{a.done_today}</td>
                        <td className="py-2 text-right">
                          <span className={`font-semibold ${
                            a.completion_7d_avg >= 0.7 ? 'text-green-600'
                              : a.completion_7d_avg >= 0.4 ? 'text-amber-600'
                              : 'text-red-500'
                          }`}>
                            {Math.round(a.completion_7d_avg * 100)}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      <HabitTemplateFormModal
        isOpen={formOpen}
        onClose={() => { setFormOpen(false); setEditingTemplate(null); }}
        onSave={handleSaveTemplate}
        template={editingTemplate}
        saving={admin.saving}
      />
    </div>
  );
};
