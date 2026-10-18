import { ADMIN_NAV, isFutureSchedule, moveItem, summarizePublish, visibleNav } from '../admin/logic';
import { BUILT_IN_ROLES, WEBSITE_PERMISSIONS, can, grantsFor, isWebsitePermission, type WebsitePermission } from '../admin/permissions';

const role = (id: string) => BUILT_IN_ROLES.find((r) => r.id === id)!;

describe('website permissions in the Hub', () => {
  it('a regular member with no website role has no website permissions', () => {
    expect(grantsFor([]).size).toBe(0);
    // Only the Home entry, which needs no permission, is visible without a role.
    expect(visibleNav(new Set<WebsitePermission>()).every((item) => item.anyOf.length === 0)).toBe(true);
  });

  it('ignores values that are not website permission keys', () => {
    expect(isWebsitePermission('website.pages.publish')).toBe(true);
    expect(isWebsitePermission('admin.everything')).toBe(false);
  });

  it('an editor can edit content but cannot publish pages', () => {
    const granted = grantsFor([role('website-editor')]);
    expect(can(granted, 'website.pages.edit')).toBe(true);
    expect(can(granted, 'website.pages.publish')).toBe(false);
  });

  it('every permission key in the catalogue is granted to some role or to none, never to an unknown key', () => {
    for (const r of BUILT_IN_ROLES) {
      for (const key of r.grants) expect(WEBSITE_PERMISSIONS).toContain(key);
    }
  });
});

describe('website navigation in the Hub', () => {
  it('every section lives under the Hub prefix /admin/website', () => {
    for (const item of ADMIN_NAV) expect(item.path === '/admin/website' || item.path.startsWith('/admin/website/')).toBe(true);
  });

  it('shows only sections the signed-in account may use', () => {
    const editorOnly = visibleNav(grantsFor([role('website-editor')]));
    expect(editorOnly.some((i) => i.id === 'pages')).toBe(true);
    expect(editorOnly.some((i) => i.id === 'people')).toBe(false);
  });
});

describe('publishing helpers', () => {
  it('moves a list item within bounds only', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
  });

  it('reports what a publish changes', () => {
    const before = [{ id: 'hero', title: 'Hero', visible: true }];
    const after = [{ id: 'hero', title: 'Hero', visible: false }];
    expect(summarizePublish(before, after).length).toBeGreaterThan(0);
  });

  it('treats a schedule in the future as future and a past one as not', () => {
    const now = new Date('2026-10-17T12:00:00Z');
    expect(isFutureSchedule(new Date('2026-10-18T12:00:00Z'), now)).toBe(true);
    expect(isFutureSchedule(new Date('2026-10-16T12:00:00Z'), now)).toBe(false);
  });
});
