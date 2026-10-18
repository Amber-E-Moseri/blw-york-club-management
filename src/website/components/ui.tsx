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
