import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, Eye, FileText, Save, Send, Type } from 'lucide-react';
import { Card } from '../components/foundation/Card';
import { Button } from '../components/foundation/Button';
import { Input } from '../components/foundation/Input';
import { renderSampleEmailTemplate } from '../lib/email/emailTemplates';
import { useEmailLog, useResendFailedEmails } from '../hooks/useEmailNotifications';
import { renderComposerEmail, validateEmailPlaceholders, ALLOWED_EMAIL_PLACEHOLDERS } from '../lib/email/emailComposer';
import { sendEmail } from '../lib/email/emailService';
import {
  fetchEmailComposerRecipients,
  fetchEmailDrafts,
  fetchEmailTemplates,
  saveEmailDraft,
  saveEmailTemplate,
  type EmailDraftRecord,
  type EmailRecipient,
  type EmailTemplateRecord,
} from '../lib/queries/emailComposer';
import type { AuthUser } from '../lib/auth';
import type { EmailStatus, EmailTemplateType } from '../types';

interface Props {
  user: AuthUser | null;
}

const TEMPLATE_TYPES: EmailTemplateType[] = [
  'meeting_reminder_8am',
  'meeting_reminder_1hr',
  'message_notification',
  'habit_milestone',
  'devotional_reminder',
  'testimony_approved',
  'weekly_digest',
  'generic',
];

const DEFAULT_BODY = `Hi {{member.full_name}},

Write your message here.

With love,
{{sender.name}}`;

const SAMPLE_RECIPIENT: EmailRecipient = {
  id: 'preview',
  full_name: 'Sample Member',
  email: 'member@example.com',
  role: 'member',
  status: 'active',
};

