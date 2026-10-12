import React from 'react';
import { cn } from '../../lib/utils';

export interface CardProps {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  hasRedBorder?: boolean;
  hoverable?: boolean;
  clickable?: boolean;
  onClick?: () => void;
  className?: string;
  headerAction?: React.ReactNode;
  footer?: React.ReactNode;
  variant?: 'default' | 'elevated' | 'outlined';
  /** @deprecated Use variant prop instead */
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

const variantStyles: Record<NonNullable<CardProps['variant']>, string> = {
  default: 'bg-white border border-gray-200 shadow-sm dark:bg-slate-900 dark:border-slate-800',
  elevated: 'bg-white border border-gray-200 shadow-[0_4px_12px_rgba(0,0,0,0.08)] dark:bg-slate-900 dark:border-slate-800',
  outlined: 'bg-white border border-gray-300 shadow-none dark:bg-slate-900 dark:border-slate-800',
};

/**
 * Flexible card container with optional title, subtitle, header action, and footer.
 *
 * @example
 * <Card title="Today's Devotional" hasRedBorder>
 *   <p>Content goes here</p>
 * </Card>
 *
 * <Card title="Meeting" subtitle="Cell 1" hoverable onClick={() => viewMeeting()} headerAction={<MoreMenu />}>
 *   Meeting details
 * </Card>
 *
 * <Card variant="elevated">High priority content</Card>
 *
 * <Card title="Actions" footer={<Button>Save</Button>}>
 *   Form body
 * </Card>
 *
 * <Card variant="outlined" hoverable clickable onClick={handleClick}>
 *   Clickable card
 * </Card>
 */
export const Card: React.FC<CardProps> = ({
  title,
  subtitle,
  children,
  hasRedBorder = false,
  hoverable = false,
  clickable = false,
  onClick,
  className,
  headerAction,
  footer,
  variant = 'default',
}) => {
  const isInteractive = hoverable || clickable || !!onClick;

  return (
    <div
      className={cn(
        'rounded-lg overflow-hidden transition-all duration-150 ease-in-out',
        variantStyles[variant],
        hasRedBorder && 'border-t-4 border-t-york-600',
        isInteractive && 'hover:shadow-[0_4px_8px_rgba(0,0,0,0.1)] cursor-pointer',
        className
      )}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => (e.key === 'Enter' || e.key === ' ') && onClick() : undefined}
    >
      {/* Header */}
      {(title || headerAction) && (
        <div className="px-4 pt-4 pb-3 border-b border-gray-100 dark:border-slate-800">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              {title && (
                <h3 className="text-sm font-bold text-gray-900 leading-tight truncate dark:text-slate-100">
                  {title}
                </h3>
              )}
              {subtitle && (
                <p className="text-xs text-gray-500 mt-0.5 dark:text-slate-400">{subtitle}</p>
              )}
            </div>
            {headerAction && (
              <div className="shrink-0">{headerAction}</div>
            )}
          </div>
        </div>
      )}

      {/* Body */}
      <div className={cn('p-4', !title && !headerAction && 'pt-4')}>
        {children}
      </div>

      {/* Footer */}
      {footer && (
        <div className="px-4 pb-3.5 pt-3 border-t border-gray-100 dark:border-slate-800">
          {footer}
        </div>
      )}
    </div>
  );
};
