import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ZoomIn, ZoomOut } from 'lucide-react';
import { TransformComponent, TransformWrapper, type ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';

interface DevotionalImageReaderProps {
  open: boolean;
  src: string;
  alt: string;
  /** Shown in the reader header, e.g. "Day 19 · Pages 42–43". */
  title: string;
  onClose: () => void;
}

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const STEP = 0.5;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Full-screen reader for a devotional scan. Opens on top of the page, locks background
 * scrolling, and returns focus and scroll position to where the member was on close.
 * Opening or closing never marks the devotional as read; that only happens via Mark as read.
 */
export const DevotionalImageReader: React.FC<DevotionalImageReaderProps> = ({
  open, src, alt, title, onClose,
}) => {
  const controlsRef = useRef<ReactZoomPanPinchRef | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [scale, setScale] = useState(MIN_SCALE);
  // Load state is keyed to the src it was reported for, so a cached image that loads
  // before any effect runs cannot be reset to "loading" afterwards.
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const loaded = loadedSrc === src;
  const failed = failedSrc === src;

  // Each open starts fitted to the screen.
  useEffect(() => {
    if (open) setScale(MIN_SCALE);
  }, [open, src]);

  // Lock background scroll; remember focus and scroll so closing returns the member to where they were.
  useEffect(() => {
    if (!open) return;
    const main = document.getElementById('main-content');
    const scrollTop = main?.scrollTop ?? 0;
    const previousOverflow = document.body.style.overflow;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      if (main) main.scrollTop = scrollTop;
      opener?.focus?.();
    };
  }, [open]);

  // Keyboard: Escape closes; + / - / 0 zoom and fit.
  useEffect(() => {
    if (!open) return;
    const animationTime = prefersReducedMotion() ? 0 : 200;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      } else if (event.key === '+' || event.key === '=') {
        controlsRef.current?.zoomIn(STEP, animationTime);
      } else if (event.key === '-') {
        controlsRef.current?.zoomOut(STEP, animationTime);
      } else if (event.key === '0') {
        controlsRef.current?.resetTransform(animationTime);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  const animationTime = prefersReducedMotion() ? 0 : 200;
  const atMin = scale <= MIN_SCALE + 0.01;
  const atMax = scale >= MAX_SCALE - 0.01;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Devotional image: ${title}`}
      className="fixed inset-0 z-[60] flex flex-col bg-white dark:bg-slate-950 overscroll-contain"
      style={{ height: '100dvh' }}
      data-testid="devotional-image-reader"
    >
      <div
        className="flex items-center justify-between gap-3 px-4 pb-2"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 0.75rem)' }}
      >
        <p className="min-w-0 truncate text-sm font-semibold text-gray-900 dark:text-slate-100">{title}</p>
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          aria-label="Close image viewer"
          className="flex h-11 min-w-[44px] shrink-0 items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-800 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-york-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
        >
          <X className="h-5 w-5" aria-hidden="true" />
          <span>Close</span>
        </button>
      </div>

      <div className="relative min-h-0 flex-1 touch-none">
        {!loaded && !failed && (
          <div className="absolute inset-0 z-10 flex items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-york-600 border-t-transparent" role="status">
              <span className="sr-only">Loading image</span>
            </div>
          </div>
        )}

        {failed ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
            <p className="text-sm font-bold text-gray-900 dark:text-slate-100">Image could not be loaded.</p>
            <p className="text-xs text-gray-500 dark:text-slate-400">Close and try again.</p>
          </div>
        ) : (
          <TransformWrapper
            ref={controlsRef}
            initialScale={MIN_SCALE}
            minScale={MIN_SCALE}
            maxScale={MAX_SCALE}
            centerOnInit
            limitToBounds
            doubleClick={{ mode: 'toggle', animationTime }}
            onTransform={(_ref, state) => setScale(state.scale)}
          >
            <TransformComponent
              wrapperStyle={{ width: '100%', height: '100%' }}
              contentStyle={{ width: '100%', height: '100%' }}
            >
              <img
                src={src}
                alt={alt}
                draggable={false}
                onLoad={() => setLoadedSrc(src)}
                onError={() => setFailedSrc(src)}
                className="h-full w-full select-none object-contain"
              />
            </TransformComponent>
          </TransformWrapper>
        )}
      </div>

      <div
        className="flex items-center justify-center gap-3 px-4 pt-2"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.75rem)' }}
      >
        <button
          type="button"
          onClick={() => controlsRef.current?.zoomOut(STEP, animationTime)}
          disabled={atMin || failed}
          aria-label="Zoom out"
          className="flex h-11 w-11 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-york-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          <ZoomOut className="h-5 w-5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => controlsRef.current?.resetTransform(animationTime)}
          disabled={atMin || failed}
          className="flex h-11 min-w-[72px] items-center justify-center rounded-xl border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-york-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
        >
          Fit
        </button>
        <button
          type="button"
          onClick={() => controlsRef.current?.zoomIn(STEP, animationTime)}
          disabled={atMax || failed}
          aria-label="Zoom in"
          className="flex h-11 w-11 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-york-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          <ZoomIn className="h-5 w-5" aria-hidden="true" />
        </button>
        <span className="sr-only" aria-live="polite">{Math.round(scale * 100)}% zoom</span>
      </div>
      <p className="pb-1 text-center text-[11px] text-gray-400 dark:text-slate-500" aria-hidden="true">
        Pinch or double-tap to zoom · drag to pan
      </p>
    </div>,
    document.body,
  );
};
