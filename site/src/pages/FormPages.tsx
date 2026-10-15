import { Link } from 'react-router-dom';
import { PageHero } from '../components/PageHero';
import { PublicForm } from '../components/PublicForm';
import { ImagePlaceholder, Section, SectionHeading, SampleNotice } from '../components/ui';
import { useSiteContent } from '../content/SiteContentContext';
import type { FieldSpec } from '../lib/forms';
import { useInquirySubmitter, useTurnstile } from '../content/InquirySubmitContext';
import { TurnstileField } from '../components/TurnstileField';
import { PagePending } from '../components/PagePending';

const RECEIVED = 'Thank you. Your message has been received and will be read by the fellowship team.';

// Demo mode: the site is not connected to a backend, so nothing is sent. The wording must never claim otherwise.
const DEMO_NOTICE = 'This form is not connected to a backend, so nothing was sent or stored.';
const DEMO_TITLE = 'Demo only';

const NEW_HERE_FIELDS: FieldSpec[] = [
  { id: 'name', label: 'Full name', kind: 'text', required: true, autoComplete: 'name' },
  { id: 'email', label: 'Email', kind: 'email', required: true, autoComplete: 'email' },
  { id: 'phone', label: 'Phone (optional)', kind: 'tel', required: false, autoComplete: 'tel' },
  {
    id: 'status',
    label: 'I am a…',
    kind: 'select',
    required: true,
    options: ['Current York student', 'Alumni', 'Visitor or guest', 'Other'],
  },
  {
    id: 'interest',
    label: "I'd like to…",
    kind: 'select',
    required: false,
    options: ['Plan a visit', 'Join a Bible study', 'Learn about Foundation School', 'Serve on a team'],
  },
  { id: 'prayer', label: 'Prayer request (optional)', kind: 'textarea', required: false },
];

const CONTACT_FIELDS: FieldSpec[] = [
  {
    id: 'topic',
    label: 'Topic',
    kind: 'select',
    required: true,
    options: ['General inquiry', 'Events', 'Foundation School', 'Rhapsody of Realities', 'Prayer request'],
  },
  { id: 'name', label: 'Full name', kind: 'text', required: true, autoComplete: 'name' },
  { id: 'email', label: 'Email', kind: 'email', required: true, autoComplete: 'email' },
  { id: 'message', label: 'Message', kind: 'textarea', required: true },
];

