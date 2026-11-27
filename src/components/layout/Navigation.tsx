import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Calendar, CalendarDays, ClipboardList, Ellipsis, LayoutGrid, Sparkles,
} from 'lucide-react';

import { cn } from '../../lib/utils';
import type { AuthUser } from '../../lib/auth';
import { useLeadership } from '../../hooks/useLeadership';

interface TabItem {
  label: string;
  path: string;
  icon: React.FC<{ className?: string }>;
}

/** Shown to staff and assigned cell leaders. Chosen by the leadership capability, never by the profile role. */
const LEADER_TABS: TabItem[] = [
  { label: 'Home',     path: '/hub',      icon: LayoutGrid },
  { label: 'Outreach', path: '/hub/contacts', icon: ClipboardList },
  { label: 'Meetings', path: '/hub/meetings', icon: Calendar },
  { label: 'Growth',   path: '/hub/growth',   icon: Sparkles },
];

const MEMBER_TABS: TabItem[] = [
  { label: 'Home',     path: '/hub',      icon: LayoutGrid },
  { label: 'Meetings', path: '/hub/meetings', icon: Calendar },
  { label: 'Events',   path: '/hub/events',   icon: CalendarDays },
  { label: 'Growth',   path: '/hub/growth',   icon: Sparkles },
];

export interface NavigationProps {
  userRole?: AuthUser['role'];
  /** Toggles the full mobile menu drawer; the "More" tab opens it. */
  onMore?: () => void;
  /** Whether the mobile menu drawer is currently open. */
  moreOpen?: boolean;
}

const tabClass = (active: boolean) => cn(
  'relative flex-1 flex flex-col items-center justify-center gap-1 py-2 min-h-[56px] text-[11px] font-medium transition-colors duration-150',
  active
    ? 'text-york-600 dark:text-york-300'
    : 'text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200',
);

export const Navigation: React.FC<NavigationProps> = ({ onMore, moreOpen = false }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { canUseLeaderPages } = useLeadership();

  const tabs = canUseLeaderPages ? LEADER_TABS : MEMBER_TABS;

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-gray-200 dark:border-slate-700 safe-bottom"
      aria-label="Mobile navigation"
    >
      <div className="flex items-stretch">
        {tabs.map((tab) => {
          const active = !moreOpen && location.pathname === tab.path;
          const Icon = tab.icon;
          return (
            <button
              key={tab.path}
              type="button"
              onClick={() => navigate(tab.path)}
              aria-current={active ? 'page' : undefined}
              aria-label={tab.label}
              className={tabClass(active)}
            >
              {active && <span className="absolute top-0 w-6 h-0.5 bg-york-600 dark:bg-york-400 rounded-b-full" />}
              <Icon className={cn('w-5 h-5', active && 'text-york-600 dark:text-york-300')} />
              <span>{tab.label}</span>
            </button>
          );
        })}

        {onMore && (
          <button
            type="button"
            onClick={onMore}
            aria-expanded={moreOpen}
            aria-controls="mobile-nav-drawer"
            aria-label="More"
            className={tabClass(moreOpen)}
          >
            {moreOpen && <span className="absolute top-0 w-6 h-0.5 bg-york-600 dark:bg-york-400 rounded-b-full" />}
            <Ellipsis className="w-5 h-5" />
            <span>More</span>
          </button>
        )}
      </div>
    </nav>
  );
};
