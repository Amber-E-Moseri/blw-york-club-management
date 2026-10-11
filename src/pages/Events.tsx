import React, { useState } from 'react';
import { Calendar, Plus } from 'lucide-react';
import { EventCard } from '../components/feature';
import { useAllEvents } from '../hooks/useEvents';
import { createEvent } from '../lib/queries';
import { Button, Input, Modal } from '../components/foundation';
import type { AuthUser } from '../lib/auth';
import type { EventCategory } from '../types';

const CATEGORIES: EventCategory[] = ['Bible Study', 'Worship', 'Fellowship', 'Outreach', 'Prayer', 'Other'];

interface Props { user: AuthUser | null; }

export const Events: React.FC<Props> = ({ user }) => {
  const { events, loading, error, refetch } = useAllEvents();
  const [filter, setFilter] = useState<EventCategory | 'All'>('All');
  const [formOpen, setFormOpen] = useState(false);

  const todayStr = new Date().toISOString().split('T')[0];
  const upcomingCount = events.filter((e) => e.date >= todayStr).length;
  const filtered = filter === 'All' ? events : events.filter((e) => e.category === filter);
  const canCreate = user?.role === 'coordinator' || user?.role === 'admin';

  return (
    <div className="space-y-5 pb-4">
      {/* Header */}
      <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl shadow-sm overflow-hidden">
        <div className="border-t-4 border-york-600 px-5 py-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold text-york-600 uppercase tracking-wider">Calendar</p>
            <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100 mt-1">Events & services</h1>
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
              Everything the community needs to know, in one rhythm.
            </p>
          </div>
          {canCreate && (
            <Button
              type="button"
              variant="primary"
              size="small"
              icon={<Plus className="w-4 h-4" />}
              onClick={() => setFormOpen(true)}
            >
              Add Event
            </Button>
          )}
        </div>
      </div>

      {/* Stats strip */}
      {!loading && (
        <div className="grid grid-cols-2 gap-3">
          <StatChip label="Upcoming" value={upcomingCount} />
          <StatChip label="Total events" value={events.length} />
        </div>
      )}

      {/* Category filter pills */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
        {(['All', ...CATEGORIES] as const).map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setFilter(cat)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
              filter === cat
                ? 'bg-york-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-xl border border-york-200 bg-york-50 p-4 text-sm text-york-700">
          {error}
        </div>
      )}

      {/* Event list */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-20 bg-gray-100 dark:bg-slate-800 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 bg-white border border-gray-200 rounded-2xl dark:bg-slate-800 dark:border-slate-700">
          <Calendar className="w-10 h-10 mx-auto mb-3 text-gray-300 dark:text-slate-600" />
          <p className="text-base font-semibold text-gray-700 dark:text-slate-300">No events found</p>
          {filter !== 'All' && (
            <button
              type="button"
              onClick={() => setFilter('All')}
              className="mt-3 text-sm text-york-600 hover:text-york-700 font-medium"
            >
              Clear filter
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl shadow-sm overflow-hidden">
          <div className="divide-y divide-gray-100 dark:divide-slate-700">
            {filtered.map((e) => <EventCard key={e.id} event={e} />)}
          </div>
        </div>
      )}

      {canCreate && user && (
        <EventFormModal
          isOpen={formOpen}
          onClose={() => setFormOpen(false)}
          userId={user.id}
          onSaved={() => {
            setFormOpen(false);
            refetch();
          }}
        />
      )}
    </div>
  );
};

const StatChip: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl shadow-sm px-4 py-3">
    <p className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider">{label}</p>
    <p className="text-2xl font-bold text-gray-900 dark:text-slate-100 mt-0.5">{value}</p>
  </div>
);

const EventFormModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  onSaved: () => void;
}> = ({ isOpen, onClose, userId, onSaved }) => {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [time, setTime] = useState('');
  const [location, setLocation] = useState('');
  const [category, setCategory] = useState<EventCategory>('Other');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const reset = () => {
    setTitle('');
    setDate(new Date().toISOString().split('T')[0]);
    setTime('');
    setLocation('');
    setCategory('Other');
    setDescription('');
    setError(null);
    setFieldErrors({});
  };

  const close = () => {
    if (saving) return;
    reset();
    onClose();
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (title.trim().length < 2) nextErrors['title'] = 'Title must be at least 2 characters.';
    if (!date) nextErrors['date'] = 'Date is required.';
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSaving(true);
    setError(null);
    try {
      await createEvent({
        title: title.trim(),
        date,
        time: time || undefined,
        location: location.trim() || undefined,
        description: description.trim() || undefined,
        category,
        created_by: userId,
      });
      reset();
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create event.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={close} title="Add Event" size="medium">
      <form onSubmit={save} className="space-y-4">
        {error && (
          <div className="rounded-lg border border-york-200 bg-york-50 px-3 py-2 text-sm text-york-700">
            {error}
          </div>
        )}

        <Input label="Title" value={title} onChange={setTitle} error={fieldErrors['title']} required />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="Date" type="date" value={date} onChange={setDate} error={fieldErrors['date']} required />
          <Input label="Time" type="time" value={time} onChange={setTime} />
        </div>

        <Input label="Location" value={location} onChange={setLocation} />

        <div>
          <label className="block text-sm font-bold text-gray-800 mb-1.5" htmlFor="event-category">
            Category
          </label>
          <select
            id="event-category"
            value={category}
            onChange={(e) => setCategory(e.target.value as EventCategory)}
            className="w-full rounded-md border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-york-600 focus:border-york-600 dark:bg-slate-900 dark:text-slate-100"
          >
            {CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>

        <Input
          label="Description"
          type="textarea"
          value={description}
          onChange={setDescription}
          rows={4}
        />

        <div className="flex flex-col sm:flex-row gap-2 pt-2">
          <Button type="submit" loading={saving} disabled={saving} fullWidth>
            Save Event
          </Button>
          <Button type="button" variant="secondary" onClick={close} disabled={saving} fullWidth>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
};
