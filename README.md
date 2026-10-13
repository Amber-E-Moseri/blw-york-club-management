# BLW York Hub

The ministry operating hub for the BLW York campus: one place for member onboarding and approval, outreach follow-up, cells, spiritual-growth tools, events, meetings and communications.

Built with React, TypeScript and Supabase. Row-level security and a repeatable certification suite are part of the project, but see [Status](#status) before treating any gate as production-certified.

---

## What it does

| Area | What members and leaders can do |
|---|---|
| **Members** | Sign up, wait for admin approval, manage a profile, browse the directory (by role and cell) |
| **Cells** | Coordinators and admins manage cells and move members between them under server-side safeguards |
| **Outreach** | Log contacts, tag them, assign follow-ups, track a pipeline, view an audit trail of changes |
| **Growth** | Read monthly devotionals, track habits, log daily confessions, share testimonies, follow the book of the month and weekly messages, and daily affirmations |
| **Events** | Create events with audience targeting, RSVP, send reminders and calendar links |
| **Meetings** | Record meetings, agenda items, invitations and attendance, with Zoom link and attendance integration |
| **Tasks and assignments** | Assign work to members and track their progress |
| **Communications** | Announcements, targeted messages with an inbox, email (templates, composer, scheduling, unsubscribe) and web push notifications |
| **Admin** | Pending approvals, roles and fine-grained permissions, reports, CSV exports, email log, Zoom settings |

### Roles

The app has four roles: `admin`, `coordinator`, `cell_leader` and `member`. Admins can also grant individual permissions (for example `contacts.view_all`, `testimonies.approve`, `reports.generate`, `integrations.manage`). New accounts stay in a pending state until an admin approves them. The full capability table is in [docs/blw-authorization-matrix.md](docs/blw-authorization-matrix.md).

---

## Tech stack

| Layer | Choice |
|---|---|
| UI | React 18, TypeScript, React Router 6 |
| Styling | Tailwind CSS 3 (York red theme), dark mode |
| Data and auth | Supabase (PostgreSQL, Auth, Storage, Edge Functions) |
| Email | Supabase Edge Function → Vercel serverless relay (`api/email-relay.ts`) → Gmail SMTP via Nodemailer |
| Push | Web Push (VAPID), PWA with service worker |
| Charts and dates | Recharts, date-fns |
| Tests | Jest and React Testing Library, Playwright, SQL and Node certification scripts |
| Hosting | Vercel (static build plus serverless function) |

### How email flows

```
App ──► Edge Function (send-email) ──► Vercel /api/email-relay ──► Gmail SMTP
              │                              (shared-secret auth)
              └─► email_log / scheduled_emails (Postgres)
```

The Gmail credentials exist only on Vercel. The relay rejects any request without the shared secret. Unsubscribe links are signed inside the `unsubscribe` Edge Function, so no signing key ever reaches the browser.

---

## Getting started

**Prerequisites:** Node 20+ for the app (CI runs Node 22 for the certification job), a Supabase project or the Supabase CLI for a local stack, and a Vercel project if you want email.

```bash
npm install
cp .env.example .env     # then fill in the values below
npm start                # http://localhost:3000
```

### Environment variables

**Browser** (`.env`; every `REACT_APP_*` value is public in the built bundle), taken from `.env.example`:

| Variable | Purpose |
|---|---|
| `REACT_APP_SUPABASE_URL` | Supabase project URL |
| `REACT_APP_SUPABASE_ANON_KEY` | Supabase anon key (safe to expose; protected by RLS) |
| `REACT_APP_PUBLIC_APP_URL` | Public site URL, used in links |
| `REACT_APP_VAPID_PUBLIC_KEY` | Web Push public key (`node scripts/generate-vapid-keys.js`) |
| `REACT_APP_GOOGLE_DRIVE_API_KEY`, `REACT_APP_GOOGLE_DRIVE_UPLOAD_ENDPOINT` | Optional, for Drive previews and uploads |
| `REACT_APP_SENTRY_DSN` | Optional error reporting |

**Vercel** (dashboard, never `.env`): `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `EMAIL_RELAY_SECRET`

**Supabase Edge Function secrets** (Dashboard → Edge Functions → Secrets): `EMAIL_RELAY_URL`, `EMAIL_RELAY_SECRET` (same value as Vercel), `EMAIL_FROM`, `EMAIL_CRON_SECRET`, `UNSUBSCRIBE_SECRET`, `VAPID_PRIVATE_KEY`, plus Zoom credentials. See [docs/email-setup.md](docs/email-setup.md).

> Never put a server secret in a `REACT_APP_*` variable. Create React App bundles all of them into the client.

### Database

`supabase/migrations/` (000 → 087) is the **only** place the schema changes. Apply it in order:

```bash
npx supabase db push              # hosted project
npx supabase db reset --local     # local stack, replays everything from empty
```

Read [docs/database-and-identity.md](docs/database-and-identity.md) before writing a migration. It covers the identity model (everything keys on `user_id`), privilege rules and migration conventions.

---

## Development commands

| Command | Purpose |
|---|---|
| `npm start` | Dev server on port 3000 |
| `npm run build` | Production build into `build/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Jest unit and contract tests with coverage |
| `npm run e2e` | Playwright end-to-end specs in `e2e/` |
| `npm run e2e:ui` | Playwright UI mode |

---

## Project structure

```
src/
├── components/
│   ├── cells/         # Cell administration components
│   ├── dashboard/     # Dashboard cards and sections
│   ├── feature/       # Domain components (ContactTable, EventCard, MeetingForm, …)
│   ├── foundation/    # Button, Card, Input, Badge, Modal, Tag
│   ├── layout/        # MainLayout, Sidebar, Header, Navigation, ProtectedRoute
│   └── people/        # Member directory and detail panel
├── pages/             # One file per route
├── hooks/             # Data and UI hooks (useAuth, useAffirmations, useBookOfMonth, …)
├── lib/
│   ├── audience/      # Shared audience selection and resolution
│   ├── cells/         # Cell administration logic
│   ├── communications/ # Messaging and announcements
│   ├── email/         # Templates, composer, send service
│   ├── queries/       # Typed Supabase query modules, one per domain
│   ├── tasks/         # Assignments and task progress
│   ├── zoom/          # Zoom integration
│   ├── csv/           # Contact import
│   ├── permissions.ts # Admin permission catalogue
│   ├── pushPrompt.ts  # Push permission prompt helpers
│   └── supabase.ts    # Client
├── types/             # Shared TypeScript types
├── i18n/              # Locale strings
└── __tests__/         # Unit and contract tests
api/
└── email-relay.ts     # Vercel function: authenticated Gmail SMTP relay
supabase/
├── migrations/        # Numbered, idempotent SQL (000 → 087)
├── functions/         # send-email, process-scheduled-emails, notify-event,
│                      # dispatch-message, unsubscribe, _shared
└── verification/      # Release certification suite (see Testing)
e2e/                   # Playwright specs
docs/                  # Current architecture, data model, authorization, deployment and security docs
docs/archive/          # Superseded prototype notes, branch migration notes and round-by-round release reports
scripts/               # Local and release certification runners, VAPID key generator, seed script
```

---

## Routes

| Route | Page |
|---|---|
| `/` | Dashboard |
| `/members` | Member directory |
| `/cells` | Cell administration |
| `/contacts` | Outreach CRM |
| `/growth` | Growth hub |
| `/devotionals`, `/habits`, `/testimonies`, `/books`, `/messages`, `/affirmations` | Growth tools |
| `/tasks` | Assignments and tasks |
| `/events` | Events and RSVPs |
| `/meetings` | Meetings hub |
| `/announcements`, `/communications` | Announcements and targeted communications |
| `/profile`, `/email-preferences` | Account settings |
| `/admin` | Admin hub, with `/admin/pending`, `/admin/roles`, `/admin/devotionals`, `/admin/testimonies`, `/admin/reports`, `/admin/contact-reports`, `/admin/exports`, `/admin/email-log`, `/admin/zoom` |

---

## Database overview

Tables are listed in the reviewed schema contract (`supabase/verification/schema_contract.json`). Every table has RLS enabled, `anon` has no access, and `authenticated` privileges are granted explicitly rather than by default.

| Domain | Tables |
|---|---|
| Identity and access | `profiles`, `user_profiles`, `memberships`, `membership_transitions`, `admin_roles`, `admin_role_assignments`, `admin_role_permissions`, `admin_bootstrap_audit`, `member_status_audit`, `staff_profile_edit_audit` |
| People, cells and outreach | `people`, `cells`, `cell_admin_audit`, `member_cell_audit`, `fellowships`, `bscs`, `bsc_assignment_audit`, `leadership_release_audit`, `assignments`, `attendance_imports`, `attendance_member_matches`, `contacts`, `contact_tags`, `contact_follow_ups`, `contact_audit_log`, `tags_settings`, `status_settings` |
| Audience and saved groups | `audience_specs`, `audience_snapshots`, `audience_publications`, `saved_groups`, `saved_group_members` |
| Events and meetings | `events`, `event_rsvps`, `meetings`, `meeting_attendances`, `zoom_settings`, `zoom_attendance` |
| Growth | `monthly_devotionals`, `devotional_daily_pages`, `devotional_views`, `habit_templates`, `habit_entries`, `confessions`, `confession_declarations`, `testimonies`, `testimony_comments`, `testimony_reactions`, `prayer_requests`, `books_of_month`, `weekly_messages` |
| Foundation school | `foundation_school_classes`, `foundation_school_enrollments`, `foundation_school_progress` |
| Integrations | `drive_link_metadata` |
| Communications | `announcements`, `communication_messages`, `communication_recipients`, `communication_deliveries`, `communication_audit`, `email_log`, `email_drafts`, `email_templates`, `email_notification_log`, `email_preferences`, `scheduled_emails`, `push_subscriptions`, `push_notification_log` |

The data model is in [docs/blw-data-model.md](docs/blw-data-model.md).

---

## Testing

```bash
npm test          # Jest unit and contract tests (run in CI)
npm run e2e       # Playwright end-to-end
npm run e2e:ui    # Playwright UI mode
```

The Jest suite is heavy on security contracts: authorization, identity, approval flow, schema, email relay and export logic.

**Release certification** is a separate, stricter layer that runs against a *local* Supabase stack with fake data. It replays every migration from empty, compares the schema against the contract and a golden fingerprint, and exercises auth, authorization, email and push, storage and Edge Function security with real accounts. The harnesses refuse to run against anything but localhost. The entry point is `scripts/certify-local.sh`, and the step-by-step runbook is [supabase/verification/README.md](supabase/verification/README.md). CI runs this on pull requests in a separate `certification` job.

---

## Deployment

1. Create a fresh Supabase project and apply all migrations.
2. Configure Auth redirect URLs, Storage and Edge Function secrets.
3. Deploy the Edge Functions: `npx supabase functions deploy`.
4. Deploy to Vercel: build command `npm run build`, output directory `build`. `vercel.json` already contains the SPA rewrite and the `/api` passthrough.
5. Bootstrap the first administrator.

The full runbook, including cutover and rollback, is [docs/clean-production-deployment.md](docs/clean-production-deployment.md).

---

## Feature notes

- **Global search:** `Ctrl+K` / `Cmd+K`.
- **Approval gate:** new members cannot reach the hub until an admin approves them.
- **PWA:** installable, with an install banner and push permission prompt.
- **Theme:** light and dark; the choice is stored in `localStorage` under `blw-theme`.
- **Brand colors:** `york-600 #E31837` (primary), `york-700 #C11628` (hover), `york-100 #FFEBEB` (badges), `red-light #F5E9EA` (active nav background).

---

## Status

This README describes what the code and migrations on the branch contain. It does not by itself claim production certification. Certification results are recorded in the reports under `docs/`, and the active gate is the certification job in CI.

---

## Documentation index

| Doc | Topic |
|---|---|
| [docs/blw-authorization-matrix.md](docs/blw-authorization-matrix.md) | Who can do what |
| [docs/database-and-identity.md](docs/database-and-identity.md) | Identity model, privileges, migration rules |
| [docs/blw-data-model.md](docs/blw-data-model.md) | Tables and relationships |
| [docs/blw-state-authority.md](docs/blw-state-authority.md) | Where each piece of state lives |
| [docs/audience-shared-contract.md](docs/audience-shared-contract.md) | Shared audience contract (reconciled) |
| [docs/audience-reconcile-certification.md](docs/audience-reconcile-certification.md) | Audience reconciliation certification report |
| [docs/ops-shared-contracts.md](docs/ops-shared-contracts.md) | Operational workstream shared contracts |
| [docs/cell-admin-schema-requirements.md](docs/cell-admin-schema-requirements.md) | Cell administration schema requirements and status |
| [docs/event-notifications.md](docs/event-notifications.md) | Event notifications and calendar links |
| [docs/notification-deployment.md](docs/notification-deployment.md) | Event notification production deployment runbook |
| [docs/email-setup.md](docs/email-setup.md) | Gmail relay and Edge Function setup |
| [docs/clean-production-deployment.md](docs/clean-production-deployment.md) | Production build, cutover, rollback |
| [docs/blw-v2-product-map.md](docs/blw-v2-product-map.md) | Product scope |
| [docs/blw-react-migration-plan.md](docs/blw-react-migration-plan.md) | React and Supabase migration plan |
| [docs/ops-cert-phase2-report.md](docs/ops-cert-phase2-report.md) | Phase 2 operational database certification report |
| [docs/security/SECURITY_REMEDIATION_REPORT.md](docs/security/SECURITY_REMEDIATION_REPORT.md) | Security findings F-1 to F-5, remediation and re-certification |
| [supabase/verification/README.md](supabase/verification/README.md) | Release certification runbook |

Superseded prototype notes, one-off branch migration notes and round-by-round release reports, with their raw run logs and golden JSON evidence, are kept under [docs/archive/](docs/archive/).
