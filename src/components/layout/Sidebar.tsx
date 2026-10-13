import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  BarChart3, BookOpen, Calendar, CalendarDays, ChevronLeft, ChevronRight,
  ClipboardCheck, ClipboardList, FileText, KeyRound, LayoutDashboard, LogOut,
  Mail, MessageSquareText, Moon, Settings, Sparkles, Sun, Users, type LucideIcon,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import type { AuthUser } from '../../lib/auth';
import { GlobalSearch } from '../feature/GlobalSearch';
import { useTheme } from '../../hooks/useTheme';
import { useTranslation } from '../../i18n';

const ROLE_LEVEL: Record<AuthUser['role'], number> = {
  member: 0, cell_leader: 1, admin: 2, coordinator: 3,
};

interface NavItem {
  labelKey: string;
  label: string;
  path: string;
  icon: LucideIcon;
  minRole: number;
}

interface NavGroup {
  groupKey: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    groupKey: 'Overview',
    items: [
      { labelKey: 'dashboard', label: 'Overview', path: '/', icon: LayoutDashboard, minRole: 0 },
    ],
  },
  {
    groupKey: 'People',
    items: [
      { labelKey: 'people', label: 'Members', path: '/members', icon: Users, minRole: 1 },
      { labelKey: 'cells', label: 'Cells', path: '/cells', icon: Users, minRole: 1 },
      { labelKey: 'outreach', label: 'Contacts', path: '/contacts', icon: ClipboardList, minRole: 1 },
      { labelKey: 'approvals', label: 'Approvals', path: '/admin/pending', icon: ClipboardCheck, minRole: 2 },
    ],
  },
  {
    groupKey: 'Ministry',
    items: [
      { labelKey: 'meetings', label: 'Meetings', path: '/meetings', icon: Calendar,     minRole: 0 },
      { labelKey: 'events',   label: 'Events',   path: '/events',   icon: CalendarDays, minRole: 0 },
      { labelKey: 'growth',   label: 'Growth',   path: '/growth',   icon: Sparkles,     minRole: 0 },
    ],
  },
  {
    groupKey: 'Resources',
    items: [
      { labelKey: 'devotionals', label: 'Devotionals', path: '/devotionals', icon: BookOpen, minRole: 0 },
      { labelKey: 'messages', label: 'Weekly Messages', path: '/messages', icon: MessageSquareText, minRole: 0 },
      { labelKey: 'targetedMessages', label: 'Messages', path: '/communications', icon: Mail, minRole: 0 },
      { labelKey: 'books', label: 'Books', path: '/books', icon: FileText, minRole: 0 },
      { labelKey: 'testimonies', label: 'Testimonies', path: '/testimonies', icon: Sparkles, minRole: 0 },
    ],
  },
  {
    groupKey: 'Administration',
    items: [
      { labelKey: 'admin', label: 'Admin', path: '/admin', icon: Settings, minRole: 2 },
      { labelKey: 'reports', label: 'Reports', path: '/admin/contact-reports', icon: BarChart3, minRole: 2 },
      { labelKey: 'roles', label: 'Roles & Access', path: '/admin/roles', icon: KeyRound, minRole: 2 },
      { labelKey: 'communications', label: 'Communications', path: '/admin/email-log', icon: Mail, minRole: 2 },
    ],
  },
];

function getInitials(name: string) {
  return name.split(' ').slice(0, 2).map((n) => n[0]).join('').toUpperCase();
}

export interface SidebarProps {
  user: AuthUser | null;
  onSignOut: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  user, onSignOut, collapsed = false, onToggleCollapse,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const level = ROLE_LEVEL[user?.role ?? 'member'] ?? 0;
  const { theme, setTheme } = useTheme();
  const { t } = useTranslation('nav');

