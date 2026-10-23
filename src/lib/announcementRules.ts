import type { Announcement } from '../types';

// Client-side rules for announcements. The database is the authority: RLS policy announcements_manage
// (migration 031) decides who can insert, update and delete. These helpers only decide what the UI shows
// and how the list is kept in order.

export const ANNOUNCEMENT_PAGE_SIZE = 20;

const MANAGING_ROLES = ['admin', 'coordinator', 'cell_leader'];

/** Roles that see the edit and delete controls. Mirrors announcements_manage; RLS still applies to each request. */
export function canManageAnnouncements(role: string | null | undefined): boolean {
  return !!role && MANAGING_ROLES.includes(role);
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
