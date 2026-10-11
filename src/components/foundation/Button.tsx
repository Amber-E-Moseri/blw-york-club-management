import React from 'react';
import { cn } from '../../lib/utils';

export interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'danger' | 'success' | 'warning' | 'ghost' | 'disabled';
  size?: 'small' | 'medium' | 'large';
  fullWidth?: boolean;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  type?: 'button' | 'submit' | 'reset';
  className?: string;
  children: React.ReactNode;
  'aria-label'?: string;
}

const variantStyles: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary:
    'bg-york-600 text-white hover:bg-york-700 active:bg-york-800 focus:ring-york-600 shadow-sm hover:shadow-md',
  secondary:
    'bg-york-50 dark:bg-york-900/30 text-york-600 dark:text-york-400 border border-york-600 hover:bg-york-100 active:bg-york-200 focus:ring-york-600',
  danger:
    'bg-york-800 text-white hover:bg-york-900 active:bg-york-900 focus:ring-york-800 shadow-sm hover:shadow-md',
  success:
    'bg-green-600 text-white hover:bg-green-700 active:bg-green-800 focus:ring-green-600 shadow-sm hover:shadow-md',
  warning:
    'bg-orange-500 text-white hover:bg-orange-600 active:bg-orange-700 focus:ring-orange-500 shadow-sm hover:shadow-md',
  ghost:
    'bg-transparent text-york-600 dark:text-york-400 hover:bg-york-50 dark:hover:bg-york-900/40 active:bg-york-100 focus:ring-york-600',
  disabled:
    'bg-gray-200 dark:bg-slate-700 text-gray-400 dark:text-slate-400 cursor-not-allowed',
};

const sizeStyles: Record<NonNullable<ButtonProps['size']>, string> = {
  small: 'px-3 py-1.5 text-xs min-h-[44px]',
  medium: 'px-4 py-2.5 text-sm min-h-[40px]',
  large: 'px-6 py-3 text-base min-h-[48px]',
};

const Spinner: React.FC = () => (
  <svg
    className="animate-spin h-4 w-4 shrink-0"
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path
      className="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
    />
  </svg>
);

/**
 * Primary UI button supporting 7 variants, 3 sizes, loading state, and optional icon.
 *
 * @example
 * <Button variant="primary" onClick={handleSave}>Save</Button>
 * <Button variant="secondary" size="small">Cancel</Button>
 * <Button variant="danger" loading>Deleting...</Button>
 * <Button variant="primary" fullWidth loading>Processing...</Button>
 * <Button icon={<SaveIcon />} iconPosition="left">Save Message</Button>
 * <Button variant="ghost" size="large">Learn More</Button>
 * <Button variant="success" size="small">Confirmed</Button>
 */
export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'medium',
  fullWidth = false,
  onClick,
  disabled = false,
  loading = false,
  icon,
  iconPosition = 'left',
  type = 'button',
  className,
  children,
  'aria-label': ariaLabel,
}) => {
  const isDisabled = disabled || loading || variant === 'disabled';

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={isDisabled}
      aria-label={ariaLabel}
      aria-busy={loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 font-bold rounded-md',
        'transition-all duration-150 ease-in-out active:scale-[0.98]',
        'focus:outline-none focus:ring-2 focus:ring-offset-2',
        'min-w-[44px]', // accessibility touch target
        variantStyles[variant],
        sizeStyles[size],
        fullWidth && 'w-full',
        isDisabled && variant !== 'disabled' && 'opacity-60 cursor-not-allowed',
        className
      )}
    >
      {loading && <Spinner />}
      {!loading && icon && iconPosition === 'left' && (
        <span className="shrink-0 inline-flex">{icon}</span>
      )}
      <span>{loading ? 'Loading...' : children}</span>
      {!loading && icon && iconPosition === 'right' && (
        <span className="shrink-0 inline-flex">{icon}</span>
      )}
    </button>
  );
};
