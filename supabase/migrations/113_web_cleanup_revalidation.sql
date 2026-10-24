-- ---------------------------------------------------------------------------------------------------------------------
-- Website Management (Phase D2): revalidation before each abandoned-upload deletion.
--
-- web_orphaned_uploads lists candidates in one snapshot. Between that snapshot and a deletion, an editor may register the
-- object or save a draft that mentions it. web_upload_still_unreferenced is asked again for each object immediately
-- before it is deleted, with the same rules and the same minimum age. Service role only.
--
-- Forward-only. Depends on 107 (content), 109 (media) and 112 (orphan discovery). Migrations 000-112 are not changed.
-- ---------------------------------------------------------------------------------------------------------------------

create or replace function public.web_upload_still_unreferenced(p_bucket text, p_object_name text, p_older_than_minutes integer)
returns boolean
language sql
stable
security definer
set search_path = public, storage
as $$
  select exists (
    select 1 from storage.objects o
    where o.bucket_id = p_bucket
      and o.name = p_object_name
      and o.bucket_id in ('site-media', 'rhapsody-pdfs')
      and p_older_than_minutes >= 1440
      and o.created_at < now() - make_interval(mins => p_older_than_minutes)
  )
  and not exists (
    select 1 from public.web_media m where m.bucket = p_bucket and m.storage_path = p_object_name)
  and not exists (
    select 1 from public.web_versions v where position(p_object_name in v.body::text) > 0)
  and not exists (
    select 1 from public.web_content c where position(p_object_name in c.draft::text) > 0)
$$;

revoke all on function public.web_upload_still_unreferenced(text, text, integer) from public, anon, authenticated;
grant execute on function public.web_upload_still_unreferenced(text, text, integer) to service_role;
