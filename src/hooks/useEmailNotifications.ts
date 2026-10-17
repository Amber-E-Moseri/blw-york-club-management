import { useState, useEffect, useCallback } from 'react';
import type { EmailPreferences, EmailPreferencesInput, EmailLog, EmailStatus } from '../types';
import {
  fetchEmailPreferences,
  upsertEmailPreferences,
  fetchEmailLog,
} from '../lib/queries/emailNotifications';
import { sendEmail } from '../lib/email/emailService';
import { supabase } from '../lib/supabase';

export function useEmailPreferences() {
  const [preferences, setPreferences] = useState<EmailPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const prefs = await fetchEmailPreferences(user.id);
        if (!cancelled) setPreferences(prefs);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { preferences, loading, error };
}

export function useUpdateEmailPreferences() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = useCallback(async (prefs: EmailPreferencesInput): Promise<EmailPreferences | null> => {
    setSaving(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const result = await upsertEmailPreferences(user.id, prefs);
      return result;
    } catch (err) {
      setError((err as Error).message);
      return null;
    } finally {
      setSaving(false);
    }
  }, []);

  return { update, saving, error };
}

export function useOptOutAll() {
  const [loading, setLoading] = useState(false);

  const optOut = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      await upsertEmailPreferences(user.id, {
        meeting_reminders_8am: false,
        meeting_reminders_1hr: false,
        message_notifications: false,
        habit_milestones: false,
        devotional_reminders: false,
        testimony_approved: false,
        weekly_digest: false,
        admin_announcements: false,
        opt_out_all: true,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  return { optOut, loading };
}

export function useEmailLog(memberId?: string, filters?: { status?: EmailStatus }) {
  const [logs, setLogs] = useState<EmailLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchEmailLog({ memberId, status: filters?.status });
        if (!cancelled) setLogs(data);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [memberId, filters?.status, reloadToken]);

  // Re-reads the log after an explicit action. It never sends anything by itself.
  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  return { logs, loading, reload };
}

export function useSendTestEmail() {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendTest = useCallback(async (email: string): Promise<void> => {
    setSending(true);
    setError(null);
    try {
      await sendEmail({
        to: email,
        subject: '[Test] Email from BLW York Hub',
        html: '<p>This is a test email from the BLW York Hub. If you received this, email notifications are working correctly.</p>',
        text: 'This is a test email from the BLW York Hub.',
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }, []);

  return { sendTest, sending, error };
}