export function NewHerePage() {
  const { newHere, settings, publishedPages } = useSiteContent();
  const submit = useInquirySubmitter();
  const turnstileOn = useTurnstile() !== null;
  if (!publishedPages.newHere) return <PagePending title="New Here?" />;
  return (
    <>
      <PageHero
        eyebrow="NEW HERE?"
        title="We'd love to meet you."
        lead="Whether you're a student, a visitor, or just curious, here is what to expect and how to get connected."
      />

      <Section labelledBy="nh-expect">
        <div className="grid gap-8 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <SectionHeading id="nh-expect" eyebrow="Your first visit" title="What to expect" />
            <ul className="grid gap-4 sm:grid-cols-2">
              {newHere.expectations.map((x) => (
                <li key={x.heading} className="rounded-2xl border border-paper-edge bg-white p-5">
                  <h3 className="font-display text-lg font-bold text-ink">{x.heading}</h3>
                  <p className="mt-2 text-ink-soft">{x.text}</p>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col gap-5">
            <ImagePlaceholder label="welcome table at the entrance" className="aspect-[4/3] w-full" />
            <dl className="rounded-2xl border border-paper-edge bg-white p-5 text-sm">
              <div className="flex flex-col gap-1">
                <dt className="font-bold text-ink">When</dt>
                <dd className="text-ink-soft">
                  {settings.serviceDay} · {settings.serviceTime}
                </dd>
              </div>
              <div className="mt-4 flex flex-col gap-1">
                <dt className="font-bold text-ink">Where</dt>
                <dd className="text-ink-soft">
                  {settings.address} · {settings.venue}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </Section>

      <Section labelledBy="nh-faq" tone="card">
        <SectionHeading id="nh-faq" eyebrow="Questions" title="Frequently asked" />
        <div className="grid max-w-3xl gap-3">
          {newHere.faqs.map((f) => (
            <details key={f.question} className="rounded-xl border border-paper-edge bg-white p-5">
              <summary className="min-h-[44px] cursor-pointer list-none font-bold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                {f.question}
              </summary>
              <p className="mt-3 text-ink-soft">{f.answer}</p>
            </details>
          ))}
        </div>
      </Section>

      <Section labelledBy="nh-form">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr]">
          <div>
            <SectionHeading id="nh-form" eyebrow="Get connected" title="Plan your visit" />
            <p className="text-ink-soft">
              Tell us a little about you and we'll follow up. Your prayer request is optional. You can also{' '}
              <Link to="/foundation-school" className="font-bold text-ink hover:text-brand">
                learn about Foundation School
              </Link>
              .
            </p>
            <div className="mt-6">
              <SampleNotice>Forms are not connected yet. Nothing you type here is sent or stored.</SampleNotice>
            </div>
          </div>
          <PublicForm
            idPrefix="nh"
            title="Plan your visit"
            intro="We will only use these details to reply to you about the fellowship."
            submitLabel="Send"
            consentText="I agree that BLW York may use these details to contact me about the fellowship. I can ask for them to be removed at any time."
            fields={NEW_HERE_FIELDS}
            successMessage={submit ? RECEIVED : DEMO_NOTICE}
            successTitle={submit ? undefined : DEMO_TITLE}
            extra={submit && turnstileOn ? <TurnstileField /> : undefined}
            onSubmitValid={submit ? async (v, honeypot, consentText) => submit({
              kind: v.prayer ? 'prayer' : 'new_here', name: v.name, email: v.email, phone: v.phone ?? '',
              message: v.prayer || `Status: ${v.status}. Interest: ${v.interest || 'not stated'}.`,
              topic: v.interest ?? '', consentText, honeypot,
            }) : undefined}
          />
        </div>
      </Section>
    </>
  );
}

export function ContactPage() {
  const { settings } = useSiteContent();
  const submit = useInquirySubmitter();
  const turnstileOn = useTurnstile() !== null;
  return (
    <>
      <PageHero eyebrow="CONTACT US" title="Let's connect." lead="Send us a message and we'll get back to you." />
      <Section labelledBy="contact-form">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr]">
          <div className="flex flex-col gap-6">
            <SectionHeading id="contact-form" eyebrow="Reach us" title="Find us and write to us" />
            <dl className="grid gap-5 text-ink-soft">
              <div>
                <dt className="font-bold text-ink">Email</dt>
                <dd>
                  <a href={`mailto:${settings.email}`} className="underline underline-offset-4 hover:text-brand">
                    {settings.email}
                  </a>
                </dd>
              </div>
              <div>
                <dt className="font-bold text-ink">Gatherings</dt>
                <dd>
                  {settings.serviceDay} · {settings.serviceTime}
                </dd>
              </div>
              <div>
                <dt className="font-bold text-ink">Location</dt>
                <dd>
                  {settings.address}
                  <br />
                  {settings.venue}
                </dd>
              </div>
            </dl>
            <ImagePlaceholder label="campus map (to be added)" className="aspect-[4/3] w-full" />
          </div>
          <PublicForm
            idPrefix="ct"
            title="Send us a message"
            intro="Choose a topic so it reaches the right person."
            submitLabel="Send message"
            consentText="I agree that BLW York may use these details to reply to my message."
            fields={CONTACT_FIELDS}
            successMessage={submit ? RECEIVED : DEMO_NOTICE}
            successTitle={submit ? undefined : DEMO_TITLE}
            extra={submit && turnstileOn ? <TurnstileField /> : undefined}
            onSubmitValid={submit ? async (v, honeypot, consentText) => submit({
              kind: 'contact', name: v.name, email: v.email, phone: '', message: v.message,
              topic: v.topic, consentText, honeypot,
            }) : undefined}
          />
        </div>
      </Section>
    </>
  );
}

export function NotFoundPage() {
  return (
    <Section>
      <h1 className="font-display text-4xl font-bold text-ink">Page not found</h1>
      <p className="mt-3 text-ink-soft">The page you were looking for does not exist or has moved.</p>
      <Link to="/" className="mt-6 inline-block font-bold text-ink hover:text-brand">
        Back to the home page →
      </Link>
    </Section>
  );
}
