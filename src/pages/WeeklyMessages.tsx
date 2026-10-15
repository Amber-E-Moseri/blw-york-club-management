import React, { useState, useCallback } from 'react';
import {
  CalendarDays, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Lock,
  NotebookPen,
} from 'lucide-react';
import { Button } from '../components/foundation/Button';
import { WeeklyMessageCard } from '../components/feature/WeeklyMessageCard';
import { WeeklyMessageForm } from '../components/feature/WeeklyMessageForm';
import { useMonthMessages, useWeeklyMessageMutations } from '../hooks/useWeeklyMessages';
import { getMondayOfWeek, getWeekBounds } from '../lib/queries/weeklyMessages';
import type { AuthUser } from '../lib/auth';
import type { WeeklyMessage, WeeklyMessageInput } from '../types';

interface Props { user: AuthUser | null; }

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function toDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

function getWeeksInMonth(year: number, month: number): string[] {
  const weeks: string[] = [];
  const first = new Date(year, month - 1, 1);
  const last = new Date(year, month, 0);
  let monday = getMondayOfWeek(first);
  while (monday <= last) {
    weeks.push(toDate(monday));
    monday = new Date(monday.getTime() + 7 * 86400000);
  }
  return weeks;
}

function formatWeekLabel(monStr: string): string {
  const mon = new Date(monStr + 'T00:00:00');
  const sun = new Date(mon.getTime() + 6 * 86400000);
  const s = mon.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  const e = mon.getMonth() === sun.getMonth()
    ? sun.toLocaleDateString('en-CA', { day: 'numeric' })
    : sun.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  return `${s} – ${e}`;
}

function isCurrentWeek(monStr: string): boolean {
  const { start } = getWeekBounds();
  return monStr === start;
}

const canAdmin = (role: string) => ['coordinator', 'admin'].includes(role);

type Tab = 'schedule' | 'personal';

