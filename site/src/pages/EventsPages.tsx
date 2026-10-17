import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EventCard } from '../components/cards';
import { PageHero } from '../components/PageHero';
import { Chip, EmptyState, ExternalButton, Section, buttonClass, SampleTag } from '../components/ui';
import { useSiteContent } from '../content/SiteContentContext';
import { eventTimeRange, formatDate, googleCalendarUrl, icsForEvent, partitionEvents, todayInSiteZone } from '../lib/dates';
import { EXTERNAL_LINK_REL, safeHttpsUrl } from '../lib/links';

export function EventsPage() {
  const { events } = useSiteContent();
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const { upcoming, past } = partitionEvents(events, todayInSiteZone());
  const list = tab === 'upcoming' ? upcoming : past;

  return (
    <>
      <PageHero eyebrow="EVENTS" title="Gatherings, studies and outreach." lead="Find something this week and bring a friend." />
      <Section labelledBy="events-list">
        <h2 id="events-list" className="sr-only">
          Event list
        </h2>
        <div role="group" aria-label="Show events" className="mb-6 flex flex-wrap gap-2">
          <Chip label="Upcoming" pressed={tab === 'upcoming'} onPress={() => setTab('upcoming')} />
          <Chip label="Past" pressed={tab === 'past'} onPress={() => setTab('past')} />
        </div>
        {list.length === 0 ? (
          <EmptyState>{tab === 'upcoming' ? 'No upcoming events are published yet.' : 'No past events to show.'}</EmptyState>
        ) : (
          <div className="grid gap-4">
            {list.map((e) => (
              <EventCard key={e.slug} event={e} />
            ))}
          </div>
        )}
      </Section>
    </>
  );
}

export function EventDetailPage() {
  const { slug = '' } = useParams();
  const { events, settings } = useSiteContent();
  const event = events.find((e) => e.slug === slug);

  if (!event) {
    return (
      <Section>
        <h1 className="font-display text-3xl font-bold text-ink">Event not found</h1>
        <p className="mt-3 text-ink-soft">This event may have ended or been moved.</p>
        <Link to="/events" className="mt-6 inline-block font-bold text-ink hover:text-brand">
          ← All events
        </Link>
      </Section>
    );
  }

  const location = event.location;
  const registration = safeHttpsUrl(event.registrationUrl);
  const stamp = '20260101T000000Z';
  const icsHref = `data:text/calendar;charset=utf-8,${encodeURIComponent(icsForEvent(event, location, stamp))}`;

  return (
    <>
      <header className="border-b border-paper-edge bg-white px-5 pb-10 pt-10 md:px-8 md:pb-14 md:pt-14">
        <div className="mx-auto max-w-content">
          <Link to="/events" className="text-sm font-bold text-ink hover:text-brand">
            ← All events
          </Link>
          <p className="mt-6 font-mono text-xs tracking-[0.14em] text-brand">
            {formatDate(event.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}{' '}
            <SampleTag />
          </p>
          <h1 className="mt-3 font-display text-4xl font-bold leading-tight text-ink md:text-5xl">{event.title}</h1>
          <p className="mt-4 max-w-prose text-lg text-ink-soft">{event.summary}</p>
        </div>
      </header>

      <Section>
        <div className="grid gap-10 md:grid-cols-[1.6fr_1fr]">
          <div className="max-w-prose">
            <p className="text-lg text-ink-soft">{event.body}</p>
          </div>
          <aside aria-label="Event details" className="flex flex-col gap-5 rounded-2xl border border-paper-edge bg-white p-6">
            <dl className="grid gap-4 text-sm">
              <div>
                <dt className="font-bold uppercase tracking-[0.1em] text-ink-muted">When</dt>
                <dd className="mt-1 text-ink">
                  {formatDate(event.date, { weekday: 'long', month: 'long', day: 'numeric' })}, {eventTimeRange(event)}
                </dd>
              </div>
              <div>
                <dt className="font-bold uppercase tracking-[0.1em] text-ink-muted">Where</dt>
                <dd className="mt-1 text-ink">
                  {event.venue}
                  <br />
                  {location}
                </dd>
              </div>
            </dl>

            <div className="flex flex-col gap-3">
              {registration ? (
                <ExternalButton href={registration}>Register</ExternalButton>
              ) : (
                <p className="text-sm text-ink-muted">No registration needed, or details are still to come.</p>
              )}
              <a
                href={googleCalendarUrl(event, location)}
                target="_blank"
                rel={EXTERNAL_LINK_REL}
                className={buttonClass('secondary')}
              >
                Add to Google Calendar <span className="sr-only">(opens in a new tab)</span>
              </a>
              <a href={icsHref} download={`${event.slug}.ics`} className={buttonClass('secondary')}>
                Download .ics file
              </a>
              <button
                type="button"
                onClick={() => {
                  const url = window.location.href;
                  void navigator.clipboard?.writeText(url).catch(() => undefined);
                }}
                className={buttonClass('ghost', 'justify-start px-0')}
              >
                Copy shareable link
              </button>
            </div>
            <p className="text-xs text-ink-muted">Calendar times use {settings.name}'s local time zone (Toronto).</p>
          </aside>
        </div>
      </Section>
    </>
  );
}
