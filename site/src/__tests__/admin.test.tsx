import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AdminLayout } from '../admin/AdminLayout';
import {
  BUILT_IN_ROLES,
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  WEBSITE_PERMISSIONS,
  grantsFor,
  isWebsitePermission,
  type WebsitePermission,
} from '../admin/permissions';
import {
  ADMIN_NAV,
  PREVIEW_WIDTHS,
  isDirty,
  isFutureSchedule,
  moveItem,
  moveItemTo,
  phoneTabs,
  stableStringify,
  summarizePublish,
  visibleNav,
} from '../admin/logic';

const role = (id: string) => BUILT_IN_ROLES.find((r) => r.id === id)!;
const granted = (...ids: string[]) => grantsFor(ids.map(role));

describe('website permission catalogue', () => {
  it('lists the sixteen permission keys from the approved design, each with a label and a group', () => {
    expect(WEBSITE_PERMISSIONS).toHaveLength(16);
    for (const key of WEBSITE_PERMISSIONS) {
      expect(PERMISSION_LABELS[key]).toBeTruthy();
    }
    const grouped = Object.values(PERMISSION_GROUPS).flat();
    expect([...grouped].sort()).toEqual([...WEBSITE_PERMISSIONS].sort());
  });

  it('rejects any key outside the catalogue', () => {
    expect(isWebsitePermission('website.roles.manage')).toBe(true);
    expect(isWebsitePermission('website.everything')).toBe(false);
    expect(isWebsitePermission('admin')).toBe(false);
  });
});

describe('built-in roles match Phase D1 section 5.3', () => {
  it('Website Administrator holds every content permission but not website.roles.manage', () => {
    const g = granted('website-administrator');
    expect(g.has('website.roles.manage')).toBe(false);
    for (const key of WEBSITE_PERMISSIONS.filter((k) => k !== 'website.roles.manage')) {
      expect(g.has(key), key).toBe(true);
    }
  });

  it('Website Editor edits content but cannot publish', () => {
    const g = granted('website-editor');
    expect(g.has('website.pages.edit')).toBe(true);
    expect(g.has('website.blog.edit')).toBe(true);
    expect(g.has('website.events.manage')).toBe(true);
    const publishKeys = [...g].filter((k) => k.endsWith('.publish'));
    expect(publishKeys).toEqual([]);
    expect(g.has('website.settings.edit')).toBe(false);
    expect(g.has('website.analytics.view')).toBe(false);
  });

  it('Website Publisher can publish each content type and settings', () => {
    const g = granted('website-publisher');
    for (const key of ['website.pages.publish', 'website.blog.publish', 'website.events.publish', 'website.rhapsody.publish', 'website.settings.publish'] as WebsitePermission[]) {
      expect(g.has(key), key).toBe(true);
    }
    expect(g.has('website.roles.manage')).toBe(false);
  });

  it('Website Contributor writes blog drafts and uploads media only', () => {
    const g = granted('website-contributor');
    expect([...g].sort()).toEqual(['website.blog.edit', 'website.media.upload']);
  });

  it('Website Analyst reads aggregated analytics only', () => {
    const g = granted('website-analyst');
    expect([...g]).toEqual(['website.analytics.view']);
    expect(g.has('website.submissions.review')).toBe(false);
  });

  it('no built-in role grants website.roles.manage (role management is core-admin only in phase 1)', () => {
    for (const r of BUILT_IN_ROLES) expect(r.grants).not.toContain('website.roles.manage');
  });

  it('unions roles and drops unknown keys, so a custom role cannot smuggle a permission in', () => {
    const forged = { id: 'x', name: 'x', description: '', grants: ['website.analytics.view', 'website.roles.manage ', 'website.everything'] as WebsitePermission[] };
    const g = grantsFor([role('website-contributor'), forged]);
    expect([...g].sort()).toEqual(['website.analytics.view', 'website.blog.edit', 'website.media.upload']);
  });
});

describe('navigation visibility (a convenience; the server decides)', () => {
  it('an analyst sees only Analytics', () => {
    expect(visibleNav(granted('website-analyst')).map((i) => i.id)).toEqual(['home', 'analytics']);
  });

  it('a contributor sees Blog and Media, not Settings or Submissions', () => {
    const ids = visibleNav(granted('website-contributor')).map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(['home', 'blog', 'media']));
    expect(ids).not.toContain('settings');
    expect(ids).not.toContain('submissions');
    expect(ids).not.toContain('people');
  });

  it('only a holder of website.roles.manage sees People and roles', () => {
    const withRoles = new Set<WebsitePermission>(['website.roles.manage']);
    expect(visibleNav(withRoles).map((i) => i.id)).toContain('people');
    expect(visibleNav(granted('website-administrator')).map((i) => i.id)).not.toContain('people');
  });

  it('phone tabs are at most four, and "More" appears when more items are visible', () => {
    const admin = phoneTabs(granted('website-administrator'));
    expect(admin.tabs.length).toBeLessThanOrEqual(4);
    expect(admin.hasMore).toBe(true);
    const analyst = phoneTabs(granted('website-analyst'));
    expect(analyst.tabs.map((i) => i.id)).toEqual(['home', 'analytics']);
    expect(analyst.hasMore).toBe(false);
  });

  it('every nav item points at an /admin path and has a unique id', () => {
    const ids = ADMIN_NAV.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of ADMIN_NAV) expect(item.path.startsWith('/admin')).toBe(true);
  });
});

