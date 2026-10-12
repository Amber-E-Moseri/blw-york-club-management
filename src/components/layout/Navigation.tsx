import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Calendar, CalendarDays, ClipboardList, LayoutDashboard, Sparkles, Users,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import type { AuthUser } from '../../lib/auth';

const ROLE_LEVEL: Record<AuthUser['role'], number> = {
  member: 0, cell_leader: 1, admin: 2, coordinator: 3,
};

interface TabItem {
  label: string;
  path: string;
  icon: React.FC<{ className?: string }>;
  minRole: number;
}

const LEADER_TABS: TabItem[] = [
  { label: 'Home',     path: '/',        icon: LayoutDashboard, minRole: 0 },
  { label: 'People',   path: '/members', icon: Users,           minRole: 1 },
  { label: 'Cells',    path: '/cells',   icon: Users,           minRole: 1 },
  { label: 'Outreach', path: '/contacts', icon: ClipboardList, minRole: 1 },
  { label: 'Meetings', path: '/meetings', icon: Calendar,    minRole: 0 },
  { label: 'Growth',   path: '/growth',   icon: Sparkles,    minRole: 0 },
];

const MEMBER_TABS: TabItem[] = [
  { label: 'Home',     path: '/',        icon: LayoutDashboard, minRole: 0 },
  { label: 'Meetings', path: '/meetings', icon: Calendar,        minRole: 0 },
  { label: 'Events',   path: '/events',   icon: CalendarDays,    minRole: 0 },
  { label: 'Growth',   path: '/growth',   icon: Sparkles,        minRole: 0 },
];

export interface NavigationProps {
  userRole?: AuthUser['role'];
}

export const Navigation: React.FC<NavigationProps> = ({ userRole = 'member' }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const level = ROLE_LEVEL[userRole] ?? 0;

  const tabs = level >= 1 ? LEADER_TABS.filter((t) => level >= t.minRole) : MEMBER_TABS;

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-gray-200 dark:border-slate-700 safe-bottom"
      aria-label="Mobile navigation"
    >
      <div className="flex items-stretch">
        {tabs.map((tab) => {
          const active = location.pathname === tab.path;
          const Icon = tab.icon;
          return (
            <button
              key={tab.path}
              type="button"
              onClick={() => navigate(tab.path)}
              aria-current={active ? 'page' : undefined}
              aria-label={tab.label}
              className={cn(
                'relative flex-1 flex flex-col items-center justify-center py-2.5 gap-0.5 min-h-[56px] text-[11px] font-medium transition-colors duration-150',
                active
                  ? 'text-york-600 dark:text-york-300 font-semibold'
                  : 'text-gray-400 dark:text-slate-400 hover:text-gray-600 dark:hover:text-slate-300',
              )}
            >
              {active && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-1 bg-york-600 dark:bg-york-400 rounded-b-full" />
              )}
              <Icon className={cn('w-5 h-5 transition-transform duration-150', active && 'scale-110')} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
