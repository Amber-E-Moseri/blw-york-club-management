# Mobile Daily Bread redesign — proposal (pre-approval)

Status: **design proposal only. No implementation. Awaiting mobile design approval.**
Branch: `feat/mobile-daily-bread-redesign` (from `main`). Nothing committed.

## 0. Blocking finding: the devotional body is an image

`devotional_daily_pages` (see `src/types/index.ts:556`) holds `image_url`, `page_range`, and an optional `title`. There is no text body, no scripture text, and no scripture-reference field. Each day's devotional is a JPG page scan rendered in `DevotionalCard` with `aspect-[2/1] object-contain`.

Consequences for the brief:

- Body typography, paragraph spacing, line height, and heading hierarchy (brief §2C) cannot be changed with CSS. They apply to the image's pixels, not to text.
- "Clear scripture reference" (brief §2A) can only show `Pages X–Y` from `page_range`, not the verse.
- "Do not change devotional content" rules out adding text by hand.

Options for the approval decision:

1. **Image-first (recommended for this PR):** redesign the frame around the image — full-bleed on mobile, larger tap-to-zoom, calmer chrome, better header and progress. Body typography is out of scope.
2. **Add text fields:** a migration plus content entry for body/scripture. This is a data and migration change, which the brief forbids for this PR. It would need a separate approved spec.

## 1. Current mobile UX problems (from code; screenshots pending, see §8)

| # | Where | Problem |
|---|---|---|
| 1 | `DevotionalCard.tsx` | Page image is a 2:1 letterboxed box with a border and shadow. On 320–430px the scanned text is tiny and the frame is visually heavy. |
| 2 | `DevotionalViewer.tsx` | Stack before the streak is six blocks: eyebrow, H1, date, optional Manage button, image, day nav, Mark-as-read, 3 action buttons, "Read today" card. The first screen is chrome, not the devotional's subject. |
| 3 | `DevotionalViewer.tsx:157–172` | "Read today N members" and "Progress day/total" card. "Progress" is the position in the devotional month, not the member's own progress. Its label collides with the streak. |
| 4 | `RorStreakBadge.tsx:60–78` | Four tiles at 2-up on mobile, values truncated (`truncate` on `text-lg`). Long values ("12 days") are at risk at 320px. |
| 5 | `RorCalendar.tsx:38–66` | Days render in a plain 7-column grid with no weekday headers and no leading offset. The 1st of the month lands in the first column whatever its weekday, so the calendar does not read as a calendar. |
| 6 | `RorCalendar.tsx:52` vs `:67–71` | Past unread days are labelled "missed" in aria but the legend says "Not yet read". The legend and the state are inconsistent. |
| 7 | `DevotionalViewer.tsx:175,184` | Streak section and calendar render only when `streak` is non-null. If the streak fetch fails, both vanish silently. `useRorStreak` returns an `error` the viewer never shows. |
| 8 | `useDevotional.ts:135–146` | `markAsRead` has `try/finally` with no `catch`. A failed write surfaces as an unhandled rejection and no error in the UI. |
| 9 | `DevotionalCard.tsx:113–124` | Mark-as-read is a good 48px target, but the only feedback is the text "Saving…". No spinner, no success moment beyond swapping the bar. Duplicate-tap protection relies on re-render timing. |
| 10 | `DevotionalViewer.tsx:99` inside `MainLayout` `<main overflow-y-auto>` | Nested scroll container. The viewer adds its own `overflow-y-auto` inside `main`'s. This conflicts with "avoid nested scrolling areas". |
| 11 | Mark-as-read location | The action is below the image and nav row. On a 390px screen it is probably below the fold, so users must scroll past the image to find it. Screenshot needed to confirm. |

## 2. Proposed mobile layout (<768px only)

Top to bottom:

1. **Identity row:** small "DAILY BREAD" label (York red, tracked caps) and the date on the right. No Manage button here. Admins get a menu item in the header instead.
2. **Title block:** `Day N` eyebrow, then the devotional title as H1. Subline: "Pages X–Y · Book title" (from `page_range`). The scripture-reference slot is reserved for when data exists (§0).
3. **Reading progress chip:** one line, "Day 12 of 31" with a 2px York-red bar. This replaces the separate "Progress" card.
4. **Page image:** full-bleed to the 16px gutter, no border, soft radius, `object-contain` on a neutral surface. Tap opens fullscreen. Keep the 2:1 aspect so layout doesn't shift while loading.
5. **Day nav:** slim row, prev/next at 44px, day label centred.
6. **Reading progress preview:** one compact card with current streak, longest, and this month "x / y". Below it, a "View reading progress" disclosure button (44px tall). Tapping expands the calendar in place. No new route (brief §3 — no demonstrated UX benefit).
7. **Mark as read:** sticky bottom bar above the bottom nav, respecting `safe-bottom`. Shown only while unread. Once read, it becomes a quiet "Read at 7:12 AM" line in place. A spacer at the end of the content keeps the sticky bar from covering the last lines. The bar uses a 48px target and a visible spinner while saving, with a `role="status"` confirmation.
8. **Share / Download / Fullscreen:** a single row of three 44px secondary buttons, below the image.

