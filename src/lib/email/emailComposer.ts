import { getAppOrigin } from './emailService';

export interface ComposerRecipient {
  id: string;
  full_name: string | null;
  email: string;
  role?: string | null;
  status?: string | null;
}

export interface RenderedComposerEmail {
  subject: string;
  html: string;
  text: string;
  invalidPlaceholders: string[];
}

export const ALLOWED_EMAIL_PLACEHOLDERS = [
  'member.full_name',
  'member.email',
  'member.role',
  'organization.name',
  'sender.name',
] as const;

const ALLOWED_PLACEHOLDER_SET = new Set<string>(ALLOWED_EMAIL_PLACEHOLDERS);

export function findEmailPlaceholders(value: string): string[] {
  const found = new Set<string>();
  const pattern = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;
  let match = pattern.exec(value);
  while (match) {
    found.add(match[1]);
    match = pattern.exec(value);
  }
  return Array.from(found).sort();
}

export function validateEmailPlaceholders(subject: string, body: string): string[] {
  return Array.from(new Set([...findEmailPlaceholders(subject), ...findEmailPlaceholders(body)]))
    .filter((placeholder) => !ALLOWED_PLACEHOLDER_SET.has(placeholder));
}

export function renderComposerEmail(input: {
  subject: string;
  body: string;
  recipient: ComposerRecipient;
  senderName?: string | null;
  appOrigin?: string;
}): RenderedComposerEmail {
  const invalidPlaceholders = validateEmailPlaceholders(input.subject, input.body);
  const subject = replacePlaceholders(input.subject, input.recipient, input.senderName);
  const text = replacePlaceholders(input.body, input.recipient, input.senderName);
  const htmlBody = markdownToSafeHtml(text);
  const preferencesUrl = `${input.appOrigin ?? getAppOrigin()}/email-preferences`;

  return {
    subject,
    text,
    invalidPlaceholders,
    html: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f7f7f7;font-family:Arial,sans-serif;color:#222;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f7f7;padding:28px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#fff;border:1px solid #eee;border-radius:8px;overflow:hidden;">
        <tr><td style="background:#E31837;padding:22px 28px;">
          <p style="margin:0;color:#fff;font-size:20px;font-weight:700;">BLW York Hub</p>
          <p style="margin:4px 0 0;color:rgba(255,255,255,.82);font-size:12px;">York University</p>
        </td></tr>
        <tr><td style="padding:28px;">${htmlBody}</td></tr>
        <tr><td style="padding:16px 28px;background:#fafafa;border-top:1px solid #eee;">
          <p style="margin:0;color:#777;font-size:12px;line-height:1.5;text-align:center;">
            You are receiving this because you are connected to BLW York Hub.<br />
            <a href="${escapeAttribute(preferencesUrl)}" style="color:#E31837;text-decoration:none;">Manage email preferences</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  };
}

function replacePlaceholders(value: string, recipient: ComposerRecipient, senderName?: string | null): string {
  const replacements: Record<string, string> = {
    'member.full_name': recipient.full_name || recipient.email,
    'member.email': recipient.email,
    'member.role': recipient.role ?? '',
    'organization.name': 'BLW York',
    'sender.name': senderName || 'BLW York Team',
  };

  return value.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key: string) => {
    return replacements[key] ?? `{{${key}}}`;
  });
}

function markdownToSafeHtml(value: string): string {
  const paragraphs = value
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) {
    return '<p style="margin:0;color:#333;font-size:15px;line-height:1.6;"></p>';
  }

  return paragraphs
    .map((paragraph) => {
      const escaped = escapeHtml(paragraph)
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_match, label: string, url: string) => {
          return `<a href="${escapeAttribute(url)}" style="color:#E31837;">${label}</a>`;
        })
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br />');
      return `<p style="margin:0 0 16px;color:#333;font-size:15px;line-height:1.6;">${escaped}</p>`;
    })
    .join('');
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char] ?? char));
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, '&#96;');
}
