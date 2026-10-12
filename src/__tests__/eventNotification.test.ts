import {
  buildDeliveryLogRows,
  buildEventPushPayload,
  classifyPushError,
} from '../../supabase/functions/_shared/event-notification';

const event = {
  id: 'e1',
  title: 'Bible Study',
  date: '2026-10-18',
  time: '19:00:00',
  location: 'Room 2',
};

describe('buildEventPushPayload', () => {
  it('builds the notification the service worker shows, with the events route', () => {
    expect(JSON.parse(buildEventPushPayload(event))).toEqual({
      title: 'New event: Bible Study',
      body: '2026-10-18 at 19:00 · Room 2',
      url: '/events',
      type: 'event',
      eventId: 'e1',
    });
  });

  it('omits the time and location when they are not set', () => {
    const body = JSON.parse(buildEventPushPayload({ ...event, time: null, location: null })).body;
    expect(body).toBe('2026-10-18');
  });
});

describe('classifyPushError', () => {
  it('retires an endpoint the browser has removed (404 or 410)', () => {
    expect(classifyPushError(410, 'Gone')).toEqual({ status: 'expired', error: 'Subscription gone (410)' });
    expect(classifyPushError(404, 'Not found')).toEqual({ status: 'expired', error: 'Subscription gone (404)' });
  });

  it('treats other errors as a failed delivery, keeping the message', () => {
    expect(classifyPushError(500, 'Push service unavailable')).toEqual({
      status: 'failed',
      error: 'Push service unavailable',
    });
    expect(classifyPushError(undefined, 'network down')).toEqual({ status: 'failed', error: 'network down' });
  });
});

describe('buildDeliveryLogRows', () => {
  it('writes one row per member, marked sent if any of their devices received it', () => {
    const rows = buildDeliveryLogRows(event, [
      { userId: 'u1', status: 'failed', error: 'timeout' },
      { userId: 'u1', status: 'sent', error: null },
      { userId: 'u2', status: 'expired', error: 'Subscription gone (410)' },
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.user_id === 'u1')).toMatchObject({
      status: 'sent',
      error_message: null,
      notification_type: 'event',
      target_url: '/events',
    });
    expect(rows.find((r) => r.user_id === 'u2')).toMatchObject({
      status: 'failed',
      error_message: 'Subscription gone (410)',
    });
  });

  it('returns no rows when nothing was attempted', () => {
    expect(buildDeliveryLogRows(event, [])).toEqual([]);
  });
});
