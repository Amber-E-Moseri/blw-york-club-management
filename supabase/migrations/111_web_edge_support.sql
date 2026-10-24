-- ---------------------------------------------------------------------------------------------------------------------
-- Website Management (Phase D2): support for the website Edge Functions.
--
--   * web_client_rate_limits / web_consume_client_limit: per-client abuse limits for public inquiries. The client is a
--     keyed hash of the network address, computed by the Edge Function. The database never sees a raw address. Only the
--     service role may call it.
--   * web_media_upload_allowed: lets the upload function ask, as the signed-in user, whether that user may upload to a
--     bucket. The function then issues a short-lived signed upload URL. Nothing else gives direct storage access.
--   * web_resolve_edition_pdf: the only way the PDF delivery function learns a private storage path. It returns a path
--     only for a published, authorized edition with an active PDF. Service role only.
--
-- Storage access model (deny by default): no storage.objects policy is added for anon or authenticated. Writes go only
-- through signed upload URLs. PDFs are read only through short-lived signed URLs. site-media is a public bucket, so
-- published images are served by URL.
--
-- Forward-only. Depends on 106 (permissions), 109 (media, rate limits) and 110 (editions). Migrations 000-110 are not
-- changed.
-- ---------------------------------------------------------------------------------------------------------------------

-- ---------------------------------------------------------------------------------------------------------------------
-- Per-client limits
-- ---------------------------------------------------------------------------------------------------------------------

create table public.web_client_rate_limits (
  client_hash  text not null check (client_hash ~ '^[0-9a-f]{64}$'),
  scope        text not null check (char_length(scope) between 1 and 60),
  window_start timestamptz not null,
  hits         integer not null check (hits >= 0),
  primary key (client_hash, scope)
);

alter table public.web_client_rate_limits enable row level security;
revoke all on public.web_client_rate_limits from public, anon, authenticated;

create or replace function public.web_consume_client_limit(p_client_hash text, p_scope text, p_limit integer, p_window_minutes integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_seconds integer;
  v_window timestamptz;
  v_hits integer;
begin
  if p_client_hash is null or p_client_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Client identifier is invalid.' using errcode = '22023';
  end if;
  if char_length(coalesce(p_scope, '')) not between 1 and 60 then
    raise exception 'Limit scope is invalid.' using errcode = '22023';
  end if;
  if p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'Limit must be between 1 and 1000.' using errcode = '22023';
  end if;
  if p_window_minutes is null or p_window_minutes not between 1 and 1440 then
    raise exception 'Window must be between 1 and 1440 minutes.' using errcode = '22023';
  end if;

  -- Fixed windows aligned to the clock, so every request in a window shares one window_start.
  v_window_seconds := p_window_minutes * 60;
  v_window := to_timestamp(floor(extract(epoch from now()) / v_window_seconds) * v_window_seconds);

  insert into public.web_client_rate_limits as l (client_hash, scope, window_start, hits)
  values (p_client_hash, p_scope, v_window, 1)
  on conflict (client_hash, scope) do update
    set hits = case when l.window_start = v_window then l.hits + 1 else 1 end,
        window_start = v_window
  returning hits into v_hits;

  -- Housekeeping: rows older than a day can no longer affect any decision.
  delete from public.web_client_rate_limits where window_start < now() - interval '1 day';

  return v_hits <= p_limit;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Media upload permission (asked as the signed-in user)
-- ---------------------------------------------------------------------------------------------------------------------

create or replace function public.web_media_upload_allowed(p_bucket text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case p_bucket
    when 'site-media' then public.web_has_permission('website.media.upload')
    when 'rhapsody-pdfs' then public.web_has_permission('website.media.upload') and public.web_has_permission('website.rhapsody.manage')
    else false
  end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Rhapsody PDF resolver (service role only)
-- ---------------------------------------------------------------------------------------------------------------------

create or replace function public.web_resolve_edition_pdf(p_edition_id uuid)
returns table (storage_bucket text, storage_path text)
language sql
stable
security definer
set search_path = public
as $$
  select m.bucket, m.storage_path
  from public.web_rhapsody_editions e
  join public.web_media m on m.id = e.pdf_media_id
  where e.id = p_edition_id
    and e.status = 'published'
    and e.authorized_by is not null
    and e.authorized_at is not null
    and m.bucket = 'rhapsody-pdfs'
    and m.status = 'active'
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------------------------------------------------

revoke all on function public.web_consume_client_limit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.web_consume_client_limit(text, text, integer, integer) to service_role;

revoke all on function public.web_media_upload_allowed(text) from public, anon;
grant execute on function public.web_media_upload_allowed(text) to authenticated;

revoke all on function public.web_resolve_edition_pdf(uuid) from public, anon, authenticated;
grant execute on function public.web_resolve_edition_pdf(uuid) to service_role;
