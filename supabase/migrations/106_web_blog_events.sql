-- 106_web_blog_events.sql
--
-- Blog posts (draft, published, scheduled, archived) and public event publication (Phase D1 section 3.5 and 3.6).
-- Forward-only. Depends on 104 (permissions, audit) and on the events table (037 columns, 038, 060, 078).
-- Does not alter any existing table. Public readers see only published posts and only public events.

-- ---------------------------------------------------------------------------------------------------------------------
-- Blog
-- ---------------------------------------------------------------------------------------------------------------------

create table public.web_posts (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,99}$'),
  title          text not null check (char_length(btrim(title)) between 1 and 140),
  excerpt        text not null default '' check (char_length(excerpt) <= 300),
  body           text not null default '' check (char_length(body) <= 40000),
  category       text not null default 'Uncategorised' check (char_length(category) between 1 and 60),
  author_display text not null default 'BLW York' check (char_length(author_display) between 1 and 80),
  status         text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  publish_at     timestamptz,
  published_at   timestamptz,
  version        integer not null default 1 check (version >= 1),
  created_by     uuid,
  created_at     timestamptz not null default now(),
  updated_by     uuid,
  updated_at     timestamptz not null default now(),
  constraint web_posts_publish_requires_status check (publish_at is null or status = 'published')
);

create or replace function public.web_save_post(
  p_id uuid, p_slug text, p_title text, p_excerpt text, p_body text, p_category text, p_author text, p_expected_version integer
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_current public.web_posts%rowtype;
begin
  perform public._web_require('website.blog.edit');
  if p_id is null then
    insert into public.web_posts (slug, title, excerpt, body, category, author_display, created_by, updated_by)
    values (p_slug, btrim(p_title), coalesce(p_excerpt, ''), coalesce(p_body, ''), coalesce(nullif(btrim(p_category), ''), 'Uncategorised'),
            coalesce(nullif(btrim(p_author), ''), 'BLW York'), auth.uid(), auth.uid())
    returning id into v_id;
  else
    select * into v_current from public.web_posts where id = p_id for update;
    if not found then raise exception 'Post not found.' using errcode = 'P0002'; end if;
    if v_current.version <> p_expected_version then
      raise exception 'This post changed while you were editing. Reload and try again.' using errcode = '40001';
    end if;
    update public.web_posts
       set slug = p_slug, title = btrim(p_title), excerpt = coalesce(p_excerpt, ''), body = coalesce(p_body, ''),
           category = coalesce(nullif(btrim(p_category), ''), 'Uncategorised'),
           author_display = coalesce(nullif(btrim(p_author), ''), 'BLW York'),
           version = version + 1, updated_by = auth.uid(), updated_at = now()
     where id = p_id
    returning id into v_id;
  end if;
  perform public._web_audit('post.saved', v_id::text, jsonb_build_object('slug', p_slug));
  return v_id;
end;
$$;

-- Status changes: publish (now or scheduled), unpublish (back to draft), archive.
create or replace function public.web_set_post_status(p_id uuid, p_status text, p_publish_at timestamptz, p_expected_version integer)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_current public.web_posts%rowtype;
begin
  perform public._web_require('website.blog.publish');
  select * into v_current from public.web_posts where id = p_id for update;
  if not found then raise exception 'Post not found.' using errcode = 'P0002'; end if;
  if v_current.version <> p_expected_version then
    raise exception 'This post changed while you were editing. Reload and try again.' using errcode = '40001';
  end if;
  if p_status not in ('draft', 'published', 'archived') then
    raise exception 'Unknown status.' using errcode = '22023';
  end if;
  if p_status = 'published' then
    if v_current.body = '' or v_current.excerpt = '' then
      raise exception 'Add an excerpt and body before publishing.' using errcode = '22023';
    end if;
  end if;
  update public.web_posts
     set status = p_status,
         publish_at = case when p_status = 'published' then p_publish_at else null end,
         published_at = case when p_status = 'published' and (p_publish_at is null or p_publish_at <= now()) then coalesce(published_at, now()) else published_at end,
         version = version + 1, updated_by = auth.uid(), updated_at = now()
   where id = p_id;
  perform public._web_audit('post.status_changed', p_id::text,
    jsonb_build_object('from', v_current.status, 'to', p_status, 'publish_at', p_publish_at));
end;
$$;

-- Public: published posts whose publish time has arrived. Drafts, archived posts and future schedules are excluded.
create or replace view public.v_public_posts with (security_barrier = true) as
  select p.slug, p.title, p.excerpt, p.body, p.category, p.author_display,
         coalesce(p.published_at, p.updated_at) as published_at
  from public.web_posts p
  where p.status = 'published' and (p.publish_at is null or p.publish_at <= now());

-- ---------------------------------------------------------------------------------------------------------------------
-- Public events
-- ---------------------------------------------------------------------------------------------------------------------

create table public.web_event_publications (
  event_id          uuid primary key references public.events (id) on delete cascade,
  is_public         boolean not null default false,
  featured          boolean not null default false,
  slug              text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,79}$'),
  public_title      text check (public_title is null or char_length(btrim(public_title)) between 1 and 120),
  public_summary    text not null default '' check (char_length(public_summary) <= 300),
  registration_url  text check (registration_url is null or registration_url ~ '^https://[^\s@/:]+(/[^\s]*)?$'),
  version           integer not null default 1 check (version >= 1),
  updated_by        uuid,
  updated_at        timestamptz not null default now()
);