  const visibleGroups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((item) => level >= item.minRole),
  })).filter((g) => g.items.length > 0);

  return (
    <aside
      className={cn(
        'shrink-0 bg-white border-r border-gray-200 flex flex-col h-screen sticky top-0 z-20',
        'dark:border-slate-800 dark:bg-slate-950',
        'transition-[width] duration-200 ease-in-out',
        collapsed ? 'w-14' : 'w-52',
      )}
    >
      {/* Logo */}
      <div className={cn('border-b border-gray-100 dark:border-slate-800', collapsed ? 'px-3 py-4' : 'px-4 py-4')}>
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            <img src="/logo.png" alt="BLW York" className="w-8 h-8 object-contain" />
            {onToggleCollapse && (
              <button onClick={onToggleCollapse} aria-label="Expand sidebar" title="Expand" className="w-6 h-6 flex items-center justify-center text-gray-400 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200">
                <ChevronRight className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <img src="/logo.png" alt="BLW York" className="w-8 h-8 rounded-md shrink-0" />
              <div>
                <p className="text-sm font-bold text-gray-900 leading-tight dark:text-slate-100">BLW York Hub</p>
                <p className="text-xs text-gray-400">York University</p>
              </div>
            </div>
            {onToggleCollapse && (
              <button onClick={onToggleCollapse} aria-label="Collapse sidebar" title="Collapse" className="w-6 h-6 flex items-center justify-center text-gray-400 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200">
                <ChevronLeft className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
          </div>
        )}
      </div>

      <GlobalSearch user={user} collapsed={collapsed} />

      <div className={cn('px-2.5 pb-1.5', collapsed && 'px-1.5')}>
        <button
          type="button"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className={cn(
            'flex h-8 w-full items-center rounded-md text-sm font-medium text-gray-500',
            'hover:bg-gray-100 hover:text-gray-900 dark:text-slate-400 dark:hover:bg-slate-800',
            collapsed ? 'justify-center' : 'gap-3 px-3.5',
          )}
          aria-label="Toggle dark mode"
          title="Toggle dark mode"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" aria-hidden="true" /> : <Moon className="w-4 h-4" aria-hidden="true" />}
          {!collapsed && <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>}
        </button>
      </div>

      {/* Nav */}
      <nav className={cn('flex-1 py-2 overflow-y-auto', collapsed ? 'px-1.5' : 'px-2.5')} aria-label="Main navigation">
        {visibleGroups.map((group) => (
          <div key={group.groupKey} className="mb-3">
            {!collapsed && (
              <p className="px-3.5 mb-1 text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-600">
                {group.groupKey}
              </p>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = location.pathname === item.path;
                return (
                  <button
                    key={item.path}
                    type="button"
                    onClick={() => navigate(item.path)}
                    title={collapsed ? item.label : undefined}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center rounded-md text-sm font-medium w-full transition-colors duration-150',
                      collapsed ? 'justify-center h-9 w-9 mx-auto' : 'gap-3 px-3.5 py-2',
                      active
                        ? 'bg-york-50 text-york-600 font-semibold dark:bg-york-900/30 dark:text-york-300'
                        : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100',
                    )}
                  >
                    <item.icon className="w-4 h-4 shrink-0" />
                    {!collapsed && <span>{t(item.labelKey)}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* User footer */}
      {user && (
        <div className={cn('border-t border-gray-100 dark:border-slate-800', collapsed ? 'px-2 py-3' : 'px-3 py-3')}>
          {collapsed ? (
            <div className="flex flex-col items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-york-600 text-white flex items-center justify-center text-xs font-bold">
                {getInitials(user.name)}
              </div>
              <button onClick={onSignOut} aria-label="Sign out" title="Sign out" className="text-gray-400 dark:text-slate-400 hover:text-york-600 transition-colors">
                <LogOut className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-york-600 text-white flex items-center justify-center text-xs font-bold shrink-0">
                  {getInitials(user.name)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-gray-900 truncate dark:text-slate-100">{user.name}</p>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-york-100 dark:bg-york-900/40 text-york-700 dark:text-york-300 font-semibold capitalize">
                    {user.role.replace('_', ' ')}
                  </span>
                </div>
              </div>
              <button onClick={onSignOut} className="mt-3 flex items-center gap-1.5 text-xs text-gray-400 dark:text-slate-400 hover:text-gray-600 dark:hover:text-slate-200 transition-colors">
                <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                Sign out
              </button>
            </>
          )}
        </div>
      )}
    </aside>
  );
};
