import {
  ANNOUNCEMENT_PAGE_SIZE,
  appendUniqueAnnouncements,
  canChangeAnnouncement,
  canPostAnnouncements,
  cursorAfter,
  removeAnnouncement,
  replaceAnnouncement,
  type AnnouncementActor,
} from '../lib/announcementRules';
import type { Announcement } from '../types';

const SPEC = '00000000-0000-4000-8000-00000000f001';

function announcement(n: number, overrides: Partial<Announcement> = {}): Announcement {
  // Newer rows get larger timestamps, so the list reads newest first when sorted descending.
  const created = new Date(Date.UTC(2026, 8, 1) + n * 60_000).toISOString();
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    title: `Title ${n}`,
    body: `Body ${n}`,
    author_id: 'author-1',
    author_name: 'Jordan Leader',
    created_at: created,
    audience_spec_id: null,
    ...overrides,
  };
}

const ADMIN: AnnouncementActor = { id: 'admin-1', role: 'admin', status: 'active' };
const COORDINATOR: AnnouncementActor = { id: 'coord-1', role: 'coordinator', status: 'active' };
const LEADER: AnnouncementActor = { id: 'leader-1', role: 'cell_leader', status: 'active' };
const OTHER_LEADER: AnnouncementActor = { id: 'leader-2', role: 'cell_leader', status: 'active' };
const MEMBER: AnnouncementActor = { id: 'member-1', role: 'member', status: 'active' };
const PENDING_ADMIN: AnnouncementActor = { id: 'admin-2', role: 'admin', status: 'pending' };
const INACTIVE_LEADER: AnnouncementActor = { id: 'leader-1', role: 'cell_leader', status: 'inactive' };
const REJECTED_LEADER: AnnouncementActor = { id: 'leader-1', role: 'cell_leader', status: 'rejected' };

describe('canPostAnnouncements', () => {
  it.each([ADMIN, COORDINATOR, LEADER])('allows an active %p to post', (actor) => {
    expect(canPostAnnouncements(actor)).toBe(true);
  });

  it.each([MEMBER, PENDING_ADMIN, INACTIVE_LEADER, REJECTED_LEADER])('denies %p', (actor) => {
    expect(canPostAnnouncements(actor)).toBe(false);
  });

  it('denies a signed-out visitor', () => {
    expect(canPostAnnouncements(null)).toBe(false);
    expect(canPostAnnouncements(undefined)).toBe(false);
  });
});

describe('canChangeAnnouncement', () => {
  const broadcastByAdmin = announcement(1, { author_id: ADMIN.id, audience_spec_id: null });
  const targetedByAdmin = announcement(2, { author_id: ADMIN.id, audience_spec_id: SPEC });
  const targetedByLeader = announcement(3, { author_id: LEADER.id, audience_spec_id: SPEC });
  const broadcastByLeader = announcement(4, { author_id: LEADER.id, audience_spec_id: null });

  it('lets an admin and a coordinator change any post, broadcast or targeted', () => {
    for (const post of [broadcastByAdmin, targetedByAdmin, targetedByLeader, broadcastByLeader]) {
      expect(canChangeAnnouncement(ADMIN, post)).toBe(true);
      expect(canChangeAnnouncement(COORDINATOR, post)).toBe(true);
    }
  });

  it('lets an active cell leader change only their own targeted posts', () => {
    expect(canChangeAnnouncement(LEADER, targetedByLeader)).toBe(true);
    expect(canChangeAnnouncement(LEADER, targetedByAdmin)).toBe(false);
  });

  it('keeps broadcasts staff-only, even for a leader who wrote one', () => {
    expect(canChangeAnnouncement(LEADER, broadcastByLeader)).toBe(false);
    expect(canChangeAnnouncement(LEADER, broadcastByAdmin)).toBe(false);
  });

  it('does not let one leader change another leader’s post', () => {
    expect(canChangeAnnouncement(OTHER_LEADER, targetedByLeader)).toBe(false);
  });

  it('denies members any change, even to a post they wrote', () => {
    expect(canChangeAnnouncement(MEMBER, announcement(5, { author_id: MEMBER.id, audience_spec_id: SPEC }))).toBe(false);
  });

  it('denies pending, rejected and inactive accounts, even on their own targeted post', () => {
    expect(canChangeAnnouncement(PENDING_ADMIN, targetedByAdmin)).toBe(false);
    expect(canChangeAnnouncement(INACTIVE_LEADER, targetedByLeader)).toBe(false);
    expect(canChangeAnnouncement(REJECTED_LEADER, targetedByLeader)).toBe(false);
  });

  it('denies a signed-out visitor', () => {
    expect(canChangeAnnouncement(null, targetedByLeader)).toBe(false);
  });
});

