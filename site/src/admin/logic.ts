// Pure logic for the Website Management dashboard. No React, no network, no storage. Each function is unit-tested.
import type { WebsitePermission } from './permissions';

// ---------- Navigation (visibility is a convenience; the server refuses unauthorized actions)

export interface AdminNavItem {
  id: string;
  label: string;
  path: string;
  /** Show when the caller holds ANY of these. Empty means always visible to signed-in website staff. */
  anyOf: readonly WebsitePermission[];
}

export const ADMIN_NAV: readonly AdminNavItem[] = [
  { id: 'home', label: 'Home', path: '/admin', anyOf: [] },
  { id: 'pages', label: 'Pages', path: '/admin/pages', anyOf: ['website.pages.edit', 'website.pages.publish'] },
  { id: 'blog', label: 'Blog', path: '/admin/blog', anyOf: ['website.blog.edit', 'website.blog.publish'] },
  { id: 'events', label: 'Events', path: '/admin/events', anyOf: ['website.events.manage', 'website.events.publish'] },
  { id: 'rhapsody', label: 'Rhapsody', path: '/admin/rhapsody', anyOf: ['website.rhapsody.manage', 'website.rhapsody.publish'] },
  { id: 'media', label: 'Media', path: '/admin/media', anyOf: ['website.media.upload', 'website.media.manage'] },
  { id: 'navigation', label: 'Navigation', path: '/admin/navigation', anyOf: ['website.navigation.edit'] },
  { id: 'settings', label: 'Settings', path: '/admin/settings', anyOf: ['website.settings.edit', 'website.settings.publish'] },
  { id: 'submissions', label: 'Submissions', path: '/admin/submissions', anyOf: ['website.submissions.review'] },
  { id: 'analytics', label: 'Analytics', path: '/admin/analytics', anyOf: ['website.analytics.view'] },
  { id: 'people', label: 'People and roles', path: '/admin/people', anyOf: ['website.roles.manage'] },
];

export function visibleNav(granted: ReadonlySet<WebsitePermission>, items: readonly AdminNavItem[] = ADMIN_NAV): AdminNavItem[] {
  return items.filter((item) => item.anyOf.length === 0 || item.anyOf.some((k) => granted.has(k)));
}

/** Phone bottom bar: the first four visible sections in navigation order, plus "More" for any remaining ones. */
export function phoneTabs(granted: ReadonlySet<WebsitePermission>): { tabs: AdminNavItem[]; hasMore: boolean } {
  const visible = visibleNav(granted);
  const tabs = visible.slice(0, 4);
  const hasMore = visible.length > tabs.length;
  return { tabs, hasMore };
}

// ---------- Sections (ordering with a keyboard and touch alternative to drag)

export function moveItem<T>(list: readonly T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return [...list];
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function moveItemTo<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length || to < 0 || to >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

// ---------- Unsaved changes

/** Stable comparison that ignores key order, so an equal draft is never reported as changed. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export function isDirty(saved: unknown, draft: unknown): boolean {
  return stableStringify(saved) !== stableStringify(draft);
}

// ---------- Publish confirmation: a plain-language summary of what changes

export interface SectionState {
  id: string;
  title: string;
  visible: boolean;
}

export function summarizePublish(before: readonly SectionState[], after: readonly SectionState[]): string[] {
  const lines: string[] = [];
  const byId = new Map(before.map((s) => [s.id, s]));
  const afterIds = new Set(after.map((s) => s.id));
  for (const s of after) {
    const prev = byId.get(s.id);
    if (!prev) lines.push(`Adds the section "${s.title}".`);
    else if (prev.visible !== s.visible) lines.push(`${s.visible ? 'Shows' : 'Hides'} the section "${s.title}".`);
  }
  for (const s of before) if (!afterIds.has(s.id)) lines.push(`Removes the section "${s.title}".`);
  const beforeOrder = before.filter((s) => afterIds.has(s.id)).map((s) => s.id).join('|');
  const afterOrder = after.filter((s) => byId.has(s.id)).map((s) => s.id).join('|');
  if (beforeOrder !== afterOrder) lines.push('Changes the order of sections.');
  return lines;
}

// ---------- Device preview widths (the four target viewports)

export const PREVIEW_WIDTHS = { mobile: 375, tablet: 768, smallDesktop: 1024, desktop: 1440 } as const;
export type PreviewDevice = keyof typeof PREVIEW_WIDTHS;

// ---------- Scheduling: a publish time must be in the future (the server re-checks)

export function isFutureSchedule(scheduledFor: Date, now: Date): boolean {
  return scheduledFor.getTime() > now.getTime();
}
