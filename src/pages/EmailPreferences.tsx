import React, { useState, useEffect } from 'react';
import { Card } from '../components/foundation/Card';
import { Button } from '../components/foundation/Button';
import { EmailPreferencesList } from '../components/feature/EmailPreferencesList';
import {
  useEmailPreferences,
  useUpdateEmailPreferences,
  useOptOutAll,
} from '../hooks/useEmailNotifications';
import type { AuthUser } from '../lib/auth';
import type { EmailPreferencesInput } from '../types';

const DEFAULT_PREFS: EmailPreferencesInput = {
  meeting_reminders_8am: true,
  meeting_reminders_1hr: true,
  message_notifications: true,
  habit_milestones: true,
  devotional_reminders: true,
  testimony_approved: true,
  weekly_digest: false,
  admin_announcements: true,
  opt_out_all: false,
};

interface Props {
  user: AuthUser | null;
}

export const EmailPreferences: React.FC<Props> = () => {
  const { preferences: saved, loading } = useEmailPreferences();
  const { update, saving } = useUpdateEmailPreferences();
  const { optOut, loading: optingOut } = useOptOutAll();

  const [prefs, setPrefs] = useState<EmailPreferencesInput>(DEFAULT_PREFS);
  const [saved_, setSaved_] = useState(false);

  useEffect(() => {
    if (saved) {
      const { user_id: _uid, created_at: _c, updated_at: _u, ...rest } = saved;
      setPrefs(rest);
    }
  }, [saved]);

  const handleChange = (key: keyof EmailPreferencesInput, value: boolean) => {
    setPrefs((prev) => ({ ...prev, [key]: value, opt_out_all: false }));
    setSaved_(false);
  };

  const handleGlobalToggle = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setPrefs((prev) => ({ ...prev, opt_out_all: false }));
    } else {
      setPrefs((prev) => ({ ...prev, opt_out_all: true }));
    }
    setSaved_(false);
  };

  const handleSave = async () => {
    await update(prefs);
    setSaved_(true);
    setTimeout(() => setSaved_(false), 3000);
  };

  const handleOptOutAll = async () => {
    if (!window.confirm('Unsubscribe from all emails? You can re-enable them here at any time.')) return;
    await optOut();
    setPrefs((prev) => ({
      ...prev,
      meeting_reminders_8am: false,
      meeting_reminders_1hr: false,
      message_notifications: false,
      habit_milestones: false,
      devotional_reminders: false,
      testimony_approved: false,
      weekly_digest: false,
      admin_announcements: false,
      opt_out_all: true,
    }));
    setSaved_(true);
    setTimeout(() => setSaved_(false), 3000);
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-york-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const globalEnabled = !prefs.opt_out_all;

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-h1">Email Preferences</h1>
          <p className="text-small text-gray-400 mt-1">Choose which emails you want to receive.</p>
        </div>

        {/* Global toggle */}
        <Card>
          <label className="flex items-center gap-4 cursor-pointer">
            <input
              type="checkbox"
              checked={globalEnabled}
              onChange={handleGlobalToggle}
              className="w-5 h-5 rounded border-gray-300 text-york-600 focus:ring-york-500"
            />
            <div>
              <p className="text-sm font-semibold text-gray-900">I want to receive emails from BLW York Hub</p>
              <p className="text-xs text-gray-400">When unchecked, all notification emails are paused.</p>
            </div>
          </label>
        </Card>

        {/* Per-type preferences */}
        <EmailPreferencesList
          preferences={prefs}
          onChange={handleChange}
          disabled={!globalEnabled}
        />

        {/* Actions */}
        <div className="flex items-center justify-between pt-2">
          <button
            onClick={handleOptOutAll}
            disabled={optingOut || prefs.opt_out_all}
            className="text-sm text-red-500 hover:text-red-700 underline disabled:opacity-40"
          >
            Unsubscribe from all
          </button>

          <div className="flex items-center gap-3">
            {saved_ && (
              <span className="text-sm text-green-600 font-medium flex items-center gap-1">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Preferences saved
              </span>
            )}
            <Button
              variant="primary"
              onClick={handleSave}
              loading={saving}
            >
              Save Preferences
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
