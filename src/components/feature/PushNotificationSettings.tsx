import React from 'react';
import { usePushNotifications } from '../../hooks/usePushNotifications';
import { Card } from '../foundation/Card';
import { AlertCircle } from 'lucide-react';

interface PushNotificationSettingsProps {
  userId: string | undefined;
}

export const PushNotificationSettings: React.FC<PushNotificationSettingsProps> = ({ userId }) => {
  const { supported, configured, permission, subscribed, loading, error, subscribe, unsubscribe } =
    usePushNotifications(userId);

  if (!supported) {
    return (
      <Card>
        <h3 className="text-h3 mb-1">Push Notifications</h3>
        <p className="text-small text-gray-400">
          Your browser doesn't support push notifications. Try Chrome or Firefox on Android,
          or add this app to your Home Screen on iOS 16.4+.
        </p>
      </Card>
    );
  }

  const statusLabel = (): string => {
    if (!configured) return 'Not configured';
    if (permission === 'denied') return 'Blocked in browser';
    if (subscribed) return 'Enabled';
    return 'Disabled';
  };

  const statusColor = (): string => {
    if (!configured || permission === 'denied') return 'text-gray-400';
    if (subscribed) return 'text-green-600';
    return 'text-gray-400';
  };

  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <h3 className="text-h3 mb-0.5">Push Notifications</h3>
          <p className={`text-small font-medium ${statusColor()}`}>{statusLabel()}</p>
          <p className="text-small text-gray-400 mt-1">
            Get notified about meeting reminders, new messages, devotional reminders,
            and testimony activity.
          </p>
          {error && (
            <p className="text-small text-york-600 mt-2"><AlertCircle className="inline w-3.5 h-3.5 mr-1 -mt-0.5" aria-hidden="true" />{error}</p>
          )}
          {permission === 'denied' && (
            <p className="text-small text-gray-500 mt-2">
              Notifications are blocked. Open your browser settings and allow notifications
              for this site, then come back and enable them.
            </p>
          )}
        </div>

        <button
          onClick={subscribed ? unsubscribe : subscribe}
          disabled={loading || !configured || permission === 'denied'}
          className={`flex-shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-york-600 focus:ring-offset-2 disabled:opacity-40 disabled:cursor-not-allowed ${
            subscribed ? 'bg-york-600' : 'bg-gray-200'
          }`}
          role="switch"
          aria-checked={subscribed}
          aria-label="Toggle push notifications"
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
              subscribed ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {!configured && (
        <p className="text-tiny text-gray-400 mt-3 pt-3 border-t border-gray-100">
          VAPID key not set — add <code>REACT_APP_VAPID_PUBLIC_KEY</code> to your environment
          to enable push notifications.
        </p>
      )}
    </Card>
  );
};
