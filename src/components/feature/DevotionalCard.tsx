import React, { useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Download, Maximize, Share2 } from 'lucide-react';
import type { DevotionalDailyPage, MonthlyDevotional } from '../../types';

interface DevotionalCardProps {
  devotional: MonthlyDevotional;
  page: DevotionalDailyPage;
  viewedAt?: string | null;
  onPrevious?: () => void;
  onNext?: () => void;
  onShare?: () => void;
  onDownload?: () => void;
  onFullscreen?: () => void;
  onMarkRead?: () => void;
  marking?: boolean;
}

function formatViewedAt(value?: string | null): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

const NAV_BUTTON_CLASS =
  'w-11 h-11 shrink-0 flex items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700';

const ACTION_BUTTON_CLASS =
  'flex h-11 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700';

export const DevotionalCard: React.FC<DevotionalCardProps> = ({
  devotional,
  page,
  viewedAt,
  onPrevious,
  onNext,
  onShare,
  onDownload,
  onFullscreen,
  onMarkRead,
  marking = false,
}) => {
  const [imageLoading, setImageLoading] = useState(true);
  const [imageError, setImageError] = useState(false);
  const viewedTime = formatViewedAt(viewedAt);

  return (
    <div className="w-full space-y-4">
      <div className="relative overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-slate-700">
        {imageLoading && !imageError && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white dark:bg-slate-800">
            <div className="w-8 h-8 border-4 border-york-600 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {imageError ? (
          <div className="aspect-[2/1] flex flex-col items-center justify-center gap-2 bg-gray-100 p-8 text-center dark:bg-slate-700">
            <p className="text-small font-bold text-gray-900 dark:text-slate-100">Image could not be loaded.</p>
            <p className="text-tiny text-gray-400">Try refreshing or contact a coordinator.</p>
          </div>
        ) : (
          <img
            src={page.image_url}
            alt={`${devotional.book_title} Day ${page.day_of_month}`}
            data-devotional-image
            className="block w-full aspect-[2/1] object-contain bg-white"
            onLoad={() => setImageLoading(false)}
            onError={() => {
              setImageLoading(false);
              setImageError(true);
            }}
          />
        )}
      </div>

      {/* Day navigation */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onPrevious}
          disabled={!onPrevious}
          aria-label="Previous day"
          className={NAV_BUTTON_CLASS}
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        <p className="text-sm font-semibold text-gray-700 dark:text-slate-300">
          Day {page.day_of_month} of {devotional.total_days}
        </p>

        <button
          type="button"
          onClick={onNext}
          disabled={!onNext}
          aria-label="Next day"
          className={NAV_BUTTON_CLASS}
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {/* Read status */}
      {viewedAt ? (
        <div
          role="status"
          className="flex h-12 items-center justify-center gap-2 rounded-xl bg-green-50 text-sm font-semibold text-green-700 dark:bg-green-900/20 dark:text-green-400"
        >
          <Check className="w-4 h-4" aria-hidden="true" />
          <span>Marked as read{viewedTime ? ` at ${viewedTime}` : ''}</span>
        </div>
      ) : onMarkRead ? (
        <button
          type="button"
          onClick={onMarkRead}
          disabled={marking}
          aria-label="Mark this devotional as read"
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-green-700 text-sm font-semibold text-white shadow-sm hover:bg-green-800 active:bg-green-900 disabled:opacity-60 transition-colors"
        >
          <Check className="w-4 h-4" aria-hidden="true" />
          {marking ? 'Saving…' : 'Mark as read'}
        </button>
      ) : null}

      {/* Actions */}
      <div className="grid grid-cols-3 gap-2.5">
        <button type="button" onClick={onShare} className={ACTION_BUTTON_CLASS}>
          <Share2 className="w-4 h-4" aria-hidden="true" />
          Share
        </button>
        <button type="button" onClick={onDownload} className={ACTION_BUTTON_CLASS}>
          <Download className="w-4 h-4" aria-hidden="true" />
          Download
        </button>
        <button type="button" onClick={onFullscreen} className={ACTION_BUTTON_CLASS}>
          <Maximize className="w-4 h-4" aria-hidden="true" />
          Fullscreen
        </button>
      </div>
    </div>
  );
};
