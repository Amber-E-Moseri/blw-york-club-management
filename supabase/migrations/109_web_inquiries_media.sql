-- 107_web_inquiries_media.sql
--
-- Public inquiries (Contact Us, New Here, prayer), rate limiting and spam protection, the media register and the storage
-- bucket definitions (Phase D1 sections 3.4, 3.8, 7). Forward-only. Depends on 106 (permissions, audit).
--
-- Public submission boundary:
--   * Anonymous visitors can call web_submit_inquiry only. It writes to web_inbound_submissions, which no client can read.
--   * It never creates a people, contacts, profile or identity-claim row. Those are CRM data and stay private.
--   * A honeypot field that is filled in is accepted silently and stored nowhere.
--   * A global rate limit (kind-scoped) protects the table from floods. A per-client limit needs the verified client
--     address, which only the server-side public-forms Edge Function can provide. That function is not built yet.
--   * Consent is required and is stored with its version and a hash of the consent text shown.

create table public.web_inbound_submissions (
  id                 uuid primary key default gen_random_uuid(),
  kind               text not null check (kind in ('contact', 'new_here', 'prayer')),
  name               text not null check (char_length(btrim(name)) between 1 and 120),
  email              text check (email is null or (char_length(email) <= 254 and email ~ '^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,20}$')),
  phone              text check (phone is null or char_length(phone) <= 40),
  message            text not null check (char_length(btrim(message)) between 1 and 2000),
  topic              text check (topic is null or char_length(topic) <= 80),
  consent_version    text not null check (char_length(consent_version) between 1 and 40),
  consent_text_hash  text not null check (consent_text_hash ~ '^[0-9a-f]{64}$'),
  status             text not null default 'new' check (status in ('new', 'in_review', 'closed')),
  reviewed_by        uuid,
  reviewed_at        timestamptz,
  created_at         timestamptz not null default now(),
  retain_until       timestamptz not null default (now() + interval '90 days')
);

create table public.web_rate_limits (
  bucket        text primary key check (char_length(bucket) between 1 and 200),
  window_start  timestamptz not null,
  hits          integer not null default 0 check (hits >= 0)
);

