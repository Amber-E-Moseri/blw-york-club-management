import fs from 'fs';
import path from 'path';
import { supabase } from '../lib/supabase';
import {
  approvalRefusalMessage,
  linkPendingProfileToPerson,
  listIdentityLinkQueue,
} from '../lib/queries/identityLinkQueue';

jest.mock('../lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));

const rpc = supabase.rpc as unknown as jest.Mock;
const root = path.resolve(__dirname, '..', '..');
const migration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '103_identity_link_queue_and_approval_gate.sql'), 'utf8');

beforeEach(() => rpc.mockReset());

describe('identity-link queue (client)', () => {
  test('lists through the staff RPC and maps masked fields and flags', async () => {
    rpc.mockResolvedValue({
      data: [{
        profile_id: 'p1', profile_name: 'Marcus Lee', profile_masked_email: 'm***@example.org',
        joined_at: '2026-02-01T00:00:00Z', email_verified: true, pending_email_change: false,
        candidate_person_id: 'person-1', candidate_name: 'Marcus Lee', candidate_masked_email: 'm***@example.org',
      }],
      error: null,
    });
    const items = await listIdentityLinkQueue(100);
    expect(rpc).toHaveBeenCalledWith('list_identity_link_queue', { p_limit: 100 });
    expect(items).toEqual([{
      profileId: 'p1', profileName: 'Marcus Lee', profileMaskedEmail: 'm***@example.org',
      joinedAt: '2026-02-01T00:00:00Z', emailVerified: true, pendingEmailChange: false,
      candidatePersonId: 'person-1', candidateName: 'Marcus Lee', candidateMaskedEmail: 'm***@example.org',
    }]);
  });

  test('surfaces a refusal from the database (for example a non-staff caller)', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'You are not authorised for identity review.' } });
    await expect(listIdentityLinkQueue()).rejects.toThrow(/not authorised/);
  });

  test('a link is refused locally when the reason is too short, and no RPC is sent', async () => {
    await expect(linkPendingProfileToPerson('p1', 'person-1', 'x')).rejects.toThrow(/reason/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  test('a link sends the trimmed reason to the guarded RPC and nothing else', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await linkPendingProfileToPerson('p1', 'person-1', '  Confirmed by phone  ');
    expect(rpc).toHaveBeenCalledWith('link_pending_profile_to_person', {
      p_profile_id: 'p1',
      p_person_id: 'person-1',
      p_reason: 'Confirmed by phone',
    });
  });

  test('a database refusal on link (pending email change, unconfirmed email) is shown to staff', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'This account has a pending email change. Resolve it before linking.' } });
    await expect(linkPendingProfileToPerson('p1', 'person-1', 'Confirmed by phone')).rejects.toThrow(/pending email change/);
  });

  test('the approval refusal is rewritten into a next step for staff', () => {
    expect(approvalRefusalMessage('Link this account to its existing person before approving it.'))
      .toMatch(/identity linking first/);
    expect(approvalRefusalMessage('Not authorised to approve members.')).toBe('Not authorised to approve members.');
  });
});

describe('migration 103 contract (text gate; the SQL is NOT executed here)', () => {
  const body = migration.replace(/--[^\n]*/g, '');

  test('approval refuses an account that still needs linking, and is audited', () => {
    expect(body).toMatch(/p\.person_id is null/i);
    expect(body).toMatch(/normalize_identity_email\(pe\.email\) = public\.normalize_identity_email\(p\.email\)/);
    expect(body).toMatch(/insert into public\.profile_approval_audit/i);
  });

  test('linking refuses a pending email change through to_jsonb (safe on stubs without the column)', () => {
    expect(body).toMatch(/to_jsonb\(u\) ->> 'new_email'/);
    expect(body).toMatch(/pending email change/);
  });

  test('the queue is staff-only and returns masked addresses, never raw emails', () => {
    expect(body).toMatch(/perform public\._f2_staff_actor\(\)/);
    const listBody = body.slice(body.indexOf('function public.list_identity_link_queue'));
    expect(listBody).toMatch(/public\._mask_email\(p\.email\)/);
    expect(listBody).toMatch(/public\._mask_email\(pe\.email\)/);
    expect(listBody).not.toMatch(/\bp\.email\b(?!\))/);
    expect(listBody).not.toMatch(/\bpe\.email\b(?!\))/);
  });

  test('the new audit table is append-only and has no client grants', () => {
    expect(body).toMatch(/revoke all on table public\.profile_approval_audit from public, anon, authenticated, service_role/i);
    expect(body).toMatch(/before update or delete on public\.profile_approval_audit/i);
  });

  test('103 stays in place, and any later migration is a forward migration numbered after it', () => {
    const files = fs.readdirSync(path.join(root, 'supabase', 'migrations')).filter((f) => f.endsWith('.sql')).sort();
    const index = files.indexOf('103_identity_link_queue_and_approval_gate.sql');
    expect(index).toBeGreaterThanOrEqual(0);
    files.slice(index + 1).forEach((f) => expect(Number(f.match(/^\d+/)?.[0])).toBeGreaterThan(103));
  });
});
