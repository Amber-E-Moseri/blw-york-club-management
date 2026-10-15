-- 021_email_push_user_identity.sql
--
-- ONE identity contract for account-owned notification state.
--
--   user_id   = the authenticated account. It is public.profiles.id, which is auth.users.id.
--               Used by email_preferences, push_subscriptions and push_notification_log.
--   person_id = the human in the People model (public.people). It is NOT a replacement for user_id here.
--   member_id = deliberately NOT used for these three tables. (email_log.member_id and contacts.member_id
--               keep their own, separate meanings and are untouched.)
--
-- Why the earlier schema had to change: it carried BOTH user_id and member_id on these tables (a bridge from an
-- older design), kept a partial unique index on member_id that PostgREST cannot use as an upsert target, and
-- left legacy duplicate preference columns. Application code, RLS and Edge Functions disagreed about which
-- column was authoritative.
--
-- Final shapes
--   email_preferences     PK user_id -> profiles(id) ON DELETE CASCADE; nine preference flags; created_at/updated_at.
--   push_subscriptions    PK id; user_id NOT NULL -> profiles(id) ON DELETE CASCADE; endpoint UNIQUE.
--                         Many devices per account are allowed (no unique on user_id).
--   push_notification_log PK id; user_id NOT NULL -> profiles(id) ON DELETE CASCADE. One row per recipient;
--                         nothing writes recipient-less rows, so NOT NULL is correct. Written by backend
--                         (service_role) only.
--
-- Defensive behaviour. This migration also runs against a database that still has the legacy member_id shape.
-- It never silently discards data: it converts user_id from member_id only when the mapping is provable (both
-- columns are profiles.id), and ABORTS with a clear message if rows disagree, are unmapped, collide, or hold
-- values that cannot be carried over. On an empty or freshly built database it converges deterministically.
-- Row Level Security stays enabled; policies are replaced by an explicit, minimal set.

create or replace function pg_temp.has_col(tbl text, col text)
returns boolean language sql stable as $$
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = tbl and column_name = col)
$$;

create or replace function pg_temp.drop_all_policies(tbl text)
returns void language plpgsql as $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = tbl loop
    execute format('drop policy %I on public.%I', p.policyname, tbl);
  end loop;
end $$;

create or replace function pg_temp.drop_primary_key(tbl text)
returns void language plpgsql as $$
declare c text;
begin
  select conname into c from pg_constraint where conrelid = format('public.%I', tbl)::regclass and contype = 'p';
  if c is not null then execute format('alter table public.%I drop constraint %I', tbl, c); end if;
end $$;

-- ===========================================================================
-- email_preferences
-- ===========================================================================
do $$
declare n bigint; bad bigint;
begin
  if not pg_temp.has_col('email_preferences', 'user_id') then
    alter table public.email_preferences add column user_id uuid;
  end if;

  if pg_temp.has_col('email_preferences', 'member_id') then
    update public.email_preferences set user_id = member_id where user_id is null and member_id is not null;
    select count(*) into bad from public.email_preferences
      where user_id is not null and member_id is not null and user_id <> member_id;
    if bad > 0 then
      raise exception '021 email_preferences: user_id and member_id disagree on % row(s); cannot prove identity', bad;
    end if;
  end if;

  select count(*) into bad from public.email_preferences where user_id is null;
  if bad > 0 then raise exception '021 email_preferences: % row(s) have no account identity', bad; end if;

  select count(*) into bad from (select user_id from public.email_preferences group by 1 having count(*) > 1) d;
  if bad > 0 then raise exception '021 email_preferences: % account(s) have more than one row', bad; end if;

  select count(*) into bad from public.email_preferences e
    where not exists (select 1 from public.profiles p where p.id = e.user_id);
  if bad > 0 then raise exception '021 email_preferences: % row(s) point at no profile', bad; end if;

  -- Legacy duplicate toggles may only be dropped when they hold nothing but defaults.
  select count(*) into n from public.email_preferences;
  if n > 0 then
    if pg_temp.has_col('email_preferences', 'meeting_reminders') then
      execute 'select count(*) from public.email_preferences where meeting_reminders is distinct from true' into bad;
      if bad > 0 then raise exception '021 email_preferences: legacy meeting_reminders holds non-default values'; end if;
    end if;
    if pg_temp.has_col('email_preferences', 'weekly_messages') then
      execute 'select count(*) from public.email_preferences where weekly_messages is distinct from true' into bad;
      if bad > 0 then raise exception '021 email_preferences: legacy weekly_messages holds non-default values'; end if;
    end if;
    if pg_temp.has_col('email_preferences', 'habit_streaks') then
      execute 'select count(*) from public.email_preferences where habit_streaks is distinct from true' into bad;
      if bad > 0 then raise exception '021 email_preferences: legacy habit_streaks holds non-default values'; end if;
    end if;
    if pg_temp.has_col('email_preferences', 'testimony_notifications') then
      execute 'select count(*) from public.email_preferences where testimony_notifications is distinct from true' into bad;
      if bad > 0 then raise exception '021 email_preferences: legacy testimony_notifications holds non-default values'; end if;
    end if;
    if pg_temp.has_col('email_preferences', 'unsubscribed_at') then
      execute 'select count(*) from public.email_preferences where unsubscribed_at is not null' into bad;
      if bad > 0 then raise exception '021 email_preferences: legacy unsubscribed_at holds values'; end if;
    end if;
  end if;
