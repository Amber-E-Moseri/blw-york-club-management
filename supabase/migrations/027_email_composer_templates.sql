-- 027_email_composer_templates.sql
--
-- Add editable communication templates and drafts for authorized coordinators.
-- System-critical authentication, approval and security emails remain outside this
-- customizable layer.

create table if not exists public.email_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subject text not null,
  body_markdown text not null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_templates_name_not_blank check (length(btrim(name)) > 0),
  constraint email_templates_subject_not_blank check (length(btrim(subject)) > 0),
  constraint email_templates_body_not_blank check (length(btrim(body_markdown)) > 0)
);

create table if not exists public.email_drafts (
  id uuid primary key default gen_random_uuid(),
  template_id uuid references public.email_templates(id) on delete set null,
  subject text not null,
  body_markdown text not null,
  recipient_ids uuid[] not null default '{}',
  recipient_filter jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.profiles(id) on delete cascade,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_drafts_subject_not_blank check (length(btrim(subject)) > 0),
  constraint email_drafts_body_not_blank check (length(btrim(body_markdown)) > 0)
);

create index if not exists idx_email_templates_updated_at on public.email_templates (updated_at desc);
create index if not exists idx_email_templates_created_by on public.email_templates (created_by);
create index if not exists idx_email_drafts_updated_at on public.email_drafts (updated_at desc);
create index if not exists idx_email_drafts_created_by on public.email_drafts (created_by);

alter table public.email_templates enable row level security;
alter table public.email_drafts enable row level security;

drop policy if exists email_templates_manage_notifications on public.email_templates;
create policy email_templates_manage_notifications on public.email_templates
  for all to authenticated
  using (public.is_active_member() and public.has_admin_permission('notifications.send'))
  with check (public.is_active_member() and public.has_admin_permission('notifications.send'));

drop policy if exists email_drafts_manage_notifications on public.email_drafts;
create policy email_drafts_manage_notifications on public.email_drafts
  for all to authenticated
  using (
    public.is_active_member()
    and public.has_admin_permission('notifications.send')
    and created_by = auth.uid()
  )
  with check (
    public.is_active_member()
    and public.has_admin_permission('notifications.send')
    and created_by = auth.uid()
  );

drop trigger if exists email_templates_updated_at on public.email_templates;
create trigger email_templates_updated_at
  before update on public.email_templates
  for each row execute function public.set_updated_at();

drop trigger if exists email_drafts_updated_at on public.email_drafts;
create trigger email_drafts_updated_at
  before update on public.email_drafts
  for each row execute function public.set_updated_at();

grant select, insert, update, delete on table public.email_templates, public.email_drafts to authenticated;
grant select, insert, update, delete on table public.email_templates, public.email_drafts to service_role;
