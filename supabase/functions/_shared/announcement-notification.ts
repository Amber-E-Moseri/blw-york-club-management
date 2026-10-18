// Pure logic for notify-announcement. No Deno or network imports, so it can be unit tested under Jest.

export interface NotifiableAnnouncement {
  id: string;
  title: string;
  body: string;
}

// Same shape as DeliveryOutcome in event-notification.ts. Declared here so this module has no imports.
interface DeliveryOutcome {
  userId: string;
  status: 'sent' | 'failed' | 'expired';
  error: string | null;
}

const MAX_BODY_LENGTH = 120;

/** The route a member lands on when they tap the notification. */
export function announcementTargetUrl(announcementId: string): string {
  return `/announcements?id=${encodeURIComponent(announcementId)}`;
}

/** Collapses whitespace and shortens long announcement text for a notification body. */
export function announcementExcerpt(body: string): string {
  const oneLine = body.replace(/\s+/g, ' ').trim();
  return oneLine.length > MAX_BODY_LENGTH ? `${oneLine.slice(0, MAX_BODY_LENGTH - 1)}…` : oneLine;
}

/**
 * The JSON body the service worker shows. The active worker (public/service-worker.js) reads
 * title, body and data.url, so the route lives under `data`.
 */
export function buildAnnouncementPushPayload(announcement: NotifiableAnnouncement): string {
  return JSON.stringify({
    title: `Announcement: ${announcement.title}`,
    body: announcementExcerpt(announcement.body),
    tag: `announcement-${announcement.id}`,
    data: {
      url: announcementTargetUrl(announcement.id),
      type: 'announcement',
      id: announcement.id,
    },
  });
}

/** One log row per member: 'sent' if any of their devices received it. */
export function buildAnnouncementDeliveryLogRows(
  announcement: NotifiableAnnouncement,
  outcomes: DeliveryOutcome[]
): Array<{
  user_id: string;
  notification_type: 'announcement';
  title: string;
  body: string;
  target_url: string;
  status: 'sent' | 'failed';
  error_message: string | null;
}> {
  const byUser = new Map<string, { sent: boolean; error: string | null }>();
  for (const outcome of outcomes) {
    const current = byUser.get(outcome.userId) ?? { sent: false, error: null };
    if (outcome.status === 'sent') current.sent = true;
    if (outcome.error) current.error = outcome.error;
    byUser.set(outcome.userId, current);
  }

  return Array.from(byUser.entries()).map(([userId, result]) => ({
    user_id: userId,
    notification_type: 'announcement',
    title: `Announcement: ${announcement.title}`,
    body: announcementExcerpt(announcement.body),
    target_url: announcementTargetUrl(announcement.id),
    status: result.sent ? 'sent' : 'failed',
    error_message: result.sent ? null : result.error,
  }));
}
