import { ButtonLink, ImagePlaceholder, Section, SectionHeading } from '../components/ui';
import { PageHero } from '../components/PageHero';
import { useSiteContent } from '../content/SiteContentContext';

export function AboutPage() {
  const { about } = useSiteContent();
  return (
    <>
      <PageHero
        eyebrow="ABOUT US"
        title="A community of students growing in God's Word."
        lead="Who we are, what we believe, and how you can be part of what God is doing at York University."
      />

      <Section labelledBy="about-mission">
        <div className="grid gap-8 md:grid-cols-2 md:items-start">
          <div>
            <SectionHeading id="about-mission" eyebrow="Mission" title="Why we exist" />
            <p className="text-lg text-ink-soft">{about.mission}</p>
            <p className="mt-6 font-display text-2xl italic text-ink">{about.vision}</p>
          </div>
          <ImagePlaceholder label="students in a small group" className="aspect-[4/3] w-full" />
        </div>
      </Section>

      <Section labelledBy="about-beliefs" tone="card">
        <SectionHeading id="about-beliefs" eyebrow="Statement of faith" title="What we believe" />
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {about.beliefs.map((b) => (
            <li key={b.title} className="rounded-2xl border border-paper-edge bg-paper p-6">
              <h3 className="font-display text-xl font-bold text-ink">{b.title}</h3>
              <p className="mt-2 text-ink-soft">{b.text}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section labelledBy="about-ministries">
        <SectionHeading id="about-ministries" eyebrow="Fellowship life" title="Our ministries" />
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {about.ministries.map((m) => (
            <li key={m.title} className="rounded-2xl border border-paper-edge bg-white p-6">
              <h3 className="font-display text-xl font-bold text-ink">{m.title}</h3>
              <p className="mt-2 text-ink-soft">{m.text}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section labelledBy="about-leadership" tone="card">
        <SectionHeading id="about-leadership" eyebrow="Leadership" title="Meet the team" />
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {about.leaders.map((l) => (
            <li key={`${l.role}`} className="flex flex-col gap-3">
              <ImagePlaceholder label={`portrait of ${l.role}`} className="aspect-square w-full" />
              <div>
                <p className="font-bold text-ink">{l.name}</p>
                <p className="text-sm text-ink-muted">{l.role}</p>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section labelledBy="about-opportunities">
        <SectionHeading id="about-opportunities" eyebrow="Students" title="Opportunities for students" />
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {about.opportunities.map((o) => (
            <li key={o.title} className="flex flex-col rounded-2xl border border-paper-edge bg-white p-6">
              <h3 className="font-display text-lg font-bold text-ink">{o.title}</h3>
              <p className="mt-2 flex-1 text-ink-soft">{o.text}</p>
            </li>
          ))}
        </ul>
        <div className="mt-8">
          <ButtonLink to="/new-here">Plan your visit</ButtonLink>
        </div>
      </Section>
    </>
  );
}
