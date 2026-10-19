import React, { useState } from 'react';
import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Download, Maximize, Share2, ZoomIn } from 'lucide-react';
import type { DevotionalDailyPage, MonthlyDevotional } from '../../types';

interface DevotionalCardProps {
  devotional: MonthlyDevotional;
  page: DevotionalDailyPage;
  viewedAt?: string | null;
  onPrevious?: () => void;
  onNext?: () => void;
  onShare?: () => void;
  onDownload?: () => void;
  /** Opens the shared full-screen image reader (used by the image and the Full screen action). */
  onOpenReader?: () => void;
  onMarkRead?: () => void;
  marking?: boolean;
  /** Message from the last failed Mark as read attempt. */
  markError?: string | null;
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
  onOpenReader,
  onMarkRead,
  marking = false,
  markError = null,
}) => {
  const [imageLoading, setImageLoading] = useState(true);
  const [imageError, setImageError] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const viewedTime = formatViewedAt(viewedAt);

  return (
    <div className="w-full space-y-4">
      {/* Image: edge-to-edge on phones, bordered card on desktop */}
      <div className="relative overflow-hidden rounded-2xl border-0 bg-white shadow-none md:border md:border-gray-200 md:shadow-sm dark:md:border-slate-700">
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
          <button
            type="button"
            onClick={onOpenReader}
            aria-label={`Open ${devotional.book_title} day ${page.day_of_month} in full screen`}
            className="group relative block w-full rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-york-600"
          >
            <img
              src={page.image_url}
              alt=""
              data-devotional-image
              className="block w-full aspect-[2/1] object-contain bg-white"
              onLoad={() => setImageLoading(false)}
              onError={() => {
                setImageLoading(false);
                setImageError(true);
              }}
            />
          </button>
        )}
      </div>

      {/* Phone affordance: a caption below the scan so the image itself stays unobstructed */}
      {!imageError && !imageLoading && (
        <p className="flex items-center justify-center gap-1.5 text-xs font-medium text-gray-500 dark:text-slate-400 md:hidden">
          <ZoomIn className="h-3.5 w-3.5" aria-hidden="true" />
          Tap to enlarge
        </p>
      )}

      {/* Day navigation */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onPrevious}
          disabled={!onPrevious}
          aria-label={onPrevious ? 'Previous day' : 'Previous day unavailable: this is the first day'}
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
          aria-label={onNext ? 'Next day' : 'Next day unavailable: this is the last day'}
          className={NAV_BUTTON_CLASS}
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {/* Read status: ready, saving, error with retry, or completed */}
      {viewedAt ? (
        <div
          role="status"
          className="flex h-12 items-center justify-center gap-2 rounded-xl bg-green-50 text-sm font-semibold text-green-700 dark:bg-green-900/20 dark:text-green-400"
        >
          <Check className="w-4 h-4" aria-hidden="true" />
          <span>Marked as read{viewedTime ? ` at ${viewedTime}` : ''}</span>
        </div>
      ) : onMarkRead ? (
        <div className="space-y-2">
          <button
            type="button"
            onClick={onMarkRead}
            disabled={marking}
            aria-busy={marking}
            aria-label={marking || markError ? undefined : 'Mark this devotional as read'}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-green-700 text-sm font-semibold text-white shadow-sm hover:bg-green-800 active:bg-green-900 disabled:opacity-70 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-york-600 focus-visible:ring-offset-2"
          >
            {marking ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent motion-reduce:animate-none" aria-hidden="true" />
            ) : (
              <Check className="w-4 h-4" aria-hidden="true" />
            )}
            {marking ? 'Saving…' : markError ? 'Try again' : 'Mark as read'}
          </button>
          {markError && (
            <p role="alert" className="text-center text-sm text-error">{markError}</p>
          )}
        </div>
      ) : null}

      {/* Desktop: three equal actions, unchanged */}
      <div className="hidden grid-cols-3 gap-2.5 md:grid">
        <button type="button" onClick={onShare} className={ACTION_BUTTON_CLASS}>
          <Share2 className="w-4 h-4" aria-hidden="true" />
          Share
        </button>
        <button type="button" onClick={onDownload} className={ACTION_BUTTON_CLASS}>
          <Download className="w-4 h-4" aria-hidden="true" />
          Download
        </button>
        <button type="button" onClick={onOpenReader} className={ACTION_BUTTON_CLASS}>
          <Maximize className="w-4 h-4" aria-hidden="true" />
          Fullscreen
        </button>
      </div>

      {/* Phone: secondary actions behind one control so they don't compete with Mark as read */}
      <div className="md:hidden">
        <button
          type="button"
          onClick={() => setMoreOpen((open) => !open)}
          aria-expanded={moreOpen}
          aria-controls="devotional-more-actions"
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          More actions
          {moreOpen ? <ChevronUp className="w-4 h-4" aria-hidden="true" /> : <ChevronDown className="w-4 h-4" aria-hidden="true" />}
        </button>
        {moreOpen && (
          <div id="devotional-more-actions" className="mt-2 grid grid-cols-3 gap-2.5">
            <button type="button" onClick={onShare} className={ACTION_BUTTON_CLASS}>
              <Share2 className="w-4 h-4" aria-hidden="true" />
              Share
            </button>
            <button type="button" onClick={onDownload} className={ACTION_BUTTON_CLASS}>
              <Download className="w-4 h-4" aria-hidden="true" />
              Download
            </button>
            <button type="button" onClick={onOpenReader} className={ACTION_BUTTON_CLASS}>
              <Maximize className="w-4 h-4" aria-hidden="true" />
              Full screen
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
