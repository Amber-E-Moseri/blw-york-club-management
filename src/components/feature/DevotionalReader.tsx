import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Share2, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { DevotionalDailyPage, MonthlyDevotional } from '../../types';

interface DevotionalReaderProps {
  devotional: MonthlyDevotional;
  page: DevotionalDailyPage;
  canPrevious: boolean;
  canNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
  onShare: () => void;
  onDownload: () => void;
  onSelectDay: (day: number) => void;
}

const SWIPE_DISTANCE = 50;

/**
 * Full-screen, reading-first view for phones. Tap the left or right edge to turn
 * the page, swipe sideways to turn it, and tap the middle to show or hide the
 * controls. Pinch zoom is left to the browser so text stays sharp.
 */
export const DevotionalReader: React.FC<DevotionalReaderProps> = ({
  devotional,
  page,
  canPrevious,
  canNext,
  onPrevious,
  onNext,
  onClose,
  onShare,
  onDownload,
  onSelectDay,
}) => {
  const [chromeVisible, setChromeVisible] = useState(true);
  const [imageLoading, setImageLoading] = useState(true);
  const [dayPickerOpen, setDayPickerOpen] = useState(false);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setImageLoading(true);
  }, [page.id]);

  // Escape closes the reader on keyboards and desktop browsers.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && canPrevious) onPrevious();
      if (e.key === 'ArrowRight' && canNext) onNext();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [canPrevious, canNext, onPrevious, onNext, onClose]);

  const isZoomed = () => (window.visualViewport?.scale ?? 1) > 1.01;

  const handleTouchStart = (e: React.TouchEvent) => {
    swipeStart.current = e.touches.length === 1
      ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
      : null;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start || isZoomed() || e.changedTouches.length === 0) return;

    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) < SWIPE_DISTANCE || Math.abs(dx) < Math.abs(dy) * 1.5) return;

    if (dx < 0 && canNext) onNext();
    if (dx > 0 && canPrevious) onPrevious();
  };

  // Taps: edges turn the page, the middle toggles the controls.
  const handleTap = (clientX: number) => {
    if (isZoomed()) return;
    const edge = window.innerWidth / 4;
    if (clientX < edge && canPrevious) return onPrevious();
    if (clientX > window.innerWidth - edge && canNext) return onNext();
    setChromeVisible((visible) => !visible);
  };

  const chromeClass = cn(
    'transition-opacity duration-200',
    chromeVisible ? 'opacity-100' : 'opacity-0 pointer-events-none',
  );
  const progress = Math.round((page.day_of_month / devotional.total_days) * 100);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${devotional.book_title}, day ${page.day_of_month}`}
      className="fixed inset-0 z-[60] flex flex-col bg-[#f7f3ea] dark:bg-[#0b1120] select-none"
    >
      <header
        className={cn(
          'absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-2 px-3 pb-2',
          'pt-[max(env(safe-area-inset-top),0.5rem)] bg-[#f7f3ea]/90 dark:bg-[#0b1120]/90 backdrop-blur-sm',
          chromeClass,
        )}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close reader"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-gray-700 dark:text-slate-200"
        >
          <X className="w-5 h-5" />
        </button>
        <p className="min-w-0 truncate text-small font-semibold text-gray-800 dark:text-slate-100">
          {devotional.book_title}
        </p>
        <div className="flex shrink-0">
          <button
            type="button"
            onClick={onDownload}
            aria-label="Save page"
            className="flex h-11 w-11 items-center justify-center rounded-full text-gray-700 dark:text-slate-200"
          >
            <Download className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={onShare}
            aria-label="Share page"
            className="flex h-11 w-11 items-center justify-center rounded-full text-gray-700 dark:text-slate-200"
          >
            <Share2 className="w-5 h-5" />
          </button>
        </div>
      </header>

      <div
        className="relative flex flex-1 min-h-0 items-center justify-center px-2"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onClick={(e) => handleTap(e.clientX)}
      >
        {imageLoading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-8 h-8 border-4 border-york-600 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        <img
          key={page.id}
          src={page.image_url}
          alt={`${devotional.book_title} Day ${page.day_of_month}`}
          draggable={false}
          onLoad={() => setImageLoading(false)}
          onError={() => setImageLoading(false)}
          className={cn(
            'max-h-full max-w-full object-contain',
            imageLoading ? 'opacity-0' : 'opacity-100 animate-[fadeIn_0.25s_ease-out]',
          )}
        />
      </div>

      <footer
        className={cn(
          'absolute inset-x-0 bottom-0 z-10 bg-[#f7f3ea]/90 dark:bg-[#0b1120]/90 backdrop-blur-sm',
          'pb-[max(env(safe-area-inset-bottom),0.5rem)]',
          chromeClass,
        )}
      >
        <div className="mx-4 h-1 overflow-hidden rounded-full bg-gray-300/70 dark:bg-slate-700">
          <div
            className="h-full rounded-full bg-york-600 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex items-center justify-between px-2 pt-1">
          <button
            type="button"
            onClick={onPrevious}
            disabled={!canPrevious}
            aria-label="Previous day"
            className="flex h-11 w-11 items-center justify-center rounded-full text-gray-700 disabled:opacity-30 dark:text-slate-200"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <button
            type="button"
            onClick={() => setDayPickerOpen(true)}
            aria-label="Choose a day"
            className="rounded-xl px-3 py-1 text-center text-tiny font-semibold text-gray-600 dark:text-slate-300"
          >
            Day {page.day_of_month} of {devotional.total_days}
            <span className="block font-normal text-gray-500 dark:text-slate-400">Pages {page.page_range} · tap to jump</span>
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={!canNext}
            aria-label="Next day"
            className="flex h-11 w-11 items-center justify-center rounded-full text-gray-700 disabled:opacity-30 dark:text-slate-200"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        </div>
      </footer>

      {dayPickerOpen && (
        <div className="absolute inset-0 z-20 flex flex-col justify-end bg-black/40" onClick={() => setDayPickerOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Choose a day"
            className="rounded-t-2xl bg-[#f7f3ea] dark:bg-[#0b1120] px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="text-small font-semibold text-gray-800 dark:text-slate-100">Jump to a day</p>
              <button
                type="button"
                onClick={() => setDayPickerOpen(false)}
                aria-label="Close day picker"
                className="flex h-11 w-11 items-center justify-center rounded-full text-gray-700 dark:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-2 max-h-[50vh] overflow-y-auto">
              {Array.from({ length: devotional.total_days }, (_, i) => i + 1).map((day) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => {
                    setDayPickerOpen(false);
                    onSelectDay(day);
                  }}
                  aria-current={day === page.day_of_month ? 'page' : undefined}
                  className={cn(
                    'flex h-11 items-center justify-center rounded-xl text-small font-semibold',
                    day === page.day_of_month
                      ? 'bg-york-600 text-white'
                      : 'bg-white text-gray-700 dark:bg-slate-800 dark:text-slate-200',
                  )}
                >
                  {day}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
