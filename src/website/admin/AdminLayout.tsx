import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import type { WebsitePermission } from './permissions';
import { phoneTabs, visibleNav, type AdminNavItem } from './logic';

interface Props {
  /** Permissions held by the signed-in caller, from the server (web_my_permissions). Empty until loaded. */
  granted: ReadonlySet<WebsitePermission>;
  children: ReactNode;
}

const linkBase = 'no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-lg';

/**
 * Website Management shell. Desktop and tablet get a side navigation; phones get a bottom tab bar plus a "More" sheet.
 * Visibility here is a convenience. Every action is checked again on the server.
 */
export function AdminLayout({ granted, children }: Props) {
  const items = visibleNav(granted);
  const { tabs, hasMore } = phoneTabs(granted);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreItems = items.filter((i) => !tabs.includes(i));

  return (
    <div className="min-h-screen bg-paper text-ink lg:grid lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside aria-label="Website management" className="hidden border-r border-paper-edge bg-white lg:block">
        <nav aria-label="Website sections" className="sticky top-0 p-4">
          <p className="mb-3 font-display text-lg font-bold">Website</p>
          <ul className="grid gap-1">
            {items.map((item) => (
              <li key={item.id}>
                <NavLink to={item.path} end={item.path === '/admin'} className={({ isActive }) => `${linkBase} block px-3 py-2 text-sm ${isActive ? 'bg-brand-soft font-bold text-brand' : 'font-medium text-ink hover:bg-paper'}`}>
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <main id="admin-main" className="min-w-0 px-4 pb-24 pt-6 md:px-8 lg:pb-10">{children}</main>

      <nav aria-label="Website sections (phone)" className="fixed inset-x-0 bottom-0 z-40 border-t border-paper-edge bg-white lg:hidden">
        <ul className="grid grid-flow-col auto-cols-fr">
          {tabs.map((item) => (
            <li key={item.id}>
              <NavLink to={item.path} end={item.path === '/admin'} className={({ isActive }) => `${linkBase} flex min-h-[56px] flex-col items-center justify-center text-xs ${isActive ? 'font-bold text-brand' : 'text-ink-soft'}`}>
                {item.label}
              </NavLink>
            </li>
          ))}
          {hasMore && (
            <li>
              <button
                type="button"
                aria-expanded={moreOpen}
                aria-controls="admin-more-sheet"
                onClick={() => setMoreOpen((o) => !o)}
                className={`${linkBase} flex min-h-[56px] w-full flex-col items-center justify-center text-xs text-ink-soft`}
              >
                More
              </button>
            </li>
          )}
        </ul>
        {moreOpen && (
          <div id="admin-more-sheet" className="max-h-[60vh] overflow-y-auto border-t border-paper-edge bg-white p-4">
            <ul className="grid gap-1">
              {moreItems.map((item: AdminNavItem) => (
                <li key={item.id}>
                  <NavLink to={item.path} onClick={() => setMoreOpen(false)} className={`${linkBase} block min-h-[44px] px-3 py-3 text-base font-medium text-ink hover:bg-paper`}>
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        )}
      </nav>
    </div>
  );
}
