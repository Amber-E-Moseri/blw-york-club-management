import fs from 'fs';
import path from 'path';
import {
  ALLOWED_EMAIL_PLACEHOLDERS,
  renderComposerEmail,
  validateEmailPlaceholders,
} from '../lib/email/emailComposer';

const root = path.resolve(__dirname, '..', '..');
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const recipient = {
  id: 'member-1',
  full_name: 'Ada Member',
  email: 'ada@example.com',
  role: 'member',
  status: 'active',
};

describe('email customization', () => {
  test('composer supports the approved personalization placeholders', () => {
    expect(ALLOWED_EMAIL_PLACEHOLDERS).toEqual(expect.arrayContaining([
      'member.full_name',
      'member.email',
      'member.role',
      'organization.name',
      'sender.name',
    ]));

    const rendered = renderComposerEmail({
      subject: 'Hi {{member.full_name}}',
      body: 'From {{organization.name}} by {{sender.name}} to {{member.email}}',
      recipient,
      senderName: 'Coordinator',
      appOrigin: 'https://example.test',
    });

    expect(rendered.subject).toBe('Hi Ada Member');
    expect(rendered.text).toContain('BLW York');
    expect(rendered.text).toContain('Coordinator');
    expect(rendered.text).toContain('ada@example.com');
    expect(rendered.invalidPlaceholders).toEqual([]);
  });

  test('composer rejects unknown placeholders before save or send', () => {
    expect(validateEmailPlaceholders('Hello {{member.full_name}}', 'Bad {{secret.token}}')).toEqual(['secret.token']);
  });

  test('preview renderer escapes arbitrary HTML and scripts', () => {
    const rendered = renderComposerEmail({
      subject: '<script>alert(1)</script>',
      body: 'Hello <img src=x onerror=alert(1)> **friend** [site](https://example.test)',
      recipient,
      senderName: 'Coordinator',
      appOrigin: 'https://example.test',
    });

    expect(rendered.html).not.toContain('<script>');
    expect(rendered.html).not.toContain('<img');
    expect(rendered.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(rendered.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(rendered.html).toContain('<strong>friend</strong>');
    expect(rendered.html).toContain('href="https://example.test"');
    expect(rendered.html).toContain('/email-preferences');
  });

  test('custom templates and drafts are protected by additive RLS', () => {
    const migration = read('supabase/migrations/027_email_composer_templates.sql');

    expect(migration).toContain('create table if not exists public.email_templates');
    expect(migration).toContain('create table if not exists public.email_drafts');
    expect(migration).toContain("public.has_admin_permission('notifications.send')");
    expect(migration).toContain('created_by = auth.uid()');
    expect(migration).toContain('grant select, insert, update, delete on table public.email_templates, public.email_drafts to authenticated');
    expect(migration).not.toContain('scheduled_emails');
  });

  test('communications page exposes edit, preview, draft, template and test-send controls', () => {
    const page = read('src/pages/AdminEmailLog.tsx');

    expect(page).toContain('Email Composer');
    expect(page).toContain('Save Draft');
    expect(page).toContain('Save Template');
    expect(page).toContain('Duplicate');
    expect(page).toContain('Rendered Preview');
    expect(page).toContain('Send Test');
    expect(page).toContain('fetchEmailComposerRecipients');
    expect(page).toContain('Account approval, password reset, and authentication emails are managed separately');
  });

  test('system-critical email templates remain outside the editable composer', () => {
    const templates = read('src/lib/email/emailTemplates.ts');
    const page = read('src/pages/AdminEmailLog.tsx');

    expect(templates).toContain('accountApprovedTemplate');
    expect(page).toContain('System Template Preview');
    expect(page).not.toContain("templateType: 'account_approved'");
  });
});
