import { useEffect, useMemo, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { ApiError, createWebsiteApi } from '../api/websiteApi';
import type { PublicApiConfig } from '../api/config';
import { getSessionToken, parseAccessTokenFromHash, setSessionToken, signInWithPassword } from './session';
import { isWebsitePermission, type WebsitePermission } from './permissions';
import { AdminLayout } from './AdminLayout';
import { Button, Card, errorMessage, inputClass, Notice } from './common';
import { PagesScreen, SettingsScreen, NavigationScreen } from './ContentScreens';
import { BlogScreen, DashboardScreen, EventsScreen, InquiriesScreen, PeopleScreen } from './OperationsScreens';
import { MediaScreen } from './MediaScreen';
import { RhapsodyScreen } from './RhapsodyScreen';

/** Website Management entry point. Loaded lazily, so the public site does not download it. */
export default function AdminApp({ config }: { config: PublicApiConfig | null }) {
  const [token, setToken] = useState<string | null>(getSessionToken());
  const [perms, setPerms] = useState<ReadonlySet<WebsitePermission> | null>(null);
  const [isCore, setIsCore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // After Google sign-in, the token arrives in the fragment. Move it into session storage and remove it from the address bar.
  useEffect(() => {
    const fromHash = parseAccessTokenFromHash(window.location.hash);
    if (fromHash) {
      setSessionToken(fromHash);
      setToken(fromHash);
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  const api = useMemo(
    () => (config ? createWebsiteApi({ url: config.url, anonKey: config.anonKey, getAccessToken: getSessionToken }) : null),
    [config],
  );

  useEffect(() => {
    if (!api || !token) return;
    let cancelled = false;
    (async () => {
      try {
        const [list, core] = await Promise.all([api.myPermissions(), api.isCoreAdmin()]);
        if (cancelled) return;
        setPerms(new Set(list.filter(isWebsitePermission)));
        setIsCore(core);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.kind === 'unauthenticated') {
          setSessionToken(null);
          setToken(null);
        }
        setError(errorMessage(e));
      }
    })();
    return () => { cancelled = true; };
  }, [api, token]);

  if (!config) {
    return <Page><Card title="Website Management"><Notice tone="info">The website service is not configured for this build, so there is nothing to manage yet.</Notice></Card></Page>;
  }
  if (!token) {
    return <PasswordSignIn config={config} onSignedIn={() => setToken(getSessionToken())} />;
  }
  if (!perms) {
    return <Page><Card title="Website Management">{error ? <Notice tone="error">{error}</Notice> : <p className="text-ink-soft">Loading your access…</p>}</Card></Page>;
  }
  if (!api) return null;
  const ctx = { api, perms };
  const signOut = () => { setSessionToken(null); setToken(null); setPerms(null); };

  return (
    <AdminLayout granted={perms} isCore={isCore}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-soft">{isCore ? 'Core administrator' : 'Website staff'} · signed in</p>
        <Button variant="ghost" onClick={signOut}>Sign out</Button>
      </div>
      {error && <div className="mb-4"><Notice tone="error">{error}</Notice></div>}
      <Routes>
        <Route path="/admin" element={<DashboardScreen {...ctx} />} />
        <Route path="/admin/pages" element={<PagesScreen {...ctx} />} />
        <Route path="/admin/settings" element={<SettingsScreen {...ctx} />} />
        <Route path="/admin/navigation" element={<NavigationScreen {...ctx} />} />
        <Route path="/admin/blog" element={<BlogScreen {...ctx} />} />
        <Route path="/admin/events" element={<EventsScreen {...ctx} />} />
        <Route path="/admin/rhapsody" element={<RhapsodyScreen {...ctx} />} />
        <Route path="/admin/submissions" element={<InquiriesScreen {...ctx} />} />
        <Route path="/admin/media" element={<MediaScreen {...ctx} />} />
        <Route path="/admin/people" element={<PeopleScreen {...ctx} isCore={isCore} />} />
        <Route path="*" element={<Card title="Not found"><p className="text-ink-soft">That section does not exist. Choose one from the menu.</p></Card>} />
      </Routes>
    </AdminLayout>
  );
}

function PasswordSignIn({ config, onSignedIn }: { config: PublicApiConfig; onSignedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signInWithPassword(config, email.trim(), password);
      setPassword('');
      onSignedIn();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page>
      <Card title="Sign in to manage the website">
        <p className="mb-5 text-ink-soft">Use the email and password your website administrator gave you. Your access depends on the website role you have been given; the database checks every action.</p>
        <form onSubmit={submit} className="grid gap-4">
          <label className="grid gap-1 text-sm font-bold text-ink">
            Email
            <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
          </label>
          <label className="grid gap-1 text-sm font-bold text-ink">
            Password
            <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
          </label>
          {error && <Notice tone="error">{error}</Notice>}
          <div><Button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button></div>
        </form>
      </Card>
    </Page>
  );
}

function Page({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-3xl px-4 py-10 md:px-8">{children}</main>;
}
