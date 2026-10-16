import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Calendar, CalendarDays, ClipboardList, Ellipsis, LayoutDashboard, Plus, Sparkles, Users,
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
  /** Opens the overflow sheet instead of navigating. */
  isMore?: boolean;
}

const MORE_PATH = '__more';

const LEADER_TABS: TabItem[] = [
  { label: 'Home',     path: '/',         icon: LayoutDashboard },
  { label: 'Meetings', path: '/meetings', icon: Calendar        },
  { label: 'Tasks',    path: '/tasks',    icon: ClipboardList   },
  { label: 'More',     path: MORE_PATH,   icon: Ellipsis, isMore: true },
];

/** Leaders reach these from the More sheet, so the bar keeps four tabs around the FAB. */
const LEADER_MORE_ITEMS: TabItem[] = [
  { label: 'Members', path: '/members', icon: Users    },
  { label: 'Growth',  path: '/growth',  icon: Sparkles },
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
  const [moreOpen, setMoreOpen] = useState(false);
  const level = ROLE_LEVEL[userRole] ?? 0;
  const isLeader = level >= 1;

  const tabs = isLeader ? LEADER_TABS : MEMBER_TABS;
  const moreItems = isLeader ? LEADER_MORE_ITEMS : [];
  const mid = Math.floor(tabs.length / 2);
  const leftTabs = tabs.slice(0, mid);
  const rightTabs = tabs.slice(mid);

  const renderTab = (tab: TabItem) => {
    const Icon = tab.icon;
    const active = tab.isMore
      ? moreItems.some((item) => item.path === location.pathname)
      : location.pathname === tab.path;
    return (
      <button
        key={tab.path}
        type="button"
        onClick={() => (tab.isMore ? setMoreOpen((open) => !open) : navigate(tab.path))}
        aria-current={!tab.isMore && active ? 'page' : undefined}
        aria-expanded={tab.isMore ? moreOpen : undefined}
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

  const openMoreItem = (path: string) => {
    setMoreOpen(false);
    navigate(path);
  };

  return (
    <>
      {moreOpen && moreItems.length > 0 && (
        <>
          <button
            type="button"
            aria-label="Close more menu"
            onClick={() => setMoreOpen(false)}
            className="md:hidden fixed inset-0 z-40 bg-black/30"
          />
          <div
            role="menu"
            aria-label="More"
            className="md:hidden fixed bottom-20 left-4 right-4 z-50 rounded-xl border border-gray-200 bg-white p-2 shadow-lg dark:border-slate-800 dark:bg-slate-900"
          >
            {moreItems.map((item) => {
              const Icon = item.icon;
              const active = location.pathname === item.path;
              return (
                <button
                  key={item.path}
                  type="button"
                  role="menuitem"
                  onClick={() => openMoreItem(item.path)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium',
                    active
                      ? 'text-york-600 dark:text-york-300'
                      : 'text-gray-700 hover:bg-gray-50 dark:text-slate-200 dark:hover:bg-slate-800',
                  )}
                >
                  <Icon className="h-5 w-5" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/95 dark:bg-slate-950/95 backdrop-blur-md border-t border-gray-200 dark:border-slate-800 safe-bottom"
        aria-label="Mobile navigation"
      >
        <div className="flex items-stretch">
          {/* Equal-width halves keep the FAB centred even when the tab counts differ */}
          <div className="flex flex-1 min-w-0 items-stretch">{leftTabs.map(renderTab)}</div>

          {/* Center FAB */}
          <div className="w-16 shrink-0 flex items-center justify-center min-h-[56px]">
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

          <div className="flex flex-1 min-w-0 items-stretch">{rightTabs.map(renderTab)}</div>
        </div>
      </nav>
    </>
  );
};
