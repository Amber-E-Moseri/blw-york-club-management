import { supabase } from '../supabase';

export interface EmailRecipient {
  id: string;
  full_name: string | null;
  email: string;
  role: string | null;
  status: string | null;
}

export interface EmailTemplateRecord {
  id: string;
  name: string;
  subject: string;
  body_markdown: string;
  created_by: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmailDraftRecord {
  id: string;
  template_id: string | null;
  subject: string;
  body_markdown: string;
  recipient_ids: string[];
  recipient_filter: Record<string, unknown>;
  created_by: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SaveEmailTemplateInput {
  id?: string;
  name: string;
  subject: string;
  body_markdown: string;
  user_id: string;
}

export interface SaveEmailDraftInput {
  id?: string;
  template_id?: string | null;
  subject: string;
  body_markdown: string;
  recipient_ids: string[];
  recipient_filter?: Record<string, unknown>;
  user_id: string;
}

export async function fetchEmailComposerRecipients(): Promise<EmailRecipient[]> {
  const { data, error } = await supabase
    .from('member_directory')
    .select('id, full_name, email, role, status')
    .eq('status', 'active')
    .order('full_name', { ascending: true });

  if (error) throw new Error(error.message ?? 'Unable to load recipients');
  return (data ?? []).filter((row): row is EmailRecipient => Boolean(row.email));
}

export async function fetchEmailTemplates(): Promise<EmailTemplateRecord[]> {
  const { data, error } = await supabase
    .from('email_templates')
    .select('id, name, subject, body_markdown, created_by, updated_by, created_at, updated_at')
    .order('updated_at', { ascending: false });

  if (error) throw new Error(error.message ?? 'Unable to load email templates');
  return data ?? [];
}

export async function saveEmailTemplate(input: SaveEmailTemplateInput): Promise<EmailTemplateRecord> {
  const payload = {
    name: input.name.trim(),
    subject: input.subject.trim(),
    body_markdown: input.body_markdown,
    updated_by: input.user_id,
    ...(input.id ? {} : { created_by: input.user_id }),
  };

  const query = input.id
    ? supabase.from('email_templates').update(payload).eq('id', input.id)
    : supabase.from('email_templates').insert(payload);

  const { data, error } = await query
    .select('id, name, subject, body_markdown, created_by, updated_by, created_at, updated_at')
    .single();

  if (error) throw new Error(error.message ?? 'Unable to save email template');
  return data;
}

export async function fetchEmailDrafts(): Promise<EmailDraftRecord[]> {
  const { data, error } = await supabase
    .from('email_drafts')
    .select('id, template_id, subject, body_markdown, recipient_ids, recipient_filter, created_by, updated_by, created_at, updated_at')
    .order('updated_at', { ascending: false });

  if (error) throw new Error(error.message ?? 'Unable to load email drafts');
  return data ?? [];
}

export async function saveEmailDraft(input: SaveEmailDraftInput): Promise<EmailDraftRecord> {
  const payload = {
    template_id: input.template_id ?? null,
    subject: input.subject.trim(),
    body_markdown: input.body_markdown,
    recipient_ids: input.recipient_ids,
    recipient_filter: input.recipient_filter ?? {},
    updated_by: input.user_id,
    ...(input.id ? {} : { created_by: input.user_id }),
  };

  const query = input.id
    ? supabase.from('email_drafts').update(payload).eq('id', input.id)
    : supabase.from('email_drafts').insert(payload);

  const { data, error } = await query
    .select('id, template_id, subject, body_markdown, recipient_ids, recipient_filter, created_by, updated_by, created_at, updated_at')
    .single();

  if (error) throw new Error(error.message ?? 'Unable to save email draft');
  return data;
}