-- Writes a public submission. Returns nothing the caller could use to probe for records.
create or replace function public.web_submit_inquiry(
  p_kind text, p_name text, p_email text, p_phone text, p_message text, p_topic text,
  p_consent_version text, p_consent_text_hash text, p_honeypot text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bucket text;
  v_window timestamptz := date_trunc('minute', now()) - make_interval(mins => (extract(minute from now())::int % 10));
  v_hits integer;
begin
  -- Honeypot: a bot fills every field. Accept silently, store nothing.
  if coalesce(p_honeypot, '') <> '' then
    return;
  end if;
  if p_kind not in ('contact', 'new_here', 'prayer') then
    raise exception 'Unknown form.' using errcode = '22023';
  end if;
  if coalesce(p_consent_version, '') = '' or coalesce(p_consent_text_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'Please give consent to be contacted.' using errcode = '22023';
  end if;

  -- Global, kind-scoped limit: at most 60 submissions per kind in a 10-minute window.
  v_bucket := 'inquiry:' || p_kind;
  insert into public.web_rate_limits (bucket, window_start, hits) values (v_bucket, v_window, 1)
  on conflict (bucket) do update
    set hits = case when web_rate_limits.window_start = v_window then web_rate_limits.hits + 1 else 1 end,
        window_start = v_window
  returning hits into v_hits;
  if v_hits > 60 then
    raise exception 'Too many messages were sent recently. Please try again in a few minutes.' using errcode = 'P0429';
  end if;

  insert into public.web_inbound_submissions (kind, name, email, phone, message, topic, consent_version, consent_text_hash)
  values (p_kind, btrim(p_name), nullif(btrim(p_email), ''), nullif(btrim(p_phone), ''), btrim(p_message),
          nullif(btrim(p_topic), ''), p_consent_version, p_consent_text_hash);
end;
$$;

create or replace function public.web_list_inquiries(p_status text)
returns table (id uuid, kind text, name text, email text, phone text, message text, topic text, status text,
               consent_version text, created_at timestamptz, retain_until timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._web_require('website.submissions.review');
  return query
    select s.id, s.kind, s.name, s.email, s.phone, s.message, s.topic, s.status, s.consent_version, s.created_at, s.retain_until
    from public.web_inbound_submissions s
    where p_status is null or s.status = p_status
    order by s.created_at desc
    limit 200;
end;
$$;

create or replace function public.web_set_inquiry_status(p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from text;
begin
  perform public._web_require('website.submissions.review');
  if p_status not in ('new', 'in_review', 'closed') then
    raise exception 'Unknown status.' using errcode = '22023';
  end if;
  select status into v_from from public.web_inbound_submissions where id = p_id for update;
  if not found then raise exception 'Submission not found.' using errcode = 'P0002'; end if;
  update public.web_inbound_submissions set status = p_status, reviewed_by = auth.uid(), reviewed_at = now() where id = p_id;
  perform public._web_audit('inquiry.status_changed', p_id::text, jsonb_build_object('from', v_from, 'to', p_status));
end;
$$;

-- Retention: prayer requests are redacted (message removed) after their retention date. Other rows are deleted after it.
create or replace function public.web_purge_expired_inquiries()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if current_user not in ('postgres', 'supabase_admin', 'service_role') then
    raise exception 'Only the scheduled maintenance job may purge inquiries.' using errcode = '42501';
  end if;
  update public.web_inbound_submissions
     set message = '[redacted]', name = '[redacted]', email = null, phone = null
   where kind = 'prayer' and retain_until < now() and message <> '[redacted]';
  delete from public.web_inbound_submissions where kind <> 'prayer' and retain_until < now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Media register and storage buckets (images are public; PDFs are private and reached through signed URLs only)
-- ---------------------------------------------------------------------------------------------------------------------

create table public.web_media (
  id           uuid primary key default gen_random_uuid(),
  bucket       text not null check (bucket in ('site-media', 'rhapsody-pdfs')),
  storage_path text not null unique check (char_length(storage_path) between 3 and 300),
  mime         text not null check (mime in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  bytes        bigint not null check (bytes > 0),
  alt_text     text not null default '' check (char_length(alt_text) <= 300),
  caption      text not null default '' check (char_length(caption) <= 300),
  status       text not null default 'active' check (status in ('active', 'archived')),
  uploaded_by  uuid,
  uploaded_at  timestamptz not null default now(),
  constraint web_media_kind_matches_bucket check (
    (bucket = 'site-media' and mime like 'image/%') or (bucket = 'rhapsody-pdfs' and mime = 'application/pdf'))
);

create or replace function public.web_register_media(p_bucket text, p_storage_path text, p_mime text, p_bytes bigint, p_alt_text text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public._web_require('website.media.upload');
  if p_bucket = 'site-media' and coalesce(p_alt_text, '') = '' then
    raise exception 'Describe the image for screen readers before saving it.' using errcode = '22023';
  end if;
  insert into public.web_media (bucket, storage_path, mime, bytes, alt_text, uploaded_by)
  values (p_bucket, p_storage_path, p_mime, p_bytes, coalesce(p_alt_text, ''), auth.uid())
  returning id into v_id;
  perform public._web_audit('media.registered', v_id::text, jsonb_build_object('bucket', p_bucket, 'mime', p_mime, 'bytes', p_bytes));
  return v_id;
end;
$$;

create or replace function public.web_list_media()
returns table (id uuid, bucket text, storage_path text, mime text, bytes bigint, alt_text text, caption text, status text, uploaded_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.web_has_permission('website.media.upload') or public.web_has_permission('website.media.manage')) then
    raise exception 'You do not have permission to view the media library.' using errcode = '42501';
  end if;
  return query select m.id, m.bucket, m.storage_path, m.mime, m.bytes, m.alt_text, m.caption, m.status, m.uploaded_at
               from public.web_media m order by m.uploaded_at desc;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('site-media',   'site-media',   true,  5242880,  array['image/jpeg', 'image/png', 'image/webp']),
  ('rhapsody-pdfs', 'rhapsody-pdfs', false, 26214400, array['application/pdf'])
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------------------------------------------------

alter table public.web_inbound_submissions enable row level security;
alter table public.web_rate_limits enable row level security;
alter table public.web_media enable row level security;
revoke all on public.web_inbound_submissions, public.web_rate_limits, public.web_media from public, anon, authenticated;

revoke all on function public.web_submit_inquiry(text, text, text, text, text, text, text, text, text) from public;
revoke all on function public.web_list_inquiries(text) from public, anon;
revoke all on function public.web_set_inquiry_status(uuid, text) from public, anon;
revoke all on function public.web_purge_expired_inquiries() from public, anon, authenticated;
revoke all on function public.web_register_media(text, text, text, bigint, text) from public, anon;
revoke all on function public.web_list_media() from public, anon;

grant execute on function public.web_submit_inquiry(text, text, text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.web_list_inquiries(text) to authenticated;
grant execute on function public.web_set_inquiry_status(uuid, text) to authenticated;
grant execute on function public.web_register_media(text, text, text, bigint, text) to authenticated;
grant execute on function public.web_list_media() to authenticated;
