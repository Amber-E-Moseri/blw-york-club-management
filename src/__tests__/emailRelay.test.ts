import { validateRequest, sendViaGmail, SendResult } from '../../api/email-relay';
import nodemailer from 'nodemailer';

jest.mock('nodemailer');

const mockSendMail = jest.fn();
const mockCreateTransport = nodemailer.createTransport as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateTransport.mockReturnValue({ sendMail: mockSendMail });
});

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const SECRET = 'test-relay-secret-abc123';

const validConfig = {
  gmailUser: 'club-sender@example.com',
  gmailAppPassword: 'abcd efgh ijkl mnop',
  relaySecret: SECRET,
};

const validBody = {
  to: 'member@example.com',
  subject: 'Your BLW York Hub account is ready',
  html: '<p>Welcome</p>',
  text: 'Welcome',
};

function makeReq(overrides: object = {}) {
  return {
    method: 'POST',
    headers: { authorization: `Bearer ${SECRET}` },
    body: { ...validBody },
    ...overrides,
  };
}

// ─── validateRequest ──────────────────────────────────────────────────────────

describe('validateRequest', () => {
  it('returns null for a valid POST with correct secret and all fields', () => {
    expect(validateRequest(makeReq(), validConfig)).toBeNull();
  });

  it('rejects non-POST methods', () => {
    const err = validateRequest(makeReq({ method: 'GET' }), validConfig);
    expect(err?.code).toBe('METHOD_NOT_ALLOWED');
    expect(err?.status).toBe(405);
  });

  it('returns 503 when relaySecret is not configured on the server', () => {
    const err = validateRequest(makeReq(), { ...validConfig, relaySecret: '' });
    expect(err?.code).toBe('RELAY_NOT_CONFIGURED');
    expect(err?.status).toBe(503);
  });

  it('returns 401 when Authorization header is missing', () => {
    const err = validateRequest(makeReq({ headers: {} }), validConfig);
    expect(err?.code).toBe('UNAUTHORIZED');
    expect(err?.status).toBe(401);
  });

  it('returns 401 when Bearer token does not match secret', () => {
    const err = validateRequest(makeReq({ headers: { authorization: 'Bearer wrong-secret' } }), validConfig);
    expect(err?.code).toBe('UNAUTHORIZED');
    expect(err?.status).toBe(401);
  });

  it('returns 503 when GMAIL_USER is missing', () => {
    const err = validateRequest(makeReq(), { ...validConfig, gmailUser: '' });
    expect(err?.code).toBe('EMAIL_PROVIDER_NOT_CONFIGURED');
    expect(err?.status).toBe(503);
  });

  it('returns 503 when GMAIL_APP_PASSWORD is missing', () => {
    const err = validateRequest(makeReq(), { ...validConfig, gmailAppPassword: '' });
    expect(err?.code).toBe('EMAIL_PROVIDER_NOT_CONFIGURED');
    expect(err?.status).toBe(503);
  });

  it('returns 400 when "to" field is missing', () => {
    const err = validateRequest(
      makeReq({ body: { ...validBody, to: undefined } }),
      validConfig,
    );
    expect(err?.code).toBe('INVALID_REQUEST');
    expect(err?.status).toBe(400);
  });

  it('returns 400 when "subject" field is missing', () => {
    const err = validateRequest(
      makeReq({ body: { ...validBody, subject: undefined } }),
      validConfig,
    );
    expect(err?.code).toBe('INVALID_REQUEST');
    expect(err?.status).toBe(400);
  });

  it('returns 400 when "html" field is missing', () => {
    const err = validateRequest(
      makeReq({ body: { ...validBody, html: undefined } }),
      validConfig,
    );
    expect(err?.code).toBe('INVALID_REQUEST');
    expect(err?.status).toBe(400);
  });
});

// ─── sendViaGmail ─────────────────────────────────────────────────────────────

describe('sendViaGmail', () => {
  it('returns a messageId on success', async () => {
    mockSendMail.mockResolvedValue({ messageId: '<abc123@smtp.gmail.com>' });

    const result: SendResult = await sendViaGmail(validBody, validConfig);

    expect(result.messageId).toBe('<abc123@smtp.gmail.com>');
  });

  it('creates transporter with smtp.gmail.com:587 STARTTLS', async () => {
    mockSendMail.mockResolvedValue({ messageId: '<id@gmail.com>' });

    await sendViaGmail(validBody, validConfig);

    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        auth: {
          user: 'club-sender@example.com',
          pass: 'abcd efgh ijkl mnop',
        },
      }),
    );
  });

  it('sends from GMAIL_USER, not a hardcoded address', async () => {
    mockSendMail.mockResolvedValue({ messageId: '<id@gmail.com>' });

    await sendViaGmail(validBody, { ...validConfig, gmailUser: 'other@gmail.com' });

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: expect.stringContaining('other@gmail.com'),
      }),
    );
  });

  it('propagates SMTP errors to the caller', async () => {
    mockSendMail.mockRejectedValue(new Error('Authentication failed'));

    await expect(sendViaGmail(validBody, validConfig)).rejects.toThrow('Authentication failed');
  });

  it('ignores any from field in the request body — sender is always fixed to GMAIL_USER', async () => {
    mockSendMail.mockResolvedValue({ messageId: '<id@gmail.com>' });

    // Simulate a caller attempting to inject a custom from address
    await sendViaGmail({ ...validBody, from: 'attacker@evil.com' } as unknown as typeof validBody, validConfig);

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: expect.stringContaining('club-sender@example.com'),
      }),
    );
    expect(mockSendMail).not.toHaveBeenCalledWith(
      expect.objectContaining({ from: 'attacker@evil.com' }),
    );
  });

  it('never logs the App Password', async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockSendMail.mockRejectedValue(new Error('SMTP error'));

    try {
      await sendViaGmail(validBody, validConfig);
    } catch {
      // expected
    }

    const allOutput = [...spy.mock.calls, ...errSpy.mock.calls].flat().join(' ');
    expect(allOutput).not.toContain('abcd efgh ijkl mnop');
    spy.mockRestore();
    errSpy.mockRestore();
  });
});
