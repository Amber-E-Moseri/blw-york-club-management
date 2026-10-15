# Event notifications and calendar links

## What happens when an event is saved

1. An admin or coordinator saves an event and chooses an audience:
   - **All active members**, or
   - **People assigned to a meeting**: the people on that meeting's `meeting_attendances`, filtered to active accounts.
2. If "Send a push notification when saved" is ticked, the app calls the `notify-event` edge function.
3. `notify-event` checks the caller is an active admin or coordinator, claims the event (`events.notified_at`) so it
   can only be sent once, resolves recipients on the server, and sends one Web Push per active subscription.
4. Each member gets one row in `push_notification_log` (`notification_type = 'event'`). A browser that rejects the
   subscription (HTTP 404 or 410) is marked inactive in `push_subscriptions`.

If the push fails, the event stays saved and the form reports the failure. Re-saving the form would duplicate the event,
so retry is not offered there.

## Calendar links

Each event card on the Events page has two links:

- **Add to Google Calendar** opens a pre-filled Google Calendar event.
- **Add to Apple / Outlook (.ics)** downloads an `.ics` file. Apple Calendar and Outlook open it directly.

Event times are read as `America/Toronto` (`APP_TIME_ZONE` in `src/lib/calendar.ts`). Events without a time are all-day.
Timed events default to one hour long.

## Configuration

Client (build time):

| Variable | Notes |
| --- | --- |
| `REACT_APP_VAPID_PUBLIC_KEY` | Already used for subscribing. Must match the server key below. |

Edge function secrets (set with `supabase secrets set`, or in `supabase/functions/.env` locally):

| Variable | Notes |
| --- | --- |
| `VAPID_PUBLIC_KEY` | Same value as `REACT_APP_VAPID_PUBLIC_KEY`. |
| `VAPID_PRIVATE_KEY` | Keep secret. Generate both keys with `node scripts/generate-vapid-keys.js`. |
| `VAPID_SUBJECT` | A `mailto:` or `https:` contact URL, for example `mailto:office@example.org`. |

Without these, `notify-event` returns HTTP 500 "Push notifications are not configured" and the event is still saved.

## Not covered

- Meetings do not have calendar links yet. The same helpers in `src/lib/calendar.ts` could be used for them.
- Members can only receive pushes after they have enabled notifications on their device.
