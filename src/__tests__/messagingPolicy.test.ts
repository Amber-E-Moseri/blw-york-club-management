import fs from 'fs';
import path from 'path';
import { canSendExternal } from '../lib/communications/messaging';

// Static guards for the 066 spec-deletion and leader-broadcast fixes and the 067 external-channel policy.
// Real-database behaviour is checked by supabase/verification/messaging_certification.sql.

const root = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const stripSql = (sql: string) => sql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
const correction = stripSql(read('supabase/migrations/068_audience_resolution_scope.sql'));
const messaging = stripSql(read('supabase/migrations/069_targeted_messages.sql'));
const fix = stripSql(read('supabase/migrations/071_messaging_leadership_and_policy_correction.sql'));
const dispatcher = read('supabase/functions/dispatch-message/index.ts');

describe('066: deleting an audience spec cannot widen visibility', () => {
  test.each([
    ['events', 'events_audience_spec_id_fkey'],
    ['confessions', 'confessions_audience_spec_id_fkey'],
    ['announcements', 'announcements_audience_spec_id_fkey'],
  ])('%s audience_spec_id is restricted, not set to null', (table, constraint) => {
    expect(correction).toMatch(
      new RegExp(`alter table public\\.${table}\\s+add constraint ${constraint}[\\s\\S]*?on delete restrict`),
    );
  });

  test('the correction never sets a spec reference to null on delete', () => {
    expect(correction).not.toMatch(/on delete set null/);
  });

  test('clients cannot update or delete audience specs', () => {
    expect(correction).toMatch(/revoke update, delete on public\.audience_specs from public, anon, authenticated/);
  });
});

describe('066: a cell leader cannot write a broadcast', () => {
  const withCheck = fix.slice(fix.indexOf('with check (', fix.indexOf('announcements_manage')));

  test('the write check requires a non-null spec', () => {
    expect(withCheck).toMatch(/audience_spec_id is not null/);
  });

  test('the write check never accepts a null spec for a leader', () => {
    expect(withCheck).not.toMatch(/audience_spec_id is null/);
  });

  test('a leader spec must be cells-mode, exactly one cell, led by that leader (migration 054 helper)', () => {
    expect(withCheck).toMatch(/s\.mode = 'cells'/);
    expect(withCheck).toMatch(/array_length\(s\.cell_ids, 1\) = 1/);
    expect(withCheck).toMatch(/public\.is_cell_leader_of\(s\.cell_ids\[1\]\)/);
  });

  test('leadership is not granted by the cell_leader role label', () => {
    expect(fix).not.toMatch(/role = 'cell_leader'/);
  });

  test('leaders manage only announcements they authored', () => {
    const policy = fix.slice(fix.indexOf('create policy announcements_manage'));
    expect(policy).toMatch(/author_id = auth\.uid\(\)/);
  });

  test('staff keep full rights in the write check', () => {
    expect(withCheck.trimStart()).toMatch(/^with check \(\s*public\.is_admin_or_coordinator\(\)/);
  });
});

describe('067: leadership is an assignment, never a profile cell or a role label', () => {
  test('the authorization check uses the 054 helper, not profiles.cell_id', () => {
    const check = fix.slice(fix.indexOf('function public.assert_can_send_message'), fix.indexOf('$$;', fix.indexOf('function public.assert_can_send_message')));
    expect(check).toMatch(/public\.is_cell_leader_of\(c\.id\)/);
    expect(check).not.toMatch(/profiles\.cell_id|\.cell_id\b/);
    expect(check).not.toMatch(/role = 'cell_leader'/);
  });

  test('a leader may send only in cells mode', () => {
    const check = fix.slice(fix.indexOf('function public.assert_can_send_message'), fix.indexOf('$$;', fix.indexOf('function public.assert_can_send_message')));
    expect(check).toMatch(/if p_mode <> 'cells' or coalesce\(cardinality\(p_cell_ids\), 0\) = 0 then/);
  });

  test('a sender label may be member (a leader can hold it), so the constraint allows it', () => {
    expect(fix).toMatch(/check \(sender_role in \('admin','coordinator','cell_leader','member'\)\)/);
  });
});

describe('067: external email and push are staff-only', () => {
  test('send_message refuses external channels for anyone who is not admin or coordinator', () => {
    // Migration 069 checks the profile role label, which is only reached after assert_can_send_message() has
    // confirmed an active account. For active accounts this is the same rule as is_admin_or_coordinator().
    expect(messaging).toMatch(
      /if \(p_channels && array\['email','push'\]::text\[\]\) and v_role not in \('admin','coordinator'\) then\s+raise exception 'external_channels_restricted'/,
    );
    const assertAt = messaging.indexOf('perform public.assert_can_send_message', messaging.indexOf('function public.send_message'));
    expect(assertAt).toBeGreaterThan(-1);
    expect(assertAt).toBeLessThan(messaging.indexOf("'external_channels_restricted'"));
  });

  test('the dispatcher refuses external dispatch for non-staff as well', () => {
    expect(dispatcher).toMatch(/if \(external && caller\.role !== 'admin' && caller\.role !== 'coordinator'\)/);
  });
});

describe('067: auditing', () => {
  test('the audit table records both sends and dispatches', () => {
    expect(messaging).toMatch(/check \(action in \('send','dispatch'\)\)/);
  });

  test('the dispatcher writes a dispatch audit row before any provider call', () => {
    const audit = dispatcher.indexOf("action: 'dispatch'");
    expect(audit).toBeGreaterThan(-1);
    expect(audit).toBeLessThan(dispatcher.indexOf('await dispatchEmail('));
  });
});

describe('dispatch: authorization and audit completeness', () => {
  test('a failed audit write stops the dispatch before any provider call', () => {
    expect(dispatcher).toMatch(/if \(auditError\) throw new HttpError\(/);
    expect(dispatcher.indexOf('if (auditError)')).toBeLessThan(dispatcher.indexOf('await dispatchEmail('));
  });

  test('the function requires a JWT at the gateway as well as checking the caller', () => {
    const toml = read('supabase/config.toml');
    expect(toml).toMatch(/\[functions\.dispatch-message\]\s+verify_jwt = true/);
  });

  test('clients cannot call the internal claim, reset or expiry functions', () => {
    expect(messaging).toMatch(/revoke all on function public\.claim_deliveries\(uuid, text\)\s+from public, anon, authenticated/);
    expect(messaging).toMatch(/revoke all on function public\.expire_stuck_deliveries\(interval\)\s+from public, anon, authenticated/);
  });

  test('clients have no write grant on delivery rows, so they cannot reset attempts', () => {
    expect(messaging).toMatch(/grant select on public\.communication_deliveries to authenticated/);
    expect(messaging).not.toMatch(/grant (insert|update|delete)[^;]*communication_deliveries[^;]*to authenticated/);
  });
});

describe('canSendExternal (client mirror of the database rule)', () => {
  test('admin and coordinator may send external channels', () => {
    expect(canSendExternal('admin')).toBe(true);
    expect(canSendExternal('coordinator')).toBe(true);
  });

  test('cell leaders and members may not', () => {
    expect(canSendExternal('cell_leader')).toBe(false);
    expect(canSendExternal('member')).toBe(false);
  });
});
