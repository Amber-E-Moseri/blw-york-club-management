import React from 'react';
import { Link } from 'react-router-dom';
import {
  BookMarked, CheckSquare, Heart, Star, MessageCircle, Book, ChevronRight,
} from 'lucide-react';
import { useDevotional } from '../hooks/useDevotional';
import { useHabits } from '../hooks/useHabits';
import { useCurrentWeekMessage } from '../hooks/useWeeklyMessages';
import { useCurrentBook } from '../hooks/useBookOfMonth';
import type { AuthUser } from '../lib/auth';

interface GrowthCardProps {
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  subtitle?: string;
  badge?: string;
  to: string;
}

const GrowthCard: React.FC<GrowthCardProps> = ({ icon, iconBg, title, subtitle, badge, to }) => (
  <Link
    to={to}
    className="flex items-center gap-4 p-4 bg-white dark:bg-slate-800 rounded-2xl shadow-sm hover:shadow-md transition-all duration-150 group"
  >
    <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${iconBg}`}>
      {icon}
    </div>
    <div className="flex-1 min-w-0">
      <p className="font-semibold text-gray-900 dark:text-white text-sm">{title}</p>
      {subtitle && (
        <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">{subtitle}</p>
      )}
    </div>
    {badge && (
      <span className="shrink-0 text-xs font-semibold text-york-600 bg-york-50 dark:bg-york-900/20 dark:text-york-300 px-2 py-0.5 rounded-full">
        {badge}
      </span>
    )}
    <ChevronRight className="w-4 h-4 text-gray-400 shrink-0 group-hover:translate-x-0.5 transition-transform" />
  </Link>
);

interface GrowthProps {
  user: AuthUser | null;
}

export const Growth: React.FC<GrowthProps> = ({ user }) => {
  const { view: devotionalView, page: devotionalPage } = useDevotional();
  const { habitsWithStats } = useHabits(user?.id);
  const { message } = useCurrentWeekMessage();
  const { book } = useCurrentBook();

  const habitsCompleted = habitsWithStats.filter((h) => h.today_status === 'done').length;
  const habitsTotal = habitsWithStats.length;

  return (
    <div className="space-y-5 pb-4">
      {/* Header */}
      <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl shadow-sm overflow-hidden">
        <div className="border-t-4 border-york-600 px-5 py-5">
          <p className="text-xs font-semibold text-york-600 uppercase tracking-wider">Spiritual</p>
          <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100 mt-1">Growth</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
            Your discipleship journey in one place.
          </p>
        </div>
      </div>

      {/* Stats strip — habits progress */}
      {habitsTotal > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <StatChip label="Done today" value={habitsCompleted} />
          <StatChip label="Total habits" value={habitsTotal} />
        </div>
      )}

      <div className="space-y-3">
        <GrowthCard
          to="/devotionals"
          iconBg="bg-amber-50 dark:bg-amber-900/20"
          icon={<BookMarked className="w-6 h-6 text-amber-600" />}
          title="Daily Bread"
          subtitle={devotionalPage?.title ?? 'Today\'s devotional'}
          badge={devotionalView ? 'Read today' : undefined}
        />

        <GrowthCard
          to="/habits"
          iconBg="bg-emerald-50 dark:bg-emerald-900/20"
          icon={<CheckSquare className="w-6 h-6 text-emerald-600" />}
          title="Habits"
          subtitle={
            habitsTotal > 0
              ? `${habitsCompleted}/${habitsTotal} completed today`
              : 'Track your daily habits'
          }
          badge={
            habitsTotal > 0
              ? `${Math.round((habitsCompleted / habitsTotal) * 100)}%`
              : undefined
          }
        />

        <GrowthCard
          to="/confessions"
          iconBg="bg-rose-50 dark:bg-rose-900/20"
          icon={<Heart className="w-6 h-6 text-rose-600" />}
          title="Confessions"
          subtitle="Speak today's declaration"
        />

        <GrowthCard
          to="/testimonies"
          iconBg="bg-yellow-50 dark:bg-yellow-900/20"
          icon={<Star className="w-6 h-6 text-yellow-600" />}
          title="Testimonies"
          subtitle="Share what God has done"
        />

        <GrowthCard
          to="/messages"
          iconBg="bg-blue-50 dark:bg-blue-900/20"
          icon={<MessageCircle className="w-6 h-6 text-blue-600" />}
          title="Messages"
          subtitle={message?.title ?? 'Weekly messages'}
        />

        <GrowthCard
          to="/books"
          iconBg="bg-purple-50 dark:bg-purple-900/20"
          icon={<Book className="w-6 h-6 text-purple-600" />}
          title="Book of the Month"
          subtitle={book?.title ?? 'Current reading'}
        />
      </div>
    </div>
  );
};

const StatChip: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl shadow-sm px-4 py-3">
    <p className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider">{label}</p>
    <p className="text-2xl font-bold text-gray-900 dark:text-slate-100 mt-0.5">{value}</p>
  </div>
);
