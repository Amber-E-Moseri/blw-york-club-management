import { Link } from 'react-router-dom';
import { EventCard, EditionCard, PostCard } from '../components/cards';
import { ExternalButton, ButtonLink, EmptyState, ImagePlaceholder, Section, SectionHeading } from '../components/ui';
import { useSiteContent } from '../content/SiteContentContext';
import { partitionEvents, todayInSiteZone } from '../lib/dates';
import { safeHttpsUrl } from '../lib/links';

export function HomePage() {
  const content = useSiteContent();
  const { home: publishedHome, settings, about, events, posts, rhapsody, newHere } = content;
  // Unpublished home copy is never shown: the hero falls back to the site name only.
  const home = content.publishedPages.home ? publishedHome : { ...publishedHome, eyebrow: '', headingLead: settings.name, headingAccent: '', headingTail: '', body: '' };
  const today = todayInSiteZone();
  const upcoming = partitionEvents(events, today).upcoming.slice(0, 3);
  const latestPosts = posts.slice(0, 3);
  const monthly = rhapsody.filter((r) => r.kind === 'Monthly');
  const currentEdition = monthly[0];
  const enrolUrl = safeHttpsUrl(settings.foundationEnrollUrl);

  return (
    <>
      <section aria-labelledby="home-hero" className="relative overflow-hidden bg-paper">
        <div className="mx-auto grid max-w-content items-center gap-10 px-5 pb-12 pt-10 md:px-8 md:pb-16 md:pt-14 lg:grid-cols-[1.1fr_1fr] lg:gap-14">
          <div>
            <p className="text-[11px] font-medium tracking-[0.3em] text-ink">{home.eyebrow}</p>
            <h1 id="home-hero" className="mt-4 font-display text-4xl font-bold leading-[1.08] tracking-[-0.01em] text-ink sm:text-5xl lg:text-[58px]">
              {home.headingLead} <span className="text-brand">{home.headingAccent}</span> {home.headingTail}
            </h1>
            <p className="mt-5 max-w-[520px] text-base leading-relaxed text-ink-soft md:text-[17px]">{home.body}</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <ButtonLink to="/new-here">Plan Your Visit</ButtonLink>
              <ButtonLink to="/rhapsody" variant="secondary">
                Download Rhapsody
              </ButtonLink>
            </div>
          </div>
          {settings.heroImageUrl ? (
            <img src={settings.heroImageUrl} alt="" loading="lazy" decoding="async" className="aspect-[4/3] w-full rounded-2xl object-cover lg:aspect-[5/4]" />
          ) : settings.isSample ? (
            <ImagePlaceholder label="students gathered on campus" className="aspect-[4/3] w-full lg:aspect-[5/4]" />
          ) : null}
        </div>

        <dl className="mx-5 mb-12 grid gap-px overflow-hidden rounded-2xl border border-paper-edge bg-paper-edge md:mx-auto md:max-w-content md:grid-cols-3">
          <div className="bg-white p-5">
            <dt className="text-xs font-bold uppercase tracking-[0.12em] text-brand">{settings.serviceDay.replace(/s$/, '')} Service</dt>
            <dd className="mt-1 text-ink">{settings.serviceTime}</dd>
          </div>
          <div className="bg-white p-5">
            <dt className="text-xs font-bold uppercase tracking-[0.12em] text-brand">Location</dt>
            <dd className="mt-1 text-ink">{settings.address}</dd>
          </div>
          <div className="bg-white p-5">
            <dt className="text-xs font-bold uppercase tracking-[0.12em] text-brand">All are welcome</dt>
            <dd className="mt-1 text-ink">Students · Friends · Newcomers</dd>
          </div>
        </dl>
      </section>

      <Section labelledBy="home-events" tone="card">
        <SectionHeading id="home-events" eyebrow="Happening soon" title="Upcoming events" />
        {upcoming.length === 0 ? (
          <EmptyState>No upcoming events are published yet. Check back soon.</EmptyState>
        ) : (
          <div className="grid gap-4">
            {upcoming.map((e) => (
              <EventCard key={e.slug} event={e} />
            ))}
          </div>
        )}
        <p className="mt-6">
          <Link to="/events" className="font-bold text-ink hover:text-brand">
            See all events →
          </Link>
        </p>
      </Section>

      {about.ministries.length > 0 && (
      <Section labelledBy="home-ministries">
        <SectionHeading id="home-ministries" eyebrow="What we do" title="Ministries for every season" />
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {about.ministries.map((m, i) => (
            <li key={m.title} className="rounded-2xl border border-paper-edge bg-white p-6">
              <p className="font-mono text-xs text-brand">{String(i + 1).padStart(2, '0')}</p>
              <h3 className="mt-2 font-display text-xl font-bold text-ink">{m.title}</h3>
              <p className="mt-2 text-ink-soft">{m.text}</p>
            </li>
          ))}
        </ul>
      </Section>
      )}

      <Section labelledBy="home-foundation" tone="ink">
        <div className="grid gap-8 md:grid-cols-[1.2fr_1fr] md:items-center">
          <div>
            <p className="font-mono text-xs tracking-[0.14em] text-gray-300">FOUNDATION SCHOOL</p>
            <h2 id="home-foundation" className="mt-3 font-display text-3xl font-bold leading-tight md:text-4xl">
              {content.foundationSchool.headline}
            </h2>
            <p className="mt-4 max-w-prose text-gray-200">{content.foundationSchool.intro}</p>
          </div>
          <div className="flex flex-col gap-3 md:items-end">
            {enrolUrl ? (
              <ExternalButton href={enrolUrl}>Enrol in Foundation School</ExternalButton>
            ) : (
              <p className="text-sm text-gray-200">Enrolment details coming soon.</p>
            )}
            <Link to="/foundation-school" className="font-bold text-white underline-offset-4 hover:underline">
              Learn more →
            </Link>
          </div>
        </div>
      </Section>

      <Section labelledBy="home-blog" tone="card">
        <SectionHeading id="home-blog" eyebrow="From the blog" title="Latest stories" />
        <div className="grid gap-6 md:grid-cols-3">
          {latestPosts.map((p) => (
            <PostCard key={p.slug} post={p} />
          ))}
        </div>
        <p className="mt-6">
          <Link to="/blog" className="font-bold text-ink hover:text-brand">
            Read the blog →
          </Link>
        </p>
      </Section>

      <Section labelledBy="home-rhapsody">
        <SectionHeading
          id="home-rhapsody"
          eyebrow="Rhapsody of Realities"
          title="Daily inspiration for a victorious life"
          lead="Read online or download this month's edition. Free, no sign-in needed."
        />
        {currentEdition && <EditionCard edition={currentEdition} />}
        <p className="mt-6">
          <Link to="/rhapsody" className="font-bold text-ink hover:text-brand">
            Browse the library →
          </Link>
        </p>
      </Section>

      <Section labelledBy="home-new" tone="card">
        <div className="grid gap-8 lg:grid-cols-[1fr_1.1fr] lg:items-center">
          <div>
            <SectionHeading id="home-new" eyebrow="New here?" title="We'd love to meet you." />
            <ul className="grid gap-3 sm:grid-cols-3">
              {newHere.welcomePoints.map((w) => (
                <li key={w.title} className="rounded-xl border border-paper-edge bg-paper p-4">
                  <p className="font-bold text-ink">{w.title}</p>
                  <p className="mt-1 text-sm text-ink-soft">{w.text}</p>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col items-start gap-3">
            <p className="text-ink-soft">{newHere.expectations[0]?.text}</p>
            <ButtonLink to="/new-here">What to expect</ButtonLink>
          </div>
        </div>
      </Section>

    </>
  );
}