Calendar states (inside the disclosure):

- Real month grid: weekday headers (S M T W T F S), leading blanks for the 1st's weekday.
- Completed: filled York-red tint with a check glyph (not colour alone).
- Missed (past, unread): outlined, muted text.
- Today: ring.
- Upcoming: dimmed, no outline.
- Legend text matches the states exactly.

Dark mode: keep the existing slate tokens. Use the same red accents, with the lightness adjusted for contrast.

Motion: 150ms expand, fade on the sticky bar. Honour `prefers-reduced-motion` by removing transitions.

## 3. Mock-ups

Not produced yet. They need the before screenshots (§8) to be meaningful. I can build a before/after HTML mock-up as a follow-up once the layout direction is approved.

## 4. Branding alignment

- York red for accents (`york-600`/`york-300` tokens already used in nav, header, progress bar).
- Keep `rounded-2xl` cards and the existing `Button` / `DevotionalCard` primitives.
- Replace the current green completion treatment with a red-tinted confirmation, so green doesn't compete. Keep green only where it already means "done" in the calendar, if approved.
- No new fonts. Use the existing type scale plus mobile-specific sizes.

## 5. Components to modify

| File | Change | Desktop impact |
|---|---|---|
| `src/pages/DevotionalViewer.tsx` | Reorder mobile blocks; remove inline stats card on mobile; add disclosure; surface streak error | Gate with `md:` modifiers so desktop order stays |
| `src/components/feature/DevotionalCard.tsx` | Mobile frame (full-bleed, no border); mark-as-read sticky + spinner + error; actions row | Desktop classes unchanged |
| `src/components/feature/RorStreakBadge.tsx` | Add a `preview` variant (single row); keep the existing grid for desktop | Existing grid untouched |
| `src/components/feature/RorCalendar.tsx` | Weekday headers, leading offset, state model, legend fix | Shared with desktop: must be checked |
| `src/hooks/useRorStreak.ts` | **No change** in this PR (read-only use of `error`) | None |
| `src/components/layout/Navigation.tsx`, `MainLayout.tsx` | **No change**; sticky bar offset measured against the existing nav height | None |

New: none, unless the disclosure is extracted into a small `ReadingProgressSection` component.

## 6. Estimated developer-hours

| Work | Hours |
|---|---|
| Layout reorder and mobile frame | 3 |
| Sticky mark-as-read, spinner, error, double-submit guard | 3 |
| Streak preview row and disclosure | 3 |
| Calendar rework (weekday grid, states, legend) | 3 |
| Error and empty states, reduced motion, a11y pass | 1.5 |
| Verification: 320/375/390/430/768/1440 × light/dark, desktop before/after diff, Playwright tests | 3 |
| **Total** | **≈16.5 h (about 2 days)** |

Excludes §0 option 2 (text content and migration), which would be a separate, larger estimate.

## 7. Desktop preservation strategy

- Mobile-only changes go behind `md:` breakpoints or in mobile-only elements. Existing desktop classes stay as they are.
- Before any code change, capture desktop screenshots at 1024, 1280 and 1440 in light and dark. After the change, diff them pixel for pixel. Any diff outside the mobile breakpoint blocks merge.
- `RorCalendar` is shared with desktop. Its weekday fix must be checked at desktop widths too. If the desktop calendar currently has the same offset bug, fixing it would change desktop, which is out of scope. That needs a separate decision.
- No change to `useRorStreak`, `get_ror_streak`, RLS, or migrations.

## 8. Verification status — what is not done yet

Not done:

- **No before screenshots.** I have not started the dev server. `.env.local` points at Supabase project `yziuh…` and `.env` at `rjtst…`. I have not confirmed which is production. Reading production data is outside this task, so I have not used either.
- **Authenticated views need sign-in.** Streak, calendar and mark-as-read need a signed-in member. I can't sign in with your Google account. Those screens need a test member on a non-production project.
- **Date bugs not yet investigated.** Possible timezone off-by-one between `viewed_at` (stored in UTC) and the local day used for calendar cells. This is to be reported separately, not fixed here.
- **Migration 043 status not checked.** Not in scope for the visual PR; flagged per brief §7.

## 9. Decisions needed from you

1. Approve the layout in §2, or request changes.
2. Choose §0 option 1 (image-first) or option 2 (add text content, separate spec).
3. Which Supabase environment to use for screenshots (a dev project or a test member), since I won't touch production.
4. Whether to make the calendar weekday fix on desktop too, or keep it mobile-only.
