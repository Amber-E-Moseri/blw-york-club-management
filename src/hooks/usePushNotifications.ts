import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

const VAPID_PUBLIC_KEY = process.env.REACT_APP_VAPID_PUBLIC_KEY ?? '';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) output[i] = rawData.charCodeAt(i);
  return output;
}

export type PushPermission = 'default' | 'granted' | 'denied';

export interface UsePushNotificationsResult {
  supported: boolean;
  configured: boolean;
  permission: PushPermission;
  subscribed: boolean;
  loading: boolean;
  error: string | null;
  subscribe: () => Promise<boolean>;
  unsubscribe: () => Promise<boolean>;
}

export function usePushNotifications(userId: string | undefined): UsePushNotificationsResult {
  const supported =
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window;

  const configured = !!VAPID_PUBLIC_KEY;

  const [permission, setPermission] = useState<PushPermission>('default');
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supported) return;
    setPermission(Notification.permission as PushPermission);

    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setSubscribed(!!sub))
      .catch(() => {});
  }, [supported, userId]);

  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!supported || !userId) return false;
    if (!configured) {
      setError('Push notifications are not configured on this server.');
      return false;
    }

    setLoading(true);
    setError(null);

    try {
      const perm = await Notification.requestPermission();
      setPermission(perm as PushPermission);

      if (perm !== 'granted') {
        setError('Notification permission denied. Enable it in your browser settings.');
        setLoading(false);
        return false;
      }

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });

      const subJson = sub.toJSON();
      const { error: dbError } = await supabase.from('push_subscriptions').upsert(
        {
          user_id: userId,
          endpoint: sub.endpoint,
          p256dh: subJson.keys?.p256dh ?? '',
          auth: subJson.keys?.auth ?? '',
          user_agent: navigator.userAgent.slice(0, 200),
          is_active: true,
          subscribed_at: new Date().toISOString(),
        },
        { onConflict: 'endpoint' }
      );

      if (dbError) throw new Error(dbError.message);

      setSubscribed(true);
      setLoading(false);
      return true;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to enable notifications.');
      setLoading(false);
      return false;
    }
  }, [supported, configured, userId]);

  const unsubscribe = useCallback(async (): Promise<boolean> => {
    setLoading(true);
    setError(null);

    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();

      if (sub) {
        await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        await sub.unsubscribe();
      }

      setSubscribed(false);
      setLoading(false);
      return true;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to disable notifications.');
      setLoading(false);
      return false;
    }
  }, []);

  return { supported, configured, permission, subscribed, loading, error, subscribe, unsubscribe };
}
