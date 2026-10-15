-- 025_storage_buckets_and_policies.sql
--
-- Reproducible Storage: every bucket the application uses, with explicit limits and an exact policy set.
-- Reviewed bucket by bucket (the policies of 002 and 007 are superseded, not copied):
--
--   devotional-images   public   {year}/{MM}/{devotionalId}/{file}.jpg   written by devotional admins
--                                10 MB, image/jpeg|png|webp
--   testimony-images    public   {userId}/{timestamp}.{ext}              written by the owner of that folder
--                                5 MB,  image/jpeg|png|webp              (the old policy let ANY signed-in user write
--                                                                         into ANY user's folder)
--   user-media          public   avatars/{userId}.{ext}                  written by that user only
--                                5 MB,  image/jpeg|png|webp              (this bucket was missing from every earlier
--                                                                         migration, so avatar upload never worked on a
--                                                                         clean project)
--
-- All three buckets are public so images render from a plain URL; that exposes only objects whose path is known.
-- Listing/reading through the authenticated API requires an ACTIVE (approved) account, so anon and pending accounts
-- cannot enumerate objects. Writes require an active account that owns the path; there is no anonymous write anywhere.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('devotional-images', 'devotional-images', true, 10485760, array['image/jpeg', 'image/png', 'image/webp']),
  ('testimony-images',  'testimony-images',  true,  5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('user-media',        'user-media',        true,  5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Remove every previous policy on storage.objects (including hand-made ones), then recreate the exact set.
do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
  loop
    execute format('drop policy %I on storage.objects', p.policyname);
  end loop;
end $$;

-- devotional-images ---------------------------------------------------------
create policy devotional_images_read on storage.objects
  for select to authenticated
  using (bucket_id = 'devotional-images' and public.is_active_member());
create policy devotional_images_admin_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'devotional-images' and public.is_devotional_admin());
create policy devotional_images_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'devotional-images' and public.is_devotional_admin())
  with check (bucket_id = 'devotional-images' and public.is_devotional_admin());
create policy devotional_images_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'devotional-images' and public.is_devotional_admin());

-- testimony-images ----------------------------------------------------------
create policy testimony_images_read on storage.objects
  for select to authenticated
  using (bucket_id = 'testimony-images' and public.is_active_member());
create policy testimony_images_owner_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'testimony-images' and public.is_active_member()
              and (storage.foldername(name))[1] = auth.uid()::text);
create policy testimony_images_owner_update on storage.objects
  for update to authenticated
  using (bucket_id = 'testimony-images' and public.is_active_member()
         and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'testimony-images' and public.is_active_member()
              and (storage.foldername(name))[1] = auth.uid()::text);
create policy testimony_images_owner_or_moderator_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'testimony-images'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin_or_coordinator()));

-- user-media (avatars) --------------------------------------------------------
create policy user_media_read on storage.objects
  for select to authenticated
  using (bucket_id = 'user-media' and public.is_active_member());
create policy user_media_avatar_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'user-media' and public.is_active_member()
              and (storage.foldername(name))[1] = 'avatars'
              and split_part(storage.filename(name), '.', 1) = auth.uid()::text);
create policy user_media_avatar_update on storage.objects
  for update to authenticated
  using (bucket_id = 'user-media' and public.is_active_member()
         and (storage.foldername(name))[1] = 'avatars'
         and split_part(storage.filename(name), '.', 1) = auth.uid()::text)
  with check (bucket_id = 'user-media' and public.is_active_member()
              and (storage.foldername(name))[1] = 'avatars'
              and split_part(storage.filename(name), '.', 1) = auth.uid()::text);
create policy user_media_avatar_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'user-media'
         and (storage.foldername(name))[1] = 'avatars'
         and split_part(storage.filename(name), '.', 1) = auth.uid()::text);
