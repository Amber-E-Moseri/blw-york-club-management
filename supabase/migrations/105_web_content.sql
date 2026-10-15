-- 105_web_content.sql
--
-- Website content: drafts, immutable versions, publication pointers and rollback (Phase D1 section 3 and 8).
-- Forward-only. Depends on 104 (web_has_permission, web_audit_log). Does not alter migrations 000-104.
--
-- Model:
--   web_content (kind, key) holds the DRAFT body and a pointer to the PUBLISHED version. Public readers never see the draft.
--   web_versions is append-only. Each publish copies the draft into a new version row. Rollback moves the pointer back.
--   Public readers use v_public_content, which exposes only published bodies.
--
-- Kinds (fixed):  page (keys: home, about, what_we_do, foundation_school, new_here, contact)
--                 settings (key: site)
--                 navigation (key: primary)
-- Permissions:    page -> website.pages.edit / website.pages.publish
--                 settings -> website.settings.edit / website.settings.publish
--                 navigation -> website.navigation.edit (edit and publish; no separate publish key exists for menus)

create table public.web_versions (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null,
  key         text not null,
  version_no  integer not null check (version_no >= 1),
  body        jsonb not null check (jsonb_typeof(body) = 'object'),
  note        text not null default '' check (char_length(note) <= 200),
  created_by  uuid,
  created_at  timestamptz not null default now(),
  unique (kind, key, version_no)
);

create table public.web_content (
  kind                 text not null check (kind in ('page', 'settings', 'navigation')),
  key                  text not null,
  draft                jsonb not null default '{}'::jsonb check (jsonb_typeof(draft) = 'object'),
  draft_version        integer not null default 1 check (draft_version >= 1),
  published_version_id uuid references public.web_versions (id),
  updated_by           uuid,
  updated_at           timestamptz not null default now(),
  primary key (kind, key),
  constraint web_content_key_allowed check (
    (kind = 'page' and key in ('home', 'about', 'what_we_do', 'foundation_school', 'new_here', 'contact'))
    or (kind = 'settings' and key = 'site')
    or (kind = 'navigation' and key = 'primary')
  )
);

alter table public.web_versions add constraint web_versions_content_fk
  foreign key (kind, key) references public.web_content (kind, key);

create trigger web_versions_append_only
  before update or delete on public.web_versions
  for each row execute function public._web_refuse_audit_mutation();
create trigger web_versions_no_truncate
  before truncate on public.web_versions
  for each statement execute function public._web_refuse_audit_mutation();

-- ---------------------------------------------------------------------------------------------------------------------
-- Body validation. Each kind has a fixed shape. Unknown keys are refused, so no free-form HTML or script can be stored.
-- ---------------------------------------------------------------------------------------------------------------------

create or replace function public._web_validate_content(p_kind text, p_key text, p_body jsonb)
returns void
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_text text;
  v_key text;
  v_section jsonb;
  v_url text;
