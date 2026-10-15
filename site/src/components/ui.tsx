import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { EXTERNAL_LINK_REL, safeHttpsUrl } from '../lib/links';

type Variant = 'primary' | 'secondary' | 'ghost';

const base =
  'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-bold no-underline transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 md:text-[15px]';

const variants: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-hover hover:text-white',
  secondary: 'border-[1.5px] border-brand bg-white text-ink hover:bg-brand-soft hover:text-ink',
  ghost: 'text-ink underline-offset-4 hover:underline',
};

export function buttonClass(variant: Variant = 'primary', extra = ''): string {
  return [base, variants[variant], extra].join(' ');
}

/** Internal route link styled as a button. */
export function ButtonLink({
  to,
  variant,
  children,
  className,
}: {
  to: string;
  variant?: Variant;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link to={to} className={buttonClass(variant, className)}>
      {children}
    </Link>
  );
}

/**
 * Outbound link styled as a button. Renders nothing when the destination is not a safe https URL, so a missing or
 * mistyped setting never produces a broken or unsafe button. The caller shows its own fallback message.
 */
export function ExternalButton({
  href,
  variant,
  children,
  className,
}: {
  href: string | null | undefined;
  variant?: Variant;
  children: ReactNode;
  className?: string;
}) {
  const safe = safeHttpsUrl(href);
  if (!safe) return null;
  return (
    <a href={safe} target="_blank" rel={EXTERNAL_LINK_REL} className={buttonClass(variant, className)}>
      {children}
      <span aria-hidden="true">↗</span>
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  lead,
  id,
}: {
  eyebrow?: string;
  title: string;
  lead?: string;
  id?: string;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-baseline gap-x-6 gap-y-2">
      <div>
        {eyebrow && <p className="mb-2 font-mono text-xs tracking-[0.14em] text-brand">{eyebrow}</p>}
        <h2 id={id} className="font-display text-3xl font-bold leading-tight text-ink md:text-4xl">
          {title}
        </h2>
      </div>
      {lead && <p className="max-w-prose text-ink-muted">{lead}</p>}
    </div>
  );
}

export function Section({
  children,
  tone = 'paper',
  labelledBy,
  className = '',
}: {
  children: ReactNode;
  tone?: 'paper' | 'card' | 'ink';
  labelledBy?: string;
  className?: string;
}) {
  const tones = {
    paper: 'bg-paper text-ink',
    card: 'bg-paper-card text-ink',
    ink: 'bg-ink text-white',
  } as const;
  return (
    <section aria-labelledby={labelledBy} className={`${tones[tone]} px-5 py-12 md:px-8 md:py-16 ${className}`}>
      <div className="mx-auto max-w-content">{children}</div>
    </section>
  );
}

/** Decorative stand-in for a photograph until approved images exist. Carries an accessible label. */
export function ImagePlaceholder({ label, className = '' }: { label: string; className?: string }) {
  return (
    <div
      role="img"
      aria-label={`Placeholder: ${label}`}
      className={`relative overflow-hidden rounded-2xl bg-[repeating-linear-gradient(135deg,#DCCDC0_0_14px,#D2C1B3_14px_28px)] ${className}`}
    >
      <span className="absolute bottom-3 left-3 rounded bg-white/90 px-2 py-1 font-mono text-[11px] text-ink-muted">
        Placeholder image
      </span>
    </div>
  );
}

export function SampleNotice({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-ink-muted/50 bg-white px-4 py-3 text-sm text-ink-muted">
      {children}
    </p>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-ink-muted">
      {children}
    </p>
  );
}

/** Pressed-state chip used for filters. Exposes state through aria-pressed. */
export function Chip({
  label,
  pressed,
  onPress,
}: {
  label: string;
  pressed: boolean;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onPress}
      className={`min-h-[44px] rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
        pressed ? 'border-brand bg-brand text-white' : 'border-gray-300 bg-white text-ink hover:border-ink'
      }`}
    >
      {label}
    </button>
  );
}
