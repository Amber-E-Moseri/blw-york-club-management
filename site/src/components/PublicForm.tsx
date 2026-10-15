import { useState, type ChangeEvent, type FormEvent } from 'react';
import { validateForm, type FieldSpec } from '../lib/forms';
import { buttonClass } from './ui';

interface Props {
  idPrefix: string;
  title: string;
  intro: string;
  submitLabel: string;
  consentText: string;
  fields: FieldSpec[];
  /** Shown after a valid submission. This preview never transmits or stores what was typed. */
  successMessage: string;
  /** When provided, a valid submission is sent through it. Without it, the form stays client-side only. */
  onSubmitValid?: (values: Record<string, string>, honeypot: string, consentText: string) => Promise<void>;
}

const inputBase =
  'min-h-[44px] w-full rounded-lg border bg-white px-3 py-2 text-base text-ink placeholder:text-gray-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand';

/**
 * Accessible form with client-side validation only. Errors are linked to their fields with aria-describedby, the
 * first invalid field receives focus, and a status region announces success. There is no network request.
 */
export function PublicForm({ idPrefix, title, intro, submitLabel, consentText, fields, successMessage, onSubmitValid }: Props) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [consent, setConsent] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [honey, setHoney] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const result = validateForm(fields, values, consent);
    setErrors(result.errors);
    setConsentError(result.consentError);
    const ok = Object.keys(result.errors).length === 0 && !result.consentError;
    if (ok && onSubmitValid) {
      setSubmitting(true);
      setSubmitError(null);
      try {
        await onSubmitValid(values, honey, consentText);
        setSent(true);
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : 'Your message could not be sent. Please try again.');
      } finally {
        setSubmitting(false);
      }
      return;
    }
    setSent(ok);
    if (!ok) {
      const firstId = fields.find((f) => result.errors[f.id])?.id ?? 'consent';
      document.getElementById(`${idPrefix}-${firstId}`)?.focus();
    }
  };

  if (sent) {
    return (
      <div role="status" className="rounded-2xl border border-paper-edge bg-white p-8">
        <p className="font-display text-2xl font-bold text-ink">Thank you.</p>
        <p className="mt-2 text-ink-soft">{successMessage}</p>
      </div>
    );
  }

  return (
    <form noValidate onSubmit={onSubmit} aria-labelledby={`${idPrefix}-title`} className="rounded-2xl border border-paper-edge bg-white p-6 md:p-10">
      <h2 id={`${idPrefix}-title`} className="font-display text-2xl font-bold text-ink">
        {title}
      </h2>
      <p className="mt-2 text-ink-muted">{intro}</p>
      <p className="mt-2 text-xs text-ink-muted">Fields marked * are required.</p>

      <div className="mt-6 grid gap-5 md:grid-cols-2">
        {fields.map((spec) => {
          const id = `${idPrefix}-${spec.id}`;
          const errorId = `${id}-error`;
          const hasError = Boolean(errors[spec.id]);
          const common = {
            id,
            name: spec.id,
            required: spec.required,
            'aria-required': spec.required,
            'aria-invalid': hasError,
            'aria-describedby': hasError ? errorId : undefined,
            value: values[spec.id] ?? '',
            onChange: (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
              setValues((v) => ({ ...v, [spec.id]: e.target.value })),
            className: `${inputBase} ${hasError ? 'border-brand' : 'border-gray-300'}`,
          };
          const wide = spec.kind === 'textarea' ? 'md:col-span-2' : '';
          return (
            <div key={spec.id} className={`flex flex-col gap-1.5 ${wide}`}>
              <label htmlFor={id} className="text-sm font-bold text-ink">
                {spec.label}
                {spec.required ? ' *' : ''}
              </label>
              {spec.kind === 'select' ? (
                <select {...common}>
                  <option value="" disabled>
                    Choose one
                  </option>
                  {spec.options?.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : spec.kind === 'textarea' ? (
                <textarea {...common} rows={5} autoComplete="off" />
              ) : (
                <input {...common} type={spec.kind} autoComplete={spec.autoComplete} />
              )}
              {hasError && (
                <p id={errorId} className="text-sm font-medium text-brand">
                  {errors[spec.id]}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-6">
        <label className="flex cursor-pointer items-start gap-3 text-sm text-ink-soft">
          <input
            id={`${idPrefix}-consent`}
            type="checkbox"
            checked={consent}
            onChange={(e) => {
              setConsent(e.target.checked);
              setConsentError(null);
            }}
            aria-invalid={Boolean(consentError)}
            aria-describedby={consentError ? `${idPrefix}-consent-error` : undefined}
            className="mt-1 h-5 w-5 flex-none accent-brand"
          />
          <span>{consentText}</span>
        </label>
        {consentError && (
          <p id={`${idPrefix}-consent-error`} className="mt-2 text-sm font-medium text-brand">
            {consentError}
          </p>
        )}
      </div>

      {/* Hidden from people and assistive technology. Bots fill every field, so a value here is a bot signal. */}
      <div hidden aria-hidden="true">
        <label>
          Website (leave empty)
          <input type="text" name="website" tabIndex={-1} autoComplete="off" value={honey} onChange={(e) => setHoney(e.target.value)} />
        </label>
      </div>

      {submitError && (
        <p role="alert" className="mt-6 text-sm font-medium text-brand">
          {submitError}
        </p>
      )}

      <button type="submit" disabled={submitting} className={`${buttonClass('primary')} mt-8 w-full md:w-auto`}>
        {submitting ? 'Sending…' : submitLabel}
      </button>
    </form>
  );
}