begin
  if p_body is null or jsonb_typeof(p_body) <> 'object' then
    raise exception 'Content must be an object.' using errcode = '22023';
  end if;
  if octet_length(p_body::text) > 65536 then
    raise exception 'Content is larger than 64 KB.' using errcode = '22023';
  end if;

  if p_kind = 'page' then
    for v_key in select jsonb_object_keys(p_body) loop
      if v_key not in ('title', 'seo_title', 'seo_description', 'sections', 'visible') then
        raise exception 'Unknown page field: %', v_key using errcode = '22023';
      end if;
    end loop;
    v_text := p_body->>'title';
    if v_text is null or char_length(btrim(v_text)) < 1 or char_length(v_text) > 140 then
      raise exception 'A page needs a title of 1 to 140 characters.' using errcode = '22023';
    end if;
    if p_body ? 'seo_title' and char_length(coalesce(p_body->>'seo_title', '')) > 60 then
      raise exception 'SEO title is limited to 60 characters.' using errcode = '22023';
    end if;
    if p_body ? 'seo_description' and char_length(coalesce(p_body->>'seo_description', '')) > 160 then
      raise exception 'SEO description is limited to 160 characters.' using errcode = '22023';
    end if;
    if p_body ? 'visible' and jsonb_typeof(p_body->'visible') <> 'boolean' then
      raise exception 'visible must be true or false.' using errcode = '22023';
    end if;
    if p_body ? 'sections' then
      if jsonb_typeof(p_body->'sections') <> 'array' or jsonb_array_length(p_body->'sections') > 24 then
        raise exception 'A page takes up to 24 sections.' using errcode = '22023';
      end if;
      for v_section in select value from jsonb_array_elements(p_body->'sections') loop
        if jsonb_typeof(v_section) <> 'object' then
          raise exception 'Each section must be an object.' using errcode = '22023';
        end if;
        if not (v_section->>'type' in ('hero', 'text', 'cta', 'faq', 'contact_details', 'ministries', 'events', 'blog', 'rhapsody', 'foundation_cta', 'new_here_points')) then
          raise exception 'Unknown section type: %', v_section->>'type' using errcode = '22023';
        end if;
        if char_length(coalesce(v_section->>'heading', '')) > 140 or char_length(coalesce(v_section->>'body', '')) > 4000 then
          raise exception 'A section heading is limited to 140 characters and its body to 4000.' using errcode = '22023';
        end if;
        if not (v_section ? 'visible') or jsonb_typeof(v_section->'visible') <> 'boolean' then
          raise exception 'Every section needs visible true or false.' using errcode = '22023';
        end if;
        if v_section ? 'url' then
          v_url := v_section->>'url';
          if v_url !~ '^(https://|/)[^\s]{0,500}$' or v_url ~* '^(https?://[^/]*@|https?://[^/]*:)' then
            raise exception 'Links must be https or a site path, without credentials.' using errcode = '22023';
          end if;
        end if;
      end loop;
    end if;
  elsif p_kind = 'settings' then
    for v_key in select jsonb_object_keys(p_body) loop
      if v_key not in ('site_name', 'tagline', 'primary_color', 'contact_email', 'address_text', 'service_day',
                       'service_time_text', 'socials', 'foundation_enroll_url', 'footer_text', 'seo_title', 'seo_description',
                       'hero_image_url', 'logo_url', 'favicon_url') then
        raise exception 'Unknown settings field: %', v_key using errcode = '22023';
      end if;
    end loop;
    if char_length(coalesce(p_body->>'site_name', '')) not between 1 and 80 then
      raise exception 'Site name is required (1 to 80 characters).' using errcode = '22023';
    end if;
    if p_body ? 'primary_color' and coalesce(p_body->>'primary_color', '') !~ '^#[0-9A-Fa-f]{6}$' then
      raise exception 'Colour must be a six-digit hex value such as #C8102E.' using errcode = '22023';
    end if;
    if p_body ? 'contact_email' and coalesce(p_body->>'contact_email', '') !~ '^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,20}$' then
      raise exception 'Contact email is not valid.' using errcode = '22023';
    end if;
    if p_body ? 'foundation_enroll_url' and coalesce(p_body->>'foundation_enroll_url', '') <> ''
       and (p_body->>'foundation_enroll_url') !~ '^https://[^\s@/:]+(/[^\s]*)?$' then
      raise exception 'The Foundation School link must be https, with no credentials.' using errcode = '22023';
    end if;
    if p_body ? 'socials' and (jsonb_typeof(p_body->'socials') <> 'array' or jsonb_array_length(p_body->'socials') > 8) then
      raise exception 'Socials is a list of up to 8 links.' using errcode = '22023';
    end if;
    for v_text in select value::text from jsonb_array_elements(coalesce(p_body->'socials', '[]'::jsonb)) loop
      if v_text !~ '^"https://[^\s@]+"$' then
        raise exception 'Each social link must be an https URL.' using errcode = '22023';
      end if;
    end loop;
    if char_length(coalesce(p_body->>'seo_title', '')) > 60 or char_length(coalesce(p_body->>'seo_description', '')) > 160 then
      raise exception 'SEO title is limited to 60 characters and the description to 160.' using errcode = '22023';
    end if;
    -- Image locations: an https URL or a site path only. Nothing that could act as a script or a redirect.
    for v_key in select unnest(array['logo_url', 'favicon_url', 'hero_image_url']) loop
      if p_body ? v_key then
        v_url := coalesce(p_body->>v_key, '');
        if v_url <> '' and v_url !~ '^(https://[^\s@/]+(/[^\s]*)?|/[^\s]*)$' then
          raise exception 'Image addresses must be https or a site path.' using errcode = '22023';
        end if;
      end if;
    end loop;
    if char_length(coalesce(p_body->>'footer_text', '')) > 500 then
      raise exception 'Footer text is limited to 500 characters.' using errcode = '22023';
    end if;
    if char_length(coalesce(p_body->>'tagline', '')) > 140 then
      raise exception 'Tagline is limited to 140 characters.' using errcode = '22023';
    end if;
  elsif p_kind = 'navigation' then
    for v_key in select jsonb_object_keys(p_body) loop
      if v_key <> 'items' then raise exception 'Unknown navigation field: %', v_key using errcode = '22023'; end if;
    end loop;
    if jsonb_typeof(p_body->'items') <> 'array' or jsonb_array_length(coalesce(p_body->'items', '[]'::jsonb)) > 12 then
      raise exception 'Navigation takes up to 12 items.' using errcode = '22023';
    end if;
    for v_section in select value from jsonb_array_elements(p_body->'items') loop
      if jsonb_typeof(v_section) <> 'object' or char_length(coalesce(v_section->>'label', '')) not between 1 and 40 then
        raise exception 'Each menu item needs a label of 1 to 40 characters.' using errcode = '22023';
      end if;
      v_url := coalesce(v_section->>'href', '');
      if v_url !~ '^(https://[^\s@/]+(/[^\s]*)?|/[^\s]*)$' then
        raise exception 'Menu links must be https or a site path.' using errcode = '22023';
      end if;
    end loop;
  else
    raise exception 'Unknown content kind.' using errcode = '22023';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Permission mapping
