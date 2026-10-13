import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Calendar, CalendarDays, ClipboardList, LayoutDashboard, Plus, Sparkles, Users,
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
}

const LEADER_TABS: TabItem[] = [
  { label: 'Home',     path: '/',         icon: LayoutDashboard },
  { label: 'Members',  path: '/members',  icon: Users           },
  { label: 'Meetings', path: '/meetings', icon: Calendar        },
  { label: 'Tasks',    path: '/tasks',    icon: ClipboardList   },
  { label: 'Growth',   path: '/growth',   icon: Sparkles        },
];

const MEMBER_TABS: TabItem[] = [
  { label: 'Home',     path: '/',         icon: LayoutDashboard },
  { label: 'Meetings', path: '/meetings', icon: Calendar        },
  { label: 'Events',   path: '/events',   icon: CalendarDays    },
  { label: 'Tasks',    path: '/tasks',    icon: ClipboardList   },
  { label: 'Growth',   path: '/growth',   icon: Sparkles        },
];

export interface NavigationProps {
  userRole?: AuthUser['role'];
  onQuickAdd?: () => void;
}

export const Navigation: React.FC<NavigationProps> = ({ userRole = 'member', onQuickAdd }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const level = ROLE_LEVEL[userRole] ?? 0;

  const tabs = level >= 1 ? LEADER_TABS : MEMBER_TABS;
  const mid = Math.floor(tabs.length / 2);
  const leftTabs = tabs.slice(0, mid);
  const rightTabs = tabs.slice(mid);

  const renderTab = (tab: TabItem) => {
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
          'flex-1 flex flex-col items-center justify-center py-2.5 gap-0.5 min-h-[56px] text-[10px] font-medium transition-colors duration-150',
          active
            ? 'text-york-600 dark:text-york-300'
            : 'text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300',
        )}
      >
        <Icon className={cn('w-5 h-5', active && 'scale-110 transition-transform')} />
        <span>{tab.label}</span>
        {active && (
          <span className="absolute bottom-0 w-6 h-0.5 bg-york-600 dark:bg-york-400 rounded-t-full" />
        )}
      </button>
    );
  };

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/95 dark:bg-slate-950/95 backdrop-blur-md border-t border-gray-200 dark:border-slate-800 safe-bottom"
      aria-label="Mobile navigation"
    >
      <div className="flex items-stretch">
        {leftTabs.map(renderTab)}

        {/* Center FAB */}
        <div className="flex-1 flex items-center justify-center min-h-[56px]">
          <button
            type="button"
            onClick={onQuickAdd}
            aria-label="Quick add"
            className={cn(
              'w-12 h-12 -mt-5 rounded-full bg-york-600 text-white shadow-md',
              'flex items-center justify-center',
              'hover:bg-york-700 active:scale-95 transition-all duration-150',
              'focus:outline-none focus:ring-2 focus:ring-york-600 focus:ring-offset-2',
            )}
          >
            <Plus className="w-6 h-6" />
          </button>
        </div>

        {rightTabs.map(renderTab)}
      </div>
    </nav>
  );
};
