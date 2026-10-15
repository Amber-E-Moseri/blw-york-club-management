# BLW York Hub — Prototype UI Migration Audit

**Phase 0 — No code changes in this document.**  
**Date:** 2026-09-14  
**Branch context:** `main` (audit performed before branching)

---

## 1. Current Architecture Summary

### Framework & Build
| Concern | Technology |
|---|---|
| Framework | React 18 + TypeScript |
| Build | Create React App (react-scripts 5) |
| Routing | react-router-dom v6 |
| Styling | Tailwind CSS v3 (custom `york` theme tokens) |
| Data / Auth | Supabase (PostgreSQL + RLS + auth.users) |
| Icons | lucide-react |
| Charts | recharts |
| Dates | date-fns |
| Push notifications | Web Push API (custom service worker) |
| Video | Zoom (OAuth integration via admin panel) |
| PWA | Service worker, install prompt |

### App entry point
`src/App.tsx` → `AppShell` → `MainLayout` wrapping all `<Routes>`.  
Auth state is resolved in `useAuth`. Pending/rejected users hit `PendingApproval` before `MainLayout`.

### Layout system
```
MainLayout
├── Header           (mobile: top bar with menu toggle; desktop: top bar)
├── Navigation       (mobile: slide-in drawer)
├── Sidebar          (desktop: collapsible left nav, w-56/w-16)
└── <main>           (page content, scrollable)
```

### Role hierarchy (4 levels)
```
member (0) < cell_leader (1) < admin (2) < coordinator (3)
```
Role-level filtering on nav items (`minRole`), DB-level RLS policies per table, and a granular `AdminRole` + `AdminPermissionKey` system for fine-grained permissions within admin roles.

### Auth flow
Sign-up → Supabase `auth.users` → trigger creates `profiles` row with `status='pending'` → admin approves at `/admin/pending` → status set to `'active'` → user can access app.

### Database tables (live in Supabase, all with RLS)
| Table | Purpose |
|---|---|
| `profiles` | Users (extends auth.users) |
| `cells` | Cell groups with leader assignment |
| `contacts` | Outreach CRM contacts |
| `tags_settings` / `status_settings` | Configurable contact tags and follow-up statuses |
| `contact_tag_relations` | Many-to-many contact ↔ tag |
| `contact_follow_ups` | Follow-up assignment + history |
| `contact_audit_log` | Full audit trail for contact changes |
| `confessions` + `confession_declarations` | Daily confessions + who declared |
| `testimonies` + reactions + comments | Testimony & prophecy log |
| `meetings` + `meeting_attendances` | Meetings with Zoom integration |
| `weekly_messages` | Org/personal messages of the week |
| `habit_templates` + `habit_entries` | Habit tracking |
| `monthly_devotionals` + `daily_pages` + `views` | Daily Bread (Rhapsody) |
| `books_of_month` | Book of the Month |
| `email_log` + `email_preferences` + `scheduled_emails` | Email system |
| `push_subscriptions` + `push_notification_log` | Web Push |
| `zoom_settings` | Zoom OAuth integration |
| `admin_roles` + `admin_role_assignments` | Granular role/permission system |

### Existing pages (27 routes)
```
/                     → Dashboard
/events               → Events (RSVP-enabled)
/members              → Members (leaders+ only)
/announcements        → Announcements
/devotionals          → DevotionalViewer (Daily Bread)
/profile              → Profile (legacy, likely superseded by /profile below)
/email-preferences    → EmailPreferences
/admin                → AdminPanel (hub)
/admin/devotionals    → AdminDevotionalUpload
/admin/testimonies    → AdminTestimonies
/admin/reports        → AdminDevotionalReport
/admin/roles          → AdminRoleManagement
/admin/contact-reports → AdminContactReports
/admin/zoom           → AdminZoomSettings
/admin/exports        → AdminDataExport
/admin/email-log      → AdminEmailLog
/admin/pending        → AdminPendingApprovals
/books                → BookOfMonth
/contacts             → ContactLogging (full CRM)
/confessions          → DailyConfessions
/testimonies          → TestimonyLog
/meetings             → Meetings (Zoom integration, attendance)
/messages             → WeeklyMessages
/habits               → HabitTracker
/user-profile (via App) → UserProfile
```

Note: `Profile` at `/profile` and `UserProfile` at a second route appear to overlap — this is worth consolidating during migration.