describe('cursorAfter', () => {
  it('returns undefined for an empty list', () => {
    expect(cursorAfter([])).toBeUndefined();
  });

  it('points at the last row shown', () => {
    const items = [announcement(3), announcement(2), announcement(1)];
    expect(cursorAfter(items)).toEqual({ created_at: items[2].created_at, id: items[2].id });
  });
});

describe('appendUniqueAnnouncements', () => {
  it('appends new rows in order and drops ids already shown', () => {
    const merged = appendUniqueAnnouncements([announcement(3), announcement(2)], [announcement(2), announcement(1)]);
    expect(merged.map((a) => a.id)).toEqual([announcement(3).id, announcement(2).id, announcement(1).id]);
  });

  it('drops a repeated id inside the incoming page too', () => {
    const merged = appendUniqueAnnouncements([], [announcement(2), announcement(2), announcement(1)]);
    expect(merged.map((a) => a.id)).toEqual([announcement(2).id, announcement(1).id]);
  });
});

describe('replaceAnnouncement', () => {
  it('replaces only the matching row, and keeps the audience of the row it replaces', () => {
    const list = [announcement(3), announcement(2, { audience_spec_id: SPEC }), announcement(1)];
    const edited = { ...announcement(2, { audience_spec_id: SPEC }), title: 'Edited', body: 'New body' };
    const next = replaceAnnouncement(list, edited);

    expect(next[1]).toEqual(edited);
    expect(next[1].audience_spec_id).toBe(SPEC);
    expect(next[0]).toBe(list[0]);
    expect(next[2]).toBe(list[2]);
  });

  it('leaves the list unchanged when the id is not present', () => {
    const list = [announcement(1)];
    expect(replaceAnnouncement(list, announcement(9))).toEqual(list);
  });
});

describe('removeAnnouncement', () => {
  it('removes only the selected row', () => {
    const list = [announcement(3), announcement(2), announcement(1)];
    expect(removeAnnouncement(list, announcement(2).id).map((a) => a.id)).toEqual([announcement(3).id, announcement(1).id]);
  });
});

describe('keyset pagination contract', () => {
  // Same rule as the database filter in getAnnouncementsPage: rows strictly after the cursor in (created_at desc, id desc).
  function fetchPage(all: Announcement[], after: ReturnType<typeof cursorAfter>, limit: number) {
    const sorted = [...all].sort((a, b) =>
      a.created_at === b.created_at ? (a.id < b.id ? 1 : -1) : a.created_at < b.created_at ? 1 : -1
    );
    const eligible = after
      ? sorted.filter((row) => row.created_at < after.created_at || (row.created_at === after.created_at && row.id < after.id))
      : sorted;
    const rows = eligible.slice(0, limit + 1);
    return { items: rows.slice(0, limit), hasMore: rows.length > limit };
  }

  it('walks every row once across pages, with no gaps or duplicates', () => {
    const all = Array.from({ length: 45 }, (_, i) => announcement(i + 1));
    let page = fetchPage(all, undefined, ANNOUNCEMENT_PAGE_SIZE);
    let list = appendUniqueAnnouncements([], page.items);
    let pages = 1;
    while (page.hasMore) {
      page = fetchPage(all, cursorAfter(list), ANNOUNCEMENT_PAGE_SIZE);
      list = appendUniqueAnnouncements(list, page.items);
      pages += 1;
    }

    expect(pages).toBe(3);
    expect(new Set(list.map((a) => a.id)).size).toBe(45);
    expect(list.map((a) => a.id)).toEqual([...all].reverse().map((a) => a.id));
  });

  it('separates rows that share a timestamp by id', () => {
    const same = '2026-09-01T10:00:00.000Z';
    const all = [1, 2, 3].map((n) => announcement(n, { created_at: same }));
    const first = fetchPage(all, undefined, 2);
    const second = fetchPage(all, cursorAfter(first.items), 2);

    expect(first.items.map((a) => a.id)).toEqual([announcement(3).id, announcement(2).id]);
    expect(second.items.map((a) => a.id)).toEqual([announcement(1).id]);
    expect(second.hasMore).toBe(false);
  });
});
