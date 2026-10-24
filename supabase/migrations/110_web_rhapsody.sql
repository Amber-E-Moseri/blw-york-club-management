-- 108_web_rhapsody.sql
--
-- Rhapsody of Realities library: editions, PDF attachment, authorization, download-click tracking and aggregated
-- analytics (Phase D1 section 3.7 and 3.8). Forward-only. Depends on 106 (permissions, audit) and 109 (web_media).
--
-- Rules:
--   * An edition can be published only with a named authorizer and an authorization date, and only with an attached
--     PDF from the private rhapsody-pdfs bucket (CHECK constraint).
--   * Public readers see published editions through v_public_editions. The PDF storage path is never exposed; the
--     download link is an edition identifier that a signed-link service resolves later (not built yet).
--   * A download click records one row: edition, day, source, campaign, and a daily-rotated visitor hash. No IP address,
--     no user agent. Clicks are not described as completed downloads or as reading.
--   * Analytics are aggregated. Visitor counts below five are reported as "fewer than 5" and never as numbers.

create table public.web_rhapsody_editions (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('monthly', 'daily')),
  period_start    date not null,
  title           text not null check (char_length(btrim(title)) between 1 and 80),
  description     text not null default '' check (char_length(description) <= 500),
  pdf_media_id    uuid references public.web_media (id),
  authorized_by   text check (authorized_by is null or char_length(btrim(authorized_by)) between 1 and 120),
  authorized_at   timestamptz,
  status          text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  version         integer not null default 1 check (version >= 1),
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_by      uuid,
  updated_at      timestamptz not null default now(),
  constraint web_rhapsody_published_requires_authorization check (
    status <> 'published'
    or (authorized_by is not null and authorized_at is not null and pdf_media_id is not null)
  )
);

create unique index web_rhapsody_editions_period on public.web_rhapsody_editions (kind, period_start);

create table public.web_download_events (
  id            bigint generated always as identity primary key,
  edition_id    uuid not null references public.web_rhapsody_editions (id),
  occurred_on   date not null default current_date,
  source        text check (source is null or char_length(source) <= 80),
  utm_source    text check (utm_source is null or char_length(utm_source) <= 80),
  utm_campaign  text check (utm_campaign is null or char_length(utm_campaign) <= 80),
  visitor_hash  text not null check (visitor_hash ~ '^[0-9a-f]{64}$'),
  created_at    timestamptz not null default now()
);

create index web_download_events_edition_day on public.web_download_events (edition_id, occurred_on);

create trigger web_download_events_append_only
  before update or delete on public.web_download_events
  for each row execute function public._web_refuse_audit_mutation();

-- ---------------------------------------------------------------------------------------------------------------------
-- Staff RPCs
-- ---------------------------------------------------------------------------------------------------------------------

