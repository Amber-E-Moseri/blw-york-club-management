import { Link } from 'react-router-dom';
import { PageHero } from '../components/PageHero';
import { ExternalButton, Section, SectionHeading } from '../components/ui';
import { useSiteContent } from '../content/SiteContentContext';
import { safeHttpsUrl } from '../lib/links';

export function FoundationSchoolPage() {
  const { foundationSchool: fs, settings } = useSiteContent();
  const enrolUrl = safeHttpsUrl(settings.foundationEnrollUrl);

  return (
    <>
      <PageHero eyebrow="FOUNDATION SCHOOL" title={fs.headline} lead={fs.intro} />

      <Section labelledBy="fs-what">
        <div className="grid gap-8 md:grid-cols-2">
          <div>
            <SectionHeading id="fs-what" eyebrow="The course" title="What Foundation School is" />
            <p className="text-lg text-ink-soft">{fs.whatItIs}</p>
          </div>
          <div>
            <h2 className="font-display text-2xl font-bold text-ink">Who it is for</h2>
            <p className="mt-3 text-lg text-ink-soft">{fs.whoItIsFor}</p>
          </div>
        </div>
      </Section>

      <Section labelledBy="fs-learn" tone="card">
        <SectionHeading id="fs-learn" eyebrow="Curriculum" title="What participants will learn" />
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {fs.learn.map((item) => (
            <li key={item.title} className="rounded-2xl border border-paper-edge bg-paper p-6">
              <h3 className="font-display text-xl font-bold text-ink">{item.title}</h3>
              <p className="mt-2 text-ink-soft">{item.text}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section labelledBy="fs-journey">
        <SectionHeading id="fs-journey" eyebrow="Step by step" title="The learning journey" />
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {fs.journey.map((step) => (
            <li key={step.step} className="rounded-2xl border border-paper-edge bg-white p-6">
              <p className="font-mono text-xs text-brand">{step.step}</p>
              <h3 className="mt-2 font-display text-xl font-bold text-ink">{step.title}</h3>
              <p className="mt-2 text-ink-soft">{step.text}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section labelledBy="fs-benefits" tone="card">
        <SectionHeading id="fs-benefits" eyebrow="Benefits" title="What you gain" />
        <ul className="grid list-disc gap-3 pl-6 text-lg text-ink-soft marker:text-brand md:grid-cols-2">
          {fs.benefits.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      </Section>

      <Section labelledBy="fs-enrol" tone="ink">
        <h2 id="fs-enrol" className="font-display text-3xl font-bold md:text-4xl">
          How to enrol
        </h2>
        <ol className="mt-6 grid list-decimal gap-3 pl-6 text-gray-100 marker:font-bold marker:text-white">
          {fs.enrolSteps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <div className="mt-8">
          {enrolUrl ? (
            <>
              <ExternalButton href={enrolUrl}>Enrol in Foundation School</ExternalButton>
              <p className="mt-3 max-w-prose text-sm text-gray-300">
                You will move to the Rock Solid Ops site to complete enrolment. Foundation School registration, classes and
                progress are managed there, not on this website.
              </p>
            </>
          ) : (
            <p className="rounded-xl border border-dashed border-gray-400 px-4 py-3 text-gray-200">
              Enrolment details coming soon. Please check back or{' '}
              <Link to="/contact" className="font-bold text-white underline">
                contact us
              </Link>{' '}
              with questions.
            </p>
          )}
        </div>
      </Section>

      <Section labelledBy="fs-faq">
        <SectionHeading id="fs-faq" eyebrow="Questions" title="Frequently asked questions" />
        <div className="grid max-w-3xl gap-3">
          {fs.faqs.map((f) => (
            <details key={f.question} className="group rounded-xl border border-paper-edge bg-white p-5 open:shadow-sm">
              <summary className="min-h-[44px] cursor-pointer list-none font-bold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                {f.question}
              </summary>
              <p className="mt-3 text-ink-soft">{f.answer}</p>
            </details>
          ))}
        </div>
        <p className="mt-8 text-ink-soft">
          Still have a question?{' '}
          <Link to="/contact" className="font-bold text-ink hover:text-brand">
            Contact us →
          </Link>
        </p>
      </Section>
    </>
  );
}
