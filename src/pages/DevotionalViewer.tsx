import React, { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { DevotionalCard } from '../components/feature/DevotionalCard';
import { DevotionalReader } from '../components/feature/DevotionalReader';
import { Button } from '../components/foundation/Button';
import { useDevotional, useDevotionalByDay } from '../hooks/useDevotional';
import type { AuthUser } from '../lib/auth';

interface DevotionalViewerProps {
  user: AuthUser | null;
}

function getInitialDay(): number {
  const day = new URLSearchParams(window.location.search).get('day');
  const parsed = Number(day);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 31 ? parsed : new Date().getDate();
}

/** True on phone-sized screens, where Rhapsody of Realities opens as a full-screen reader. */
function usePhoneLayout(): boolean {
  const query = '(max-width: 767px)';
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setMatches(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return matches;
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
  const isPhone = usePhoneLayout();

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

  if (isPhone && !state.loading && devotional && page) {
    return (
      <DevotionalReader
        devotional={devotional}
        page={page}
        canPrevious={canGoPrevious}
        canNext={canGoNext}
        onPrevious={() => setSelectedDay((day) => day - 1)}
        onNext={() => setSelectedDay((day) => day + 1)}
        onClose={() => navigate(-1)}
        onShare={() => void handleShare()}
        onDownload={handleDownload}
        onSelectDay={setSelectedDay}
      />
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-gray-100 dark:bg-slate-800">
      <div className="px-4 py-5 md:px-8 md:py-6">
        <div className="mx-auto max-w-6xl">
          <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <Button variant="ghost" onClick={() => navigate(-1)} className="w-fit">
              Back
            </Button>
            {(user?.role === 'admin' || user?.role === 'coordinator') && (
              <Button variant="secondary" onClick={() => navigate('/admin/devotionals')} className="w-fit">
                Manage Devotionals
              </Button>
            )}
          </div>

          {state.loading ? (
            <div className="flex min-h-[420px] items-center justify-center">
              <div className="w-8 h-8 border-4 border-york-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : state.error ? (
            <div className="card mx-auto max-w-2xl text-center">
              <h1 className="text-h2">Rhapsody of Realities</h1>
              <p className="mt-2 text-small text-error">{state.error}</p>
            </div>
          ) : !devotional || !page ? (
            <div className="card mx-auto max-w-2xl text-center">
              <h1 className="text-h2">Rhapsody of Realities</h1>
              <p className="mt-2 text-small text-gray-400 dark:text-slate-400">No devotional is available for this day.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_240px]">
              <section>
                <div className="mb-5 text-center">
                  <p className="text-small font-bold uppercase text-york-600 dark:text-york-400">{devotional.book_title}</p>
                  <h1 className="mt-1 text-h1">Day {page.day_of_month}: {page.title || devotional.title}</h1>
                  <p className="mt-2 text-small text-gray-500 dark:text-slate-400">{format(pageDate, 'MMMM d, yyyy')}</p>
                  <p className="text-small font-semibold text-gray-600">Pages {page.page_range}</p>
                </div>

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
                  />
                </div>
              </section>

              <aside className="hidden xl:block">
                <div className="sticky top-6 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm">
                  <p className="stat-label">Today</p>
                  <p className="mt-2 text-h2">{state.stats?.viewed_count ?? 0}</p>
                  <p className="text-small text-gray-400 dark:text-slate-400">member views</p>
                  <div className="divider" />
                  <p className="text-small font-semibold text-gray-900 dark:text-slate-100">Reading Progress</p>
                  <p className="mt-1 text-small text-gray-500">
                    Day {page.day_of_month} of {devotional.total_days}
                  </p>
                </div>
              </aside>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
