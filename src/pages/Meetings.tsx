import React, { useState } from 'react';
import { LayoutList, Building2, BookOpen, Users, Star, Calendar, Plus, type LucideIcon } from 'lucide-react';
import { Button } from '../components/foundation/Button';
import { MeetingCard } from '../components/feature/MeetingCard';
import { MeetingForm } from '../components/feature/MeetingForm';
import { useMeetings } from '../hooks/useMeetings';
import type { AuthUser } from '../lib/auth';
import type { Meeting, MeetingInput, MeetingCategory } from '../types';

interface Props { user: AuthUser | null; }

const canManage = (role: string) => ['coordinator', 'admin', 'cell_leader'].includes(role);

const CATEGORY_TABS: { value: MeetingCategory | 'all'; label: string; icon: LucideIcon }[] = [
  { value: 'all',        label: 'All',        icon: LayoutList },
  { value: 'general',   label: 'General',    icon: Building2 },
  { value: 'bsc',       label: 'BSC',        icon: BookOpen },
  { value: 'cell',      label: 'Cell',       icon: Users },
  { value: 'leadership',label: 'Leadership', icon: Star },
];

export const Meetings: React.FC<Props> = ({ user }) => {
  const [showPast, setShowPast] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Meeting | null>(null);
  const [activeTab, setActiveTab] = useState<MeetingCategory | 'all'>('all');

  const { meetings, loading, error, save, remove, confirm, cancel } = useMeetings(!showPast);

  const isManager = canManage(user?.role ?? 'member');
  const isLeader = ['coordinator', 'admin', 'cell_leader'].includes(user?.role ?? '');

  const handleEdit = (m: Meeting) => { setEditing(m); setFormOpen(true); };
  const handleAdd  = () => { setEditing(null); setFormOpen(true); };

  const handleSave = async (input: MeetingInput, id?: string) => {
    if (!user) return;
    await save({ ...input, created_by: user.id }, id);
  };

  const handleConfirm = async (meetingId: string) => {
    if (!user) return;
    await confirm(meetingId, user.id, user.name);
  };

  const handleCancel = async (meetingId: string) => {
    if (!user) return;
    await cancel(meetingId, user.id);
  };

  // Filter by category; also hide leadership from non-leaders unless allow_join_requests
  const filtered = meetings.filter((m) => {
    const cat = m.category ?? 'general';
    if (cat === 'leadership' && !isLeader && !m.allow_join_requests) return false;
    if (activeTab !== 'all' && cat !== activeTab) return false;
    return true;
  });

  // Group by month
  const grouped = filtered.reduce<Record<string, Meeting[]>>((acc, m) => {
    const key = m.date.slice(0, 7);
    if (!acc[key]) acc[key] = [];
    acc[key].push(m);
    return acc;
  }, {});

  const monthLabel = (ym: string) =>
    new Date(ym + '-01').toLocaleDateString('en-CA', { month: 'long', year: 'numeric' });

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Meetings</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">Confirm your attendance and stay connected</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="small"
            onClick={() => setShowPast((v) => !v)}
          >
            {showPast ? 'Upcoming' : 'Past Meetings'}
          </Button>
          {isManager && (
            <Button variant="primary" onClick={handleAdd}>
              <Plus className="w-4 h-4 mr-1" aria-hidden="true" />New Meeting
            </Button>
          )}
        </div>
      </div>

      {/* Category tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-hide">
        {CATEGORY_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setActiveTab(tab.value)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
              activeTab === tab.value
                ? 'bg-york-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600'
            }`}
          >
            <tab.icon className="w-3.5 h-3.5 shrink-0" />
            {tab.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>
      )}

      {loading && (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-40 bg-gray-100 rounded-lg animate-pulse" />
          ))}
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="text-center py-16 bg-white border border-gray-200 rounded-lg dark:bg-slate-800 dark:border-slate-700">
          <Calendar className="w-10 h-10 mx-auto mb-3 text-gray-300 dark:text-slate-600" />
          <p className="text-base font-semibold text-gray-700 dark:text-slate-300">
            No {showPast ? 'past' : 'upcoming'} meetings
            {activeTab !== 'all' ? ` in ${activeTab}` : ''}
          </p>
          {!showPast && isManager && activeTab === 'all' && (
            <div className="mt-4">
              <Button variant="primary" size="small" onClick={handleAdd}>Schedule First Meeting</Button>
            </div>
          )}
        </div>
      )}

      {!loading && Object.entries(grouped).map(([month, items]) => (
        <div key={month} className="space-y-3">
          <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider">
            {monthLabel(month)}
          </h2>
          {items.map((m) => (
            <MeetingCard
              key={m.id}
              meeting={m}
              canManage={isManager}
              onConfirm={handleConfirm}
              onCancel={handleCancel}
              onEdit={isManager ? handleEdit : undefined}
              onDelete={isManager ? remove : undefined}
            />
          ))}
        </div>
      ))}

      <MeetingForm
        isOpen={formOpen}
        onClose={() => { setFormOpen(false); setEditing(null); }}
        onSave={handleSave}
        meeting={editing}
      />
    </div>
  );
};
