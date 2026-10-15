import type { VercelRequest, VercelResponse } from '@vercel/node';
import nodemailer from 'nodemailer';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RelayBody {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

// ─── Configuration ────────────────────────────────────────────────────────────

function getConfig() {
  return {
    gmailUser: process.env.GMAIL_USER ?? '',
    gmailAppPassword: process.env.GMAIL_APP_PASSWORD ?? '',
    relaySecret: process.env.EMAIL_RELAY_SECRET ?? '',
  };
}

// ─── Core send logic (exported for testing) ──────────────────────────────────

export interface SendResult {
  messageId: string;
}

export interface SendError {
  code: string;
  message: string;
  status: number;
}

export async function sendViaGmail(
  body: RelayBody,
  config: ReturnType<typeof getConfig>,
): Promise<SendResult> {
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      user: config.gmailUser,
      pass: config.gmailAppPassword,
    },
  });

  const info = await transporter.sendMail({
    from: `BLW York <${config.gmailUser}>`,
    to: body.to,
    subject: body.subject,
    html: body.html,
    text: body.text,
  });

  return { messageId: info.messageId };
}

export function validateRequest(
  req: Pick<VercelRequest, 'method' | 'headers' | 'body'>,
  config: ReturnType<typeof getConfig>,
): SendError | null {
  if (req.method !== 'POST') {
    return { code: 'METHOD_NOT_ALLOWED', message: 'POST required', status: 405 };
  }

  // Authorization
  if (!config.relaySecret) {
    return { code: 'RELAY_NOT_CONFIGURED', message: 'Relay secret not configured on server', status: 503 };
  }
  const auth = req.headers['authorization'] ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token || token !== config.relaySecret) {
    return { code: 'UNAUTHORIZED', message: 'Invalid or missing relay secret', status: 401 };
  }

  // Credentials
  if (!config.gmailUser || !config.gmailAppPassword) {
    return { code: 'EMAIL_PROVIDER_NOT_CONFIGURED', message: 'GMAIL_USER or GMAIL_APP_PASSWORD not set', status: 503 };
  }

  // Body
  const { to, subject, html } = req.body ?? {};
  if (!to || !subject || !html) {
    return { code: 'INVALID_REQUEST', message: 'to, subject, and html are required', status: 400 };
  }

  return null;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const config = getConfig();

  const validationError = validateRequest(req, config);
  if (validationError) {
    return res.status(validationError.status).json({
      error: validationError.code,
      message: validationError.message,
    });
  }

  try {
    const result = await sendViaGmail(req.body as RelayBody, config);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({
      error: 'SEND_FAILED',
      message: err instanceof Error ? err.message : 'Unknown send error',
    });
  }
}
