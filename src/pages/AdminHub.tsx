import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle, BarChart3, BookMarked, CalendarDays, CheckSquare, ChevronRight,
  ClipboardCheck, ClipboardList, Download, KeyRound, Mail, Megaphone, Settings,
  Users, Video, type LucideIcon,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { AuthUser } from '../lib/auth';

interface Props { user: AuthUser | null; }

interface OpsCounts {
  pendingApprovals: number;
  overdueFollowUps: number;
  failedEmails: number;
  incompleteMeetings: number;
}

const TOOL_GROUPS: {
  title: string;
  items: { label: string; desc: string; icon: LucideIcon; path: string }[];
}[] = [
  {
    title: 'People',
    items: [
      { label: 'Members', desc: 'Directory, roles, cells, and member details', icon: Users, path: '/members' },
      { label: 'Contacts', desc: 'Outreach pipeline, handoffs, and follow-ups', icon: ClipboardList, path: '/contacts' },
      { label: 'Approvals', desc: 'Review pending and rejected sign-up requests', icon: ClipboardCheck, path: '/admin/pending' },
    ],
  },
  {
    title: 'Ministry',
    items: [
      { label: 'Events', desc: 'Schedule public ministry events', icon: CalendarDays, path: '/events' },
      { label: 'Announcements', desc: 'Publish club-wide updates', icon: Megaphone, path: '/announcements' },
      { label: 'Zoom Integration', desc: 'Configure meeting video automation', icon: Video, path: '/admin/zoom' },
    ],
  },
  {
    title: 'Resources',
    items: [
      { label: 'Daily Bread Upload', desc: 'Convert monthly PDFs into daily pages', icon: BookMarked, path: '/admin/devotionals' },
      { label: 'Testimony Moderation', desc: 'Approve or reject submitted testimonies', icon: CheckSquare, path: '/admin/testimonies' },
      { label: 'Devotional Reports', desc: 'Review devotional engagement', icon: BarChart3, path: '/admin/reports' },
    ],
  },
  {
    title: 'Administration',
    items: [
      { label: 'Reports', desc: 'Outreach and activity analytics', icon: BarChart3, path: '/admin/contact-reports' },
      { label: 'Roles & Access', desc: 'Custom admin roles and assignments', icon: KeyRound, path: '/admin/roles' },
      { label: 'Communications', desc: 'Email delivery and failure log', icon: Mail, path: '/admin/email-log' },
      { label: 'Data Export', desc: 'Download members, contacts, and attendance', icon: Download, path: '/admin/exports' },
      { label: 'Settings', desc: 'Profile and account preferences', icon: Settings, path: '/profile' },
    ],
  },
];

async function countRows(table: string, build?: (query: any) => any): Promise<number> {
  let query = supabase.from(table).select('id', { count: 'exact', head: true });
  if (build) query = build(query);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

async function loadOpsCounts(): Promise<OpsCounts> {
  const today = new Date().toISOString().slice(0, 10);
  const [pendingApprovals, overdueFollowUps, failedEmails, incompleteMeetings] = await Promise.all([
    countRows('member_directory', (q) => q.eq('status', 'pending')),
    countRows('contacts', (q) =>
      q.eq('archived', false)
        .not('follow_up_date', 'is', null)
        .lt('follow_up_date', today)),
    countRows('email_log', (q) => q.eq('status', 'failed')),
    countRows('meetings', (q) =>
      q.gte('date', today)
        .or('location.is.null,location.eq.,time.is.null')),
  ]);

  return { pendingApprovals, overdueFollowUps, failedEmails, incompleteMeetings };
}

export const AdminHub: React.FC<Props> = ({ user }) => {
  const navigate = useNavigate();
  const [counts, setCounts] = useState<OpsCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const isAdmin = ['admin', 'coordinator'].includes(user?.role ?? '');

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }

    let alive = true;
    loadOpsCounts()
      .then((data) => { if (alive) setCounts(data); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'Could not load admin metrics.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [isAdmin]);

  const attentionItems = useMemo(() => [
    {
      label: 'Pending approvals',
      value: counts?.pendingApprovals ?? 0,
      icon: ClipboardCheck,
      path: '/admin/pending',
      tone: 'york',
    },
    {
      label: 'Overdue follow-ups',
      value: counts?.overdueFollowUps ?? 0,
      icon: AlertCircle,
      path: '/contacts',
      tone: 'orange',
    },
    {
      label: 'Failed communications',
      value: counts?.failedEmails ?? 0,
      icon: Mail,
      path: '/admin/email-log',
      tone: 'red',
    },
    {
      label: 'Incomplete meetings',
      value: counts?.incompleteMeetings ?? 0,
      icon: CalendarDays,
      path: '/meetings',
      tone: 'slate',
    },
  ], [counts]);

  if (!isAdmin) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <p className="text-sm text-york-600 font-medium">Access denied.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-4">
      <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl shadow-sm overflow-hidden">
        <div className="border-t-4 border-york-600 px-5 py-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold text-york-600 uppercase tracking-wider">Administration</p>
            <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100 mt-1">Operations Dashboard</h1>
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
              Review the work that needs attention, then jump into the right tool.
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/admin/roles')}
            className="h-9 px-3 inline-flex items-center justify-center gap-2 text-sm font-semibold text-york-600 border border-york-200 rounded-xl bg-red-50 hover:bg-red-100 dark:bg-york-900/20 dark:border-york-800 dark:text-york-300"
          >
            <KeyRound className="w-4 h-4" />
            Roles & Access
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-york-200 bg-york-50 dark:bg-york-900/20 p-4 text-sm text-york-700 dark:text-york-300">
          {error}
        </div>
      )}

      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3" aria-label="Operational attention">
        {attentionItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.label}
              type="button"
              onClick={() => navigate(item.path)}
              className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl shadow-sm p-4 text-left hover:border-york-300 dark:hover:border-york-700 transition-colors"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="w-10 h-10 rounded-xl bg-york-50 dark:bg-york-900/20 flex items-center justify-center">
                  <Icon className="w-5 h-5 text-york-600 dark:text-york-400" />
                </div>
                {loading ? (
                  <span className="w-12 h-7 rounded-md bg-gray-100 dark:bg-slate-700 animate-pulse" />
                ) : (
                  <span className="text-2xl font-bold text-gray-900 dark:text-slate-100">{item.value}</span>
                )}
              </div>
              <p className="mt-3 text-sm font-semibold text-gray-900 dark:text-slate-100">{item.label}</p>
              <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">
                {item.value > 0 ? 'Needs review' : 'No action needed'}
              </p>
            </button>
          );
        })}
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {TOOL_GROUPS.map((group) => (
          <section
            key={group.title}
            className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl shadow-sm overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-gray-100 dark:border-slate-700">
              <h2 className="text-sm font-bold text-gray-900 dark:text-slate-100">{group.title}</h2>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-slate-700">
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.path}
                    type="button"
                    onClick={() => navigate(item.path)}
                    className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-gray-50 dark:hover:bg-slate-700/40 transition-colors"
                  >
                    <div className="w-9 h-9 rounded-lg bg-gray-100 dark:bg-slate-700 flex items-center justify-center shrink-0">
                      <Icon className="w-4 h-4 text-gray-500 dark:text-slate-300" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 dark:text-slate-100">{item.label}</p>
                      <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5 line-clamp-1">{item.desc}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-300 dark:text-slate-600 shrink-0" />
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
};
