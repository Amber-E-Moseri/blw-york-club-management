import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ChevronLeft, ChevronRight, LogOut, Moon, Sun } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { AuthUser } from '../../lib/auth';
import { GlobalSearch } from '../feature/GlobalSearch';
import { useTheme } from '../../hooks/useTheme';
import { useTranslation } from '../../i18n';
import { getVisibleNavGroups } from './navItems';

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
  const { theme, setTheme } = useTheme();
  const { t } = useTranslation('nav');

  const visibleGroups = getVisibleNavGroups(user?.role);

  return (
    <aside
      className={cn(
        'shrink-0 bg-white border-r border-gray-200 flex flex-col h-screen sticky top-0 z-20',
        'dark:border-slate-700 dark:bg-slate-900',
        'transition-[width] duration-200 ease-in-out',
        collapsed ? 'w-16' : 'w-56',
      )}
    >
      {/* Logo */}
      <div className={cn('border-b border-gray-100 dark:border-slate-700', collapsed ? 'px-3 py-5' : 'px-5 py-5')}>
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            <img src="/logo.png" alt="BLW York" className="w-8 h-8 object-contain" />
            {onToggleCollapse && (
              <button onClick={onToggleCollapse} aria-label="Expand sidebar" title="Expand" className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-slate-200">
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
              <button onClick={onToggleCollapse} aria-label="Collapse sidebar" title="Collapse" className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-slate-200">
                <ChevronLeft className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
          </div>
        )}
      </div>

      <GlobalSearch user={user} collapsed={collapsed} />

      <div className={cn('px-3 pb-2', collapsed && 'px-2')}>
        <button
          type="button"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className={cn(
            'flex min-h-[40px] w-full items-center rounded-md text-sm font-medium text-gray-500',
            'hover:bg-gray-100 hover:text-gray-900 dark:text-slate-300 dark:hover:bg-slate-800',
            collapsed ? 'justify-center' : 'gap-3 px-4',
          )}
          aria-label="Toggle dark mode"
          title="Toggle dark mode"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" aria-hidden="true" /> : <Moon className="w-4 h-4" aria-hidden="true" />}
          {!collapsed && <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>}
        </button>
      </div>

      {/* Nav */}
      <nav className={cn('flex-1 py-3 overflow-y-auto', collapsed ? 'px-2' : 'px-3')} aria-label="Main navigation">
        {visibleGroups.map((group) => (
          <div key={group.groupKey} className="mb-4">
            {!collapsed && (
              <p className="px-4 mb-1 text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500">
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
                      collapsed ? 'justify-center h-10 w-10 mx-auto' : 'gap-3 px-4 py-2.5',
                      active
                        ? 'bg-red-50 text-york-600 font-semibold dark:bg-york-900/30 dark:text-york-300'
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
        <div className={cn('border-t border-gray-100 dark:border-slate-700', collapsed ? 'px-2 py-3' : 'px-4 py-4')}>
          {collapsed ? (
            <div className="flex flex-col items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-york-600 text-white flex items-center justify-center text-xs font-bold">
                {getInitials(user.name)}
              </div>
              <button onClick={onSignOut} aria-label="Sign out" title="Sign out" className="text-gray-400 hover:text-york-600 transition-colors">
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
                  <span className="text-xs px-2 py-0.5 rounded-full bg-york-100 text-york-700 font-semibold capitalize">
                    {user.role.replace('_', ' ')}
                  </span>
                </div>
              </div>
              <button onClick={onSignOut} className="mt-3 flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-slate-200 transition-colors">
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
