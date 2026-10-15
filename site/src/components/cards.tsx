import { Link } from 'react-router-dom';
import type { BlogPost, PublicEvent, RhapsodyEdition } from '../content/types';
import { eventTimeRange, formatDate } from '../lib/dates';
import { ImagePlaceholder } from './ui';

export function EventCard({ event }: { event: PublicEvent }) {
  const mon = formatDate(event.date, { month: 'short' }).toUpperCase();
  const day = formatDate(event.date, { day: 'numeric' });
  const dow = formatDate(event.date, { weekday: 'short' });
  return (
    <article className="flex flex-col gap-4 rounded-2xl border border-paper-edge bg-white p-5 sm:flex-row sm:items-center">
      <div className="flex w-full flex-none items-center gap-4 sm:w-28 sm:flex-col sm:items-start sm:gap-1">
        <div className="grid h-16 w-16 flex-none place-items-center rounded-xl bg-brand-soft text-center" aria-hidden="true">
          <div>
            <p className="font-mono text-[11px] font-medium text-brand">{mon}</p>
            <p className="font-display text-xl font-bold leading-none text-ink">{day}</p>
          </div>
        </div>
        <p className="text-sm text-ink-muted sm:mt-1">
          <span className="sr-only">Date: </span>
          {dow}
        </p>
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="font-display text-xl font-bold text-ink">
          <Link to={`/events/${event.slug}`} className="text-ink no-underline hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
            {event.title}
          </Link>
        </h3>
        <p className="mt-1 text-sm text-ink-muted">
          {eventTimeRange(event)} · {event.venue}
        </p>
        <p className="mt-2 text-ink-soft">{event.summary}</p>
      </div>
      <Link
        to={`/events/${event.slug}`}
        className="inline-flex min-h-[44px] items-center text-sm font-bold text-ink no-underline hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand sm:flex-none"
      >
        Details <span className="sr-only">for {event.title}</span> <span aria-hidden="true">→</span>
      </Link>
    </article>
  );
}

export function PostCard({ post }: { post: BlogPost }) {
  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border border-paper-edge bg-white">
      <ImagePlaceholder label={`cover image for ${post.title}`} className="aspect-[16/9] rounded-none" />
      <div className="flex flex-1 flex-col gap-3 p-5">
        <p className="font-mono text-xs uppercase tracking-[0.12em] text-brand">{post.category}</p>
        <h3 className="font-display text-xl font-bold leading-snug text-ink">
          <Link to={`/blog/${post.slug}`} className="text-ink no-underline hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
            {post.title}
          </Link>
        </h3>
        <p className="flex-1 text-ink-soft">{post.excerpt}</p>
        <p className="text-xs text-ink-muted">
          {formatDate(post.date, { month: 'short', day: 'numeric', year: 'numeric' })} · {post.readMinutes} min read
        </p>
      </div>
    </article>
  );
}

export function EditionCard({ edition }: { edition: RhapsodyEdition }) {
  return (
    <article className="flex flex-col gap-4 rounded-2xl border border-paper-edge bg-white p-5 sm:flex-row sm:items-start">
      <ImagePlaceholder label={`cover of ${edition.title}`} className="aspect-[3/4] w-full flex-none sm:w-28" />
      <div className="min-w-0 flex-1">
        <p className="font-mono text-xs uppercase tracking-[0.12em] text-brand">{edition.kind}</p>
        <h3 className="mt-1 font-display text-xl font-bold text-ink">{edition.title}</h3>
        <p className="mt-2 text-ink-soft">{edition.blurb}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            to={`/rhapsody/${edition.slug}`}
            className="inline-flex min-h-[44px] items-center rounded-xl bg-ink px-4 text-sm font-bold text-white no-underline hover:bg-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            Read online <span className="sr-only">: {edition.title}</span>
          </Link>
          <a
            href={edition.pdfPath}
            download
            className="inline-flex min-h-[44px] items-center rounded-xl border border-gray-300 bg-white px-4 text-sm font-bold text-ink no-underline hover:border-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            Download PDF <span className="sr-only">for {edition.title}</span>
          </a>
        </div>
      </div>
    </article>
  );
}
