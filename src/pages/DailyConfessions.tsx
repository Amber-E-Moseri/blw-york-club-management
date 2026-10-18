import React, { useState } from 'react';
import { BookOpen, ChevronLeft, ChevronRight } from 'lucide-react';
import { ConfessionCard } from '../components/feature/ConfessionCard';
import { Button } from '../components/foundation/Button';
import { Input } from '../components/foundation/Input';
import { Modal } from '../components/foundation/Modal';
import { useConfessions } from '../hooks/useConfessions';
import type { AuthUser } from '../lib/auth';

interface Props { user: AuthUser | null; }

const canManage = (role: string) => ['coordinator', 'admin'].includes(role);

export const DailyConfessions: React.FC<Props> = ({ user }) => {
  const today = new Date().toISOString().split('T')[0];
  const [viewDate, setViewDate] = useState(today);
  const { confessions, loading, error, declare, undeclare, add, remove } = useConfessions(viewDate);

  const [addOpen, setAddOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [newDate, setNewDate] = useState(today);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const isManager = canManage(user?.role ?? 'member');

  const handleAdd = async () => {
    if (!newTitle.trim() || !newBody.trim() || !user) return;
    setFormError('');
    setSaving(true);
    try {
      await add({ title: newTitle.trim(), body: newBody.trim(), scheduled_date: newDate, created_by: user.id });
      setAddOpen(false);
      setNewTitle('');
      setNewBody('');
      setNewDate(today);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Header */}
      <div>
        <p className="text-[11px] font-bold text-york-600 uppercase tracking-wider">Growth</p>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100 mt-1">Daily confessions</h1>
        <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">Declare God's word over your life.</p>
      </div>
      {isManager && (
        <Button variant="primary" fullWidth onClick={() => setAddOpen(true)}>+ New confession</Button>
      )}

      {/* Date navigation */}
      <div className="flex items-center gap-3 rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm px-3 py-2.5">
        <button
          type="button"
          aria-label="Previous day"
          className="w-10 h-10 shrink-0 flex items-center justify-center rounded-xl border border-gray-200 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-700 text-gray-600 dark:text-slate-300"
          onClick={() => {
            const d = new Date(viewDate);
            d.setDate(d.getDate() - 1);
            setViewDate(d.toISOString().split('T')[0]);
          }}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        {/* The whole date label opens the native date picker */}
        <label className="relative flex-1 min-w-0 text-center cursor-pointer">
          <span className="block text-sm font-semibold text-gray-900 dark:text-slate-100">
            {new Date(`${viewDate}T00:00:00`).toLocaleDateString('en-CA', { weekday: 'long', month: 'short', day: 'numeric' })}
          </span>
          <span className="block text-xs text-gray-500 dark:text-slate-400">
            {viewDate === today ? 'Today' : (
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); setViewDate(today); }}
                className="font-semibold text-york-600 dark:text-york-300"
              >
                Back to today
              </button>
            )}
          </span>
          <input
            type="date"
            aria-label="Choose date"
            value={viewDate}
            onChange={(e) => setViewDate(e.target.value)}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
        </label>

        <button
          type="button"
          aria-label="Next day"
          className="w-10 h-10 shrink-0 flex items-center justify-center rounded-xl border border-gray-200 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-700 text-gray-600 dark:text-slate-300"
          onClick={() => {
            const d = new Date(viewDate);
            d.setDate(d.getDate() + 1);
            setViewDate(d.toISOString().split('T')[0]);
          }}
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>
      )}

      {loading && (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-32 bg-gray-100 rounded-lg animate-pulse" />
          ))}
        </div>
      )}

      {!loading && confessions.length === 0 && (
        <div className="text-center py-16 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg">
          <BookOpen className="w-10 h-10 mx-auto mb-3 text-gray-300 dark:text-slate-600" />
          <p className="text-base font-semibold text-gray-700">No confessions for this day</p>
          {isManager && (
            <p className="text-sm text-gray-400 mt-1">
              Add confessions using the button above.
            </p>
          )}
        </div>
      )}

      {!loading && confessions.length > 0 && (
        <div className="space-y-3">
          {confessions.map((c) => (
            <ConfessionCard
              key={c.id}
              confession={c}
              userId={user?.id}
              onDeclare={(id) => user && declare(id, user.id)}
              onUndeclare={(id) => user && undeclare(id, user.id)}
              canDelete={isManager}
              onDelete={remove}
            />
          ))}
        </div>
      )}

      {/* Add modal */}
      <Modal
        isOpen={addOpen}
        onClose={() => setAddOpen(false)}
        title="New Confession"
        subtitle="Schedule a confession for a specific day"
        size="medium"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={handleAdd}>Save</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Title"
            placeholder="e.g. God is my provider"
            value={newTitle}
            onChange={setNewTitle}
            required
            maxLength={100}
          />
          <Input
            label="Confession Text"
            type="textarea"
            placeholder="Write the full declaration…"
            value={newBody}
            onChange={setNewBody}
            required
            rows={5}
          />
          <Input
            label="Scheduled Date"
            type="date"
            value={newDate}
            onChange={setNewDate}
            required
          />
          {formError && <p className="text-sm text-red-600">⚠️ {formError}</p>}
        </div>
      </Modal>
    </div>
  );
};
