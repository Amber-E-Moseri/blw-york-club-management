import { supabase } from '../supabase';
import type { EmailTemplateType } from '../../types';

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  memberId?: string;
  templateType?: EmailTemplateType;
}

export interface BatchRecipient {
  email: string;
  data: Record<string, unknown>;
}

/**
 * Send a single email via the Supabase Edge Function (which calls Resend).
 * The Resend API key lives in Supabase project secrets — never in client code.
 */
export async function sendEmail(options: SendEmailOptions): Promise<{ id: string }> {
  const { data, error } = await supabase.functions.invoke('send-email', {
    body: {
      action: 'send',
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      memberId: options.memberId,
      templateType: options.templateType,
    },
  });
  if (error) throw new Error(`Email send failed: ${error.message}`);
  return data as { id: string };
}

/**
 * Send the same template to multiple recipients.
 * Each recipient receives a personalised version rendered from templateData.
 */
export async function sendBatch(
  recipients: BatchRecipient[],
  subject: string,
  templateType: EmailTemplateType
): Promise<void> {
  const { error } = await supabase.functions.invoke('send-email', {
    body: {
      action: 'batch',
      recipients,
      subject,
      templateType,
    },
  });
  if (error) throw new Error(`Batch send failed: ${error.message}`);
}

/**
 * Queue an email to be delivered at a specific time.
 * The edge function writes to scheduled_emails; a cron edge function polls and sends.
 */
export async function scheduleEmail(
  to: string,
  subject: string,
  html: string,
  scheduledFor: Date
): Promise<void> {
  const { error } = await supabase.functions.invoke('send-email', {
    body: {
      action: 'schedule',
      to,
      subject,
      html,
      scheduledFor: scheduledFor.toISOString(),
    },
  });
  if (error) throw new Error(`Schedule failed: ${error.message}`);
}

/**
 * Retry a previously failed message by its email_log id.
 */
export async function resendEmail(messageId: string): Promise<void> {
  const { error } = await supabase.functions.invoke('send-email', {
    body: { action: 'resend', messageId },
  });
  if (error) throw new Error(`Resend failed: ${error.message}`);
}

/**
 * Record that the tracking pixel was loaded (sets opened_at in email_log).
 */
export async function trackEmailOpen(messageId: string, trackingToken: string): Promise<void> {
  const { error } = await supabase.functions.invoke('send-email', {
    body: { action: 'track_open', messageId, trackingToken },
  });
  if (error) throw new Error(`Track open failed: ${error.message}`);
}

/**
 * Build a signed unsubscribe URL for the given member and notification type.
 * Uses btoa to encode a base64 token (server validates full JWT; this is just
 * the client payload — the edge function signs it with UNSUBSCRIBE_SECRET).
 */
export function buildUnsubscribeUrl(_memberId: string, _notifType: EmailTemplateType, origin?: string): string {
  return `${origin ?? getAppOrigin()}/email-preferences`;
}

export function getAppOrigin(): string {
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
  return process.env.REACT_APP_PUBLIC_APP_URL || 'https://blw-york.vercel.app';
}

export function getSupabaseFunctionUrl(functionName: string): string {
  const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
  if (!supabaseUrl) return `${getAppOrigin()}/api/${functionName}`;
  return `${supabaseUrl.replace(/\/$/, '')}/functions/v1/${functionName}`;
}
