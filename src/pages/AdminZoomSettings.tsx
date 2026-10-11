import React, { useState } from 'react';
import { Card } from '../components/foundation/Card';
import { Button } from '../components/foundation/Button';
import { useZoomSettings, useTestZoomConnection } from '../hooks/useZoom';
import { upsertZoomSettings } from '../lib/queries/zoomMeetings';
import type { AuthUser } from '../lib/auth';

interface Props {
  user: AuthUser | null;
}

export const AdminZoomSettings: React.FC<Props> = ({ user }) => {
  const { settings, loading } = useZoomSettings();
  const { test, testing, result, error: testError } = useTestZoomConnection();
  const [disconnecting, setDisconnecting] = useState(false);

  if (user?.role !== 'admin' && user?.role !== 'coordinator') {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <p className="text-small text-gray-400">Access denied.</p>
      </div>
    );
  }

  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect Zoom integration? Existing meeting links will remain.')) return;
    setDisconnecting(true);
    try {
      await upsertZoomSettings({ is_active: false });
      window.location.reload();
    } finally {
      setDisconnecting(false);
    }
  };

  const isConnected = settings?.is_active ?? false;

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-h1">Zoom Integration</h1>
          <p className="text-small text-gray-400 mt-1">
            Connect your Zoom account to auto-create video meetings and sync attendance.
          </p>
        </div>

        {/* Status card */}
        <Card>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-gray-300'}`} />
              <div>
                <p className="text-sm font-semibold text-gray-900">
                  {loading ? 'Checking...' : isConnected ? 'Connected' : 'Not connected'}
                </p>
                {settings?.zoom_account_id && (
                  <p className="text-xs text-gray-400">Account: {settings.zoom_account_id}</p>
                )}
              </div>
            </div>
            {isConnected && (
              <Button
                variant="danger"
                size="small"
                onClick={handleDisconnect}
                loading={disconnecting}
              >
                Disconnect
              </Button>
            )}
          </div>
        </Card>

        {/* Setup instructions */}
        <Card title="Setup Instructions">
          <ol className="space-y-4 text-sm text-gray-600">
            <li className="flex gap-3">
              <span className="w-6 h-6 rounded-full bg-york-600 text-white text-xs flex items-center justify-center shrink-0 font-bold">1</span>
              <div>
                <p className="font-medium text-gray-800">Create a Server-to-Server OAuth app in Zoom</p>
                <p className="text-gray-400 text-xs mt-1">
                  Go to marketplace.zoom.us → Develop → Build App → Server-to-Server OAuth.
                  Required scopes: <code className="bg-gray-100 px-1 rounded">meeting:write</code> and <code className="bg-gray-100 px-1 rounded">meeting:read</code>.
                </p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="w-6 h-6 rounded-full bg-york-600 text-white text-xs flex items-center justify-center shrink-0 font-bold">2</span>
              <div>
                <p className="font-medium text-gray-800">Add credentials to Supabase project secrets</p>
                <p className="text-gray-400 text-xs mt-1">
                  In the Supabase dashboard → Settings → Edge Functions → Secrets, add:
                </p>
                <div className="mt-2 bg-gray-50 rounded p-3 font-mono text-xs space-y-1">
                  <p><span className="text-gray-500">ZOOM_ACCOUNT_ID</span>=your_account_id</p>
                  <p><span className="text-gray-500">ZOOM_CLIENT_ID</span>=your_client_id</p>
                  <p><span className="text-gray-500">ZOOM_CLIENT_SECRET</span>=your_client_secret</p>
                </div>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="w-6 h-6 rounded-full bg-york-600 text-white text-xs flex items-center justify-center shrink-0 font-bold">3</span>
              <div>
                <p className="font-medium text-gray-800">Test the connection below</p>
                <p className="text-gray-400 text-xs mt-1">
                  Once secrets are saved, click Test Connection. A successful test saves the account ID here.
                </p>
              </div>
            </li>
          </ol>
        </Card>

        {/* Test connection */}
        <Card>
          <div className="flex items-center gap-4">
            <Button
              variant="secondary"
              onClick={test}
              loading={testing}
            >
              Test Connection
            </Button>

            {result === true && (
              <span className="text-sm text-green-600 font-medium flex items-center gap-1">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Connection successful
              </span>
            )}
            {result === false && (
              <span className="text-sm text-york-500">
                {testError ?? 'Connection failed'}
              </span>
            )}
          </div>
        </Card>

        {/* Features overview */}
        <Card title="What this enables">
          <ul className="space-y-2">
            {[
              'Auto-create Zoom meetings when scheduling portal meetings',
              'Join link included in meeting reminder emails',
              'Calendar invite (.ics) with video conference URL',
              'Sync attendee list from Zoom after meeting ends',
              'Match Zoom attendees to portal members by email',
            ].map((feature) => (
              <li key={feature} className="flex items-start gap-2 text-sm text-gray-600">
                <svg className="w-4 h-4 text-green-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                {feature}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
};
