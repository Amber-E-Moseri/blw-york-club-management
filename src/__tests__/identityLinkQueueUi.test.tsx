import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { AdminPendingApprovals } from '../pages/AdminPendingApprovals';
import { approvePendingMember } from '../lib/queries/members';
import { approvalRefusalMessage } from '../lib/queries/identityLinkQueue';
import { IdentityLinkQueue } from '../components/feature/IdentityLinkQueue';
import { supabase } from '../lib/supabase';
import type { AuthUser } from '../lib/auth';

// Static and mocked tests. They prove the UI wiring and the client-side outcomes only. They do NOT certify the database
// rules; those are proven by the PGlite suites in supabase/verification (not a Supabase stack).
jest.mock('../lib/supabase', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));
jest.mock('../lib/queries/contacts', () => ({ fetchCells: jest.fn(() => new Promise(() => {})) }));
jest.mock('../lib/email/emailService', () => ({
  sendEmail: jest.fn(),
  getAppOrigin: jest.fn(() => 'https://blwyork.example'),
  buildUnsubscribeUrl: jest.fn(() => 'https://blwyork.example/email-preferences'),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const rpc = supabase.rpc as jest.Mock;

const user = (role: AuthUser['role'], status: AuthUser['status'] = 'active'): AuthUser => ({
  id: 'staff-1', email: 'staff@example.org', name: 'Staff', role, status, createdAt: new Date(0),
});

describe('Accounts Awaiting Link is staff-only', () => {
  it('shows an ordinary member only the access-denied state, with no link queue or link control', () => {
    const html = renderToStaticMarkup(<AdminPendingApprovals user={user('member')} />);
    expect(html).toContain('Access denied');
    expect(html).not.toContain('Accounts awaiting link');
    expect(html).not.toContain('Link account to');
  });

  it('shows a cell leader only the access-denied state', () => {
    const html = renderToStaticMarkup(<AdminPendingApprovals user={user('cell_leader')} />);
    expect(html).toContain('Access denied');
    expect(html).not.toContain('Accounts awaiting link');
  });

  it('shows an administrator the single queue, with the queue closed until a reason is entered', () => {
    const html = renderToStaticMarkup(<AdminPendingApprovals user={user('admin')} />);
    expect(html).toContain('Accounts awaiting link');
    expect(html).toContain('Reason for opening this queue');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>(<span>)?Open queue/);
  });
});

describe('Accounts awaiting link (mocked queries)', () => {
  let mounted: { container: HTMLDivElement; root: Root } | null = null;

  beforeEach(() => {
    rpc.mockReset();
  });

  afterEach(() => {
    if (mounted) {
      act(() => mounted!.root.unmount());
      mounted.container.remove();
      mounted = null;
    }
  });

  const setInput = (input: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const buttonWith = (text: string) =>
    Array.from(mounted!.container.querySelectorAll('button')).find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined;

  const mount = () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<IdentityLinkQueue />));
    mounted = { container, root };
  };

  const candidate = {
    profile_id: 'profile-1',
    display_name: 'Verified Applicant',
    created_at: '2026-10-01T10:00:00.000Z',
    person_id: 'person-1',
    person_name: 'Prospect Person',
  };

  it('loads nothing until staff give a reason, then sends that reason to the audited queue', async () => {
    rpc.mockResolvedValueOnce({ data: [candidate], error: null });
    mount();
    expect(buttonWith('Open queue')?.disabled).toBe(true);
    expect(rpc).not.toHaveBeenCalled();

    setInput(mounted!.container.querySelector('input')!, 'Desk check of applicant');
    await act(async () => { buttonWith('Open queue')!.click(); });

    expect(rpc).toHaveBeenCalledWith('list_account_link_queue', { p_reason: 'Desk check of applicant' });
    expect(mounted!.container.textContent).toContain('Verified Applicant');
    expect(mounted!.container.textContent).toContain('Matching person: Prospect Person');
  });

  it('does not show the person email until the reviewer asks, and then only under the reason', async () => {
    rpc
      .mockResolvedValueOnce({ data: [candidate], error: null })
      .mockResolvedValueOnce({ data: [{ full_name: 'Prospect Person', email: 'p@x.org', phone: null }], error: null });
    mount();
    setInput(mounted!.container.querySelector('input')!, 'Desk check of applicant');
    await act(async () => { buttonWith('Open queue')!.click(); });
    expect(mounted!.container.textContent).not.toContain('p@x.org');
    await act(async () => { buttonWith("Show matching person's details")!.click(); });
    expect(rpc).toHaveBeenLastCalledWith('get_person_identity', { p_person_id: 'person-1', p_reason: 'Desk check of applicant' });
    expect(mounted!.container.textContent).toContain('p@x.org');
  });

  it('requires an explicit confirmation before the link button is enabled, then links with the reason', async () => {
    rpc
      .mockResolvedValueOnce({ data: [candidate], error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    mount();
    setInput(mounted!.container.querySelector('input')!, 'Desk check of applicant');
    await act(async () => { buttonWith('Open queue')!.click(); });

    expect(buttonWith('Link account to Prospect Person')?.disabled).toBe(true);
    const checkbox = mounted!.container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => { checkbox.click(); });
    expect(buttonWith('Link account to Prospect Person')?.disabled).toBe(false);

    await act(async () => { buttonWith('Link account to Prospect Person')!.click(); });
    expect(rpc).toHaveBeenLastCalledWith('link_pending_profile_to_person', {
      p_profile_id: 'profile-1',
      p_person_id: 'person-1',
      p_reason: 'Desk check of applicant',
    });
    expect(mounted!.container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(mounted!.container.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it('shows the database refusal and keeps the account listed when linking is refused', async () => {
    rpc
      .mockResolvedValueOnce({ data: [candidate], error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'This account has a pending email change.', code: '42501' } });
    mount();
    setInput(mounted!.container.querySelector('input')!, 'Desk check of applicant');
    await act(async () => { buttonWith('Open queue')!.click(); });
    await act(async () => { mounted!.container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(); });
    await act(async () => { buttonWith('Link account to Prospect Person')!.click(); });

    expect(mounted!.container.querySelector('[role="alert"]')?.textContent).toContain('pending email change');
    expect(mounted!.container.textContent).toContain('Verified Applicant');
  });

  it('offers no link when no person holds the account email', async () => {
    rpc.mockResolvedValueOnce({ data: [{ ...candidate, person_id: null, person_name: null }], error: null });
    mount();
    setInput(mounted!.container.querySelector('input')!, 'Desk check of applicant');
    await act(async () => { buttonWith('Open queue')!.click(); });
    expect(mounted!.container.textContent).toContain('cannot be linked here');
    expect(buttonWith('Link account to')).toBeUndefined();
  });
});

describe('approval is blocked until an account is linked', () => {
  it('refuses an unlinked account with the database message, which the approvals page turns into the next step', async () => {
    const from = supabase.from as unknown as jest.Mock;
    from.mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'p1', email: 'p@x.org', full_name: 'P', status: 'pending' }, error: null }) }) }),
    });
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: 'Link this account to its existing person before approving it.' },
    });
    await expect(approvePendingMember('p1')).rejects.toThrow('Link this account to its existing person before approving it.');
    expect(approvalRefusalMessage('Link this account to its existing person before approving it.')).toMatch(/Accounts awaiting link below/);
  });

  it('still reports other activation failures as errors', async () => {
    const from = supabase.from as unknown as jest.Mock;
    from.mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'p1', email: 'p@x.org', full_name: 'P', status: 'pending' }, error: null }) }) }),
    });
    rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'Not authorised to approve members.' } });
    await expect(approvePendingMember('p1')).rejects.toThrow('Not authorised to approve members.');
  });
});
