import { supabase } from '../supabase';
import type { PushNotificationPayload } from '../../types';

const VAPID_PUBLIC_KEY = process.env.REACT_APP_VAPID_PUBLIC_KEY ?? '';

/** Convert a URL-base64 string to a Uint8Array required by pushManager.subscribe. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) output[i] = rawData.charCodeAt(i);
  return output;
}

/** Returns the current notification permission state as a typed string. */
export function getSubscriptionStatus(): 'unsupported' | 'denied' | 'granted' | 'default' {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return 'unsupported';
  return Notification.permission as 'denied' | 'granted' | 'default';
}

/** Ask the browser for notification permission. */
export async function requestPushPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) return 'denied';
  return Notification.requestPermission();
}

/** Register the push service worker and subscribe the browser to push. */
export async function subscribeToPush(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator)) return null;
  if (!VAPID_PUBLIC_KEY) {
    console.warn('[Push] REACT_APP_VAPID_PUBLIC_KEY is not set.');
    return null;
  }

  const registration = await navigator.serviceWorker.register(`${process.env.PUBLIC_URL}/service-worker.js`);
  await navigator.serviceWorker.ready;

  const existing = await registration.pushManager.getSubscription();
  if (existing) return existing;

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });

  return subscription;
}

/** Unsubscribe the current browser from push notifications. */
export async function unsubscribeFromPush(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration(`${process.env.PUBLIC_URL}/service-worker.js`);
  const subscription = await registration?.pushManager.getSubscription();
  await subscription?.unsubscribe();
}

/** Get the active push subscription for this browser (without subscribing). */
export async function getActivePushSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration(`${process.env.PUBLIC_URL}/service-worker.js`);
  return registration?.pushManager.getSubscription() ?? null;
}

/** Send a push notification to a user by dispatching through the edge function. */
export async function sendPushNotification(
  userId: string,
  notification: PushNotificationPayload
): Promise<void> {
  const { error } = await supabase.functions.invoke('send-push', {
    body: { action: 'send', userId, notification },
  });
  if (error) throw new Error(`Push send failed: ${error.message}`);
}

/** Send the same push notification to multiple users. */
export async function sendBatchNotifications(
  userIds: string[],
  notification: PushNotificationPayload
): Promise<void> {
  const { error } = await supabase.functions.invoke('send-push', {
    body: { action: 'batch', userIds, notification },
  });
  if (error) throw new Error(`Batch push failed: ${error.message}`);
}

/** Send a test notification to the current user. */
export async function testPushNotification(): Promise<void> {
  const { error } = await supabase.functions.invoke('send-push', {
    body: { action: 'test' },
  });
  if (error) throw new Error(`Test push failed: ${error.message}`);
}
