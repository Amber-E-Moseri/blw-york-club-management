import React, { useId } from 'react';
import { cn } from '../../lib/utils';
import { AlertCircle } from 'lucide-react';

export interface InputProps {
  label?: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
  required?: boolean;
  type?: 'text' | 'email' | 'tel' | 'date' | 'time' | 'datetime-local' | 'password' | 'number' | 'textarea';
  maxLength?: number;
  minLength?: number;
  pattern?: string;
  className?: string;
  helpText?: string;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  onFocus?: () => void;
  onBlur?: () => void;
  rows?: number;
  name?: string;
  autoComplete?: string;
  readOnly?: boolean;
}

const fieldBase = [
  'w-full text-sm text-gray-900 bg-white border rounded-md dark:bg-slate-900 dark:text-slate-100',
  'placeholder:text-gray-400 outline-none',
  'transition-all duration-150 ease-in-out',
  'focus:ring-2 focus:ring-york-600 focus:ring-offset-0 focus:border-york-600',
  'disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed',
].join(' ');

/**
 * Comprehensive form field component supporting all HTML input types plus textarea.
 *
 * @example
 * <Input label="Contact Name" placeholder="Enter name" value={name} onChange={setName} required />
 *
 * <Input label="Email" type="email" value={email} onChange={setEmail} error={emailError} helpText="We'll never share your email" />
 *
 * <Input type="textarea" label="Notes" value={notes} onChange={setNotes} maxLength={500} />
 *
 * <Input label="Phone" type="tel" value={phone} onChange={setPhone} icon={<PhoneIcon />} iconPosition="left" />
 *
 * <Input label="Date" type="date" value={date} onChange={setDate} />
 *
 * <Input label="Password" type="password" value={pw} onChange={setPw} required />
 */
export const Input: React.FC<InputProps> = ({
  label,
  placeholder,
  value,
  onChange,
  error,
  disabled = false,
  required = false,
  type = 'text',
  maxLength,
  minLength,
  pattern,
  className,
  helpText,
  icon,
  iconPosition = 'left',
  onFocus,
  onBlur,
  rows = 4,
  name,
  autoComplete,
  readOnly = false,
}) => {
  const generatedId = useId();
  const inputId = `input-${generatedId}`;
  const errorId = `error-${generatedId}`;
  const helpId = `help-${generatedId}`;

  const hasLeftIcon = !!icon && iconPosition === 'left';
  const hasRightIcon = !!icon && iconPosition === 'right';

  const borderClass = error
    ? 'border-york-500 bg-york-50 dark:bg-york-900/30 focus:ring-york-500 focus:border-york-500'
    : 'border-gray-200 dark:border-slate-700';

  const paddingClass = cn(
    'py-3',
    hasLeftIcon ? 'pl-10 pr-4' : hasRightIcon ? 'pl-4 pr-10' : 'px-4'
  );

  const sharedProps = {
    id: inputId,
    name,
    disabled,
    required,
    readOnly,
    value,
    placeholder,
    maxLength,
    minLength,
    pattern,
    autoComplete,
    onFocus,
    onBlur,
    'aria-invalid': !!error,
    'aria-describedby': cn(error && errorId, helpText && !error && helpId) || undefined,
    className: cn(fieldBase, borderClass, paddingClass, className),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange(e.target.value),
  };

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="block text-sm font-bold text-gray-800 dark:text-slate-200 mb-1.5">
          {label}
          {required && <span className="text-york-600 dark:text-york-400 ml-1" aria-hidden="true">*</span>}
        </label>
      )}

      <div className="relative">
        {/* Left icon */}
        {hasLeftIcon && (
          <span
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-400"
            aria-hidden="true"
          >
            {icon}
          </span>
        )}

        {type === 'textarea' ? (
          <textarea
            {...(sharedProps as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
            rows={rows}
            className={cn(sharedProps.className, 'resize-vertical min-h-[120px] leading-relaxed')}
          />
        ) : (
          <input
            {...(sharedProps as React.InputHTMLAttributes<HTMLInputElement>)}
            type={type}
          />
        )}

        {/* Right icon */}
        {hasRightIcon && (
          <span
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-400"
            aria-hidden="true"
          >
            {icon}
          </span>
        )}
      </div>

      {error && (
        <p id={errorId} className="text-xs text-york-600 dark:text-york-400 mt-1.5 flex items-center gap-1" role="alert">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> {error}
        </p>
      )}
      {helpText && !error && (
        <p id={helpId} className="text-xs text-gray-400 dark:text-slate-400 mt-1.5">
          {helpText}
        </p>
      )}
      {maxLength && (
        <p className="text-xs text-gray-400 dark:text-slate-400 mt-1 text-right" aria-live="polite" aria-atomic="true">
          {value.length}/{maxLength}
        </p>
      )}
    </div>
  );
};