### Current navigation structure (Sidebar, 14 items)
```
Dashboard           (all)
Events              (all)
Announcements       (all)
Meetings            (all)
Messages            (all)
Habits              (all)
Confessions         (all)
Testimonies         (all)
Daily Bread         (all)
Book of Month       (all)
CRM / Contacts      (cell_leader+)
Members             (cell_leader+)
Profile             (all)
Email Preferences   (all)
Data Export         (admin+)
Email Log           (admin+)
Admin Panel         (admin+)
```
The current sidebar is a flat, 17-item list with no grouping. All "spiritual growth" tools are top-level alongside operational ones.

---

## 2. Prototype → Codebase Feature Map

| Prototype area | Current implementation | Verdict |
|---|---|---|
| **Dashboard** | `Dashboard.tsx` — stat cards, devotional, habits preview, events, meetings, activity feed, contacts chart | **Refactor** — content is rich but not action-oriented; missing follow-up pulse card |
| **People** | `Members.tsx` — basic table (name, role, cell, joined, status) | **Refactor** — functional but thin; needs richer profile card, filters, and click-through to detail |
| **Person detail** | `UserProfile.tsx` — current user's own profile only | **New** — no admin-viewable member detail page exists |
| **Outreach CRM** | `ContactLogging.tsx` — full CRM (table, filters, tags, statuses, follow-ups, assignment, audit log, bulk import) | **Refactor** — fully functional; needs Kanban pipeline view option and better mobile layout |
| **Meetings** | `Meetings.tsx` + `MeetingForm.tsx` + `ZoomMeetingForm.tsx` | **Refactor** — functional with Zoom; prototype asks for card-based hub layout + meeting detail workspace |
| **Events & Services** | `Events.tsx` + `useEvents.ts` + `EventCard.tsx` | **Refactor** — functional; prototype enhances with RSVP count visibility and event detail |
| **Growth hub** | Scattered across `/devotionals`, `/habits`, `/confessions`, `/testimonies`, `/messages`, `/books` | **New page** — needs a Growth hub route that surfaces and links all six; underlying data exists |
| **Daily Bread** | `DevotionalViewer.tsx` + `useDevotional.ts` | **Reuse** — keep as-is, link from Growth hub |
| **Habits** | `HabitTracker.tsx` + `useHabits.ts` | **Reuse** — keep as-is, link from Growth hub |
| **Confessions** | `DailyConfessions.tsx` + `useConfessions.ts` | **Reuse** — keep as-is, link from Growth hub |
| **Testimonies** | `TestimonyLog.tsx` + `useTestimonies.ts` | **Reuse** — keep as-is, link from Growth hub |
| **Weekly messages** | `WeeklyMessages.tsx` + `useWeeklyMessages.ts` | **Reuse** — keep as-is, link from Growth hub |
| **Book of Month** | `BookOfMonth.tsx` + `useBookOfMonth.ts` | **Reuse** — keep as-is, link from Growth hub |
| **Admin centre** | `AdminPanel.tsx` + 8 admin sub-pages | **Refactor** — same card-hub pattern; prototype groups them more cleanly |
| **Navigation (desktop)** | `Sidebar.tsx` — flat 17-item list | **Refactor** — add section groupings, reduce top-level items to 7 primary destinations |
| **Navigation (mobile)** | `Navigation.tsx` — slide-in drawer | **Refactor** — replace with prototype's fixed bottom nav (5 tabs) |
| **Global search** | `GlobalSearch.tsx` + `useSearch.ts` | **Reuse** — exists; move to top bar matching prototype |
| **Quick add** | Not present | **New** — modal with contextual quick-add for contact/meeting/event |
| **Follow-up pulse** | Data exists in `contacts` + `contact_follow_ups` tables | **New widget** — Dashboard card, data query needed |
| **Announcements** | `Announcements.tsx` | Prototype does not have a primary Announcements page — surface on Dashboard sidebar card only; keep route for drill-down |
| **Sign-up approval** | `AdminPendingApprovals.tsx` + `PendingApproval.tsx` | **Reuse** — link from Admin centre card |
| **Kanban pipeline** | Not present in UI (table-only) | **New view** — toggle in ContactLogging alongside existing table |
| **Dark mode toggle** | `useTheme.ts` + Sidebar button | **Reuse** — keep; move to user footer area |
| **PWA install banner** | `PWAInstallBanner.tsx` | **Reuse** unchanged |
| **Push notification prompt** | `PushPermissionPrompt.tsx` | **Reuse** unchanged |

---

## 3. Features That Already Exist

Everything marked **Reuse** or **Refactor** above exists and works. Summary of fully-working features:

