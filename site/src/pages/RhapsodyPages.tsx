import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EditionCard } from '../components/cards';
import { PageHero } from '../components/PageHero';
import { Chip, EmptyState, Section } from '../components/ui';
import { useSiteContent } from '../content/SiteContentContext';
import type { RhapsodyKind } from '../content/types';
import { formatDate } from '../lib/dates';

const KINDS: ('All' | RhapsodyKind)[] = ['All', 'Monthly', 'Daily'];

export function RhapsodyPage() {
  const { rhapsody } = useSiteContent();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<'All' | RhapsodyKind>('All');

  const editions = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rhapsody.filter(
      (r) => (kind === 'All' || r.kind === kind) && (!q || `${r.title} ${r.kind} ${r.blurb}`.toLowerCase().includes(q)),
    );
  }, [rhapsody, query, kind]);

  return (
    <>
      <PageHero
        eyebrow="RHAPSODY OF REALITIES"
        title="Daily inspiration for a victorious life."
        lead="Read online or download this month's edition. Free, no sign-in needed."
      />
      <Section labelledBy="rhapsody-library">
        <h2 id="rhapsody-library" className="sr-only">
          Edition library
        </h2>
        <div className="mb-6 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="rhapsody-search" className="text-sm font-bold text-ink">
              Search editions
            </label>
            <input
              id="rhapsody-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by month or date"
              className="min-h-[44px] rounded-lg border border-gray-300 bg-white px-3 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            />
          </div>
          <div role="group" aria-label="Edition type" className="flex flex-wrap gap-2">
            {KINDS.map((k) => (
              <Chip key={k} label={k} pressed={kind === k} onPress={() => setKind(k)} />
            ))}
          </div>
        </div>
        <p className="mb-4 text-sm text-ink-muted" role="status">
          {editions.length} {editions.length === 1 ? 'edition' : 'editions'}
        </p>
        {editions.length === 0 ? (
          <EmptyState>No editions match your search.</EmptyState>
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            {editions.map((e) => (
              <EditionCard key={e.slug} edition={e} />
            ))}
          </div>
        )}
      </Section>
    </>
  );
}

export function RhapsodyReaderPage() {
  const { slug = '' } = useParams();
  const { rhapsody } = useSiteContent();
  const index = rhapsody.findIndex((r) => r.slug === slug);
  const edition = index >= 0 ? rhapsody[index] : undefined;

  if (!edition) {
    return (
      <Section>
        <h1 className="font-display text-3xl font-bold text-ink">Edition not found</h1>
        <Link to="/rhapsody" className="mt-6 inline-block font-bold text-ink hover:text-brand">
          ← Rhapsody library
        </Link>
      </Section>
    );
  }

  const newer = index > 0 ? rhapsody[index - 1] : undefined;
  const older = index < rhapsody.length - 1 ? rhapsody[index + 1] : undefined;
  const period = formatDate(edition.period, { month: 'long', year: 'numeric' });

  return (
    <>
      <header className="border-b border-paper-edge bg-white px-5 pb-8 pt-10 md:px-8 md:pt-14">
        <div className="mx-auto flex max-w-content flex-wrap items-end justify-between gap-6">
          <div>
            <Link to="/rhapsody" className="text-sm font-bold text-ink hover:text-brand">
              ← Rhapsody library
            </Link>
            <p className="mt-6 font-mono text-xs tracking-[0.14em] text-brand">
              {edition.kind.toUpperCase()} · {period}
            </p>
            <h1 className="mt-2 font-display text-4xl font-bold text-ink">{edition.title}</h1>
            <p className="mt-2 text-sm text-ink-muted">Authorised by {edition.authorizedBy}</p>
          </div>
          <a
            href={edition.pdfPath}
            download
            className="inline-flex min-h-[44px] items-center rounded-xl bg-brand px-5 text-sm font-bold text-white no-underline hover:bg-brand-hover hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
          >
            Download PDF
          </a>
        </div>
      </header>

      <Section>
        <div className="overflow-hidden rounded-2xl border border-paper-edge bg-white">
          <object data={`${edition.pdfPath}#view=FitH`} type="application/pdf" title={`${edition.title} reader`} className="h-[70vh] min-h-[420px] w-full">
            <p className="p-6 text-ink-soft">
              Your browser cannot display this PDF here.{' '}
              <a href={edition.pdfPath} className="font-bold text-ink underline">
                Open or download {edition.title} (PDF)
              </a>
              .
            </p>
          </object>
        </div>

        <nav aria-label="Other editions" className="mt-8 flex flex-wrap justify-between gap-4">
          {newer ? (
            <Link to={`/rhapsody/${newer.slug}`} className="font-bold text-ink hover:text-brand">
              ← {newer.title}
            </Link>
          ) : (
            <span />
          )}
          {older ? (
            <Link to={`/rhapsody/${older.slug}`} className="font-bold text-ink hover:text-brand">
              {older.title} →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      </Section>
    </>
  );
}
