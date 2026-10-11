import React from 'react';

export interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  icon?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}

/**
 * Standard page heading: a bordered card with a brand accent, eyebrow label,
 * title, optional description, and optional action buttons. Keeps every page
 * header in the same visual style, and wraps cleanly on narrow screens.
 */
export const PageHeader: React.FC<PageHeaderProps> = ({ eyebrow, title, icon, description, actions }) => (
  <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl shadow-sm overflow-hidden">
    <div className="border-t-4 border-york-600 px-5 py-5 flex items-start justify-between gap-4 flex-wrap">
      <div className="min-w-0">
        {eyebrow && (
          <p className="text-xs font-semibold text-york-600 dark:text-york-400 uppercase tracking-wider">{eyebrow}</p>
        )}
        <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100 mt-1 flex items-center gap-2">
          {icon}
          {title}
        </h1>
        {description && <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">{description}</p>}
      </div>
      {actions && <div className="flex gap-2 shrink-0 flex-wrap">{actions}</div>}
    </div>
  </div>
);
