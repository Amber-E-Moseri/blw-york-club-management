import React, { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { SlidersHorizontal } from 'lucide-react';
import { DevotionalCard } from '../components/feature/DevotionalCard';
import { RorStreakBadge } from '../components/feature/RorStreakBadge';
import { RorCalendar } from '../components/feature/RorCalendar';
import { Button } from '../components/foundation/Button';
import { useDevotional, useDevotionalByDay } from '../hooks/useDevotional';
import { useRorStreak } from '../hooks/useRorStreak';
import type { AuthUser } from '../lib/auth';

interface DevotionalViewerProps {
  user: AuthUser | null;
}

function getInitialDay(): number {
  const day = new URLSearchParams(window.location.search).get('day');
  const parsed = Number(day);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 31 ? parsed : new Date().getDate();
}

export const DevotionalViewer: React.FC<DevotionalViewerProps> = ({ user }) => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const today = useMemo(() => new Date(), []);
  const [selectedDay, setSelectedDay] = useState(getInitialDay);
  const selectedMonth = Number(searchParams.get('month')) || today.getMonth() + 1;
  const selectedYear = Number(searchParams.get('year')) || today.getFullYear();
  const isToday =
    selectedDay === today.getDate() &&
    selectedMonth === today.getMonth() + 1 &&
    selectedYear === today.getFullYear();

  const todayState = useDevotional();
  const selectedState = useDevotionalByDay(selectedMonth, selectedDay, selectedYear, false);
  const state = isToday ? todayState : selectedState;

  const devotionalId = state.devotional?.id;
  const { streak, readDates } = useRorStreak(user?.id, devotionalId);

  useEffect(() => {
    if (
      searchParams.get('day') === String(selectedDay) &&
      searchParams.get('month') === String(selectedMonth) &&
      searchParams.get('year') === String(selectedYear)
    ) {
      return;
    }

    const next = new URLSearchParams(searchParams);
    next.set('day', String(selectedDay));
    next.set('month', String(selectedMonth));
    next.set('year', String(selectedYear));
    setSearchParams(next, { replace: true });
  }, [selectedDay, selectedMonth, selectedYear, searchParams, setSearchParams]);

  const devotional = state.devotional;
  const page = state.page;
  const pageDate = new Date(selectedYear, selectedMonth - 1, selectedDay);
  const canGoPrevious = !!devotional && selectedDay > 1;
  const canGoNext = !!devotional && selectedDay < devotional.total_days;
  const readPercent = devotional && page
    ? Math.min(100, Math.round((page.day_of_month / devotional.total_days) * 100))
    : 0;

  async function handleShare() {
    const url = window.location.href;
    if (navigator.share && devotional && page) {
      await navigator.share({
        title: `${devotional.book_title} - Day ${page.day_of_month}`,
        url,
      });
      return;
    }
    await navigator.clipboard.writeText(url);
  }

  function handleDownload() {
    if (!page) return;
    const link = document.createElement('a');
    link.href = page.image_url;
    link.download = `daily-bread-day-${page.day_of_month}.jpg`;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.click();
  }

  function handleFullscreen() {
    const image = document.querySelector('[data-devotional-image]');
    if (image instanceof HTMLElement && image.requestFullscreen) {
      image.requestFullscreen();
    }
  }

  const canManage = user?.role === 'admin' || user?.role === 'coordinator';

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-5">
        {state.loading ? (
          <div className="flex min-h-[420px] items-center justify-center">
            <div className="w-8 h-8 border-4 border-york-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : state.error ? (
          <div className="card mx-auto max-w-2xl text-center">
            <h1 className="text-h2">Daily Bread</h1>
            <p className="mt-2 text-small text-error">{state.error}</p>
          </div>
        ) : !devotional || !page ? (
          <div className="card mx-auto max-w-2xl text-center">
            <h1 className="text-h2">Daily Bread</h1>
            <p className="mt-2 text-small text-gray-400">No devotional is available for this day.</p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-york-600">
                {devotional.book_title} · Pages {page.page_range}
              </p>
              <h1 className="mt-1 text-2xl font-bold text-gray-900 dark:text-slate-100">
                Day {page.day_of_month}: {page.title || devotional.title}
              </h1>
              <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
                {format(pageDate, 'EEEE, MMMM d, yyyy')}
              </p>
            </div>

            {canManage && (
              <Button
                variant="secondary"
                onClick={() => navigate('/admin/devotionals')}
                className="w-fit"
                icon={<SlidersHorizontal className="w-4 h-4" />}
              >
                Manage
              </Button>
            )}

            <div data-devotional-image>
              <DevotionalCard
                devotional={devotional}
                page={page}
                viewedAt={state.view?.viewed_at}
                onPrevious={canGoPrevious ? () => setSelectedDay((day) => day - 1) : undefined}
                onNext={canGoNext ? () => setSelectedDay((day) => day + 1) : undefined}
                onShare={handleShare}
                onDownload={handleDownload}
                onFullscreen={handleFullscreen}
                onMarkRead={user ? state.markAsRead : undefined}
                marking={state.marking}
              />
            </div>

            {/* Stats */}
            <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
              <p className="text-xs text-gray-500 dark:text-slate-400">Read today</p>
              <p className="mt-1 text-3xl font-bold text-gray-900 dark:text-slate-100">{state.stats?.viewed_count ?? 0}</p>
              <p className="text-sm text-gray-500 dark:text-slate-400">members</p>

              <div className="mt-4 border-t border-gray-100 pt-4 dark:border-slate-700">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-gray-900 dark:text-slate-100">Progress</p>
                  <p className="text-sm font-semibold text-gray-700 dark:text-slate-300">
                    {page.day_of_month} / {devotional.total_days}
                  </p>
                </div>
                <div className="mt-2 h-2 w-full rounded-full bg-gray-100 dark:bg-slate-700">
                  <div className="h-2 rounded-full bg-york-600 transition-all" style={{ width: `${readPercent}%` }} />
                </div>
              </div>
            </div>

            {streak && (
              <div>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-600 dark:text-slate-400">
                  Your reading streak
                </h2>
                <RorStreakBadge streak={streak} />
              </div>
            )}

            {devotional && streak && (
              <RorCalendar
                totalDays={devotional.total_days}
                readDates={readDates}
                month={selectedMonth}
                year={selectedYear}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
};
