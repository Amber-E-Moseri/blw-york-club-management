import React, { useState } from 'react';
import { BookOpen } from 'lucide-react';
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Daily Confessions</h1>
          <p className="text-sm text-gray-500 mt-0.5">Declare God's word over your life</p>
        </div>
        {isManager && (
          <Button variant="primary" onClick={() => setAddOpen(true)}>+ New Confession</Button>
        )}
      </div>

      {/* Date navigation */}
      <div className="flex items-center gap-3">
        <button
          className="w-8 h-8 flex items-center justify-center rounded-full border border-gray-200 hover:bg-gray-50 text-gray-500"
          onClick={() => {
            const d = new Date(viewDate);
            d.setDate(d.getDate() - 1);
            setViewDate(d.toISOString().split('T')[0]);
          }}
        >‹</button>
        <Input
          type="date"
          value={viewDate}
          onChange={setViewDate}
          className="max-w-[160px]"
        />
        <button
          className="w-8 h-8 flex items-center justify-center rounded-full border border-gray-200 hover:bg-gray-50 text-gray-500"
          onClick={() => {
            const d = new Date(viewDate);
            d.setDate(d.getDate() + 1);
            setViewDate(d.toISOString().split('T')[0]);
          }}
        >›</button>
        {viewDate !== today && (
          <Button variant="ghost" size="small" onClick={() => setViewDate(today)}>Today</Button>
        )}
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

      {!loading && confessions.map((c) => (
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
