import fs from 'fs';
import path from 'path';

// Offline structural checks over the authorization migrations (090-094). They read SQL text only. Behaviour needs the
// authenticated certification (supabase/verification) against a local stack, or the PGlite replay where it is available.

const migrationsDir = path.resolve(__dirname, '../../supabase/migrations');
const read = (prefix: string): string => {
  const file = fs.readdirSync(migrationsDir).find((f) => f.startsWith(`${prefix}_`));
  if (!file) throw new Error(`No migration ${prefix}`);
  return fs.readFileSync(path.join(migrationsDir, file), 'utf8');
};
const stripComments = (sql: string): string => sql.replace(/--[^\n]*/g, '');
const grantColumns = (sql: string, role: string): string[] | null => {
  const match = sql.match(new RegExp(`grant update \\(([^)]*)\\)\\s+on table public\\.profiles to ${role};`));
  return match ? match[1].split(',').map((c) => c.trim()) : null;
};

describe('migration sequence', () => {
  it('has one file per version, contiguous from 000', () => {
    const versions = fs.readdirSync(migrationsDir).map((f) => Number(f.split('_')[0]));
    expect(new Set(versions).size).toBe(versions.length);
    [...versions].sort((a, b) => a - b).forEach((v, i) => expect(v).toBe(i));
  });

  it('keeps the applied 089 unchanged in its guard exemption', () => {
    expect(read('089')).toContain("if current_user in ('postgres', 'supabase_admin', 'service_role') then");
  });
});

describe('service_role status guard (090)', () => {
  const sql = stripComments(read('090'));

  it('refuses status changes for every caller except the owner', () => {
    expect(sql).toMatch(/new\.status is distinct from old\.status and current_user not in \('postgres', 'supabase_admin'\)/);
  });
});

describe('pending visibility (091)', () => {
  const sql = stripComments(read('091'));

  it('hides pending rows from cell leaders in profile RLS', () => {
    expect(sql).toMatch(/is_cell_leader_for_profile\(id\)\s+and profiles\.status is distinct from 'pending'/);
  });

  it('limits pending visibility in the BSC roster to admins and coordinators', () => {
    expect(sql).toMatch(/p\.status = 'pending' and public\.is_admin_or_coordinator\(\)/);
  });

  it('returns only id, full name and cell from the cell-leader roster, for cells the caller leads', () => {
    const start = sql.indexOf('function public.cell_leader_pending_roster');
    const rpc = sql.slice(start, sql.indexOf('$function$;', start));
    expect(rpc).toMatch(/returns table \(id uuid, full_name text, cell_id uuid\)/);
    expect(rpc).toMatch(/public\.is_cell_leader_of\(c\.id\)/);
    expect(rpc).not.toMatch(/\bemail\b|student_number|avatar_url|joined_at/);
  });
});

describe('contact logging (092)', () => {
  const sql = stripComments(read('092'));

  it('lets an active ordinary member log only as themselves, to their own or no cell', () => {
    expect(sql).toMatch(/public\.is_active_member\(\)\s+and logged_by = auth\.uid\(\)/);
    expect(sql).toMatch(/cell_id is null\s+or cell_id is not distinct from/);
  });
});

describe('reasoned cell changes (093)', () => {
  const sql = stripComments(read('093'));

  it('has exactly one writer of member_cell_audit', () => {
    expect(sql.match(/insert into public\.member_cell_audit/g)?.length).toBe(1);
  });

  it('refuses a cell change with no recorded reason in the audit trigger', () => {
    expect(sql).toMatch(/if v_reason is null then\s+raise exception 'Every cell change needs a recorded reason/);
  });

  it('requires a reason in both owner-run placement RPCs', () => {
    expect(sql).toMatch(/function public\.transfer_member_cell\(p_member_id uuid, p_cell_id uuid, p_reason text\)/);
    expect(sql).toMatch(/function public\.assign_pending_applicant_to_cell\(p_member_id uuid, p_cell_id uuid, p_reason text\)/);
    expect(sql.match(/perform public\.begin_cell_change\(p_reason\);/g)?.length).toBe(2);
  });

  it('keeps the reasonless 2-argument transfer only as a refusal that changes nothing', () => {
    const stub = sql.slice(sql.indexOf('function public.transfer_member_cell(p_member_id uuid, p_cell_id uuid)'));
    expect(stub).toMatch(/raise exception 'Cell changes now require a reason/);
    expect(stub.slice(0, 600)).not.toMatch(/update public\.profiles/);
  });
});

describe('profile privileges (094)', () => {
  const sql = stripComments(read('094'));

  it('revokes update and delete on profiles from every API role and PUBLIC', () => {
    expect(sql).toMatch(/revoke update, delete on table public\.profiles from public, anon, authenticated, service_role;/);
  });

  it('removes insert from service_role', () => {
    expect(sql).toMatch(/revoke insert on table public\.profiles from service_role;/);
  });

  it('gives service_role no column UPDATE on profiles', () => {
    expect(grantColumns(sql, 'service_role')).toBeNull();
  });

  it('grants authenticated no status, cell, BSC or id column directly', () => {
    const columns = grantColumns(sql, 'authenticated') ?? [];
    expect(columns.length).toBeGreaterThan(0);
    for (const forbidden of ['status', 'cell_id', 'bsc_id', 'id']) {
      expect(columns).not.toContain(forbidden);
    }
  });
});

describe('people privacy (095)', () => {
  const sql = stripComments(read('095'));

  it('hides pending and rejected applicant rows from everyone except admins, coordinators and the applicant', () => {
    expect(sql).toMatch(/p\.status in \('pending', 'rejected'\)/);
    expect(sql).toMatch(/public\.is_admin_or_coordinator\(\)\s+or public\.is_callers_person\(id\)/);
    expect(sql).toMatch(/public\.is_active_member\(\) and not public\.person_has_unapproved_profile\(id\)/);
  });

  it('keeps the applicant own row readable through is_callers_person', () => {
    expect(sql).toMatch(/where p\.id = auth\.uid\(\)\s+and p\.person_id = p_person_id/);
  });
});

describe('profile INSERT boundary (096)', () => {
  const sql = stripComments(read('096'));

  it('revokes INSERT on profiles from every role, PUBLIC included', () => {
    expect(sql).toMatch(/revoke insert on table public\.profiles from public, anon, authenticated, service_role;/);
  });

  it('adds no grant that restores INSERT', () => {
    expect(sql).not.toMatch(/grant\s+insert/i);
  });
});
