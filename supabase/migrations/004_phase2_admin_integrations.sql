create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.is_core_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role in ('admin', 'coordinator')
  );
$$;

create table if not exists public.admin_roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 2 and 80),
  description text,
  is_system boolean not null default false,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists admin_roles_updated_at on public.admin_roles;
create trigger admin_roles_updated_at
  before update on public.admin_roles
  for each row execute procedure public.set_updated_at();

create table if not exists public.admin_role_permissions (
  role_id uuid not null references public.admin_roles(id) on delete cascade,
  permission_key text not null check (
    permission_key in (
      'contacts.view_all',
      'contacts.write',
      'attendance.view_all',
      'testimonies.view_all',
      'testimonies.approve',
      'reports.generate',
      'settings.manage_tags',
      'devotionals.manage',
      'notifications.send',
      'integrations.manage'
    )
  ),
  created_at timestamptz not null default now(),
  primary key (role_id, permission_key)
);

create table if not exists public.admin_role_assignments (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references public.admin_roles(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  assigned_by uuid not null references public.profiles(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  unique (role_id, user_id)
);

create index if not exists admin_role_assignments_user_idx
  on public.admin_role_assignments (user_id);

alter table public.admin_roles enable row level security;
alter table public.admin_role_permissions enable row level security;
alter table public.admin_role_assignments enable row level security;

drop policy if exists admin_roles_read on public.admin_roles;
create policy admin_roles_read on public.admin_roles
  for select using (public.is_core_admin());

drop policy if exists admin_roles_manage on public.admin_roles;
create policy admin_roles_manage on public.admin_roles
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'coordinator')
  )
  with check (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'coordinator')
  );

drop policy if exists admin_role_permissions_read on public.admin_role_permissions;
create policy admin_role_permissions_read on public.admin_role_permissions
  for select using (public.is_core_admin());

drop policy if exists admin_role_permissions_manage on public.admin_role_permissions;
create policy admin_role_permissions_manage on public.admin_role_permissions
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'coordinator')
  )
  with check (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'coordinator')
  );

drop policy if exists admin_role_assignments_read on public.admin_role_assignments;
create policy admin_role_assignments_read on public.admin_role_assignments
  for select using (public.is_core_admin() or auth.uid() = user_id);

drop policy if exists admin_role_assignments_manage on public.admin_role_assignments;
create policy admin_role_assignments_manage on public.admin_role_assignments
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'coordinator')
  )
  with check (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'coordinator')
  );

create table if not exists public.drive_link_metadata (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles(id) on delete set null,
  source_table text,
  source_id uuid,
  url text not null,
  file_id text,
  title text not null,
  resource_type text not null default 'unknown'
    check (resource_type in ('doc','sheet','pdf','presentation','image','folder','unknown')),
  thumbnail_url text,
  embed_url text,
  permission_status text not null default 'unchecked'
    check (permission_status in ('unchecked','accessible','restricted','deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists drive_link_metadata_updated_at on public.drive_link_metadata;
create trigger drive_link_metadata_updated_at
  before update on public.drive_link_metadata
  for each row execute procedure public.set_updated_at();

alter table public.drive_link_metadata enable row level security;
drop policy if exists drive_links_read on public.drive_link_metadata;
create policy drive_links_read on public.drive_link_metadata
  for select using (auth.role() = 'authenticated');
drop policy if exists drive_links_manage on public.drive_link_metadata;
create policy drive_links_manage on public.drive_link_metadata
  for all using (owner_id = auth.uid() or public.is_core_admin())
  with check (owner_id = auth.uid() or public.is_core_admin());

create table if not exists public.email_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  member_id uuid references public.profiles(id) on delete cascade,
  meeting_reminders boolean not null default true,
  weekly_messages boolean not null default true,
  habit_streaks boolean not null default true,
  devotional_reminders boolean not null default true,
  testimony_notifications boolean not null default true,
  unsubscribed_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.email_preferences
  add column if not exists member_id uuid references public.profiles(id) on delete cascade;

update public.email_preferences
set member_id = user_id
where member_id is null;

create unique index if not exists email_preferences_member_id_bridge_unique
  on public.email_preferences (member_id)
  where member_id is not null;

drop trigger if exists email_preferences_updated_at on public.email_preferences;
create trigger email_preferences_updated_at
  before update on public.email_preferences
  for each row execute procedure public.set_updated_at();

create table if not exists public.email_notification_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  email text not null,
  notification_type text not null,
  subject text not null,
  provider text,
  provider_message_id text,
  status text not null default 'queued'
    check (status in ('queued','sent','failed','opened','clicked')),
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.email_preferences enable row level security;
alter table public.email_notification_log enable row level security;

drop policy if exists email_preferences_own on public.email_preferences;
create policy email_preferences_own on public.email_preferences
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists email_log_read on public.email_notification_log;
create policy email_log_read on public.email_notification_log
  for select using (public.is_core_admin() or user_id = auth.uid());

drop policy if exists email_log_admin_write on public.email_notification_log;
create policy email_log_admin_write on public.email_notification_log
  for insert with check (public.is_core_admin());

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  permission text not null default 'granted'
    check (permission in ('granted','denied','default')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists push_subscriptions_updated_at on public.push_subscriptions;
create trigger push_subscriptions_updated_at
  before update on public.push_subscriptions
  for each row execute procedure public.set_updated_at();

create table if not exists public.push_notification_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  notification_type text not null,
  title text not null,
  body text not null,
  target_url text,
  status text not null default 'queued'
    check (status in ('queued','sent','failed','clicked')),
  error_message text,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;
alter table public.push_notification_log enable row level security;

drop policy if exists push_subscriptions_own on public.push_subscriptions;
create policy push_subscriptions_own on public.push_subscriptions
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists push_log_read on public.push_notification_log;
create policy push_log_read on public.push_notification_log
  for select using (user_id = auth.uid() or public.is_core_admin());

drop policy if exists push_log_admin_write on public.push_notification_log;
create policy push_log_admin_write on public.push_notification_log
  for insert with check (public.is_core_admin());

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='meetings') then
    alter table public.meetings
      add column if not exists zoom_meeting_id text,
      add column if not exists zoom_start_url text,
      add column if not exists zoom_synced_at timestamptz,
      add column if not exists cmp_attendance_id text,
      add column if not exists meeting_type text;
  end if;
end $$;

create table if not exists public.attendance_imports (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'cmp',
  source_event_id text,
  source_payload jsonb not null default '{}'::jsonb,
  synced_by uuid references public.profiles(id) on delete set null,
  synced_at timestamptz not null default now()
);

create table if not exists public.attendance_member_matches (
  id uuid primary key default gen_random_uuid(),
  import_id uuid references public.attendance_imports(id) on delete cascade,
  source_name text not null,
  source_email text,
  matched_user_id uuid references public.profiles(id) on delete set null,
  confidence numeric(5,4) not null default 0,
  status text not null default 'pending'
    check (status in ('pending','matched','ignored')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.attendance_imports enable row level security;
alter table public.attendance_member_matches enable row level security;

drop policy if exists attendance_imports_admin on public.attendance_imports;
create policy attendance_imports_admin on public.attendance_imports
  for all using (public.is_core_admin())
  with check (public.is_core_admin());

drop policy if exists attendance_matches_admin on public.attendance_member_matches;
create policy attendance_matches_admin on public.attendance_member_matches
  for all using (public.is_core_admin())
  with check (public.is_core_admin());
