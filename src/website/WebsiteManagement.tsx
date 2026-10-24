import React, { useEffect, useMemo, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import type { AuthUser } from '../lib/auth';
import { isConfigured, supabase } from '../lib/supabase';
import { createWebsiteApi } from './api/websiteApi';
import type { PublicApiConfig } from './api/config';
import { isWebsitePermission, type WebsitePermission } from './admin/permissions';
import { AdminLayout } from './admin/AdminLayout';
import { Card, errorMessage, Notice } from './admin/common';
import { PagesScreen, SettingsScreen, NavigationScreen } from './admin/ContentScreens';
import { BlogScreen, DashboardScreen, EventsScreen, InquiriesScreen, PeopleScreen } from './admin/OperationsScreens';
import { MediaScreen } from './admin/MediaScreen';
import { RhapsodyScreen } from './admin/RhapsodyScreen';

interface Props {
  user: AuthUser | null;
}

// The Hub's own Supabase session supplies the token. It is kept in memory only, and every database call still goes
// through the website permission checks in the database.
let accessToken: string | null = null;

function readConfig(): PublicApiConfig | null {
  const url = (process.env.REACT_APP_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  const anonKey = (process.env.REACT_APP_SUPABASE_ANON_KEY ?? '').trim();
  if (!url || !anonKey) return null;
  return { url, anonKey, turnstileSiteKey: null };
}

/**
 * Website Management inside the Hub. Access is decided by the database: the Hub's sign-in provides the session, and
 * website permissions come only from explicit website role assignments. Being a Hub member grants nothing here.
 */
export const WebsiteManagement: React.FC<Props> = ({ user }) => {
  const config = useMemo(readConfig, []);
  const [token, setToken] = useState<string | null>(accessToken);
  const [perms, setPerms] = useState<ReadonlySet<WebsitePermission> | null>(null);
  const [isCore, setIsCore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isConfigured) return;
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      accessToken = data.session?.access_token ?? null;
      setToken(accessToken);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      accessToken = session?.access_token ?? null;
      setToken(accessToken);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const api = useMemo(
    () => (config ? createWebsiteApi({ url: config.url, anonKey: config.anonKey, getAccessToken: () => accessToken }) : null),
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
        setError(errorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, token]);

  if (!user) {
    return <Card title="Website Management"><p className="text-ink-soft">Sign in to the Hub to manage the website.</p></Card>;
  }
  if (!config) {
    return (
      <Card title="Website Management">
        <Notice tone="info">The Hub database is not configured for this build, so website management is unavailable.</Notice>
      </Card>
    );
  }
  if (!token) {
    return <Card title="Website Management"><p className="text-ink-soft">Your session is loading…</p></Card>;
  }
  if (!perms) {
    return (
      <Card title="Website Management">
        {error ? (
          <Notice tone="error">{error} Website Management may not be active on this database yet.</Notice>
        ) : (
          <p className="text-ink-soft">Loading your website access…</p>
        )}
      </Card>
    );
  }

  const ctx = { api: api!, perms };
  return (
    <AdminLayout granted={perms} isCore={isCore}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-soft">{isCore ? 'Core administrator' : 'Website staff'} · signed in through the Hub</p>
      </div>
      {perms.size === 0 ? (
        <Notice tone="info">
          You have no website permissions. A core Hub administrator can grant website roles in Website Management → People.
        </Notice>
      ) : null}
      <Routes>
        <Route index element={<DashboardScreen {...ctx} />} />
        <Route path="pages" element={<PagesScreen {...ctx} />} />
        <Route path="settings" element={<SettingsScreen {...ctx} />} />
        <Route path="navigation" element={<NavigationScreen {...ctx} />} />
        <Route path="blog" element={<BlogScreen {...ctx} />} />
        <Route path="events" element={<EventsScreen {...ctx} />} />
        <Route path="rhapsody" element={<RhapsodyScreen {...ctx} />} />
        <Route path="submissions" element={<InquiriesScreen {...ctx} />} />
        <Route path="media" element={<MediaScreen {...ctx} />} />
        <Route path="people" element={<PeopleScreen {...ctx} isCore={isCore} />} />
        <Route path="*" element={<Card title="Not found"><p className="text-ink-soft">That section does not exist. Choose one from the menu.</p></Card>} />
      </Routes>
    </AdminLayout>
  );
};
