// Client-side validation for the New Here and Contact forms. The public site has no backend yet, so these functions
// only check input and never store or transmit it. A later Edge Function must repeat every rule server-side.

export interface FieldSpec {
  id: string;
  label: string;
  kind: 'text' | 'email' | 'tel' | 'select' | 'textarea';
  required: boolean;
  options?: string[];
  autoComplete?: string;
}

export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function validateField(spec: FieldSpec, value: string): string | null {
  const v = value.trim();
  if (spec.required && !v) return 'Please complete this field.';
  if (spec.kind === 'email' && v && !EMAIL_PATTERN.test(v)) return 'Enter a valid email address.';
  if (spec.kind === 'tel' && v && !/^[+()\d\s-]{7,20}$/.test(v)) return 'Enter a valid phone number.';
  if (spec.kind === 'select' && v && spec.options && !spec.options.includes(v)) return 'Choose one of the options.';
  if (v.length > 2000) return 'Keep this under 2,000 characters.';
  return null;
}

export function validateForm(
  specs: FieldSpec[],
  values: Record<string, string>,
  consent: boolean,
): { errors: Record<string, string>; consentError: string | null } {
  const errors: Record<string, string> = {};
  for (const spec of specs) {
    const message = validateField(spec, values[spec.id] ?? '');
    if (message) errors[spec.id] = message;
  }
  return { errors, consentError: consent ? null : 'Please tick the box to give your consent.' };
}
