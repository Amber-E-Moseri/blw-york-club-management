-- 116_web_unpublish_content.sql
--
-- Page unpublish. Adds the one missing content workflow: withdrawing a published page from the public site. Forward-only.
-- Depends on 108 (web_content, web_versions, v_public_content) and 115 (_web_publish_permission). Migrations 000-115
-- are not changed.
--
-- Behaviour:
--   * Clears web_content.published_version_id. v_public_content is an inner join on that column, so the page disappears
--     from the public view at once. The draft and every version row are kept, so the page can be republished or rolled
--     back later. Nothing is deleted.
--   * Only kind = 'page' is supported. Settings and navigation always need a published value for the public site, so
--     they are not unpublished; a settings or navigation change is withdrawn by publishing an earlier version.
--   * Needs website.pages.publish (through _web_require) and a reason of at least 5 characters, the same rule as rollback.
--   * Writes one web_audit_log row with the version that was withdrawn.
--   * Already-unpublished pages raise 22023, so a repeated click cannot write a misleading audit row.

create or replace function public.web_unpublish_content(p_kind text, p_key text, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_content public.web_content%rowtype;
begin
  if p_kind <> 'page' then
    raise exception 'Only pages can be unpublished. Publish an earlier version to change settings or navigation.' using errcode = '22023';
  end if;
  perform public._web_require(public._web_publish_permission(p_kind));
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Give a reason of at least 5 characters to unpublish a page.' using errcode = '22023';
  end if;
  select * into v_content from public.web_content where kind = p_kind and key = p_key for update;
  if not found then
    raise exception 'That page does not exist.' using errcode = 'P0002';
  end if;
  if v_content.published_version_id is null then
    raise exception 'That page is not published.' using errcode = '22023';
  end if;
  update public.web_content
     set published_version_id = null, updated_by = auth.uid(), updated_at = now()
   where kind = p_kind and key = p_key;
  perform public._web_audit('content.unpublished', p_kind || ':' || p_key,
    jsonb_build_object('withdrawn_version_id', v_content.published_version_id, 'reason', btrim(p_reason)));
end;
$$;

revoke all on function public.web_unpublish_content(text, text, text) from public, anon;
grant execute on function public.web_unpublish_content(text, text, text) to authenticated;
