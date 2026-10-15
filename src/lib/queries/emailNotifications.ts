import { supabase } from '../supabase';
import type { EmailPreferences, EmailPreferencesInput, EmailLog, EmailStatus, EmailTemplateType, ScheduledEmail } from '../../types';

/** Preferences belong to an authenticated account: `userId` is profiles.id (= auth.users.id). */
export async function fetchEmailPreferences(userId: string): Promise<EmailPreferences | null> {
  const { data, error } = await supabase
    .from('email_preferences')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message ?? 'Unknown error');
  return data;
}

export async function upsertEmailPreferences(
  userId: string,
  prefs: EmailPreferencesInput
): Promise<EmailPreferences> {
  const { data, error } = await supabase
    .from('email_preferences')
    .upsert({ user_id: userId, ...prefs }, { onConflict: 'user_id' })
    .select()
    .single();
  if (error) throw new Error(error.message ?? 'Unknown error');
  return data;
}

export interface EmailLogInput {
  member_id?: string;
  recipient_email: string;
  subject: string;
  template_type: EmailTemplateType;
  status?: EmailStatus;
}

export async function createEmailLog(input: EmailLogInput): Promise<EmailLog> {
  const { data, error } = await supabase
    .from('email_log')
    .insert({ ...input, status: input.status ?? 'queued' })
    .select()
    .single();
  if (error) throw new Error(error.message ?? 'Unknown error');
  return data;
}

export async function updateEmailLog(
  id: string,
  patch: { status?: EmailStatus; sentAt?: string; failedReason?: string; openedAt?: string; clickedAt?: string }
): Promise<void> {
  const { error } = await supabase
    .from('email_log')
    .update({
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.sentAt !== undefined ? { sent_at: patch.sentAt } : {}),
      ...(patch.failedReason !== undefined ? { failed_reason: patch.failedReason } : {}),
      ...(patch.openedAt !== undefined ? { opened_at: patch.openedAt } : {}),
      ...(patch.clickedAt !== undefined ? { clicked_at: patch.clickedAt } : {}),
    })
    .eq('id', id);
  if (error) throw new Error(error.message ?? 'Unknown error');
}

export interface EmailLogFilters {
  memberId?: string;
  status?: EmailStatus;
  dateFrom?: string;
  dateTo?: string;
}

export async function fetchEmailLog(filters: EmailLogFilters = {}): Promise<EmailLog[]> {
  let q = supabase
    .from('email_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);

  if (filters.memberId) q = q.eq('member_id', filters.memberId);
  if (filters.status) q = q.eq('status', filters.status);
  if (filters.dateFrom) q = q.gte('created_at', filters.dateFrom);
  if (filters.dateTo) q = q.lte('created_at', filters.dateTo);

  const { data, error } = await q;
  if (error) throw new Error(error.message ?? 'Unknown error');
  return data ?? [];
}

export interface ScheduledEmailInput {
  recipient_email: string;
  subject: string;
  html_content: string;
  scheduled_for: string;
}

export async function createScheduledEmail(input: ScheduledEmailInput): Promise<ScheduledEmail> {
  const { data, error } = await supabase
    .from('scheduled_emails')
    .insert(input)
    .select()
    .single();
  if (error) throw new Error(error.message ?? 'Unknown error');
  return data;
}

export async function fetchPendingScheduledEmails(now = new Date().toISOString()): Promise<ScheduledEmail[]> {
  const { data, error } = await supabase
    .from('scheduled_emails')
    .select('*')
    .eq('sent', false)
    .lte('scheduled_for', now)
    .order('scheduled_for', { ascending: true })
    .limit(100);
  if (error) throw new Error(error.message ?? 'Unknown error');
  return data ?? [];
}

export async function markScheduledEmailSent(id: string, sentAt = new Date().toISOString()): Promise<void> {
  const { error } = await supabase
    .from('scheduled_emails')
    .update({ sent: true, sent_at: sentAt })
    .eq('id', id);
  if (error) throw new Error(error.message ?? 'Unknown error');
}

export async function fetchFailedEmailLogs(): Promise<EmailLog[]> {
  return fetchEmailLog({ status: 'failed' });
}

/** Removes email_log rows older than the supplied retention window. Intended for admin use. */
export async function deleteOldEmailLogs(olderThanDays = 90): Promise<void> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - olderThanDays);
  const { error } = await supabase
    .from('email_log')
    .delete()
    .lt('created_at', cutoff.toISOString());
  if (error) throw new Error(error.message ?? 'Unknown error');
}
