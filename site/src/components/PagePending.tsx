import { Section } from './ui';

/**
 * Shown in production for a page whose content has not been published. It replaces the page instead of showing
 * placeholder copy, so a visitor can never read unapproved text as fellowship information.
 */
export function PagePending({ title }: { title: string }) {
  return (
    <Section labelledBy="page-pending">
      <h1 id="page-pending" className="font-display text-4xl font-bold text-ink">{title}</h1>
      <p role="status" className="mt-4 max-w-prose text-lg text-ink-soft">
        This page is being prepared. Please check back soon.
      </p>
    </Section>
  );
}