-- Only an open, un-targeted event can be public (D1 section 3.5). Targeted events never leave the Hub.
create or replace function public._web_check_event_publication()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_audience text;
  v_spec uuid;
begin
  if new.is_public then
    select e.audience, e.audience_spec_id into v_audience, v_spec from public.events e where e.id = new.event_id;
    if v_audience is distinct from 'all' or v_spec is not null then
      raise exception 'Only an event open to everyone can be published on the website.' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

create trigger web_event_publications_audience_gate
  before insert or update on public.web_event_publications
  for each row execute function public._web_check_event_publication();

create or replace function public.web_set_event_publication(
  p_event_id uuid, p_is_public boolean, p_featured boolean, p_slug text, p_title text, p_summary text,
  p_registration_url text, p_expected_version integer
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_current public.web_event_publications%rowtype;
  v_exists boolean;
begin
  perform public._web_require('website.events.manage');
  if p_is_public then perform public._web_require('website.events.publish'); end if;
  select exists (select 1 from public.events where id = p_event_id) into v_exists;
  if not v_exists then raise exception 'Event not found.' using errcode = 'P0002'; end if;
  select * into v_current from public.web_event_publications where event_id = p_event_id for update;
  if found and v_current.version <> p_expected_version then
    raise exception 'This event changed while you were editing. Reload and try again.' using errcode = '40001';
  end if;
  if not found and p_expected_version <> 0 then
    raise exception 'This event changed while you were editing. Reload and try again.' using errcode = '40001';
  end if;
  insert into public.web_event_publications (event_id, is_public, featured, slug, public_title, public_summary, registration_url, updated_by)
  values (p_event_id, p_is_public, p_featured, p_slug, nullif(btrim(p_title), ''), coalesce(p_summary, ''), nullif(p_registration_url, ''), auth.uid())
  on conflict (event_id) do update
    set is_public = excluded.is_public, featured = excluded.featured, slug = excluded.slug,
        public_title = excluded.public_title, public_summary = excluded.public_summary,
        registration_url = excluded.registration_url, version = web_event_publications.version + 1,
        updated_by = auth.uid(), updated_at = now();
  perform public._web_audit('event.publication_changed', p_event_id::text,
    jsonb_build_object('is_public', p_is_public, 'featured', p_featured, 'slug', p_slug));
end;
$$;

-- Public: only public events. No audience, RSVP, attendee, creator or notification fields are exposed.
create or replace view public.v_public_events with (security_barrier = true) as
  select pub.slug,
         coalesce(pub.public_title, e.title) as title,
         pub.public_summary as summary,
         e.date as event_date,
         e.time as event_time,
         e.location,
         e.category,
         pub.featured,
         pub.registration_url
  from public.web_event_publications pub
  join public.events e on e.id = pub.event_id
  where pub.is_public
    and e.audience = 'all'
    and e.audience_spec_id is null;

-- ---------------------------------------------------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------------------------------------------------

alter table public.web_posts enable row level security;
alter table public.web_event_publications enable row level security;
revoke all on public.web_posts, public.web_event_publications from public, anon, authenticated;
revoke all on public.v_public_posts, public.v_public_events from public, anon, authenticated;
grant select on public.v_public_posts, public.v_public_events to anon, authenticated;

-- Editors need to see drafts and the event list. Reads go through a permission-checked RPC.
create or replace function public.web_list_posts()
returns table (id uuid, slug text, title text, excerpt text, body text, category text, author_display text,
               status text, publish_at timestamptz, published_at timestamptz, version integer, updated_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not (public.web_has_permission('website.blog.edit') or public.web_has_permission('website.blog.publish')) then
    raise exception 'You do not have permission to view blog posts.' using errcode = '42501';
  end if;
  return query select p.id, p.slug, p.title, p.excerpt, p.body, p.category, p.author_display, p.status,
                      p.publish_at, p.published_at, p.version, p.updated_at
               from public.web_posts p order by p.updated_at desc;
end;
$$;

create or replace function public.web_list_event_publications()
returns table (event_id uuid, title text, event_date date, is_public boolean, featured boolean, slug text,
               public_title text, public_summary text, registration_url text, version integer)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not (public.web_has_permission('website.events.manage') or public.web_has_permission('website.events.publish')) then
    raise exception 'You do not have permission to view event publications.' using errcode = '42501';
  end if;
  return query
    select e.id, e.title, e.date, coalesce(pub.is_public, false), coalesce(pub.featured, false), pub.slug,
           pub.public_title, pub.public_summary, pub.registration_url, coalesce(pub.version, 0)
    from public.events e
    left join public.web_event_publications pub on pub.event_id = e.id
    order by e.date desc;
end;
$$;

revoke all on function public._web_check_event_publication() from public, anon, authenticated;
revoke all on function public.web_save_post(uuid, text, text, text, text, text, text, integer) from public, anon;
revoke all on function public.web_set_post_status(uuid, text, timestamptz, integer) from public, anon;
revoke all on function public.web_set_event_publication(uuid, boolean, boolean, text, text, text, text, integer) from public, anon;
revoke all on function public.web_list_posts() from public, anon;
revoke all on function public.web_list_event_publications() from public, anon;
grant execute on function public.web_save_post(uuid, text, text, text, text, text, text, integer) to authenticated;
grant execute on function public.web_set_post_status(uuid, text, timestamptz, integer) to authenticated;
grant execute on function public.web_set_event_publication(uuid, boolean, boolean, text, text, text, text, integer) to authenticated;
grant execute on function public.web_list_posts() to authenticated;
grant execute on function public.web_list_event_publications() to authenticated;
