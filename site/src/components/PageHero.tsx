import type { ReactNode } from 'react';

/** Shared header block for list pages: eyebrow, page title and short lead. Sets the page's single h1. */
export function PageHero({ eyebrow, title, lead, children }: { eyebrow: string; title: string; lead?: string; children?: ReactNode }) {
  return (
    <header className="border-b border-paper-edge bg-white px-5 pb-12 pt-12 md:px-8 md:pb-16 md:pt-16">
      <div className="mx-auto max-w-content">
        <p className="font-mono text-xs tracking-[0.14em] text-brand">{eyebrow}</p>
        <h1 className="mt-3 max-w-3xl font-display text-4xl font-bold leading-[1.1] text-ink md:text-5xl">{title}</h1>
        {lead && <p className="mt-4 max-w-prose text-lg text-ink-soft">{lead}</p>}
        {children}
      </div>
    </header>
  );
}