- **Auth** (sign-up, sign-in, sign-out, password reset, pending approval flow)
- **Full outreach CRM** (contacts, tags, statuses, follow-up assignment, audit log, bulk CSV import, export, move-to-cell, reassign)
- **Events** with RSVP
- **Meetings** with Zoom OAuth, attendance confirmation, category/visibility filtering
- **Daily Bread** (PDF upload → daily images, viewer with streak/view tracking)
- **Habit tracker** (templates, entries, streaks, 7-day analytics)
- **Daily confessions** (scheduled, declarations)
- **Testimonies & prophecies** (submission, moderation, reactions, comments)
- **Book of the Month** (active book, Drive link preview)
- **Weekly messages** (org + personal, recurring, Drive link)
- **Announcements** (create, read, unread count)
- **Member management** (role-gated table)
- **Admin panel** (linking to all sub-systems)
- **Devotional reports** (engagement analytics)
- **Contact reports** (outreach analytics)
- **Role management** (custom roles + permission keys)
- **Data export** (CSV)
- **Email log**, **email preferences**, email templates
- **Push notifications** (Web Push subscribe, per-type preferences)
- **Zoom settings** (OAuth connect)
- **Global search** (contacts, members, testimonies, meetings)
- **Dark mode** (class-based, persisted)
- **i18n** (en.json locale, `useTranslation` hook)
- **Dashboard stats** (`useDashboardStats` with real Supabase queries)
- **Activity feed** (real data, 4 types)

---

## 4. Features Genuinely Missing

These are prototype interactions that require new code (but mostly no new DB tables):

| Missing feature | Notes |
|---|---|
| **Growth hub page** (`/growth`) | New route + page stitching existing tools; no DB work |
| **Person detail page** (admin view) | New route `/people/:id`; uses existing `profiles` data |
| **Kanban/pipeline view in CRM** | New UI component; existing `follow_up_status` maps to columns |
| **Follow-up pulse Dashboard widget** | New query on `contact_follow_ups` + `contacts`; no schema change |
| **Quick-add modal** | New modal shell; connects to existing form logic |
| **Grouped sidebar navigation** | Restructure `Sidebar.tsx`; no backend change |
| **Fixed bottom mobile nav** | Replace `Navigation.tsx` drawer with bottom tab bar |
| **Meeting detail page** | New route `/meetings/:id`; `Meeting` type has all fields; minutes/decisions would need schema (see below) |
| **People list as richer page** | Refactor `Members.tsx` with cards + more filters |

### Genuine schema gaps (minor, optional)

| Gap | Schema change |
|---|---|
| Meeting minutes / notes | Currently only `description`; a `meeting_notes` text column on `meetings` or a separate `meeting_minutes` table would enable the prototype's "minutes ready" pattern |
| Meeting decisions + action items | Not in current schema; could add a `meeting_action_items` table (id, meeting_id, body, assignee, due_date, completed) |
| Member note / leader notes | No free-text notes on `profiles`; a `member_notes` table (id, profile_id, author_id, body, created_at) would support person detail |

**Recommendation:** defer all schema additions to Phase 6 (Meetings) when the meeting detail UX is built. Don't add columns to satisfy mock data.

---

## 5. Components That Can Be Reused

### Foundation (keep as-is or minimal tweak)
- `Badge` — already flexible
- `Button` — already flexible  
- `Card` — already has `hoverable`; add a `section` variant
- `Input` — already good
- `Modal` — already good
- `Tag` — already good

### Feature (keep as-is)
- `StatCard`, `EventCard`, `AnnouncementCard`, `ActivityFeed`
- `BookWidget`, `DevotionalCard`, `HabitCard`, `ConfessionCard`
- `WeeklyMessageCard`, `TestimonyCard`, `TestimonyComments`, `TestimonyForm`
- `MeetingCard`, `MeetingForm`, `ZoomMeetingForm`
- `ContactCard`, `ContactFilters`, `ContactForm`, `ContactTable`
- `BulkImportModal`, `ReassignContactModal`, `MoveToCellModal`
- `DrivePreview`, `DriveLinkInput`
- `PushNotificationSettings`, `PushPermissionPrompt`, `PWAInstallBanner`
- `GlobalSearch`
- `ProfileForm`

### Layout (refactor, not replace)
- `Sidebar` — restructure nav groups, keep collapse logic
- `Navigation` — replace drawer with bottom tab bar pattern
- `Header` — minor tweaks for top-bar search placement
- `MainLayout` — likely minimal changes

