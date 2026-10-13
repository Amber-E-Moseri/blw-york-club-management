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
  const withCheck = correction.slice(correction.indexOf('with check (', correction.indexOf('announcements_manage')));

  test('the write check requires a non-null spec', () => {
    expect(withCheck).toMatch(/audience_spec_id is not null/);
  });

  test('the write check never accepts a null spec for a leader', () => {
    expect(withCheck).not.toMatch(/audience_spec_id is null/);
  });

  test('a leader spec must be cells-mode, exactly one cell, led by that leader', () => {
    expect(withCheck).toMatch(/s\.mode = 'cells'/);
    expect(withCheck).toMatch(/array_length\(s\.cell_ids, 1\) = 1/);
    expect(withCheck).toMatch(/c\.id = s\.cell_ids\[1\][\s\S]*c\.leader_id = auth\.uid\(\)/);
  });

  test('staff keep full rights in the write check', () => {
    expect(withCheck.trimStart()).toMatch(/^with check \(\s*public\.is_admin_or_coordinator\(\)/);
  });
});

describe('067: external email and push are staff-only', () => {
  test('send_message refuses external channels for anyone who is not admin or coordinator', () => {
    expect(messaging).toMatch(
      /if \(p_channels && array\['email','push'\]::text\[\]\) and v_role not in \('admin','coordinator'\) then\s+raise exception 'external_channels_restricted'/,
    );
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
