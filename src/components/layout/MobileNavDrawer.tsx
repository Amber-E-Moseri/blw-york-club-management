import React, { useCallback, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { cn } from '../../lib/utils';
import type { AuthUser } from '../../lib/auth';
import { useTranslation } from '../../i18n';
import { getVisibleNavGroups } from './navItems';

export interface MobileNavDrawerProps {
  open: boolean;
  onClose: () => void;
  user: AuthUser | null;
}

/**
 * Mobile counterpart to the desktop Sidebar. Lists every page the user's role can see,
 * so pages outside the bottom tab bar stay reachable on small screens.
 * Sits below the mobile header (so the hamburger still toggles it) and above the bottom tab bar.
 */
export const MobileNavDrawer: React.FC<MobileNavDrawerProps> = ({ open, onClose, user }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation('nav');
  const groups = getVisibleNavGroups(user?.role);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    // 60px = mobile header; 57px = bottom tab bar (56px min-height + 1px top border, see Navigation.tsx)
    <div className="md:hidden fixed inset-x-0 top-[60px] bottom-[57px] z-40">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <nav
        id="mobile-nav-drawer"
        aria-label="Main navigation"
        className="absolute inset-y-0 left-0 w-72 max-w-[85%] overflow-y-auto bg-white dark:bg-slate-900 shadow-xl px-3 py-4"
      >
        {groups.map((group) => (
          <div key={group.groupKey} className="mb-4">
            <p className="px-3 mb-1 text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500">
              {group.groupKey}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = location.pathname === item.path;
                return (
                  <button
                    key={item.path}
                    type="button"
                    onClick={() => { onClose(); navigate(item.path); }}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-3 w-full min-h-[44px] px-3 rounded-md text-sm font-medium transition-colors duration-150',
                      active
                        ? 'bg-red-50 text-york-600 font-semibold dark:bg-york-900/30 dark:text-york-300'
                        : 'text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-800',
                    )}
                  >
                    <item.icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>{t(item.labelKey)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </div>
  );
};
