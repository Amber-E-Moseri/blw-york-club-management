import React, { useEffect, useState } from 'react';
import type { DevotionalDailyPage, MonthlyDevotional } from '../../types';
import { Button } from '../foundation/Button';
import { Check, ChevronLeft, ChevronRight, Download, Expand, Share2, X } from 'lucide-react';

interface DevotionalCardProps {
  devotional: MonthlyDevotional;
  page: DevotionalDailyPage;
  viewedAt?: string | null;
  onPrevious?: () => void;
  onNext?: () => void;
  onShare?: () => void;
  onDownload?: () => void;
}

function formatViewedAt(value?: string | null): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

export const DevotionalCard: React.FC<DevotionalCardProps> = ({
  devotional,
  page,
  viewedAt,
  onPrevious,
  onNext,
  onShare,
  onDownload,
}) => {
  const [imageLoading, setImageLoading] = useState(true);
  const [imageError, setImageError] = useState(false);
  const [enlarged, setEnlarged] = useState(false);
  const viewedTime = formatViewedAt(viewedAt);

  useEffect(() => {
    if (!enlarged) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setEnlarged(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [enlarged]);

  return (
    <div className="w-full">
      {/* Day stepper sits above the page so it is reachable without scrolling */}
      <nav className="mb-3 flex items-center justify-between gap-3" aria-label="Change day">
        <Button
          variant="secondary"
          size="small"
          onClick={onPrevious}
          disabled={!onPrevious}
          aria-label="Previous day"
          icon={<ChevronLeft className="w-5 h-5" />}
          className="w-11 shrink-0 !px-0"
        >
          {null}
        </Button>
        <p className="text-center text-small font-semibold text-gray-600 dark:text-slate-300">
          Day {page.day_of_month} of {devotional.total_days}
        </p>
        <Button
          variant="secondary"
          size="small"
          onClick={onNext}
          disabled={!onNext}
          aria-label="Next day"
          icon={<ChevronRight className="w-5 h-5" />}
          iconPosition="right"
          className="w-11 shrink-0 !px-0"
        >
          {null}
        </Button>
      </nav>

      {enlarged && (
        <div role="dialog" aria-modal="true" aria-label={`Day ${page.day_of_month} page`} className="fixed inset-0 z-[60] flex flex-col bg-black">
          <div className="flex items-center justify-between px-4 py-3">
            <p className="text-small font-semibold text-white">Day {page.day_of_month} of {devotional.total_days}</p>
            <button
              type="button"
              onClick={() => setEnlarged(false)}
              aria-label="Close enlarged page"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          {/* Scrolls and pinches so the page text stays readable on a phone */}
          <div className="flex-1 overflow-auto overscroll-contain">
            <img
              src={page.image_url}
              alt={`${devotional.book_title} Day ${page.day_of_month}`}
              className="block h-auto w-[200vw] max-w-none md:mx-auto md:w-full md:max-w-5xl"
            />
          </div>
        </div>
      )}

      <div className="relative overflow-hidden rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm">
        {imageLoading && !imageError && (
          <div className="absolute inset-0 z-10 flex min-h-[220px] items-center justify-center bg-white dark:bg-slate-800">
            <div className="w-8 h-8 border-4 border-york-600 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {imageError ? (
          <div className="aspect-[2/1] flex flex-col items-center justify-center gap-2 bg-gray-100 dark:bg-slate-800 p-8 text-center">
            <p className="text-small font-bold text-gray-900 dark:text-slate-100">Image could not be loaded.</p>
            <p className="text-tiny text-gray-400 dark:text-slate-400">Try refreshing or contact a coordinator.</p>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEnlarged(true)}
            aria-label="Enlarge page"
            className="block w-full cursor-zoom-in"
          >
            <img
              src={page.image_url}
              alt={`${devotional.book_title} Day ${page.day_of_month}`}
              className="block w-full h-auto md:aspect-[2/1] md:object-contain bg-white dark:bg-slate-800"
              onLoad={() => setImageLoading(false)}
              onError={() => {
                setImageLoading(false);
                setImageError(true);
              }}
            />
          </button>
        )}
      </div>
      {!imageError && (
        <p className="mt-2 text-center text-tiny text-gray-400 dark:text-slate-400 md:hidden">Tap the page to enlarge</p>
      )}

      <div className="mt-4 space-y-4">
        {viewedTime && (
          <div className="flex items-center justify-center gap-2 text-small font-semibold text-success">
            <Check className="w-4 h-4" aria-hidden="true" />
            <span>Viewed at {viewedTime}</span>
          </div>
        )}

        <div className="grid grid-cols-3 gap-2">
          <Button
            variant="ghost"
            size="small"
            onClick={onShare}
            icon={<Share2 className="w-4 h-4" />}
            className="border border-gray-200 dark:border-slate-700"
          >
            Share
          </Button>
          <Button
            variant="ghost"
            size="small"
            onClick={onDownload}
            icon={<Download className="w-4 h-4" />}
            className="border border-gray-200 dark:border-slate-700"
          >
            Save
          </Button>
          <Button
            variant="ghost"
            size="small"
            onClick={() => setEnlarged(true)}
            icon={<Expand className="w-4 h-4" />}
            className="border border-gray-200 dark:border-slate-700"
          >
            Enlarge
          </Button>
        </div>
      </div>
    </div>
  );
};
