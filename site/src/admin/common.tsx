import { useEffect, useId, useRef, type ReactNode } from 'react';
import { buttonClass } from '../components/ui';
import { ApiError } from '../api/websiteApi';

export const inputClass = 'min-h-[44px] w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand';

export function Card({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="rounded-2xl border border-paper-edge bg-white p-5 md:p-7">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id={id} className="font-display text-2xl font-bold text-ink">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode }) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errId = `${id}-error`;
  const describedBy = [hint ? hintId : '', error ? errId : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-bold text-ink">{label}</label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {hint && <p id={hintId} className="text-xs text-ink-muted">{hint}</p>}
      {error && <p id={errId} className="text-sm font-medium text-brand">{error}</p>}
    </div>
  );
}

export function Notice({ tone, children }: { tone: 'ok' | 'error' | 'info'; children: ReactNode }) {
  const cls = tone === 'ok' ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : tone === 'error' ? 'border-brand bg-brand-soft text-ink' : 'border-paper-edge bg-paper text-ink-soft';
  return <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-xl border px-4 py-3 text-sm ${cls}`}>{children}</div>;
}

/** Turns any thrown error into a sentence a person can act on. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return e instanceof Error ? e.message : 'Something went wrong. Try again.';
}

export function Button({ variant = 'primary', onClick, disabled, type = 'button', children }: { variant?: 'primary' | 'secondary' | 'ghost'; onClick?: () => void; disabled?: boolean; type?: 'button' | 'submit'; children: ReactNode }) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={buttonClass(variant, disabled ? 'opacity-60' : '')}>
      {children}
    </button>
  );
}

/** Confirmation dialog: traps focus inside, closes on Escape, and returns focus to the element that opened it. */
export function ConfirmDialog({ title, summary, confirmLabel, onConfirm, onCancel }: { title: string; summary: string[]; confirmLabel: string; onConfirm: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(typeof document !== 'undefined' ? document.activeElement : null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button[data-autofocus]')?.focus();
    const back = opener.current as HTMLElement | null;
    return () => back?.focus?.();
  }, []);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onCancel();
    if (e.key === 'Tab' && ref.current) {
      const items = Array.from(ref.current.querySelectorAll<HTMLElement>('button'));
      if (items.length === 0) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 md:items-center">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="confirm-title" onKeyDown={onKeyDown} className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <h2 id="confirm-title" className="font-display text-2xl font-bold">{title}</h2>
        {summary.length ? (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink-soft">{summary.map((s) => <li key={s}>{s}</li>)}</ul>
        ) : (
          <p className="mt-3 text-sm text-ink-soft">No visible changes compared with the published version.</p>
        )}
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
          <button type="button" data-autofocus onClick={onConfirm} className={buttonClass('primary')}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

/** Preview frame at one of the four target widths. The content renders at real width inside a scrollable frame. */
export function PreviewFrame({ width, children }: { width: number; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-paper-edge bg-paper p-3">
      <div className="mx-auto max-w-full rounded-lg bg-white p-4 shadow-sm" style={{ width: Math.min(width, 1440), maxWidth: '100%' }}>
        {children}
      </div>
    </div>
  );
}