end $$;

select pg_temp.drop_all_policies('email_preferences');
drop trigger if exists email_preferences_updated_at on public.email_preferences;
drop trigger if exists set_email_prefs_updated_at on public.email_preferences;

alter table public.email_preferences
  add column if not exists meeting_reminders_8am boolean not null default true,
  add column if not exists meeting_reminders_1hr boolean not null default true,
  add column if not exists message_notifications boolean not null default true,
  add column if not exists habit_milestones boolean not null default true,
  add column if not exists devotional_reminders boolean not null default true,
  add column if not exists testimony_approved boolean not null default true,
  add column if not exists weekly_digest boolean not null default false,
  add column if not exists admin_announcements boolean not null default true,
  add column if not exists opt_out_all boolean not null default false,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

select pg_temp.drop_primary_key('email_preferences');

alter table public.email_preferences
  drop column if exists id,
  drop column if exists member_id,
  drop column if exists meeting_reminders,
  drop column if exists weekly_messages,
  drop column if exists habit_streaks,
  drop column if exists testimony_notifications,
  drop column if exists unsubscribed_at;

alter table public.email_preferences alter column user_id set not null;
alter table public.email_preferences add constraint email_preferences_pkey primary key (user_id);

alter table public.email_preferences drop constraint if exists email_preferences_user_id_fkey;
alter table public.email_preferences
  add constraint email_preferences_user_id_fkey foreign key (user_id) references public.profiles(id) on delete cascade;

drop index if exists public.idx_email_prefs_member;
drop index if exists public.email_preferences_member_id_unique;
drop index if exists public.email_preferences_member_id_bridge_unique;

alter table public.email_preferences enable row level security;

create policy email_preferences_select_own on public.email_preferences
  for select using (user_id = auth.uid());
create policy email_preferences_insert_own on public.email_preferences
  for insert with check (user_id = auth.uid());
create policy email_preferences_update_own on public.email_preferences
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create trigger email_preferences_updated_at
  before update on public.email_preferences
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- push_subscriptions
-- ===========================================================================
do $$
declare bad bigint;
begin
  if not pg_temp.has_col('push_subscriptions', 'user_id') then
    alter table public.push_subscriptions add column user_id uuid;
  end if;

  if pg_temp.has_col('push_subscriptions', 'member_id') then
    update public.push_subscriptions set user_id = member_id where user_id is null and member_id is not null;
    select count(*) into bad from public.push_subscriptions
      where user_id is not null and member_id is not null and user_id <> member_id;
    if bad > 0 then
      raise exception '021 push_subscriptions: user_id and member_id disagree on % row(s); cannot prove identity', bad;
    end if;
  end if;

  select count(*) into bad from public.push_subscriptions where user_id is null;
  if bad > 0 then raise exception '021 push_subscriptions: % row(s) have no account identity', bad; end if;

  select count(*) into bad from public.push_subscriptions s
    where not exists (select 1 from public.profiles p where p.id = s.user_id);
  if bad > 0 then raise exception '021 push_subscriptions: % row(s) point at no profile', bad; end if;

  -- A subscription whose browser permission was not "granted" is not deliverable: carry that meaning over.
  if pg_temp.has_col('push_subscriptions', 'permission') then
    execute 'update public.push_subscriptions set is_active = false where permission is not null and permission <> ''granted''';
  end if;
end $$;

select pg_temp.drop_all_policies('push_subscriptions');
drop trigger if exists push_subscriptions_updated_at on public.push_subscriptions;

alter table public.push_subscriptions
  add column if not exists is_active boolean not null default true,
  add column if not exists subscribed_at timestamptz not null default now(),
  add column if not exists last_used timestamptz,
  add column if not exists created_at timestamptz not null default now();

alter table public.push_subscriptions
  alter column p256dh type text,
  alter column auth type text,
  alter column user_agent type text;

