import React, { useState } from 'react';
import type { DevotionalDailyPage, MonthlyDevotional } from '../../types';
import { Button } from '../foundation/Button';

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
    <div className="w-full">
      <div className="relative mx-auto max-w-[900px] overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm">
        {imageLoading && !imageError && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white">
            <div className="w-8 h-8 border-4 border-york-600 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {imageError ? (
          <div className="aspect-[2/1] flex flex-col items-center justify-center gap-2 bg-gray-100 p-8 text-center">
            <p className="text-small font-bold text-gray-900">Image could not be loaded.</p>
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

      <div className="mx-auto mt-4 max-w-[900px] space-y-4">
        {viewedAt ? (
          <div className="flex items-center justify-center gap-2 text-small font-semibold text-success" role="status">
            <span aria-hidden="true">✓</span>
            <span>Marked as read{viewedTime ? ` at ${viewedTime}` : ''}</span>
          </div>
        ) : onMarkRead ? (
          <div className="flex justify-center">
            <Button
              variant="success"
              onClick={onMarkRead}
              disabled={marking}
              className="min-w-[180px]"
              aria-label="Mark this devotional as read"
            >
              {marking ? 'Saving…' : 'Mark as Read'}
            </Button>
          </div>
        ) : null}

        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <Button variant="secondary" onClick={onPrevious} disabled={!onPrevious} className="md:w-44">
            Previous Day
          </Button>

          <p className="text-center text-small font-bold text-gray-600">
            Day {page.day_of_month} of {devotional.total_days}
          </p>

          <Button variant="secondary" onClick={onNext} disabled={!onNext} className="md:w-44">
            Next Day
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Button variant="ghost" onClick={onShare}>Share</Button>
          <Button variant="ghost" onClick={onDownload}>Download</Button>
          <Button variant="ghost" onClick={onFullscreen}>Fullscreen</Button>
        </div>
      </div>
    </div>
  );
};
