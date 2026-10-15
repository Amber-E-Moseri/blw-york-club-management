import { approvePendingMember } from '../lib/queries/members';
import { supabase } from '../lib/supabase';
import * as emailService from '../lib/email/emailService';
import { accountApprovedTemplate } from '../lib/email/emailTemplates';

jest.mock('../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

jest.mock('../lib/email/emailService', () => ({
  sendEmail: jest.fn(),
  getAppOrigin: jest.fn(() => 'https://blwyork.example'),
  buildUnsubscribeUrl: jest.fn(() => 'https://blwyork.example/email-preferences'),
}));

const PENDING_MEMBER_ID = 'member-pending';
const ACTIVE_MEMBER_ID = 'member-active';

function memberDirectoryQuery(row: Record<string, unknown> | null) {
  const q: Record<string, jest.Mock> = {};
  q.select = jest.fn(() => q);
  q.eq = jest.fn(() => q);
  q.maybeSingle = jest.fn(() => Promise.resolve({ data: row, error: null }));
  return q;
}

afterEach(() => {
  jest.clearAllMocks();
});

test('approval uses DB-authorized RPC and never performs direct profile update', async () => {
  (supabase.from as jest.Mock).mockReturnValueOnce(
    memberDirectoryQuery({
      id: PENDING_MEMBER_ID,
      email: 'jane@example.com',
      full_name: 'Jane Doe',
      status: 'pending',
    }),
  );
  (supabase.rpc as jest.Mock).mockResolvedValueOnce({
    data: [{ id: PENDING_MEMBER_ID, email: 'jane@example.com', full_name: 'Jane Doe', status: 'active' }],
    error: null,
  });
  (emailService.sendEmail as jest.Mock).mockResolvedValueOnce({ id: 'msg-1' });

  const result = await approvePendingMember(PENDING_MEMBER_ID, 'spoofed-actor-id');

  expect(result.approval).toBe('success');
  expect(supabase.rpc).toHaveBeenCalledWith('approve_pending_member', { target_member_id: PENDING_MEMBER_ID });
  const query = (supabase.from as jest.Mock).mock.results[0].value;
  expect(query.update).toBeUndefined();
  expect(emailService.sendEmail).toHaveBeenCalledTimes(1);
});

test('unauthorized approval is rejected by the database RPC', async () => {
  (supabase.from as jest.Mock).mockReturnValueOnce(
    memberDirectoryQuery({
      id: PENDING_MEMBER_ID,
      email: 'jane@example.com',
      full_name: 'Jane Doe',
      status: 'pending',
    }),
  );
  (supabase.rpc as jest.Mock).mockResolvedValueOnce({
    data: null,
    error: { message: 'Not authorised to approve members.' },
  });

  await expect(approvePendingMember(PENDING_MEMBER_ID, 'member-user')).rejects.toThrow('Not authorised');
  expect(emailService.sendEmail).not.toHaveBeenCalled();
});

test('already active member: approval skipped, no RPC and no email sent', async () => {
  (supabase.from as jest.Mock).mockReturnValueOnce(
    memberDirectoryQuery({
      id: ACTIVE_MEMBER_ID,
      email: 'alice@example.com',
      full_name: 'Alice',
      status: 'active',
    }),
  );

  const result = await approvePendingMember(ACTIVE_MEMBER_ID);

  expect(result.approval).toBe('not_pending');
  expect(result.email).toBe('skipped');
  expect(supabase.rpc).not.toHaveBeenCalled();
  expect(emailService.sendEmail).not.toHaveBeenCalled();
});

test('pending to active: email failure leaves member active', async () => {
  (supabase.from as jest.Mock).mockReturnValueOnce(
    memberDirectoryQuery({
      id: PENDING_MEMBER_ID,
      email: 'bob@example.com',
      full_name: 'Bob',
      status: 'pending',
    }),
  );
  (supabase.rpc as jest.Mock).mockResolvedValueOnce({
    data: [{ id: PENDING_MEMBER_ID, email: 'bob@example.com', full_name: 'Bob', status: 'active' }],
    error: null,
  });
  (emailService.sendEmail as jest.Mock).mockRejectedValueOnce(new Error('SMTP unavailable'));

  const result = await approvePendingMember(PENDING_MEMBER_ID);

  expect(result.approval).toBe('success');
  expect(result.email).toBe('failed');
  expect(result.emailError).toContain('SMTP unavailable');
});

test('account_approved template: HTML contains approval text', () => {
  const { html, text, subject } = accountApprovedTemplate({
    memberId: 'member-1',
    memberName: 'Alex',
    loginUrl: 'https://blwyork.example/',
  });

  expect(subject).toBe('Your BLW York Hub account is ready');
  expect(html).toContain('Alex');
  expect(html).toContain('approved');
  expect(html).toContain('https://blwyork.example/');
  expect(html).toContain('Sign in to BLW York Hub');
  expect(html).not.toContain('create');
  expect(text).toContain('Alex');
  expect(text).toContain('approved');
  expect(text).toContain('https://blwyork.example/');
});
