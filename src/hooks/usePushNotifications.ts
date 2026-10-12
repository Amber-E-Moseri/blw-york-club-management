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

/** Store this browser's subscription against the signed-in account. Idempotent: safe to call on every load. */
async function saveSubscription(userId: string, sub: PushSubscription): Promise<void> {
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
}

/**
 * Remove this browser's subscription from the account and from the browser. Must run while the session is still
 * signed in, because the delete is authorised by RLS (user_id = auth.uid()). Does nothing if there is no subscription.
 */
export async function releaseDeviceSubscription(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  // getRegistration resolves to undefined when no worker is registered; serviceWorker.ready would never settle.
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;

  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  if (error) throw new Error(error.message);
  await sub.unsubscribe();
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
      .then((sub) => {
        setSubscribed(!!sub);
        // Reconcile: a browser subscription that never reached the database (failed save, or the browser rotated
        // the endpoint while the app was closed) is saved now. Failures are retried on the next load.
        if (sub && userId && Notification.permission === 'granted') {
          saveSubscription(userId, sub).catch((err) =>
            console.warn('[Push] could not save subscription', err instanceof Error ? err.message : err)
          );
        }
      })
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

      // Save before reporting success. If the save fails, undo the browser subscription so the UI never shows
      // "Enabled" for a device the server cannot reach.
      try {
        await saveSubscription(userId, sub);
      } catch (dbErr) {
        await sub.unsubscribe();
        throw dbErr;
      }

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
      // Database first: if the delete fails, the browser keeps its subscription and the UI still says "Enabled".
      await releaseDeviceSubscription();

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