-- ---------------------------------------------------------------------------------------------------------------------

create or replace function public._web_edit_permission(p_kind text)
returns text
language sql
immutable
as $$
  select case p_kind when 'page' then 'website.pages.edit' when 'settings' then 'website.settings.edit' when 'navigation' then 'website.navigation.edit' end
$$;

create or replace function public._web_publish_permission(p_kind text)
returns text
language sql
immutable
as $$
  select case p_kind when 'page' then 'website.pages.publish' when 'settings' then 'website.settings.publish' when 'navigation' then 'website.navigation.edit' end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Content RPCs
-- ---------------------------------------------------------------------------------------------------------------------

-- Ensures the row exists so that the first edit of a new key works.
create or replace function public._web_ensure_content(p_kind text, p_key text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.web_content (kind, key, draft) values (p_kind, p_key, '{}'::jsonb) on conflict do nothing;
end;
$$;

create or replace function public.web_get_content(p_kind text, p_key text)
returns table (draft jsonb, draft_version integer, published_version_id uuid, published_body jsonb, published_version_no integer)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not (public.web_has_permission(public._web_edit_permission(p_kind)) or public.web_has_permission(public._web_publish_permission(p_kind))) then
    raise exception 'You do not have permission to view this content.' using errcode = '42501';
  end if;
  return query
    select c.draft, c.draft_version, c.published_version_id, v.body, v.version_no
    from public.web_content c
    left join public.web_versions v on v.id = c.published_version_id
    where c.kind = p_kind and c.key = p_key;
end;
$$;

create or replace function public.web_save_draft(p_kind text, p_key text, p_body jsonb, p_expected_version integer)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_version integer;
begin
  perform public._web_require(public._web_edit_permission(p_kind));
  perform public._web_validate_content(p_kind, p_key, p_body);
  perform public._web_ensure_content(p_kind, p_key);
  update public.web_content c
     set draft = p_body, draft_version = c.draft_version + 1, updated_by = auth.uid(), updated_at = now()
   where c.kind = p_kind and c.key = p_key and c.draft_version = p_expected_version
  returning c.draft_version into v_version;
  if v_version is null then
    raise exception 'This content changed while you were editing. Reload to see the latest draft.' using errcode = '40001';
  end if;
  perform public._web_audit('content.draft_saved', p_kind || ':' || p_key, jsonb_build_object('draft_version', v_version));
  return v_version;
end;
$$;

create or replace function public.web_publish_content(p_kind text, p_key text, p_expected_draft_version integer, p_note text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_content public.web_content%rowtype;
  v_next integer;
  v_id uuid;
begin
  perform public._web_require(public._web_publish_permission(p_kind));
  perform public._web_ensure_content(p_kind, p_key);
  select * into v_content from public.web_content where kind = p_kind and key = p_key for update;
  if v_content.draft_version <> p_expected_draft_version then
    raise exception 'The draft changed since you reviewed it. Reload and review again.' using errcode = '40001';
  end if;
  perform public._web_validate_content(p_kind, p_key, v_content.draft);
  select coalesce(max(version_no), 0) + 1 into v_next from public.web_versions where kind = p_kind and key = p_key;
  insert into public.web_versions (kind, key, version_no, body, note, created_by)
  values (p_kind, p_key, v_next, v_content.draft, btrim(coalesce(p_note, '')), auth.uid())
  returning id into v_id;
  update public.web_content set published_version_id = v_id, updated_by = auth.uid(), updated_at = now()
   where kind = p_kind and key = p_key;
  perform public._web_audit('content.published', p_kind || ':' || p_key,
    jsonb_build_object('version_id', v_id, 'version_no', v_next, 'note', btrim(coalesce(p_note, ''))));
  return v_id;
end;
$$;

create or replace function public.web_rollback_content(p_kind text, p_key text, p_version_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_version public.web_versions%rowtype;
begin
  perform public._web_require(public._web_publish_permission(p_kind));
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Give a reason of at least 5 characters for a rollback.' using errcode = '22023';
  end if;
  select * into v_version from public.web_versions where id = p_version_id;
  if not found or v_version.kind <> p_kind or v_version.key <> p_key then
    raise exception 'That version does not belong to this content.' using errcode = '22023';
  end if;
  update public.web_content set published_version_id = p_version_id, updated_by = auth.uid(), updated_at = now()
   where kind = p_kind and key = p_key;
  perform public._web_audit('content.rolled_back', p_kind || ':' || p_key,
    jsonb_build_object('version_id', p_version_id, 'version_no', v_version.version_no, 'reason', btrim(p_reason)));
end;
$$;

create or replace function public.web_list_versions(p_kind text, p_key text)
returns table (id uuid, version_no integer, note text, created_by uuid, created_at timestamptz, is_published boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not (public.web_has_permission(public._web_edit_permission(p_kind)) or public.web_has_permission(public._web_publish_permission(p_kind))) then
    raise exception 'You do not have permission to view this history.' using errcode = '42501';
  end if;
  return query
    select v.id, v.version_no, v.note, v.created_by, v.created_at, (c.published_version_id = v.id)
    from public.web_versions v
    left join public.web_content c on c.kind = v.kind and c.key = v.key
    where v.kind = p_kind and v.key = p_key
    order by v.version_no desc;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Public, published-only view. Exposes the published body and nothing else.
-- ---------------------------------------------------------------------------------------------------------------------

create or replace view public.v_public_content with (security_barrier = true) as
  select c.kind, c.key, v.body, v.version_no, v.created_at as published_at
  from public.web_content c
  join public.web_versions v on v.id = c.published_version_id;

-- ---------------------------------------------------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------------------------------------------------

alter table public.web_content enable row level security;
alter table public.web_versions enable row level security;
revoke all on public.web_content, public.web_versions from public, anon, authenticated;
revoke all on public.v_public_content from public, anon, authenticated;

-- Writes only through the RPCs below. No client table access.
grant select on public.v_public_content to anon, authenticated;

revoke all on function public._web_validate_content(text, text, jsonb) from public, anon, authenticated;
revoke all on function public._web_edit_permission(text) from public, anon, authenticated;
revoke all on function public._web_publish_permission(text) from public, anon, authenticated;
revoke all on function public._web_ensure_content(text, text) from public, anon, authenticated;

revoke all on function public.web_get_content(text, text) from public, anon;
revoke all on function public.web_save_draft(text, text, jsonb, integer) from public, anon;
revoke all on function public.web_publish_content(text, text, integer, text) from public, anon;
revoke all on function public.web_rollback_content(text, text, uuid, text) from public, anon;
revoke all on function public.web_list_versions(text, text) from public, anon;

grant execute on function public.web_get_content(text, text) to authenticated;
grant execute on function public.web_save_draft(text, text, jsonb, integer) to authenticated;
grant execute on function public.web_publish_content(text, text, integer, text) to authenticated;
grant execute on function public.web_rollback_content(text, text, uuid, text) to authenticated;
grant execute on function public.web_list_versions(text, text) to authenticated;

-- Seed the three singleton content rows as empty drafts so that the first edit does not need to create them.
insert into public.web_content (kind, key, draft) values
  ('settings', 'site', '{}'::jsonb),
  ('navigation', 'primary', '{}'::jsonb)
on conflict do nothing;