export const AdminEmailLog: React.FC<Props> = ({ user }) => {
  const [status, setStatus] = useState<EmailStatus | ''>('');
  const [templateType, setTemplateType] = useState<EmailTemplateType>('meeting_reminder_8am');
  const [notice, setNotice] = useState('');
  const [composerError, setComposerError] = useState('');
  const [saving, setSaving] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [templates, setTemplates] = useState<EmailTemplateRecord[]>([]);
  const [drafts, setDrafts] = useState<EmailDraftRecord[]>([]);
  const [recipients, setRecipients] = useState<EmailRecipient[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [draftId, setDraftId] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [subject, setSubject] = useState('Hello {{member.full_name}}');
  const [body, setBody] = useState(DEFAULT_BODY);
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<string[]>([]);
  const [testEmail, setTestEmail] = useState(user?.email ?? '');
  const { logs, loading } = useEmailLog(undefined, { status: status || undefined });
  const { resendFailed, sending: resending, error: resendError } = useResendFailedEmails();

  const loadComposerData = useCallback(async () => {
    const [templateRows, draftRows, recipientRows] = await Promise.all([
      fetchEmailTemplates(),
      fetchEmailDrafts(),
      fetchEmailComposerRecipients(),
    ]);
    setTemplates(templateRows);
    setDrafts(draftRows);
    setRecipients(recipientRows);
  }, []);

  useEffect(() => {
    if (user?.role !== 'admin' && user?.role !== 'coordinator') return;
    loadComposerData().catch((error) => setComposerError((error as Error).message));
  }, [loadComposerData, user?.role]);

  const fixedPreview = useMemo(() => renderSampleEmailTemplate(templateType), [templateType]);
  const stats = useMemo(() => {
    const total = logs.length || 1;
    const sent = logs.filter((log) => log.status === 'sent').length;
    const failed = logs.filter((log) => log.status === 'failed').length;
    const opened = logs.filter((log) => log.opened_at).length;
    const clicked = logs.filter((log) => log.clicked_at).length;
    return {
      sent,
      failed,
      openRate: Math.round((opened / total) * 100),
      clickRate: Math.round((clicked / total) * 100),
    };
  }, [logs]);

  const selectedRecipients = useMemo(
    () => recipients.filter((recipient) => selectedRecipientIds.includes(recipient.id)),
    [recipients, selectedRecipientIds]
  );

  const invalidPlaceholders = useMemo(() => validateEmailPlaceholders(subject, body), [subject, body]);
  const composerPreview = useMemo(() => renderComposerEmail({
    subject,
    body,
    recipient: selectedRecipients[0] ?? recipients[0] ?? SAMPLE_RECIPIENT,
    senderName: user?.name ?? user?.email,
  }), [body, recipients, selectedRecipients, subject, user?.email, user?.name]);

  const isComposerValid = subject.trim().length > 0 && body.trim().length > 0 && invalidPlaceholders.length === 0;

  if (user?.role !== 'admin' && user?.role !== 'coordinator') {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <p className="text-small text-gray-400">Access denied.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-h1">Communications</h1>
          <p className="text-small text-gray-400 mt-1">Compose editable member communications and review delivery status.</p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><Metric label="Sent" value={stats.sent} /></Card>
          <Card><Metric label="Failed" value={stats.failed} /></Card>
          <Card><Metric label="Open Rate" value={`${stats.openRate}%`} /></Card>
          <Card><Metric label="Click Rate" value={`${stats.clickRate}%`} /></Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <Card title="Email Composer" subtitle="Reusable templates and drafts for ordinary communications">
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="block text-sm font-bold text-gray-800">
                  Saved template
                  <select
                    className="mt-1.5 w-full rounded-md border border-gray-200 bg-white px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-york-600"
                    value={templateId}
                    onChange={(event) => {
                      const next = templates.find((row) => row.id === event.target.value);
                      setTemplateId(event.target.value);
                      if (next) {
                        setTemplateName(next.name);
                        setSubject(next.subject);
                        setBody(next.body_markdown);
                      }
                    }}
                  >
                    <option value="">New template</option>
                    {templates.map((template) => (
                      <option key={template.id} value={template.id}>{template.name}</option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm font-bold text-gray-800">
                  Saved draft
                  <select
                    className="mt-1.5 w-full rounded-md border border-gray-200 bg-white px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-york-600"
                    value={draftId}
                    onChange={(event) => {
                      const next = drafts.find((row) => row.id === event.target.value);
                      setDraftId(event.target.value);
                      if (next) {
                        setTemplateId(next.template_id ?? '');
                        setSubject(next.subject);
                        setBody(next.body_markdown);
                        setSelectedRecipientIds(next.recipient_ids);
                        // Restore template name so Save Template / Duplicate remain usable
                        const linkedTemplate = next.template_id
                          ? templates.find((t) => t.id === next.template_id)
                          : undefined;
                        setTemplateName(linkedTemplate?.name ?? '');
                      }
                    }}
                  >
                    <option value="">No draft selected</option>
                    {drafts.map((draft) => (
                      <option key={draft.id} value={draft.id}>{draft.subject}</option>
                    ))}
                  </select>
                </label>
              </div>

              <Input
                label="Template name"
                value={templateName}
                onChange={setTemplateName}
                placeholder="Fall outreach follow-up"
                maxLength={120}
              />
              <Input
                label="Subject"
                value={subject}
                onChange={setSubject}
                placeholder="Hello {{member.full_name}}"
                required
                maxLength={180}
              />

              <div>
                <div className="mb-2 flex flex-wrap gap-2">
                  <FormatButton label="Bold" value="**bold text**" onInsert={(value) => setBody((current) => `${current}${current ? '\n' : ''}${value}`)} />
                  <FormatButton label="Italic" value="*italic text*" onInsert={(value) => setBody((current) => `${current}${current ? '\n' : ''}${value}`)} />
                  <FormatButton label="Link" value="[link text](https://example.com)" onInsert={(value) => setBody((current) => `${current}${current ? '\n' : ''}${value}`)} />
                  {ALLOWED_EMAIL_PLACEHOLDERS.map((placeholder) => (
                    <FormatButton key={placeholder} label={`{{${placeholder}}}`} value={`{{${placeholder}}}`} onInsert={(value) => setBody((current) => `${current}${current ? ' ' : ''}${value}`)} />
                  ))}
                </div>
                <Input
                  type="textarea"
                  label="Message body"
                  value={body}
                  onChange={setBody}
                  required
                  rows={12}
                  helpText="Formatting supports bold, italic, links, paragraph breaks, and approved placeholders."
                />
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-sm font-bold text-gray-800">Recipients</p>
                  <Button
                    variant="ghost"
                    size="small"
                    onClick={() => setSelectedRecipientIds(recipients.map((recipient) => recipient.id))}
                    disabled={recipients.length === 0}
                  >
                    Select Active
                  </Button>
                </div>
                <div className="max-h-56 overflow-y-auto rounded-md border border-gray-200 bg-white">
                  {recipients.length === 0 ? (
                    <p className="p-4 text-sm text-gray-400">No authorized recipients are visible.</p>
                  ) : recipients.map((recipient) => (
                    <label key={recipient.id} className="flex items-start gap-3 border-b border-gray-100 px-3 py-2 last:border-0">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={selectedRecipientIds.includes(recipient.id)}
                        onChange={(event) => {
                          setSelectedRecipientIds((current) => event.target.checked
                            ? Array.from(new Set([...current, recipient.id]))
                            : current.filter((id) => id !== recipient.id));
                        }}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-gray-900">{recipient.full_name || recipient.email}</span>
                        <span className="block truncate text-xs text-gray-400">{recipient.email}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                <Input
                  type="email"
                  label="Test send address"
                  value={testEmail}
                  onChange={setTestEmail}
                  placeholder="name@example.com"
                  helpText="Test send uses the backend sender and may fail until the email relay is configured."
                />
                <div className="flex flex-wrap items-end gap-2">
                  <Button icon={<Save className="h-4 w-4" />} loading={saving} disabled={!isComposerValid} onClick={async () => {
                    if (!user) return;
                    await runComposerAction(setSaving, setComposerError, setNotice, async () => {
                      const saved = await saveEmailDraft({
                        id: draftId || undefined,
                        template_id: templateId || null,
                        subject,
                        body_markdown: body,
                        recipient_ids: selectedRecipientIds,
                        user_id: user.id,
                      });
                      setDraftId(saved.id);
                      await loadComposerData();
                      return 'Draft saved.';
                    });
                  }}>
                    Save Draft
                  </Button>
                  <Button variant="secondary" icon={<FileText className="h-4 w-4" />} loading={saving} disabled={!isComposerValid || !templateName.trim()} onClick={async () => {
                    if (!user) return;
                    await runComposerAction(setSaving, setComposerError, setNotice, async () => {
                      const saved = await saveEmailTemplate({
                        id: templateId || undefined,
                        name: templateName,
                        subject,
                        body_markdown: body,
                        user_id: user.id,
                      });
                      setTemplateId(saved.id);
                      await loadComposerData();
                      return 'Template saved.';
                    });
                  }}>
                    Save Template
                  </Button>
                  <Button variant="ghost" icon={<Copy className="h-4 w-4" />} disabled={!isComposerValid || !templateName.trim()} onClick={async () => {
                    if (!user) return;
                    await runComposerAction(setSaving, setComposerError, setNotice, async () => {
                      const saved = await saveEmailTemplate({
                        name: `Copy of ${templateName}`,
                        subject,
                        body_markdown: body,
                        user_id: user.id,
                      });
                      setTemplateId(saved.id);
                      setTemplateName(saved.name);
                      await loadComposerData();
                      return 'Template duplicated.';
                    });
                  }}>
                    Duplicate
                  </Button>
                  <Button variant="warning" icon={<Send className="h-4 w-4" />} loading={sendingTest} disabled onClick={async () => {
                    await runComposerAction(setSendingTest, setComposerError, setNotice, async () => {
                      const testRender = renderComposerEmail({
                        subject,
                        body,
                        recipient: { ...SAMPLE_RECIPIENT, email: testEmail },
                        senderName: user?.name ?? user?.email,
                      });
                      await sendEmail({
                        to: testEmail,
                        subject: testRender.subject,
                        html: testRender.html,
                        text: testRender.text,
                        templateType: 'generic',
                      });
                      return 'Test send accepted by backend.';
                    });
                  }}>
                    Send Test
                  </Button>
                </div>
              </div>

              {invalidPlaceholders.length > 0 && (
                <p className="text-sm text-red-600" role="alert">Invalid placeholders: {invalidPlaceholders.join(', ')}</p>
              )}
              {(composerError || resendError) && <p className="text-sm text-red-600" role="alert">{composerError || resendError}</p>}
              {notice && <p className="text-sm text-green-600" role="status">{notice}</p>}
              <p className="text-xs text-gray-400">Sending is disabled until the email relay is configured. Account approval, password reset, and authentication emails are managed separately from this composer.</p>
            </div>
          </Card>

          <Card title="Rendered Preview" headerAction={<Eye className="h-4 w-4 text-gray-400" aria-hidden="true" />}>
            <div className="space-y-3">
              <p className="text-sm font-semibold text-gray-900">{composerPreview.subject}</p>
              <iframe
                title="Rendered email preview"
                className="h-[520px] w-full rounded-md border border-gray-200 bg-white"
                srcDoc={composerPreview.html}
              />
              <p className="text-xs text-gray-400">Preview uses {selectedRecipients[0]?.full_name || recipients[0]?.full_name || 'sample'} data and sanitized formatting.</p>
            </div>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <Card title="System Template Preview">
            <div className="space-y-3">
              <select
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-york-600"
                value={templateType}
                onChange={(event) => setTemplateType(event.target.value as EmailTemplateType)}
              >
                {TEMPLATE_TYPES.map((type) => (
                  <option key={type} value={type}>{type.replace(/_/g, ' ')}</option>
                ))}
              </select>
              <p className="text-sm font-semibold text-gray-900">{fixedPreview.subject}</p>
              <iframe
                title="System email template preview"
                className="w-full h-80 rounded-md border border-gray-200 bg-white"
                srcDoc={fixedPreview.html}
              />
            </div>
          </Card>

          <Card title="Admin Tools">
            <div className="space-y-4">
              <Button
                variant="secondary"
                onClick={async () => {
                  const count = await resendFailed();
                  setNotice(`Resend requested for ${count} failed email${count === 1 ? '' : 's'}.`);
                }}
                loading={resending}
              >
                Resend Failed Emails
              </Button>
              <p className="text-sm text-gray-500">Resending uses the existing email log records and backend authorization checks.</p>
            </div>
          </Card>
        </div>

        <Card
          title="Delivery History"
          headerAction={
            <select
              className="px-3 py-2 text-sm border border-gray-200 rounded-md bg-white"
              value={status}
              onChange={(event) => setStatus(event.target.value as EmailStatus | '')}
            >
              <option value="">All statuses</option>
              <option value="queued">Queued</option>
              <option value="sent">Sent</option>
              <option value="failed">Failed</option>
              <option value="bounced">Bounced</option>
            </select>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-gray-100 text-xs uppercase text-gray-400">
                  <th className="py-2 pr-4">Recipient</th>
                  <th className="py-2 pr-4">Subject</th>
                  <th className="py-2 pr-4">Template</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Created</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td className="py-4 text-gray-400" colSpan={5}>Loading...</td></tr>
                ) : logs.length === 0 ? (
                  <tr><td className="py-4 text-gray-400" colSpan={5}>No email logs found.</td></tr>
                ) : logs.map((log) => (
                  <tr key={log.id} className="border-b border-gray-50">
                    <td className="py-3 pr-4 text-gray-700">{log.recipient_email}</td>
                    <td className="py-3 pr-4 text-gray-900">{log.subject}</td>
                    <td className="py-3 pr-4 text-gray-500">{log.template_type}</td>
                    <td className="py-3 pr-4">
                      <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-700">{log.status}</span>
                    </td>
                    <td className="py-3 pr-4 text-gray-500">{new Date(log.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
};

const FormatButton: React.FC<{ label: string; value: string; onInsert: (value: string) => void }> = ({ label, value, onInsert }) => (
  <Button
    variant="ghost"
    size="small"
    icon={<Type className="h-3.5 w-3.5" />}
    onClick={() => onInsert(value)}
  >
    {label}
  </Button>
);

async function runComposerAction(
  setWorking: (value: boolean) => void,
  setError: (value: string) => void,
  setNotice: (value: string) => void,
  action: () => Promise<string>
) {
  setWorking(true);
  setError('');
  setNotice('');
  try {
    const message = await action();
    setNotice(message);
  } catch (error) {
    setError((error as Error).message);
  } finally {
    setWorking(false);
  }
}

const Metric: React.FC<{ label: string; value: number | string }> = ({ label, value }) => (
  <div>
    <p className="text-xs uppercase tracking-wide text-gray-400 font-semibold">{label}</p>
    <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
  </div>
);
