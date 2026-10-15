-- ---------------------------------------------------------------------------------------------------------------------
-- Website Management (Phase D2): verified media registration and abandoned-upload discovery.
--
--   * web_register_media now requires the object to exist in storage, in the declared bucket, with the declared size and
--     type. A registration cannot point at a file that was never uploaded, or at a different file from the one declared.
--   * web_orphaned_uploads lists storage objects that nothing references: no web_media row and no mention of the path in
--     any published or draft website content. Service role only. The cleanup function deletes only what this returns.
--
-- Forward-only. Depends on 104 (permissions, audit), 105 (content), 107 (media). Migrations 000-109 are not changed.
-- ---------------------------------------------------------------------------------------------------------------------

create or replace function public.web_register_media(p_bucket text, p_storage_path text, p_mime text, p_bytes bigint, p_alt_text text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  perform public._web_require('website.media.upload');
  if p_bucket = 'site-media' and coalesce(p_alt_text, '') = '' then
    raise exception 'Describe the image for screen readers before saving it.' using errcode = '22023';
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

create or replace function public.web_orphaned_uploads(p_older_than_minutes integer)
returns table (bucket_id text, object_name text)
language sql
stable
security definer
set search_path = public, storage, pg_temp
as $$
  select o.bucket_id, o.name
  from storage.objects o
  where o.bucket_id in ('site-media', 'rhapsody-pdfs')
    and o.created_at < now() - make_interval(mins => p_older_than_minutes)
    and not exists (
      select 1 from public.web_media m where m.bucket = o.bucket_id and m.storage_path = o.name)
    and not exists (
      select 1 from public.web_versions v where position(o.name in v.body::text) > 0)
    and not exists (
      select 1 from public.web_content c where position(o.name in c.draft::text) > 0)
  order by o.created_at
  limit 500
$$;

revoke all on function public.web_orphaned_uploads(integer) from public, anon, authenticated;
grant execute on function public.web_orphaned_uploads(integer) to service_role;
