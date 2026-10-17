import React, { useState, useEffect } from 'react';

const STORAGE_KEY = 'push_prompt_dismissed';

interface Props {
  onAllow: () => void;
  onDismiss: () => void;
}

/**
 * Banner shown once after login to request push notification permission.
 * Respects the `push_prompt_dismissed` localStorage flag and the browser's
 * current permission state — never shown if already decided or unsupported.
 */
export const PushPermissionPrompt: React.FC<Props> = ({ onAllow, onDismiss }) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      const dismissed = localStorage.getItem(STORAGE_KEY);
      if (dismissed) return;
      if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
      if (Notification.permission !== 'default') return;
      setVisible(true);
    } catch {
      // localStorage blocked (private browsing, etc.)
    }
  }, []);

  const handleAllow = () => {
    setVisible(false);
    onAllow();
  };

  const handleLater = () => {
    setVisible(false);
    onDismiss();
  };

  const handleDontAsk = () => {
    try { localStorage.setItem(STORAGE_KEY, 'true'); } catch { /* ignore */ }
    setVisible(false);
    onDismiss();
  };

  if (!visible) return null;

  return (
    <div
      role="banner"
      aria-label="Enable push notifications"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-sm px-4"
    >
      <div className="bg-white rounded-xl shadow-lg border border-gray-100 p-5">
        {/* Bell icon */}
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-york-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-gray-900">Stay Updated</p>
            <p className="text-xs text-gray-400 mt-0.5">
              Get notifications about meetings, messages, and more — even when the app is closed.
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 mt-4">
          <button
            onClick={handleAllow}
            className="flex-1 bg-york-600 hover:bg-york-700 text-white text-sm font-semibold py-2 px-4 rounded-lg transition-colors"
          >
            Enable Notifications
          </button>
          <button
            onClick={handleLater}
            className="flex-1 text-sm font-medium text-gray-500 hover:text-gray-700 py-2 px-4 rounded-lg border border-gray-200 transition-colors"
          >
            Maybe Later
          </button>
        </div>

        <div className="mt-3 text-center">
          <button
            onClick={handleDontAsk}
            className="text-xs text-gray-400 hover:text-gray-600 underline"
          >
            Don't ask again
          </button>
        </div>
      </div>
    </div>
  );
};
