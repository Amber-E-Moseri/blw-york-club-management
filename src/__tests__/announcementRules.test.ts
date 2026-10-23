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

const ADMIN: AnnouncementActor = { id: 'admin-1', role: 'admin', status: 'active' };
const COORDINATOR: AnnouncementActor = { id: 'coord-1', role: 'coordinator', status: 'active' };
const LEADER: AnnouncementActor = { id: 'leader-1', role: 'cell_leader', status: 'active' };
const MEMBER: AnnouncementActor = { id: 'member-1', role: 'member', status: 'active' };
const PENDING_LEADER: AnnouncementActor = { id: 'leader-1', role: 'cell_leader', status: 'pending' };
const REJECTED_LEADER: AnnouncementActor = { id: 'leader-1', role: 'cell_leader', status: 'rejected' };
const INACTIVE_ADMIN: AnnouncementActor = { id: 'admin-1', role: 'admin', status: 'inactive' };

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
    ...overrides,
  };
}

describe('canPostAnnouncements', () => {
  it.each([ADMIN, COORDINATOR, LEADER])('allows an active %s to post', (actor) => {
    expect(canPostAnnouncements(actor)).toBe(true);
  });

  it.each([MEMBER, PENDING_LEADER, REJECTED_LEADER, INACTIVE_ADMIN])('denies %p', (actor) => {
    expect(canPostAnnouncements(actor)).toBe(false);
  });

  it('denies a signed-out user', () => {
    expect(canPostAnnouncements(null)).toBe(false);
    expect(canPostAnnouncements(undefined)).toBe(false);
  });
});

describe('canChangeAnnouncement', () => {
  const byLeader = { author_id: LEADER.id };
  const byAdmin = { author_id: ADMIN.id };

  it('lets admins and coordinators change any post', () => {
    expect(canChangeAnnouncement(ADMIN, byLeader)).toBe(true);
    expect(canChangeAnnouncement(COORDINATOR, byLeader)).toBe(true);
    expect(canChangeAnnouncement(COORDINATOR, byAdmin)).toBe(true);
  });

  it('lets an active cell leader change only their own posts', () => {
    expect(canChangeAnnouncement(LEADER, byLeader)).toBe(true);
    expect(canChangeAnnouncement(LEADER, byAdmin)).toBe(false);
  });

  it('denies members any change, even to their own post', () => {
    expect(canChangeAnnouncement(MEMBER, { author_id: MEMBER.id })).toBe(false);
    expect(canChangeAnnouncement(MEMBER, byLeader)).toBe(false);
  });

  it('denies pending, rejected and inactive accounts, even when they wrote the post', () => {
    expect(canChangeAnnouncement(PENDING_LEADER, byLeader)).toBe(false);
    expect(canChangeAnnouncement(REJECTED_LEADER, byLeader)).toBe(false);
    expect(canChangeAnnouncement(INACTIVE_ADMIN, byAdmin)).toBe(false);
  });

  it('denies a signed-out user', () => {
    expect(canChangeAnnouncement(null, byLeader)).toBe(false);
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
    const current = [announcement(3), announcement(2)];
    const incoming = [announcement(2), announcement(1)];
    const merged = appendUniqueAnnouncements(current, incoming);
    expect(merged.map((a) => a.id)).toEqual([announcement(3).id, announcement(2).id, announcement(1).id]);
  });

  it('drops a repeated id inside the incoming page too', () => {
    const merged = appendUniqueAnnouncements([], [announcement(2), announcement(2), announcement(1)]);
    expect(merged.map((a) => a.id)).toEqual([announcement(2).id, announcement(1).id]);
  });
});

describe('replaceAnnouncement', () => {
  it('replaces only the matching row and leaves the others as they were', () => {
    const list = [announcement(3), announcement(2), announcement(1)];
    const edited = { ...announcement(2), title: 'Edited', body: 'New body' };
    const next = replaceAnnouncement(list, edited);

    expect(next[1]).toEqual(edited);
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
    expect(removeAnnouncement(list, announcement(2).id).map((a) => a.id)).toEqual([
      announcement(3).id,
      announcement(1).id,
    ]);
  });
});

describe('keyset pagination contract', () => {
  // Same rule as the database filter in getAnnouncementsPage: rows strictly after the cursor in (created_at desc, id desc).
  function fetchPage(all: Announcement[], after: ReturnType<typeof cursorAfter>, limit: number) {
    const sorted = [...all].sort((a, b) =>
      a.created_at === b.created_at ? (a.id < b.id ? 1 : -1) : a.created_at < b.created_at ? 1 : -1
    );
    const eligible = after
      ? sorted.filter((row) =>
          row.created_at < after.created_at || (row.created_at === after.created_at && row.id < after.id)
        )
      : sorted;
    const rows = eligible.slice(0, limit + 1);
    return { items: rows.slice(0, limit), hasMore: rows.length > limit };
  }

  it('walks every row once across pages, with no gaps or duplicates', () => {
    const all = Array.from({ length: 45 }, (_, i) => announcement(i + 1));
    let list: Announcement[] = [];
    let page = fetchPage(all, undefined, ANNOUNCEMENT_PAGE_SIZE);
    list = appendUniqueAnnouncements(list, page.items);
    let pages = 1;
    while (page.hasMore) {
      page = fetchPage(all, cursorAfter(list), ANNOUNCEMENT_PAGE_SIZE);
      list = appendUniqueAnnouncements(list, page.items);
      pages += 1;
    }

    expect(pages).toBe(3);
    expect(list).toHaveLength(45);
    expect(new Set(list.map((a) => a.id)).size).toBe(45);
    expect(list.map((a) => a.id)).toEqual([...all].reverse().map((a) => a.id));
  });

  it('separates rows that share a timestamp by id', () => {
    const same = '2026-09-01T10:00:00.000Z';
    const all = [
      announcement(1, { created_at: same }),
      announcement(2, { created_at: same }),
      announcement(3, { created_at: same }),
    ];
    const first = fetchPage(all, undefined, 2);
    const second = fetchPage(all, cursorAfter(first.items), 2);

    expect(first.items.map((a) => a.id)).toEqual([announcement(3).id, announcement(2).id]);
    expect(second.items.map((a) => a.id)).toEqual([announcement(1).id]);
    expect(second.hasMore).toBe(false);
  });
});
