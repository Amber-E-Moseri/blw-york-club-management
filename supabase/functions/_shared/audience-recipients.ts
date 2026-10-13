// Decides HOW an event's recipients are found. Pure, no I/O, so it can be unit-tested in Jest.
//
// Rules (fail closed):
//   * A spec, when present, governs the event. It is never ignored.
//   * Only spec-less 'all' is a fellowship-wide broadcast. Only spec-less 'meeting' uses meeting attendance.
//   * Anything else (an unknown audience, or a targeted audience with no spec) throws. It never falls back to
//     "every active member". That fallback is what this module exists to prevent.

export type EventAudienceRoute =
  | { kind: 'broadcast' }
  | { kind: 'meeting'; meetingId: string }
  | { kind: 'targeted'; contentId: string };

export interface EventAudienceFields {
  id: string;
  audience: string;
  audience_spec_id: string | null;
  audience_meeting_id: string | null;
}

export class AudienceRouteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AudienceRouteError';
  }
}

export function routeEventAudience(event: EventAudienceFields): EventAudienceRoute {
  if (event.audience_spec_id !== null && event.audience_spec_id !== undefined) {
    return { kind: 'targeted', contentId: event.id };
  }
  if (event.audience === 'all') {
    return { kind: 'broadcast' };
  }
  if (event.audience === 'meeting') {
    if (!event.audience_meeting_id) {
      throw new AudienceRouteError('Event has a meeting audience but no meeting. Not sent.');
    }
    return { kind: 'meeting', meetingId: event.audience_meeting_id };
  }
  throw new AudienceRouteError(
    `Event audience "${event.audience}" has no audience specification. Not sent, to avoid a fellowship-wide broadcast.`,
  );
}