### New components to build
- `GrowthHub` (new page)
- `PeopleList` (refactor of Members)
- `PersonDetail` (new page)
- `KanbanBoard` / `PipelineColumn` / `PipelineCard` (new CRM view)
- `FollowUpPulseCard` (new Dashboard widget)
- `QuickAddModal` (new global modal)
- `MeetingDetail` (new page, Phase 6)

---

## 6. Backend Changes Required

### None for Phases 1–5
All data needed for Dashboard, People, Outreach, Events, and Growth already exists in the database and is already queryable via existing hooks.

### Minor additions for Phase 6 (Meetings detail)
If meeting minutes and action items are implemented:
```sql
-- Optional: add to meetings table
ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS notes text;

-- Optional: meeting action items
CREATE TABLE IF NOT EXISTS public.meeting_action_items (
  id          uuid primary key default gen_random_uuid(),
  meeting_id  uuid not null references public.meetings(id) on delete cascade,
  body        text not null,
  assignee_id uuid references public.profiles(id),
  due_date    date,
  completed   boolean not null default false,
  created_by  uuid not null references public.profiles(id),
  created_at  timestamptz not null default now()
);
```
These are additive and backwards-compatible. No existing query breaks.

### Optional for Phase 3 (People detail)
```sql
CREATE TABLE IF NOT EXISTS public.member_notes (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  author_id   uuid not null references public.profiles(id),
  body        text not null,
  created_at  timestamptz not null default now()
);
```
Only needed if leaders need to add private notes to member profiles.

### No changes to
- `profiles`, `cells`, `contacts`, `meetings`, `events`, `habits`, `testimonies`, `confessions`, `weekly_messages`, `books_of_month`, `monthly_devotionals`, `admission_role` tables — all used as-is.

---

## 7. Proposed Phased Migration

### Phase 1 — Design System + App Shell
**Scope:** Restructure sidebar navigation, add section groupings, add mobile bottom nav, add Quick-Add modal shell.  
**No pages migrate yet.** All existing routes still work.  
Changes:
- `Sidebar.tsx`: add `navgroup` sections matching prototype IA (Overview, Ministry, Manage), reduce top-level items to 7 primary destinations, move growth tools under a single "Growth" entry
- `Navigation.tsx`: replace mobile drawer with fixed 5-tab bottom nav (Home, People, Outreach, Meetings, Growth)
- `App.tsx`: add `/growth` route (initially renders existing devotional list as placeholder)
- Quick-add `QuickAddModal` component wired to `+ Quick add` button in top bar

### Phase 2 — Dashboard
**Scope:** Refactor `Dashboard.tsx` to be action-oriented.  
Changes:
- Add **Follow-up pulse** widget (query on `contact_follow_ups` where `status='active'` + overdue)
- Improve stat cards to use prototype's delta pattern (already partially there)
- Add **Quick actions** panel (Log contact, Schedule meeting, Testimony, New event)
- Make cards navigable (clicking "Needs Follow-Up" stat → `/contacts?status=active`)
- Keep existing devotional, habits, events, meetings, activity feed widgets

### Phase 3 — People
**Scope:** Refactor `Members.tsx` → `PeopleList`, add `PersonDetail` page.  
Changes:
- Richer member cards/table (avatar initial, role badge, cell, joined date, status)
- Filters: role, cell, active/pending, search
- `/people/:id` route with `PersonDetail` page (overview, contact info, follow-up history from existing data)
- Keep existing `Members` route as alias during transition

### Phase 4 — Outreach CRM
**Scope:** Add Kanban view toggle to `ContactLogging.tsx`.  
Changes:
- `PipelineBoard` component: 3 columns mapped from `follow_up_status` values
- Toggle between table view (existing) and pipeline view (new)
- Preserve all existing filtering, assignment, and audit logic

### Phase 5 — Events
**Scope:** Enhance `Events.tsx` — minimal.  
Changes:
- Improve event cards to match prototype's date-box pattern (already partially done by `EventCard.tsx`)
- Show RSVP count on event cards
- Keep existing RSVP logic

### Phase 6 — Meetings
**Scope:** Refactor `Meetings.tsx` to card hub layout + optional meeting detail page.  
Changes:
- Card-based layout for upcoming/past meetings (existing `MeetingCard` can be extended)
- Meeting detail route `/meetings/:id`
- Optional: add `notes` column to meetings table; add `meeting_action_items` table

### Phase 7 — Growth Hub
**Scope:** Build the `/growth` hub page.  
Changes:
- New `Growth.tsx` page with summary cards for each tool
- Cards navigate to existing pages (habit streak, devotional streak, current book progress)
- Data from existing hooks: `useHabits`, `useDevotional`, `useBookOfMonth`
- No schema changes

