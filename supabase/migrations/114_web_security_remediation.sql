-- 112_web_security_remediation.sql
--
-- Forward-only correction of confirmed authorization gaps in the website CMS (migrations 106-113). Migrations 000-113
-- are not changed. Every function below is replaced with create or replace, so existing grants on the function are kept
-- unless this file states otherwise.
--
-- Corrections:
--   1. web_submit_inquiry: browsers and anonymous callers may no longer call it. Only service_role may, and only the
--      website-inquiry Edge Function calls it, after Turnstile and the per-client limit.
--   2. web_save_edition: a published edition can be changed only by someone who may publish. This covers its PDF, title,
--      description, kind and period, so a manager who cannot publish cannot change what readers see.
--   3. web_list_event_publications and web_set_event_publication: only events open to everyone are listed or can be
--      given a website publication. Targeted and restricted Hub events are reported as not found.
--   4. Navigation publishing needs website.settings.publish. Editors keep editing menus but cannot publish them.
--   5. Site-path and image links: a protocol-relative address (//host or /\host) is refused.
--   6. web_register_media: an upload can be registered only by the account it was issued to (the path starts with that
--      account's id), only to a bucket that account may upload to, and only once.
--   7. web_record_download: a browser cannot record a download. Only service_role may, from the PDF delivery function,
--      which now also applies a per-client limit.

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Inquiry intake: trusted backend only
-- ---------------------------------------------------------------------------------------------------------------------

revoke all on function public.web_submit_inquiry(text, text, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.web_submit_inquiry(text, text, text, text, text, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Rhapsody: a published edition needs publish permission for any change
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
    -- A published edition is what readers see. Changing any part of it, including its PDF, is a publishing action.
    if v_current.status = 'published' then
      perform public._web_require('website.rhapsody.publish');
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

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Events: only events open to everyone are visible to website staff
-- ---------------------------------------------------------------------------------------------------------------------

create or replace function public.web_list_event_publications()
returns table (event_id uuid, title text, event_date date, is_public boolean, featured boolean, slug text,
               public_title text, public_summary text, registration_url text, version integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.web_has_permission('website.events.manage') or public.web_has_permission('website.events.publish')) then
    raise exception 'You do not have permission to view event publications.' using errcode = '42501';
  end if;
  -- Targeted and restricted Hub events (meetings, cells, saved groups, explicit lists) are never shown here.
  return query
    select e.id, e.title, e.date, coalesce(pub.is_public, false), coalesce(pub.featured, false), pub.slug,
           pub.public_title, pub.public_summary, pub.registration_url, coalesce(pub.version, 0)
    from public.events e
    left join public.web_event_publications pub on pub.event_id = e.id
    where e.audience = 'all' and e.audience_spec_id is null
    order by e.date desc;
end;
$$;

create or replace function public.web_set_event_publication(
  p_event_id uuid, p_is_public boolean, p_featured boolean, p_slug text, p_title text, p_summary text,
  p_registration_url text, p_expected_version integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.web_event_publications%rowtype;
  v_exists boolean;
begin
  perform public._web_require('website.events.manage');
  if p_is_public then perform public._web_require('website.events.publish'); end if;
  -- An event that is not open to everyone is reported exactly like a missing one, so its existence is not revealed.
  select exists (
    select 1 from public.events e where e.id = p_event_id and e.audience = 'all' and e.audience_spec_id is null
  ) into v_exists;
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

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Navigation publishing uses the settings publish permission, which Editors do not hold
-- ---------------------------------------------------------------------------------------------------------------------

create or replace function public._web_publish_permission(p_kind text)
returns text
language sql
immutable
as $$
  select case p_kind when 'page' then 'website.pages.publish' when 'settings' then 'website.settings.publish' when 'navigation' then 'website.settings.publish' end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. Content validation: refuse protocol-relative addresses everywhere a link or image is stored
--    Site path rule: starts with a single "/", and the next character is neither "/" nor "\" and nothing is whitespace.
-- ---------------------------------------------------------------------------------------------------------------------

create or replace function public._web_validate_content(p_kind text, p_key text, p_body jsonb)
returns void
language plpgsql
immutable
set search_path = public
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
          -- Postgres regular expressions allow at most 255 repetitions, so the length is checked separately.
          if v_url <> ''
             and (v_url !~ '^https://[^\s]*$' and v_url !~ '^/($|[^/\\\s])[^\s]*$'
                  or char_length(v_url) > 500
                  or v_url ~* '^(https?://[^/]*@|https?://[^/]*:)') then
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
        if v_url <> '' and v_url !~ '^(https://[^\s@/]+(/[^\s]*)?|/($|[^/\\\s])[^\s]*)$' then
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
      if v_url !~ '^(https://[^\s@/]+(/[^\s]*)?|/($|[^/\\\s])[^\s]*)$' then
        raise exception 'Menu links must be https or a site path.' using errcode = '22023';
      end if;
    end loop;
  else
    raise exception 'Unknown content kind.' using errcode = '22023';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. Media registration: only the account the upload was issued to, only for buckets that account may upload to
-- ---------------------------------------------------------------------------------------------------------------------

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
  if p_bucket = 'rhapsody-pdfs' then
    perform public._web_require('website.rhapsody.manage');
  elsif p_bucket <> 'site-media' then
    raise exception 'That storage bucket is not used by the website.' using errcode = '22023';
  end if;
  -- Uploads are issued under the uploader's own folder (website-media-upload). Anything else was not issued to this user.
  if not starts_with(coalesce(p_storage_path, ''), auth.uid()::text || '/') then
    raise exception 'This upload was not issued to your account. Please upload it again.' using errcode = '42501';
  end if;
  if p_bucket = 'site-media' and coalesce(p_alt_text, '') = '' then
    raise exception 'Describe the image for screen readers before saving it.' using errcode = '22023';
  end if;
  if exists (select 1 from public.web_media m where m.storage_path = p_storage_path) then
    raise exception 'This file is already in the media library.' using errcode = '22023';
  end if;
  -- The object must really be there, in this bucket, with the size and type that were declared.
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = p_bucket
      and o.name = p_storage_path
      and (o.metadata->>'size') = p_bytes::text
      and (o.metadata->>'mimetype') = p_mime
  ) then
    raise exception 'The uploaded file was not found, or it does not match the declared type and size. Please upload it again.'
      using errcode = '22023';
  end if;
  insert into public.web_media (bucket, storage_path, mime, bytes, alt_text, uploaded_by)
  values (p_bucket, p_storage_path, p_mime, p_bytes, coalesce(p_alt_text, ''), auth.uid())
  returning id into v_id;
  perform public._web_audit('media.registered', v_id::text, jsonb_build_object('bucket', p_bucket, 'mime', p_mime, 'bytes', p_bytes));
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 7. Download recording: trusted backend only. The PDF function applies the per-client limit before calling it.
-- ---------------------------------------------------------------------------------------------------------------------

revoke all on function public.web_record_download(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.web_record_download(uuid, text, text, text, text) to service_role;