create or replace function public.web_save_edition(
  p_id uuid, p_kind text, p_period_start date, p_title text, p_description text, p_pdf_media_id uuid, p_expected_version integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_current public.web_rhapsody_editions%rowtype;
begin
  perform public._web_require('website.rhapsody.manage');
  if p_pdf_media_id is not null and not exists (
    select 1 from public.web_media m where m.id = p_pdf_media_id and m.bucket = 'rhapsody-pdfs' and m.status = 'active') then
    raise exception 'Choose an active PDF from the Rhapsody library.' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.web_rhapsody_editions (kind, period_start, title, description, pdf_media_id, created_by, updated_by)
    values (p_kind, p_period_start, btrim(p_title), coalesce(p_description, ''), p_pdf_media_id, auth.uid(), auth.uid())
    returning id into v_id;
  else
    select * into v_current from public.web_rhapsody_editions where id = p_id for update;
    if not found then raise exception 'Edition not found.' using errcode = 'P0002'; end if;
    if v_current.version <> p_expected_version then
      raise exception 'This edition changed while you were editing. Reload and try again.' using errcode = '40001';
    end if;
    update public.web_rhapsody_editions
       set kind = p_kind, period_start = p_period_start, title = btrim(p_title), description = coalesce(p_description, ''),
           pdf_media_id = p_pdf_media_id, version = version + 1, updated_by = auth.uid(), updated_at = now()
     where id = p_id
    returning id into v_id;
  end if;
  perform public._web_audit('rhapsody.saved', v_id::text, jsonb_build_object('kind', p_kind, 'period_start', p_period_start));
  return v_id;
end;
$$;

-- Publishing needs website.rhapsody.publish. Archiving needs the same permission. Authorization is a separate step.
create or replace function public.web_authorize_edition(p_id uuid, p_authorized_by text, p_expected_version integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.web_rhapsody_editions%rowtype;
begin
  perform public._web_require('website.rhapsody.publish');
  select * into v_current from public.web_rhapsody_editions where id = p_id for update;
  if not found then raise exception 'Edition not found.' using errcode = 'P0002'; end if;
  if v_current.version <> p_expected_version then
    raise exception 'This edition changed while you were editing. Reload and try again.' using errcode = '40001';
  end if;
  if char_length(btrim(coalesce(p_authorized_by, ''))) < 1 then
    raise exception 'Name the person who authorized this edition.' using errcode = '22023';
  end if;
  update public.web_rhapsody_editions
     set authorized_by = btrim(p_authorized_by), authorized_at = now(), version = version + 1, updated_by = auth.uid(), updated_at = now()
   where id = p_id;
  perform public._web_audit('rhapsody.authorized', p_id::text, jsonb_build_object('authorized_by', btrim(p_authorized_by)));
end;
$$;

create or replace function public.web_set_edition_status(p_id uuid, p_status text, p_expected_version integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.web_rhapsody_editions%rowtype;
begin
  perform public._web_require('website.rhapsody.publish');
  if p_status not in ('draft', 'published', 'archived') then
    raise exception 'Unknown status.' using errcode = '22023';
  end if;
  select * into v_current from public.web_rhapsody_editions where id = p_id for update;
  if not found then raise exception 'Edition not found.' using errcode = 'P0002'; end if;
  if v_current.version <> p_expected_version then
    raise exception 'This edition changed while you were editing. Reload and try again.' using errcode = '40001';
  end if;
  -- The CHECK constraint refuses publication without an authorizer and a PDF.
  update public.web_rhapsody_editions set status = p_status, version = version + 1, updated_by = auth.uid(), updated_at = now()
   where id = p_id;
  perform public._web_audit('rhapsody.status_changed', p_id::text, jsonb_build_object('from', v_current.status, 'to', p_status));
end;
$$;

create or replace function public.web_list_editions()
returns table (id uuid, kind text, period_start date, title text, description text, pdf_media_id uuid, pdf_path text,
               authorized_by text, authorized_at timestamptz, status text, version integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.web_has_permission('website.rhapsody.manage') or public.web_has_permission('website.rhapsody.publish')) then
    raise exception 'You do not have permission to view the Rhapsody library.' using errcode = '42501';
  end if;
  return query
    select e.id, e.kind, e.period_start, e.title, e.description, e.pdf_media_id, m.storage_path,
           e.authorized_by, e.authorized_at, e.status, e.version
    from public.web_rhapsody_editions e
    left join public.web_media m on m.id = e.pdf_media_id
    order by e.period_start desc;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Download-click tracking (anonymous, rate-limited, no personal data stored)
-- ---------------------------------------------------------------------------------------------------------------------

create or replace function public.web_record_download(p_edition_id uuid, p_source text, p_utm_source text, p_utm_campaign text, p_visitor_hash text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bucket text := 'download:' || p_edition_id::text;
  v_window timestamptz := date_trunc('minute', now()) - make_interval(mins => (extract(minute from now())::int % 10));
  v_hits integer;
begin
  if not exists (select 1 from public.web_rhapsody_editions e where e.id = p_edition_id and e.status = 'published') then
    raise exception 'That edition is not available.' using errcode = 'P0002';
  end if;
  if coalesce(p_visitor_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid visitor token.' using errcode = '22023';
  end if;
  insert into public.web_rate_limits (bucket, window_start, hits) values (v_bucket, v_window, 1)
  on conflict (bucket) do update
    set hits = case when web_rate_limits.window_start = v_window then web_rate_limits.hits + 1 else 1 end,
        window_start = v_window
  returning hits into v_hits;
  if v_hits > 300 then
    raise exception 'Too many requests. Please try again shortly.' using errcode = 'P0429';
  end if;
  insert into public.web_download_events (edition_id, source, utm_source, utm_campaign, visitor_hash)
  values (p_edition_id, nullif(btrim(p_source), ''), nullif(btrim(p_utm_source), ''), nullif(btrim(p_utm_campaign), ''), p_visitor_hash);
end;
$$;

-- Aggregated analytics. Visitor counts under five are withheld. No visitor hash or raw row is returned.
create or replace function public.web_download_stats(p_days integer)
returns table (edition_id uuid, title text, clicks bigint, approx_visitors text, first_day date, last_day date)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._web_require('website.analytics.view');
  if p_days is null or p_days < 1 or p_days > 365 then
    raise exception 'Choose between 1 and 365 days.' using errcode = '22023';
  end if;
  return query
    select e.id, e.title,
           count(d.id)::bigint,
           case when count(distinct d.visitor_hash) < 5 then 'fewer than 5'
                else count(distinct d.visitor_hash)::text end,
           min(d.occurred_on), max(d.occurred_on)
    from public.web_rhapsody_editions e
    left join public.web_download_events d on d.edition_id = e.id and d.occurred_on >= current_date - p_days
    where e.status = 'published'
    group by e.id, e.title
    order by e.title;
end;
$$;

-- Public view: published editions only. The PDF location and the authorizer's internal details beyond the public name are
-- not exposed. The edition identifier is the only link to the file.
create or replace view public.v_public_editions with (security_barrier = true) as
  select e.id as edition_id, e.kind, e.period_start, e.title, e.description, e.authorized_by
  from public.web_rhapsody_editions e
  where e.status = 'published' and e.authorized_at is not null;

-- ---------------------------------------------------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------------------------------------------------

alter table public.web_rhapsody_editions enable row level security;
alter table public.web_download_events enable row level security;
revoke all on public.web_rhapsody_editions, public.web_download_events from public, anon, authenticated;
revoke all on public.v_public_editions from public, anon, authenticated;
grant select on public.v_public_editions to anon, authenticated;

revoke all on function public.web_save_edition(uuid, text, date, text, text, uuid, integer) from public, anon;
revoke all on function public.web_authorize_edition(uuid, text, integer) from public, anon;
revoke all on function public.web_set_edition_status(uuid, text, integer) from public, anon;
revoke all on function public.web_list_editions() from public, anon;
revoke all on function public.web_record_download(uuid, text, text, text, text) from public;
revoke all on function public.web_download_stats(integer) from public, anon;

grant execute on function public.web_save_edition(uuid, text, date, text, text, uuid, integer) to authenticated;
grant execute on function public.web_authorize_edition(uuid, text, integer) to authenticated;
grant execute on function public.web_set_edition_status(uuid, text, integer) to authenticated;
grant execute on function public.web_list_editions() to authenticated;
grant execute on function public.web_record_download(uuid, text, text, text, text) to anon, authenticated;
grant execute on function public.web_download_stats(integer) to authenticated;
