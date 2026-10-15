import React from 'react';
import { cn } from '../../lib/utils';

interface DashboardCardProps {
  title: string;
  action?: { label: string; onClick: () => void };
  children: React.ReactNode;
  className?: string;
  noPadding?: boolean;
}

export const DashboardCard: React.FC<DashboardCardProps> = ({
  title, action, children, className, noPadding,
}) => (
  <section className={cn('bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl shadow-sm', className)}>
    <div className="flex items-center justify-between px-5 pt-4 pb-3">
      <h2 className="text-sm font-bold text-gray-900 dark:text-slate-100">{title}</h2>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="text-xs font-semibold text-york-600 hover:text-york-700 transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
    <div className="border-t border-gray-100 dark:border-slate-700" />
    <div className={noPadding ? undefined : 'px-5 py-4'}>
      {children}
    </div>
  </section>
);

export const Skeleton: React.FC<{ className?: string }> = ({ className }) => (
  <div className={cn('bg-gray-200 dark:bg-slate-700 rounded-lg animate-pulse', className)} />
);