export const WeeklyMessages: React.FC<Props> = ({ user }) => {
  const now = new Date();
  const [tab, setTab] = useState<Tab>('schedule');
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth() + 1);
  const [expandedWeek, setExpandedWeek] = useState<string | null>(getWeekBounds().start);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<WeeklyMessage | null>(null);
  const [defaultWeekStart, setDefaultWeekStart] = useState<string | undefined>();
  const [defaultScope, setDefaultScope] = useState<'org' | 'personal'>('org');

  const isAdmin = canAdmin(user?.role ?? 'member');

  const { messages, loading, error, reload } = useMonthMessages(
    viewYear,
    viewMonth,
    user?.id,
  );
  const { save, remove, saving } = useWeeklyMessageMutations(reload);

  const orgMessages = messages.filter((m) => m.scope === 'org');
  const personalMessages = messages.filter((m) => m.scope === 'personal');
  const weeks = getWeeksInMonth(viewYear, viewMonth);

  function getWeekMessages(monStr: string, scope: 'org' | 'personal'): WeeklyMessage[] {
    const sunStr = toDate(new Date(new Date(monStr + 'T00:00:00').getTime() + 6 * 86400000));
    return (scope === 'org' ? orgMessages : personalMessages).filter(
      (m) => m.week_start <= sunStr && m.week_end >= monStr,
    );
  }

  const openCreate = useCallback((weekStart: string, scope: 'org' | 'personal' = 'org') => {
    setEditing(null);
    setDefaultWeekStart(weekStart);
    setDefaultScope(scope);
    setFormOpen(true);
  }, []);

  const openEdit = useCallback((m: WeeklyMessage) => {
    setEditing(m);
    setDefaultWeekStart(undefined);
    setFormOpen(true);
  }, []);

  async function handleSave(input: WeeklyMessageInput, id?: string) {
    if (!user) return;
    await save(input, user.id, user.name, id);
  }

  function prevMonth() {
    if (viewMonth === 1) { setViewYear((y) => y - 1); setViewMonth(12); }
    else setViewMonth((m) => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 12) { setViewYear((y) => y + 1); setViewMonth(1); }
    else setViewMonth((m) => m + 1);
  }

  const currentWeekStart = getWeekBounds().start;
  const thisWeekOrgMessages = orgMessages.filter(
    (m) => m.week_start <= currentWeekStart && m.week_end >= currentWeekStart,
  );

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Message of the Week</h1>
          <p className="text-sm text-gray-500 mt-0.5">Org announcements and personal notes by week</p>
        </div>
        {isAdmin && (
          <Button variant="primary" onClick={() => openCreate(currentWeekStart, 'org')}>
            + New Org Message
          </Button>
        )}
      </div>

      {/* THIS WEEK spotlight */}
      {thisWeekOrgMessages.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-bold text-york-600 uppercase tracking-wider">This Week</p>
          {thisWeekOrgMessages.map((m) => (
            <WeeklyMessageCard
              key={m.id}
              message={m}
              canEdit={isAdmin || m.created_by === user?.id}
              onEdit={openEdit}
              onDelete={remove}
            />
          ))}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>
      )}

      {/* Tabs */}
      <div className="flex gap-0 border-b border-gray-200">
        {(['schedule', 'personal'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t
                ? 'border-york-600 text-york-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'schedule' ? (
              <><CalendarDays className="w-3.5 h-3.5 mr-1.5 inline" aria-hidden="true" />Org Schedule</>
            ) : (
              <><Lock className="w-3.5 h-3.5 mr-1.5 inline" aria-hidden="true" />My Messages</>
            )}
          </button>
        ))}
      </div>

      {/* Schedule tab */}
      {tab === 'schedule' && (
        <div className="space-y-4">
          {/* Month navigation */}
          <div className="flex items-center justify-between">
            <button onClick={prevMonth} aria-label="Previous month" className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-600 dark:text-slate-300">
              <ChevronLeft className="w-4 h-4" aria-hidden="true" />
            </button>
            <h2 className="text-base font-bold text-gray-800 dark:text-slate-200">
              {MONTHS[viewMonth - 1]} {viewYear}
            </h2>
            <button onClick={nextMonth} aria-label="Next month" className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-600 dark:text-slate-300">
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          {loading && (
            <div className="space-y-2">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-14 bg-gray-100 rounded-lg animate-pulse" />
              ))}
            </div>
          )}

          {!loading && weeks.map((monStr) => {
            const weekMsgs = getWeekMessages(monStr, 'org');
            const isThis = isCurrentWeek(monStr);
            const isExpanded = expandedWeek === monStr;
            return (
              <div key={monStr} className={`border rounded-lg overflow-hidden ${isThis ? 'border-york-300' : 'border-gray-200'}`}>
                <button
                  className={`w-full flex items-center justify-between px-4 py-3 text-left transition-colors ${
                    isThis ? 'bg-red-50' : 'bg-white hover:bg-gray-50'
                  }`}
                  onClick={() => setExpandedWeek(isExpanded ? null : monStr)}
                >
                  <div className="flex items-center gap-3">
                    {isThis && (
                      <span className="text-xs font-bold text-york-600 bg-york-100 px-2 py-0.5 rounded-full">NOW</span>
                    )}
                    <span className="text-sm font-medium text-gray-700">{formatWeekLabel(monStr)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {weekMsgs.length > 0 ? (
                      <span className="w-2 h-2 rounded-full bg-york-500" title={`${weekMsgs.length} message(s)`} />
                    ) : (
                      <span className="w-2 h-2 rounded-full bg-gray-200" />
                    )}
                    {isExpanded
                      ? <ChevronUp className="w-4 h-4 text-gray-400" aria-hidden="true" />
                      : <ChevronDown className="w-4 h-4 text-gray-400" aria-hidden="true" />}
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-gray-100 px-4 py-3 bg-white space-y-3">
                    {weekMsgs.length > 0 ? (
                      weekMsgs.map((m) => (
                        <WeeklyMessageCard
                          key={m.id}
                          message={m}
                          canEdit={isAdmin || m.created_by === user?.id}
                          onEdit={openEdit}
                          onDelete={remove}
                          compact
                        />
                      ))
                    ) : (
                      <p className="text-sm text-gray-400">No message scheduled for this week.</p>
                    )}
                    {isAdmin && (
                      <Button
                        variant="ghost"
                        size="small"
                        onClick={() => openCreate(monStr, 'org')}
                      >
                        + Add for this week
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Personal tab */}
      {tab === 'personal' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button onClick={prevMonth} aria-label="Previous month" className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-500 dark:text-slate-400">
                <ChevronLeft className="w-4 h-4" aria-hidden="true" />
              </button>
              <span className="text-sm font-semibold text-gray-700 dark:text-slate-200">{MONTHS[viewMonth - 1]} {viewYear}</span>
              <button onClick={nextMonth} aria-label="Next month" className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-500 dark:text-slate-400">
                <ChevronRight className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
            <Button variant="secondary" size="small" onClick={() => openCreate(currentWeekStart, 'personal')}>
              + Personal Note
            </Button>
          </div>

          {loading && <div className="h-20 bg-gray-100 rounded-lg animate-pulse" />}

          {!loading && personalMessages.length === 0 && (
            <div className="text-center py-12 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg">
              <NotebookPen className="w-8 h-8 mx-auto mb-2 text-gray-300 dark:text-slate-600" aria-hidden="true" />
              <p className="text-sm font-semibold text-gray-700 dark:text-slate-300">No personal notes yet</p>
              <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">Use personal messages to write your own weekly reflections.</p>
              <div className="mt-4">
                <Button variant="primary" size="small" onClick={() => openCreate(currentWeekStart, 'personal')}>
                  Write First Note
                </Button>
              </div>
            </div>
          )}

          {!loading && personalMessages.length > 0 && (
            <div className="space-y-3">
              {personalMessages.map((m) => (
                <WeeklyMessageCard
                  key={m.id}
                  message={m}
                  canEdit
                  onEdit={openEdit}
                  onDelete={remove}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <WeeklyMessageForm
        isOpen={formOpen}
        onClose={() => { setFormOpen(false); setEditing(null); }}
        onSave={handleSave}
        message={editing}
        defaultScope={defaultScope}
        defaultWeekStart={defaultWeekStart}
        canSetOrgScope={isAdmin}
        saving={saving}
      />
    </div>
  );
};
