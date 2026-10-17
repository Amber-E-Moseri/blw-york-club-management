import { useEffect, useId, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useSiteContent } from '../content/SiteContentContext';
import { buttonClass } from './ui';

const SAMPLE_BANNER =
  'Demo preview. Names, dates, venues, times and documents are sample content. Nothing shown here is published information.';

export function SiteLayout() {
  const content = useSiteContent();
  const { settings, nav } = content;
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const menuId = useId();
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  // Close the mobile menu on navigation. Focus stays on the page content rather than the closed menu.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  // Escape closes the open menu and returns focus to its toggle.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden bg-paper font-sans text-ink">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[100] focus:rounded-lg focus:bg-ink focus:px-4 focus:py-3 focus:text-white"
      >
        Skip to content
      </a>

      {settings.isSample && import.meta.env.VITE_PREVIEW_DEMO !== 'true' && (
        <div className="bg-ink px-4 py-2 text-center text-[13px] leading-snug text-white">{SAMPLE_BANNER}</div>
      )}

      <header className="sticky top-0 z-50 border-b border-paper-edge bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-content items-center justify-between gap-4 px-5 md:px-8">
          <Link
            to="/"
            aria-label={`${settings.name} home`}
            className="flex min-w-0 items-center gap-2.5 text-ink no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            {settings.logoUrl ? (
              <img src={settings.logoUrl} alt="" width={36} height={36} loading="eager" decoding="async" className="h-9 w-9 flex-none rounded-[10px] object-contain" />
            ) : (
              <span
                aria-hidden="true"
                className="grid h-9 w-9 flex-none place-items-center rounded-[10px] bg-brand font-display text-[15px] font-bold text-white"
              >
                BLW
              </span>
            )}
            <span className="grid min-w-0 leading-tight">
              <b className="truncate font-display text-[20px] font-bold">
                <span className="text-brand">BLW</span> York Hub
              </b>
              <span className="hidden text-[9px] tracking-[0.05em] text-ink-muted sm:block">
                BELIEVERS' LOVEWORLD · YORK UNIVERSITY
              </span>
            </span>
          </Link>

          <nav aria-label="Main" className="hidden lg:block">
            <ul className="flex items-center gap-4 xl:gap-6">
              {nav.map((item) => (
                <li key={item.path}>
                  <NavLink
                    to={item.path}
                    end={item.path === '/'}
                    className={({ isActive }) =>
                      `whitespace-nowrap border-b-2 pb-1 text-sm no-underline transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                        isActive ? 'border-brand font-bold text-brand' : 'border-transparent font-medium text-ink hover:text-brand'
                      }`
                    }
                  >
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>

          <div className="flex items-center gap-3">
            <Link to="/new-here" className={`${buttonClass('primary')} hidden !min-h-[40px] !py-2.5 xl:inline-flex`}>
              Plan Your Visit
            </Link>
            <button
              ref={menuButtonRef}
              type="button"
              aria-expanded={menuOpen}
              aria-controls={menuId}
              onClick={() => setMenuOpen((open) => !open)}
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-gray-300 bg-white px-3 text-sm font-bold lg:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              {menuOpen ? 'Close' : 'Menu'}
            </button>
          </div>
        </div>

        {menuOpen && (
          <nav id={menuId} aria-label="Mobile" className="border-t border-paper-edge bg-white px-5 pb-6 pt-2 lg:hidden">
            <ul className="grid gap-1">
              {nav.map((item) => (
                <li key={item.path}>
                  <NavLink
                    to={item.path}
                    end={item.path === '/'}
                    className={({ isActive }) =>
                      `block min-h-[44px] rounded-lg px-3 py-3 text-base no-underline ${
                        isActive ? 'bg-brand-soft font-bold text-brand' : 'font-medium text-ink hover:bg-paper'
                      }`
                    }
                  >
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
            <Link to="/new-here" className={`${buttonClass('primary')} mt-4 w-full`}>
              Plan Your Visit
            </Link>
          </nav>
        )}
      </header>

      <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
        <Outlet />
      </main>

      <SiteFooter />
    </div>
  );
}

function SiteFooter() {
  const { settings, nav } = useSiteContent();
  return (
    <footer className="bg-ink text-white">
      <div className="mx-auto grid max-w-content gap-10 px-5 py-12 md:grid-cols-3 md:px-8">
        <div>
          <p className="font-display text-2xl font-bold">{settings.name}</p>
          <p className="mt-2 max-w-xs text-sm text-gray-300">{settings.tagline}</p>
        </div>
        <nav aria-label="Footer">
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-gray-400">Explore</p>
          <ul className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            {nav.map((item) => (
              <li key={item.path}>
                <Link to={item.path} className="text-gray-200 underline-offset-4 hover:underline">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="text-sm text-gray-300">
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-gray-400">Visit and connect</p>
          <p>
            {settings.serviceDay} · {settings.serviceTime}
          </p>
          <p>{settings.address}</p>
          {settings.email && (
            <p className="mt-2">
              <a href={`mailto:${settings.email}`} className="text-white underline-offset-4 hover:underline">
                {settings.email}
              </a>
            </p>
          )}
          <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-2" aria-label="Social media">
            {settings.socials.map((s) => (
              <li key={s.label}>
                <a href={s.href} className="text-gray-200 underline-offset-4 hover:underline">
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10 px-5 py-4 text-center text-xs text-gray-400">
        {settings.isSample ? (import.meta.env.VITE_PREVIEW_DEMO === 'true' ? '© BLW York · Privacy and terms pages to follow' : '© BLW York · Demo: sample content preview · Privacy and terms pages to follow') : `© ${new Date().getFullYear()} BLW York`}
      </div>
    </footer>
  );
}
