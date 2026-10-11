import React from 'react';
import { cn } from '../../lib/utils';

export interface BadgeProps {
  variant?: 'primary' | 'success' | 'warning' | 'error' | 'light' | 'info' | 'red' | 'green' | 'gray' | 'blue';
  size?: 'small' | 'medium';
  children: React.ReactNode;
  className?: string;
}

const variantStyles: Record<NonNullable<BadgeProps['variant']>, string> = {
  primary: 'bg-york-600 text-white',
  success: 'bg-green-500 text-white',
  warning: 'bg-orange-500 text-white',
  error:   'bg-york-600 text-white',
  light:   'bg-york-50 dark:bg-york-900/30 text-york-700 dark:text-york-300',
  info:    'bg-blue-500 text-white',
  // legacy aliases
  red:     'bg-york-100 text-york-700',
  green:   'bg-green-100 text-green-700',
  gray:    'bg-gray-200 text-gray-600 dark:text-slate-300',
  blue:    'bg-blue-100 text-blue-700',
};

const sizeStyles: Record<NonNullable<BadgeProps['size']>, string> = {
  small:  'px-2 py-0.5 text-[10px]',
  medium: 'px-3 py-1 text-xs',
};

/**
 * Pill-shaped status label. Use for role tags, status indicators, counts.
 *
 * @example
 * <Badge variant="primary">Active</Badge>
 * <Badge variant="success">Completed</Badge>
 * <Badge variant="warning">Pending</Badge>
 * <Badge variant="error">Failed</Badge>
 * <Badge variant="light" size="small">Draft</Badge>
 * <Badge variant="info">New</Badge>
 */
export const Badge: React.FC<BadgeProps> = ({
  variant = 'gray',
  size = 'medium',
  children,
  className,
}) => (
  <span
    className={cn(
      'inline-flex items-center justify-center font-bold rounded-full whitespace-nowrap leading-none',
      variantStyles[variant],
      sizeStyles[size],
      className
    )}
  >
    {children}
  </span>
);
