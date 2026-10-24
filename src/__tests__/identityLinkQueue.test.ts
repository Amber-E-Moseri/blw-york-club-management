import fs from 'fs';
import path from 'path';
import { supabase } from '../lib/supabase';
import {
  approvalRefusalMessage,
  linkPendingProfileToPerson,
  listAccountLinkQueue,
} from '../lib/queries/identityLinkQueue';

// Client calls and text gates. The SQL itself is executed by the PGlite suites in supabase/verification (not here).
jest.mock('../lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));

const rpc = supabase.rpc as unknown as jest.Mock;
const root = path.resolve(__dirname, '..', '..');
const migration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '103_identity_link_queue_and_approval_gate.sql'), 'utf8');
const body = migration.replace(/--[^\n]*/g, '');

beforeEach(() => rpc.mockReset());

describe('accounts-awaiting-link queue (client)', () => {
  test('lists through the single staff RPC with the reason, and maps only names, ids and dates', async () => {
    rpc.mockResolvedValue({
      data: [{
        profile_id: 'p1', display_name: 'Marcus Lee', created_at: '2026-02-01T00:00:00Z',
        person_id: 'person-1', person_name: 'Marcus Lee',
      }],
      error: null,
    });
    const items = await listAccountLinkQueue('  Desk check  ');
    expect(rpc).toHaveBeenCalledWith('list_account_link_queue', { p_reason: 'Desk check' });
    expect(items).toEqual([{
      profileId: 'p1', displayName: 'Marcus Lee', createdAt: '2026-02-01T00:00:00Z',
      personId: 'person-1', personName: 'Marcus Lee',
    }]);
    expect(Object.keys(items[0]).some((k) => /email/i.test(k))).toBe(false);
  });

  test('a queue read is refused locally when the reason is missing, and no RPC is sent', async () => {
    await expect(listAccountLinkQueue('')).rejects.toThrow(/reason/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  test('a database refusal (for example a non-staff caller) is surfaced', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'You are not authorised for identity review.' } });
    await expect(listAccountLinkQueue('Desk check')).rejects.toThrow(/not authorised/);
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

  test('a database refusal on link (pending email change) is shown to staff', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'This account has a pending email change. Resolve it before linking.' } });
    await expect(linkPendingProfileToPerson('p1', 'person-1', 'Confirmed by phone')).rejects.toThrow(/pending email change/);
  });

  test('the approval refusal is rewritten into a next step on the approvals page', () => {
    expect(approvalRefusalMessage('Link this account to its existing person before approving it.'))
      .toMatch(/Accounts awaiting link below/);
    expect(approvalRefusalMessage('Not authorised to approve members.')).toBe('Not authorised to approve members.');
  });
});

describe('migration 103 text gates (the SQL is NOT executed here)', () => {
  test('exactly one queue RPC exists, staff-only, reason-gated and audited', () => {
    expect(body).not.toMatch(/list_identity_link_queue/);
    expect(body).toMatch(/FUNCTION public\.list_account_link_queue\(p_reason text\)/i);
    const q = body.slice(body.search(/FUNCTION public\.list_account_link_queue/i));
    expect(q).toMatch(/_f2_staff_actor\(\)/);
    expect(q).toMatch(/_f2_valid_reason\(p_reason\)/);
    expect(q).toMatch(/insert into public\.identity_read_audit[\s\S]*'account_link'/i);
    expect(q).toMatch(/au\.email_confirmed_at is not null/i);
    expect(q).toMatch(/pr\.person_id is null/i);
  });

  test('the queue returns no email field and no masked address', () => {
    const from = body.search(/FUNCTION public\.list_account_link_queue/i);
    const returns = body.slice(body.indexOf('RETURNS TABLE (', from), body.indexOf(')', body.indexOf('RETURNS TABLE (', from)) + 1);
    expect(returns).not.toMatch(/email/i);
    expect(body).not.toMatch(/_mask_email/);
  });

  test('approval refuses any pending account with no linked person, and locks the profile row', () => {
    expect(body).toMatch(/if v_profile\.person_id is null then/i);
    expect(body).toMatch(/from public\.profiles p\s+where p\.id = target_member_id\s+for update/i);
    expect(body).toMatch(/insert into public\.profile_approval_audit/i);
  });

  test('every SECURITY DEFINER function pins its search_path to pg_catalog, public', () => {
    const definers = body.split(/CREATE OR REPLACE FUNCTION/i).slice(1).filter((f) => /SECURITY DEFINER/i.test(f));
    expect(definers.length).toBeGreaterThanOrEqual(4);
    for (const f of definers) expect(f).toMatch(/SET search_path = pg_catalog, public/);
  });

  test('pending email change is read from GoTrue email_change, never from a new_email column', () => {
    expect(body).toMatch(/nullif\(btrim\(u\.email_change\), ''\) IS NOT NULL/i);
    expect(body).toMatch(/_auth_has_pending_email_change\(p_profile_id\)/);
    expect(body).not.toMatch(/new_email/);
  });

  test('audit tables are append-only and refuse TRUNCATE for every role', () => {
    expect(body).toMatch(/revoke all on table public\.profile_approval_audit from public, anon, authenticated, service_role/i);
    expect(body).toMatch(/before update or delete on public\.profile_approval_audit/i);
    expect(body).toMatch(/before truncate on public\.profile_approval_audit\s+for each statement/i);
    expect(body).toMatch(/before truncate on public\.identity_read_audit\s+for each statement/i);
    expect(body).toMatch(/before truncate on public\.profile_link_audit\s+for each statement/i);
  });

  test('the unique person/account index is not part of 103', () => {
    expect(body).not.toMatch(/unique index/i);
  });

  // 103 is an ordinary member of the chain, not its end: later forward migrations (104, 105) are expected. The test
  // therefore checks that 103 is present exactly once and that the chain is contiguous from 000 through its last file.
  test('103 is present exactly once in a contiguous chain from 000', () => {
    const files = fs.readdirSync(path.join(root, 'supabase', 'migrations')).filter((f) => f.endsWith('.sql')).sort();
    expect(files.filter((f) => f.startsWith('103_'))).toEqual(['103_identity_link_queue_and_approval_gate.sql']);
    files.forEach((f, i) => expect(Number(f.slice(0, 3))).toBe(i));
  });
});