alter table public.push_subscriptions
  drop column if exists member_id,
  drop column if exists permission,
  drop column if exists updated_at;

alter table public.push_subscriptions alter column user_id set not null;
alter table public.push_subscriptions drop constraint if exists push_subscriptions_user_id_fkey;
alter table public.push_subscriptions
  add constraint push_subscriptions_user_id_fkey foreign key (user_id) references public.profiles(id) on delete cascade;

drop index if exists public.idx_push_subs_member;
create index if not exists idx_push_subs_user on public.push_subscriptions (user_id, is_active);

alter table public.push_subscriptions enable row level security;

create policy push_subscriptions_select_own on public.push_subscriptions
  for select using (user_id = auth.uid());
create policy push_subscriptions_insert_own on public.push_subscriptions
  for insert with check (user_id = auth.uid());
create policy push_subscriptions_update_own on public.push_subscriptions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy push_subscriptions_delete_own on public.push_subscriptions
  for delete using (user_id = auth.uid());

-- ===========================================================================
-- push_notification_log
-- ===========================================================================
do $$
declare bad bigint;
begin
  if not pg_temp.has_col('push_notification_log', 'user_id') then
    alter table public.push_notification_log add column user_id uuid;
  end if;

  if pg_temp.has_col('push_notification_log', 'member_id') then
    update public.push_notification_log set user_id = member_id where user_id is null and member_id is not null;
    select count(*) into bad from public.push_notification_log
      where user_id is not null and member_id is not null and user_id <> member_id;
    if bad > 0 then
      raise exception '021 push_notification_log: user_id and member_id disagree on % row(s); cannot prove identity', bad;
    end if;
  end if;

  select count(*) into bad from public.push_notification_log where user_id is null;
  if bad > 0 then
    raise exception '021 push_notification_log: % row(s) have no recipient; a recipient-less log cannot be converted', bad;
  end if;

  select count(*) into bad from public.push_notification_log l
    where not exists (select 1 from public.profiles p where p.id = l.user_id);
  if bad > 0 then raise exception '021 push_notification_log: % row(s) point at no profile', bad; end if;

  -- Fold the two certified-only columns into response_data so nothing is lost.
  if pg_temp.has_col('push_notification_log', 'target_url') or pg_temp.has_col('push_notification_log', 'error_message') then
    execute $q$
      update public.push_notification_log
         set response_data = coalesce(response_data, '{}'::jsonb)
             || jsonb_strip_nulls(jsonb_build_object('target_url', to_jsonb(push_notification_log) -> 'target_url',
                                                     'error_message', to_jsonb(push_notification_log) -> 'error_message'))
       where (to_jsonb(push_notification_log) ->> 'target_url') is not null
          or (to_jsonb(push_notification_log) ->> 'error_message') is not null
    $q$;
  end if;
end $$;

select pg_temp.drop_all_policies('push_notification_log');

alter table public.push_notification_log
  add column if not exists sent_at timestamptz not null default now(),
  add column if not exists clicked_at timestamptz,
  add column if not exists response_data jsonb,
  add column if not exists created_at timestamptz not null default now();

alter table public.push_notification_log
  alter column notification_type type text,
  alter column title type text,
  alter column body type text,
  alter column status type text;

alter table public.push_notification_log
  drop column if exists member_id,
  drop column if exists target_url,
  drop column if exists error_message;

alter table public.push_notification_log alter column status set default 'queued';
alter table public.push_notification_log drop constraint if exists push_notification_log_status_check;
alter table public.push_notification_log
  add constraint push_notification_log_status_check
  check (status in ('queued', 'sent', 'failed', 'clicked', 'dismissed'));

alter table public.push_notification_log alter column user_id set not null;
alter table public.push_notification_log drop constraint if exists push_notification_log_user_id_fkey;
alter table public.push_notification_log
  add constraint push_notification_log_user_id_fkey foreign key (user_id) references public.profiles(id) on delete cascade;

drop index if exists public.idx_push_log_member;
create index if not exists idx_push_log_user on public.push_notification_log (user_id, sent_at desc);
create index if not exists idx_push_log_type on public.push_notification_log (notification_type, sent_at desc);

alter table public.push_notification_log enable row level security;

-- Recipients read their own history; coordinators/admins can read the log for operations.
-- There is intentionally NO insert/update/delete policy: only the backend (service_role) writes notification logs.
create policy push_notification_log_select_own on public.push_notification_log
  for select using (user_id = auth.uid());
create policy push_notification_log_select_admin on public.push_notification_log
  for select using (public.is_admin_or_coordinator());