describe('section ordering (keyboard and touch alternative to drag)', () => {
  const list = ['hero', 'events', 'blog', 'rhapsody'];

  it('moves an item up and down by one', () => {
    expect(moveItem(list, 1, -1)).toEqual(['events', 'hero', 'blog', 'rhapsody']);
    expect(moveItem(list, 1, 1)).toEqual(['hero', 'blog', 'events', 'rhapsody']);
  });

  it('does nothing at the top or bottom edge', () => {
    expect(moveItem(list, 0, -1)).toEqual(list);
    expect(moveItem(list, 3, 1)).toEqual(list);
    expect(moveItem(list, -1, 1)).toEqual(list);
  });

  it('moves to an explicit position for a drag-equivalent result', () => {
    expect(moveItemTo(list, 3, 0)).toEqual(['rhapsody', 'hero', 'events', 'blog']);
    expect(moveItemTo(list, 2, 2)).toEqual(list);
    expect(moveItemTo(list, 0, 9)).toEqual(list);
  });

  it('never mutates the input', () => {
    const copy = [...list];
    moveItem(list, 0, 1);
    moveItemTo(list, 0, 2);
    expect(list).toEqual(copy);
  });
});

describe('unsaved changes', () => {
  it('ignores key order so an equal draft is not reported as changed', () => {
    expect(isDirty({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 })).toBe(false);
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
  });

  it('detects a changed value, a changed order and a removed field', () => {
    expect(isDirty({ title: 'A' }, { title: 'B' })).toBe(true);
    expect(isDirty(['x', 'y'], ['y', 'x'])).toBe(true);
    expect(isDirty({ title: 'A', subtitle: 'S' }, { title: 'A' })).toBe(true);
  });
});

describe('publish confirmation summary', () => {
  const before = [
    { id: 'hero', title: 'Hero', visible: true },
    { id: 'events', title: 'Events', visible: true },
    { id: 'blog', title: 'Blog', visible: false },
  ];

  it('reports a hidden section, a shown section and a reorder in plain language', () => {
    const after = [
      { id: 'events', title: 'Events', visible: false },
      { id: 'hero', title: 'Hero', visible: true },
      { id: 'blog', title: 'Blog', visible: true },
    ];
    const lines = summarizePublish(before, after);
    expect(lines).toContain('Hides the section "Events".');
    expect(lines).toContain('Shows the section "Blog".');
    expect(lines).toContain('Changes the order of sections.');
  });

  it('reports additions and removals', () => {
    const after = [...before.slice(0, 2), { id: 'rhapsody', title: 'Rhapsody', visible: true }];
    const lines = summarizePublish(before, after);
    expect(lines).toContain('Removes the section "Blog".');
    expect(lines).toContain('Adds the section "Rhapsody".');
  });

  it('is empty when nothing changed', () => {
    expect(summarizePublish(before, before)).toEqual([]);
  });
});

describe('preview widths and scheduling', () => {
  it('uses the four target viewports', () => {
    expect(PREVIEW_WIDTHS).toEqual({ mobile: 375, tablet: 768, smallDesktop: 1024, desktop: 1440 });
  });

  it('accepts only a publish time in the future', () => {
    const now = new Date('2026-10-15T12:00:00Z');
    expect(isFutureSchedule(new Date('2026-10-15T12:00:01Z'), now)).toBe(true);
    expect(isFutureSchedule(new Date('2026-10-15T11:59:59Z'), now)).toBe(false);
    expect(isFutureSchedule(now, now)).toBe(false);
  });
});

describe('AdminLayout', () => {
  const renderWith = (perms: WebsitePermission[]) =>
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <AdminLayout granted={new Set(perms)}>
          <p>Dashboard body</p>
        </AdminLayout>
      </MemoryRouter>,
    );

  it('renders the content area and only the navigation the caller can use', () => {
    renderWith([...granted('website-analyst')]);
    expect(screen.getByText('Dashboard body')).toBeInTheDocument();
    const side = screen.getByRole('navigation', { name: 'Website sections' });
    expect(within(side).getByRole('link', { name: 'Analytics' })).toBeInTheDocument();
    expect(within(side).queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it('shows a More button on the phone bar when further sections exist, and it toggles', async () => {
    const user = userEvent.setup();
    renderWith([...granted('website-administrator')]);
    const more = screen.getByRole('button', { name: 'More' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await user.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    const sheet = document.getElementById('admin-more-sheet')!;
    expect(within(sheet).getByRole('link', { name: 'Settings' })).toBeInTheDocument();
    expect(within(sheet).queryByRole('link', { name: 'Blog' })).not.toBeInTheDocument();
  });

  it('shows no More button when there is nothing beyond the primary tabs', () => {
    renderWith([...granted('website-analyst')]);
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument();
  });
});
