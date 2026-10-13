import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { Navigation } from './Navigation';
import { PWAInstallBanner } from '../feature/PWAInstallBanner';
import { QuickAddModal } from '../feature/QuickAddModal';
import { cn } from '../../lib/utils';
import type { AuthUser } from '../../lib/auth';

export interface MainLayoutProps {
  children: React.ReactNode;
  user: AuthUser | null;
  onSignOut: () => void;
  showSidebar?: boolean;
}

export const MainLayout: React.FC<MainLayoutProps> = ({
  children, user, onSignOut, showSidebar = true,
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const location = useLocation();

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 text-gray-600 dark:bg-slate-950 dark:text-slate-300">
      <a href="#main-content" className="skip-link">Skip to main content</a>

      {/* Mobile header */}
      <Header
        userName={user?.name}
        userRole={user?.role}
        onLogout={onSignOut}
        onQuickAdd={() => setQuickAddOpen(true)}
        className="md:hidden safe-header"
      />

      {/* Mobile bottom nav */}
      <Navigation userRole={user?.role} onQuickAdd={() => setQuickAddOpen(true)} />

      <div className="flex flex-1 min-h-0">
        {showSidebar && (
          <div className="hidden md:block">
            <Sidebar
              user={user}
              onSignOut={onSignOut}
              collapsed={collapsed}
              onToggleCollapse={() => setCollapsed((v) => !v)}
            />
          </div>
        )}

        <div className="flex flex-col flex-1 min-w-0">
          {/* Desktop header */}
          <Header
            userName={user?.name}
            userRole={user?.role}
            onLogout={onSignOut}
            onQuickAdd={() => setQuickAddOpen(true)}
            className="hidden md:flex"
          />

          <main
            id="main-content"
            className={cn(
              'flex-1 overflow-y-auto bg-gray-50 dark:bg-slate-950',
              'px-4 py-4 sm:px-5 sm:py-4 lg:px-6 lg:py-5',
              'pb-24 md:pb-6',
            )}
          >
            <div key={location.pathname} className="animate-fade-up">
              {children}
            </div>
          </main>
        </div>
      </div>

      <PWAInstallBanner />

      <QuickAddModal
        isOpen={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
        user={user}
      />
    </div>
  );
};
