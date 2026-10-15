import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { cn, getInitials } from '../../lib/utils';

export interface HeaderProps {
  userName?: string;
  userRole?: string;
  onLogout?: () => void;
  className?: string;
  onMenuToggle?: () => void;
  mobileNavOpen?: boolean;
  onQuickAdd?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  userName,
  userRole,
  onLogout,
  className,
  onMenuToggle,
  mobileNavOpen = false,
  onQuickAdd,
}) => {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <header
      className={cn(
        'h-[60px] bg-white border-b-2 border-york-600 shadow-sm dark:bg-slate-900',
        'flex items-center justify-between px-5 shrink-0 sticky top-0 z-30',
        className,
      )}
    >
      {/* Hamburger — mobile only, shown when onMenuToggle provided */}
      {onMenuToggle && (
        <button
          type="button"
          onClick={onMenuToggle}
          aria-label={mobileNavOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={mobileNavOpen}
          aria-controls="mobile-nav-drawer"
          className={cn(
            'md:hidden flex items-center justify-center w-11 h-11 rounded-md shrink-0',
            'text-gray-600 hover:bg-red-50 hover:text-york-600 dark:text-slate-300 dark:hover:bg-slate-800',
            'focus:outline-none focus:ring-2 focus:ring-york-600 transition-colors duration-150',
          )}
        >
          {mobileNavOpen ? (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
      )}

      {/* Logo + Title */}
      <div className="flex items-center gap-2.5">
        <img src="/logo.png" alt="BLW York" className="w-8 h-8 rounded-md shrink-0" />
        <span className="text-lg font-bold text-york-600 leading-tight hidden sm:block">
          BLW York Hub
        </span>
        <span className="text-lg font-bold text-york-600 sm:hidden">BLW York</span>
      </div>

      <div className="flex items-center gap-2">
        {/* Quick Add button */}
        {onQuickAdd && (
          <>
            <button
              type="button"
              onClick={onQuickAdd}
              aria-label="Quick add"
              className={cn(
                'hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold',
                'bg-york-600 text-white hover:bg-york-700 transition-colors duration-150',
                'focus:outline-none focus:ring-2 focus:ring-york-600 focus:ring-offset-1',
              )}
            >
              <Plus className="w-4 h-4" />
              Quick add
            </button>
            <button
              type="button"
              onClick={onQuickAdd}
              aria-label="Quick add"
              className={cn(
                'sm:hidden flex items-center justify-center w-9 h-9 rounded-md',
                'bg-york-600 text-white hover:bg-york-700 transition-colors duration-150',
                'focus:outline-none focus:ring-2 focus:ring-york-600',
              )}
            >
              <Plus className="w-4 h-4" />
            </button>
          </>
        )}

        {/* User menu */}
        {userName && (
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="true"
              aria-expanded={menuOpen}
              aria-label="User menu"
              className={cn(
                'flex items-center gap-2 px-3 py-1.5 rounded-md',
                'hover:bg-red-50 transition-colors duration-150 dark:hover:bg-slate-800',
                'focus:outline-none focus:ring-2 focus:ring-york-600',
              )}
            >
              <div className="w-8 h-8 rounded-full bg-york-600 text-white flex items-center justify-center text-xs font-bold shrink-0">
                {getInitials(userName)}
              </div>
              <div className="text-left hidden sm:block">
                <p className="text-sm font-semibold text-gray-900 leading-none dark:text-slate-100">{userName}</p>
                {userRole && (
                  <p className="text-xs text-gray-400 capitalize mt-0.5">{userRole}</p>
                )}
              </div>
              <svg
                className={cn('w-4 h-4 text-gray-400 transition-transform duration-150', menuOpen && 'rotate-180')}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-40 dark:border-slate-700 dark:bg-slate-900">
                <div className="px-4 py-2 border-b border-gray-100 dark:border-slate-700">
                  <p className="text-xs font-bold text-gray-900 truncate dark:text-slate-100">{userName}</p>
                  {userRole && <p className="text-xs text-gray-400 capitalize">{userRole}</p>}
                </div>
                <button
                  type="button"
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors dark:text-slate-200 dark:hover:bg-slate-800"
                  onClick={() => { setMenuOpen(false); navigate('/profile'); }}
                >
                  My Profile
                </button>
                <button
                  type="button"
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors dark:text-slate-200 dark:hover:bg-slate-800"
                  onClick={() => { setMenuOpen(false); navigate('/email-preferences'); }}
                >
                  Settings
                </button>
                <div className="border-t border-gray-100 mt-1 dark:border-slate-700">
                  <button
                    type="button"
                    className="w-full text-left px-4 py-2 text-sm text-york-600 font-semibold hover:bg-red-50 transition-colors"
                    onClick={() => { setMenuOpen(false); onLogout?.(); }}
                  >
                    Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
};
