import type { Announcement } from '../types';

// Client-side rules for announcements. The database is the authority: the announcements_insert, _update and _delete
// policies (migration 043) decide every write, and each request is checked again there. These helpers only decide
// what the UI shows, so the controls match what the database will accept.

export const ANNOUNCEMENT_PAGE_SIZE = 20;

const POSTING_ROLES = ['admin', 'coordinator', 'cell_leader'];

/** The signed-in user, as far as announcement rules need it. */
export interface AnnouncementActor {
  id: string;
  role: string;
  status: string;
}

/** Create a post: admins, coordinators and active cell leaders. Pending, rejected and inactive accounts cannot. */
export function canPostAnnouncements(actor: AnnouncementActor | null | undefined): boolean {
  return !!actor && actor.status === 'active' && POSTING_ROLES.includes(actor.role);
}

/**
 * Edit or delete one post. Admins and coordinators may change any post. An active cell leader may change only the
 * posts they wrote. Mirrors the announcements_update and announcements_delete policies.
 */
export function canChangeAnnouncement(
  actor: AnnouncementActor | null | undefined,
  announcement: Pick<Announcement, 'author_id'>
): boolean {
  if (!canPostAnnouncements(actor) || !actor) return false;
  if (actor.role === 'cell_leader') return announcement.author_id === actor.id;
  return true;
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
