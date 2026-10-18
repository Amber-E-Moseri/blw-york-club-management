import {
  announcementExcerpt,
  announcementTargetUrl,
  buildAnnouncementDeliveryLogRows,
  buildAnnouncementPushPayload,
} from '../../supabase/functions/_shared/announcement-notification';

const announcement = {
  id: 'a1',
  title: 'Midweek prayer moves online',
  body: 'Starting Oct 22, midweek prayer will meet on Zoom at 7:00 PM.',
};

describe('buildAnnouncementPushPayload', () => {
  it('builds the notification the active service worker shows, with the announcement route under data', () => {
    expect(JSON.parse(buildAnnouncementPushPayload(announcement))).toEqual({
      title: 'Announcement: Midweek prayer moves online',
      body: 'Starting Oct 22, midweek prayer will meet on Zoom at 7:00 PM.',
      tag: 'announcement-a1',
      data: {
        url: '/announcements?id=a1',
        type: 'announcement',
        id: 'a1',
      },
    });
  });

  it('shortens long announcement text for the notification body', () => {
    const long = { ...announcement, body: 'word '.repeat(100) };
    const body = JSON.parse(buildAnnouncementPushPayload(long)).body as string;
    expect(body.length).toBe(120);
    expect(body.endsWith('…')).toBe(true);
  });
});

describe('announcementExcerpt', () => {
  it('collapses whitespace and leaves short text alone', () => {
    expect(announcementExcerpt('  Line one\n\nline   two ')).toBe('Line one line two');
  });
});

describe('announcementTargetUrl', () => {
  it('encodes the id so it cannot change the path', () => {
    expect(announcementTargetUrl('a/b?c')).toBe('/announcements?id=a%2Fb%3Fc');
  });
});

describe('buildAnnouncementDeliveryLogRows', () => {
  it('writes one row per member, marked sent if any device received it', () => {
    const rows = buildAnnouncementDeliveryLogRows(announcement, [
      { endpointId: 'd1', userId: 'u1', status: 'failed', error: 'timeout' },
      { endpointId: 'd2', userId: 'u1', status: 'sent', error: null },
      { endpointId: 'd3', userId: 'u2', status: 'expired', error: 'Subscription gone (410)' },
    ] as Array<{ endpointId: string; userId: string; status: 'sent' | 'failed' | 'expired'; error: string | null }>);

    expect(rows).toEqual([
      {
        user_id: 'u1',
        notification_type: 'announcement',
        title: 'Announcement: Midweek prayer moves online',
        body: 'Starting Oct 22, midweek prayer will meet on Zoom at 7:00 PM.',
        target_url: '/announcements?id=a1',
        status: 'sent',
        error_message: null,
      },
      {
        user_id: 'u2',
        notification_type: 'announcement',
        title: 'Announcement: Midweek prayer moves online',
        body: 'Starting Oct 22, midweek prayer will meet on Zoom at 7:00 PM.',
        target_url: '/announcements?id=a1',
        status: 'failed',
        error_message: 'Subscription gone (410)',
      },
    ]);
  });
});
