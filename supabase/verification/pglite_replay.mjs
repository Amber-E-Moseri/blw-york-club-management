// Isolated, in-process replay harness for migrations and real-session certification.
//
// Runs the real migration files on PGlite (Postgres compiled to WebAssembly). Nothing here touches Docker,
// hosted Supabase or a shared database. Supabase-only objects (auth, storage, and their helper functions)
// are provided as a minimal shim so RLS, SECURITY DEFINER and role switching behave as they do in Supabase.
//
// Limits (state these with any result):
//   * PGlite has no extensions, so `create extension` lines are skipped. gen_random_uuid() is core Postgres.
//   * Shim auth.uid()/auth.role()/auth.jwt() read the same request.jwt.* settings Supabase uses.
//   * This is NOT a substitute for certifying against a hosted or Docker Supabase stack.
//
// Load PGlite from the directory that has it installed, for example:
//   PGLITE_MODULE=file:///path/to/node_modules/@electric-sql/pglite/dist/index.js node <script>

import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

export async function loadPglite() {
  // Accept a file:// URL or a bare filesystem path. A bare Windows path cannot be imported directly.
  const raw = process.env.PGLITE_MODULE;
  const spec = !raw ? '@electric-sql/pglite' : raw.startsWith('file:') ? raw : pathToFileURL(path.resolve(raw)).href;
  const mod = await import(spec);
  return mod.PGlite;
}

const SHIM = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='supabase_admin') then create role supabase_admin nologin; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users(id uuid primary key, email text, encrypted_password text, aud text, role text, created_at timestamptz, updated_at timestamptz, raw_user_meta_data jsonb default '{}'::jsonb, email_confirmed_at timestamptz, email_change text);
-- GoTrue columns read by migrations 099 and 103: email_confirmed_at (verified ownership) and email_change (pending email change, GoTrue's own column name).
alter table auth.users add column if not exists email_confirmed_at timestamptz;
alter table auth.users add column if not exists email_change text;
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
-- Supabase grants USAGE on auth and storage to the API roles. Policies call auth.uid() directly, so the shim must too.
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
create schema if not exists storage;
create or replace function storage.filename(name text) returns text language sql as $$ select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)] $$;
create or replace function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name, '/') $$;
create table if not exists storage.buckets(id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table if not exists storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb);
grant usage on schema storage to anon, authenticated, service_role;
`;

/**
 * Opens a fresh database and applies every migration in migrationsDir in filename order, up to and including
 * lastFile when given. Throws on the first failing file so a broken chain is never certified.
 */
export async function openReplay(migrationsDir, { lastFile = null } = {}) {
  const PGlite = await loadPglite();
  const db = new PGlite();
  await db.exec(SHIM);
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
    .filter((f) => lastFile === null || f <= lastFile);
  for (const f of files) {
    const raw = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
    const sql = raw.split('\n').filter((line) => !/^\s*create extension/i.test(line)).join('\n');
    try {
      await db.exec(sql);
    } catch (e) {
      throw new Error(`replay failed at ${f}: ${e.message}`);
    }
  }
  return { db, applied: files };
}

/** Switches the session role. uid null returns to the owner (postgres), which bypasses RLS. */
export async function asRole(db, role, uid = null) {
  if (role === 'owner') {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false); select set_config('request.jwt.claim.role','',false);`);
    return;
  }
  const sub = uid ?? '';
  await db.exec(
    `set role ${role}; select set_config('request.jwt.claim.sub', '${sub}', false); select set_config('request.jwt.claim.role', '${role}', false);`,
  );
}

/** Runs one statement as a role and reports the outcome without throwing. */
export async function attempt(db, role, uid, sql, params = []) {
  await asRole(db, role, uid);
  try {
    const r = await db.query(sql, params);
    await asRole(db, 'owner');
    return { ok: true, rows: r.rows };
  } catch (e) {
    await asRole(db, 'owner');
    return { ok: false, code: e.code, error: e.message };
  }
}
