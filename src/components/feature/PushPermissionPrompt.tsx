import React, { useEffect, useRef, useState } from 'react';
import {
  dismissPushPromptForever,
  readPushPromptState,
  shouldShowPushPrompt,
  snoozePushPrompt,
} from '../../lib/pushPrompt';

const TITLE_ID = 'push-prompt-title';
const DESCRIPTION_ID = 'push-prompt-description';

interface Props {
  /** Called only after the user taps "Enable Notifications". Permission is requested from that action. */
  onAllow: () => void;
  /** Called after "Maybe Later", "Don't ask again" or Escape. */
  onDismiss: () => void;
}

function storageOrNull(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * "Stay Updated" prompt shown after login. Rules live in lib/pushPrompt:
 * - "Maybe Later" hides it for seven days.
 * - "Don't ask again" hides it permanently in this browser.
 * - It never shows when permission is already granted or denied, or when this browser is subscribed.
 */
export const PushPermissionPrompt: React.FC<Props> = ({ onAllow, onDismiss }) => {
  const [visible, setVisible] = useState(false);
  const enableRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;

    const supported =
      typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator;
    if (!supported) return;

    (async () => {
      let hasSubscription = false;
      try {
        // getRegistration resolves at once when no worker is registered; ready would wait forever.
        const registration = await navigator.serviceWorker.getRegistration('/service-worker.js');
        hasSubscription = !!(await registration?.pushManager.getSubscription());
      } catch {
        hasSubscription = false;
      }

      const state = readPushPromptState(storageOrNull());
      const show = shouldShowPushPrompt({
        supported,
        permission: Notification.permission,
        hasSubscription,
        dismissedForever: state.dismissedForever,
        snoozedUntil: state.snoozedUntil,
        now: Date.now(),
      });
      if (!cancelled && show) setVisible(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!visible) return;
    enableRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleLater();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // handleLater is stable for this instance; visible is the only trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const handleAllow = () => {
    setVisible(false);
    onAllow();
  };

  const handleLater = () => {
    snoozePushPrompt(storageOrNull(), Date.now());
    setVisible(false);
    onDismiss();
  };

  const handleDontAsk = () => {
    dismissPushPromptForever(storageOrNull());
    setVisible(false);
    onDismiss();
  };

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby={TITLE_ID}
      aria-describedby={DESCRIPTION_ID}
      className="fixed inset-x-4 bottom-24 z-50 md:inset-x-auto md:bottom-6 md:left-1/2 md:w-full md:max-w-sm md:-translate-x-1/2"
    >
      <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-lg dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-50 dark:bg-york-900/40" aria-hidden="true">
            <svg className="h-5 w-5 text-york-600 dark:text-york-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
          </div>
          <div className="flex-1">
            <p id={TITLE_ID} className="text-sm font-semibold text-gray-900 dark:text-slate-100">Stay Updated</p>
            <p id={DESCRIPTION_ID} className="mt-0.5 text-xs text-gray-600 dark:text-slate-300">
              Get notifications about meetings, messages, and more, even when the app is closed.
            </p>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button
            ref={enableRef}
            type="button"
            onClick={handleAllow}
            className="min-h-[44px] flex-1 rounded-lg bg-york-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-york-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-york-500"
          >
            Enable Notifications
          </button>
          <button
            type="button"
            onClick={handleLater}
            className="min-h-[44px] flex-1 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-york-500 dark:border-slate-600 dark:text-slate-200 dark:hover:text-white"
          >
            Maybe Later
          </button>
        </div>

        <div className="mt-3 text-center">
          <button
            type="button"
            onClick={handleDontAsk}
            className="min-h-[44px] px-2 text-xs text-gray-600 underline hover:text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-york-500 dark:text-slate-300 dark:hover:text-white"
          >
            Don't ask again
          </button>
        </div>
      </div>
    </div>
  );
};
