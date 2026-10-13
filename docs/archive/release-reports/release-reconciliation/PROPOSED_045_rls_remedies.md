# Proposed migration 045: authorisation remedies (NOT APPLIED, needs approval)

Status: drafted and tested inside a rolled-back transaction on the local replay only. Not in `supabase/migrations/`.
Each part changes an access rule. Part 4 also needs an app change. Read the "decision" notes before approving.

Companion test: `supabase/verification/bsc_effective_rls_test.sql` (real schema, rolled back).

## Parts

1. **books_of_month write** (`books_manage`). Was: role check only, so an inactive or pending coordinator/admin could write. Now: `is_admin_or_coordinator()`, which is status-gated through `current_user_role()`.
2. **Rhapsody admin read** (`views_admin_read`). Was: role check only. Now: `is_devotional_admin()`, which is status-gated.
3. **Cells write** (`cells_manage`). Was: role check only. Now: `is_coordinator()`, which is status-gated and matches the original role.
4. **Leader and member scope** (`can_view_member`). Was: the BSC-leader and own-row branches had no status check, and members were not required to be active. Now: the caller must be an active account, and a leader-branch member must be active too. Pending accounts see nothing, including their own rows.
   - **Decision:** should a pending member's Rhapsody read or declaration be visible to their leader? This draft says no.
5. **Broad confession read** (`confession_declarations_read`). Was: any active member could read every declaration. Now: dropped. A `SECURITY DEFINER` function returns per-confession **counts only** to active members.
   - **Required app change:** `src/lib/queries/confessions.ts` embeds `confession_declarations(user_id)` to compute `declaration_count` (lines 9 and 33). After this part, that embed returns only the caller's own row. Switch to `confession_declaration_counts()` for the count and keep the embed for `declared_by_me`.
   - **Decision:** is a member-visible count of declarations intended? This draft keeps it.

Not drafted (same role-only pattern, need a per-table decision): `email_log_admin_manage`, `email_log_admin_read`, `meetings_manage_scoped` (cell-leader branch), `meetings_leaders_read`, `people_delete`, `prayer_requests_coordinator_manage`, `prayer_requests_leadership_read`, `foundation_school_*`, `devotional_daily_pages.daily_pages_manage`, `monthly_devotionals.devotional_manage`, `admin_role_*`, `cells` (part 3 covers `cells_manage` only).

## SQL (proposed)

```sql
-- 1. books_of_month: coordinator/admin write, status-gated
drop policy if exists books_manage on public.books_of_month;
create policy books_manage on public.books_of_month for all
  using (public.is_admin_or_coordinator())
  with check (public.is_admin_or_coordinator());

-- 2. Rhapsody reads for admins: status-gated
drop policy if exists views_admin_read on public.devotional_views;
create policy views_admin_read on public.devotional_views for select
  using (public.is_devotional_admin());

-- 3. Cells: coordinator write, status-gated
drop policy if exists cells_manage on public.cells;
create policy cells_manage on public.cells for all
  using (public.is_coordinator())
  with check (public.is_coordinator());

-- 4. Leader and member scope: active caller; active member; active leader
create or replace function public.can_view_member(p_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_active_member() and (
    p_member_id = auth.uid()
    or public.is_admin_or_coordinator()
    or exists (
      select 1
      from public.profiles m
      join public.bscs b on b.id = m.bsc_id
      where m.id = p_member_id
        and m.status = 'active'
        and (b.leader_id = auth.uid() or public.is_cell_leader_of(b.cell_id))
    )
  )
$$;

-- 5. Confessions: no row-level read of other members' declarations. Counts only.
drop policy if exists confession_declarations_read on public.confession_declarations;

create or replace function public.confession_declaration_counts(p_confession_ids uuid[])
returns table (confession_id uuid, declaration_count bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select d.confession_id, count(*)
  from public.confession_declarations d
  where d.confession_id = any(p_confession_ids)
    and public.is_active_member()
  group by d.confession_id
$$;

revoke all on function public.confession_declaration_counts(uuid[]) from public, anon;
grant execute on function public.confession_declaration_counts(uuid[]) to authenticated;
```

## Tested result (rolled back, real schema)

See the section "Remedy test" in `RC_REPORT.md` for the before and after counts.