### Phase 8 — Admin Centre
**Scope:** Refactor `AdminPanel.tsx` to match prototype's grouped card layout.  
Changes:
- Group admin cards: Approvals, Roles, Reports & Exports, Email, Zoom, Data
- Badge counts on Pending Approvals card (live count)
- Keep all existing sub-route navigation

### Phase 9 — Mobile & UX Hardening
**Scope:** End-to-end mobile testing and fixes across all migrated views.

### Phase 10 — Cleanup
**Scope:** Remove superseded components and dead routes after migration is verified.

---

## 8. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Navigation restructure breaks familiarity** — existing users know where everything is | Medium | Keep all existing routes working during migration; don't remove old nav items until new ones are verified |
| **"Growth" route conflicts with existing spiritual growth pages** — users may get confused | Low | Growth hub is a new `/growth` aggregator; all sub-routes (`/devotionals`, `/habits`, etc.) remain intact |
| **Kanban view maps status strings that are user-configurable** — the `status_settings` table is editable by coordinators | Medium | Pipeline columns should be derived from the live `status_settings` table, not hardcoded |
| **`Members.tsx` is leaders-only** — if People page expands to all roles there's a permission gap | High | Keep role guard; members see only themselves; leaders+ see directory |
| **Profile page duplication** — `/profile` (`Profile.tsx`) and a `UserProfile.tsx` route exist | Low | Consolidate to one during Phase 3 |
| **Announcements has no prototype page** — risk of losing feature visibility | Low | Surface announcements on Dashboard sidebar card (already exists); keep `/announcements` route |
| **AdminPanel access check is frontend-only** — `if (!['admin', 'coordinator', 'cell_leader'].includes(user?.role))` returns null; RLS is the real gate | Low | Maintain this pattern; don't weaken |
| **`buildAuthUser` reads role from `user_metadata`** — if role is updated in `profiles` but not synced to user_metadata, stale role displayed | Medium | Already known technical debt; document but don't touch during migration |
| **react-scripts (CRA) is in maintenance mode** — build tooling debt | Low | Out of scope for this migration; document and defer |

---

## 9. Recommended First Implementation Slice

**Start with Phase 1 (Design System + App Shell) — specifically the sidebar restructure.**

This is the highest-leverage first step because:
1. It establishes the new IA for all subsequent phases.
2. It requires no data model changes.
3. All existing routes continue to function — no regression risk.
4. It makes the prototype navigation immediately visible to users.
5. It gives a clear visual signal that the migration is underway.

**Concrete first slice:**
1. Restructure `Sidebar.tsx` nav items into three groups: **Overview**, **Ministry**, **Manage**.
2. Add a single **Growth** nav item pointing to a new `/growth` stub page (renders current devotional cards as placeholder).
3. Replace `Navigation.tsx` mobile drawer with a 5-tab bottom nav bar.
4. Wire the `+ Quick add` button in the top bar to a `QuickAddModal` with tabs for Contact / Meeting / Event.
5. Commit as: `feat: add ministry hub design system and shell`.

Everything else in the prototype builds on top of this foundation.

---

## Appendix: File Index

```
src/
  App.tsx                          — Route tree, AppShell
  types/index.ts                   — All TS types
  lib/
    auth.ts                        — Auth functions, AuthUser type, role permissions
    permissions.ts                 — AdminPermissionKey list
    supabase.ts                    — Supabase client
    queries.ts                     — Main query functions
    queries/
      contacts.ts                  — CRM queries (export, audit log)
      meetings.ts                  — Meeting queries
      confessions.ts               — Confession queries
      habits.ts                    — Habit queries
      weeklyMessages.ts            — Message queries
      books.ts                     — Book of month queries
      adminRoles.ts                — Role management queries
      reports.ts                   — Report/analytics queries
      testimonies.ts               — Testimony queries
      search.ts                    — Global search
      pushNotifications.ts         — Push notification queries
      zoomMeetings.ts              — Zoom API queries
  hooks/                           — All useXxx hooks
  components/
    foundation/                    — Badge, Button, Card, Input, Modal, Tag
    feature/                       — All feature components (see §5)
    layout/                        — MainLayout, Sidebar, Header, Navigation, ProtectedRoute
  pages/                           — 27 page components (see §1)
  i18n/                            — Localisation
  db/                              — SQL schema and migration files

tailwind.config.js                 — york colour scale, custom type scale, spacing, radius, shadow
```
