import type { Announcement } from '../types';

// Client-side rules for announcements on the authoritative line. The database is the authority: announcements_read
// (064, 075) decides what a caller may see, and announcements_manage (075, 082) decides every write. These helpers
// only decide what the UI offers, so the controls match what the database will accept.

export const ANNOUNCEMENT_PAGE_SIZE = 20;

/** The signed-in user, as the announcement rules need it. `role` is the effective role (see effectiveRole in auth). */
export interface AnnouncementActor {
  id: string;
  role: 'admin' | 'coordinator' | 'cell_leader' | 'member';
  status: 'pending' | 'active' | 'inactive' | 'rejected';
}

/** Post, and see the composer: an active admin, coordinator or cell leader. Mirrors the composer rule on the page. */
export function canPostAnnouncements(actor: AnnouncementActor | null | undefined): boolean {
  if (!actor || actor.status !== 'active') return false;
  return actor.role === 'admin' || actor.role === 'coordinator' || actor.role === 'cell_leader';
}

/**
 * Edit or delete one post. Mirrors announcements_manage (075):
 *   - admins and coordinators: any post, broadcast or targeted;
 *   - an active cell leader: only a post they wrote that is aimed at an audience. Broadcasts are staff-only.
 * The database also checks that the leader still leads the targeted cell. The page cannot see that, so the database
 * refusal is what the user sees in that case.
 */
export function canChangeAnnouncement(
  actor: AnnouncementActor | null | undefined,
  announcement: Pick<Announcement, 'author_id' | 'audience_spec_id'>
): boolean {
  if (!canPostAnnouncements(actor) || !actor) return false;
  if (actor.role === 'admin' || actor.role === 'coordinator') return true;
  return announcement.author_id === actor.id && announcement.audience_spec_id != null;
}

/** Keyset position: the last row shown. The next page starts strictly after it in (created_at, id) order. */
export interface AnnouncementCursor {
  created_at: string;
  id: string;
}

export function cursorAfter(items: Announcement[]): AnnouncementCursor | undefined {
  const last = items[items.length - 1];
  return last ? { created_at: last.created_at, id: last.id } : undefined;
}

/** Adds a fetched page to the list, keeping the first copy of any id already shown. */
export function appendUniqueAnnouncements(current: Announcement[], incoming: Announcement[]): Announcement[] {
  const seen = new Set(current.map((a) => a.id));
  const fresh: Announcement[] = [];
  for (const announcement of incoming) {
    if (seen.has(announcement.id)) continue;
    seen.add(announcement.id);
    fresh.push(announcement);
  }
  return [...current, ...fresh];
}

/** Replaces the one announcement with the same id. Every other row is returned untouched. */
export function replaceAnnouncement(list: Announcement[], updated: Announcement): Announcement[] {
  return list.map((a) => (a.id === updated.id ? updated : a));
}

export function removeAnnouncement(list: Announcement[], id: string): Announcement[] {
  return list.filter((a) => a.id !== id);
}
