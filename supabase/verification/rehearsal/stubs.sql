-- Local rehearsal only: minimal stand-ins for the Supabase auth and storage schemas that migrations depend on.
-- These are not the Supabase implementations. Behavioural checks against real Supabase Auth still belong to the
-- hosted-stack certification (supabase/verification/README.md), not to this file.
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;
create table if not exists auth.users (id uuid primary key, email text, phone text, raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}', created_at timestamptz default now(), banned_until timestamptz, deleted_at timestamptz);
-- GoTrue columns read by migrations 099 and 103 (verified email, pending email change).
alter table if exists auth.users add column if not exists email_confirmed_at timestamptz;
alter table if exists auth.users add column if not exists email_change text;
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '')::text $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create table if not exists storage.buckets (id text primary key, name text, owner uuid, public boolean default false, file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid, metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now(), last_accessed_at timestamptz default now(), path_tokens text[]);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
create or replace function storage.filename(name text) returns text language sql immutable as $$ select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'),1)] $$;
create or replace function storage.extension(name text) returns text language sql immutable as $$ select split_part(name, '.', -1) $$;
