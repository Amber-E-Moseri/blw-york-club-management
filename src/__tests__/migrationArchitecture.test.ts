import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '..', '..');
const migrationsDir = path.join(root, 'supabase', 'migrations');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function migrationFiles(): string[] {
  return fs.readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort();
}

describe('Supabase migration architecture', () => {
  test('canonical migrations have unique numeric prefixes', () => {
    const prefixes = migrationFiles().map((file) => file.match(/^\d+/)?.[0] ?? file);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  test('canonical migrations do not destructively drop tables or schemas', () => {
    const destructive = migrationFiles()
      .map((file) => [file, fs.readFileSync(path.join(migrationsDir, file), 'utf8')] as const)
      .filter(([, sql]) => /\b(drop\s+table|drop\s+schema|truncate)\b/i.test(sql));

    expect(destructive).toEqual([]);
  });

  test('verification scripts are kept outside executable migration history', () => {
    expect(migrationFiles()).not.toContain('014_verify_reconciliation.sql');
    expect(fs.existsSync(path.join(root, 'supabase', 'verification', '014_verify_reconciliation.sql'))).toBe(true);
  });

  test('migration versions are contiguous, so a fresh replay never skips a step', () => {
    const numbers = migrationFiles().map((file) => Number(file.match(/^\d+/)?.[0]));
    numbers.forEach((n, i) => expect(n).toBe(i));
  });

  test('protected shared migrations are immutable (content hash, line endings normalised)', () => {
    const expected: Record<string, string> = {
      '006_contact_enhancements.sql': '9ce270bc9f4736b5a07a7a317b3e86d82f71c45aa5e3e2992c941c28db951a7a',
      '007_testimonies_full.sql': 'ff79c50317b206ab579ea591cad8005df3ad5e2218015c8aa72a0f97cbd9dce4',
      '008_email_notifications_additive.sql': '3c2fc40ef80281f9304f5c7492d41c315a05553d4b8aa9b86704072b6f094e69',
    };
    Object.entries(expected).forEach(([file, hash]) => {
      const text = fs.readFileSync(path.join(migrationsDir, file), 'utf8').replace(/\r\n/g, '\n');
      expect(crypto.createHash('sha256').update(text).digest('hex')).toBe(hash);
    });
  });

  test('no executable SQL exists outside the migration system (the source of earlier production drift)', () => {
    const skip = new Set(['node_modules', 'build', 'coverage', '.git', '.claude', '.temp', 'test-results', 'playwright-report']);
    const stray: string[] = [];
    const walk = (dir: string) => {
      fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
        if (skip.has(entry.name)) return;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          return;
        }
        if (!entry.name.endsWith('.sql')) return;
        const rel = path.relative(root, full).split(path.sep).join('/');
        if (!rel.startsWith('supabase/migrations/') && !rel.startsWith('supabase/verification/')) stray.push(rel);
      });
    };
    walk(root);
    expect(stray).toEqual([]);
  });

  test('the app-phase tables are created by a canonical migration', () => {
    const appTables = read('supabase/migrations/017_app_phase_tables.sql');

    [
      'weekly_messages',
      'habit_templates',
      'habit_entries',
      'events',
      'event_rsvps',
      'announcements',
      'confessions',
      'confession_declarations',
    ].forEach((table) => {
      expect(appTables).toContain(`public.${table}`);
    });

    expect(appTables).toContain('ADD COLUMN IF NOT EXISTS category');
    expect(appTables).toContain('ADD COLUMN IF NOT EXISTS allow_join_requests');
  });

  test('phase 6 notification migration reconciles without clean-slate drops', () => {
    const phase6 = read('supabase/migrations/009_phase6_integrations.sql');

    expect(phase6).not.toMatch(/\bdrop\s+table\b/i);
    expect(phase6).toContain('ADD COLUMN IF NOT EXISTS member_id');
    expect(phase6).toContain('UPDATE public.email_preferences');
    expect(phase6).toContain('UPDATE public.push_subscriptions');
    expect(phase6).toContain('UPDATE public.push_notification_log');
  });
});
