// Pure logic for notify-event. No Deno or network imports, so it can be unit tested under Jest.

export interface NotifiableEvent {
  id: string;
  title: string;
  date: string;
  time: string | null;
  location: string | null;
}

export type DeliveryStatus = 'sent' | 'failed' | 'expired';

export interface DeliveryOutcome {
  userId: string;
  status: DeliveryStatus;
  error: string | null;
}

/** The JSON body the service worker shows. `url` is the route opened on click. */
export function buildEventPushPayload(event: NotifiableEvent): string {
  const when = [event.date, event.time ? `at ${event.time.slice(0, 5)}` : null].filter(Boolean).join(' ');
  const where = event.location ? ` · ${event.location}` : '';
  return JSON.stringify({
    title: `New event: ${event.title}`,
    body: `${when}${where}`,
    url: '/events',
    type: 'event',
    eventId: event.id,
  });
}

/** A browser that answers 404 or 410 no longer accepts this endpoint, so it is retired, not retried. */
export function classifyPushError(statusCode: number | undefined, message: string): {
  status: 'expired' | 'failed';
  error: string;
} {
  if (statusCode === 404 || statusCode === 410) {
    return { status: 'expired', error: `Subscription gone (${statusCode})` };
  }
  return { status: 'failed', error: message };
}

/** One log row per member: 'sent' if any of their devices received it. */
export function buildDeliveryLogRows(
  event: Pick<NotifiableEvent, 'title' | 'date' | 'location'>,
  outcomes: DeliveryOutcome[]
): Array<{
  user_id: string;
  notification_type: 'event';
  title: string;
  body: string;
  status: 'sent' | 'failed';
  response_data: { target_url: string; error: string | null };
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
    notification_type: 'event',
    title: `New event: ${event.title}`,
    body: `${event.date}${event.location ? ` · ${event.location}` : ''}`,
    status: result.sent ? 'sent' : 'failed',
    response_data: { target_url: '/events', error: result.sent ? null : result.error },
  }));
}
