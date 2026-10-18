// Website Management permission catalogue and built-in roles (Phase D1 section 5). Client-side mirror only.
// The database is the authority: every write is checked server-side by web_has_permission (migrations after 103, not yet
// created). These constants drive which controls are shown. They never grant access on their own.
//
// Website permissions are deliberately separate from the Hub's existing admin permissions (src/lib/permissions.ts in the
// private Hub). Nothing here reads or extends the Hub's profiles.role, admin_roles or admin_role_permissions.

export const WEBSITE_PERMISSIONS = [
  'website.pages.edit',
  'website.pages.publish',
  'website.blog.edit',
  'website.blog.publish',
  'website.events.manage',
  'website.events.publish',
  'website.rhapsody.manage',
  'website.rhapsody.publish',
  'website.media.upload',
  'website.media.manage',
  'website.navigation.edit',
  'website.settings.edit',
  'website.settings.publish',
  'website.analytics.view',
  'website.submissions.review',
  'website.roles.manage',
] as const;

export type WebsitePermission = (typeof WEBSITE_PERMISSIONS)[number];

export const PERMISSION_GROUPS: Record<string, WebsitePermission[]> = {
  Pages: ['website.pages.edit', 'website.pages.publish'],
  Blog: ['website.blog.edit', 'website.blog.publish'],
  Events: ['website.events.manage', 'website.events.publish'],
  Rhapsody: ['website.rhapsody.manage', 'website.rhapsody.publish'],
  Media: ['website.media.upload', 'website.media.manage'],
  Navigation: ['website.navigation.edit'],
  Settings: ['website.settings.edit', 'website.settings.publish'],
  Analytics: ['website.analytics.view'],
  Submissions: ['website.submissions.review'],
  'People and roles': ['website.roles.manage'],
};

export const PERMISSION_LABELS: Record<WebsitePermission, string> = {
  'website.pages.edit': 'Edit pages and sections (drafts)',
  'website.pages.publish': 'Publish or roll back pages',
  'website.blog.edit': 'Create and edit blog drafts',
  'website.blog.publish': 'Publish, schedule, archive or roll back posts',
  'website.events.manage': 'Choose and edit public events',
  'website.events.publish': 'Make an event public or withdraw it',
  'website.rhapsody.manage': 'Create and edit Rhapsody editions and PDFs',
  'website.rhapsody.publish': 'Publish or archive editions (needs an authorizer)',
  'website.media.upload': 'Upload images and PDFs',
  'website.media.manage': 'Edit alt text, archive or replace media',
  'website.navigation.edit': 'Edit menus and links',
  'website.settings.edit': 'Edit identity, contact, service times, socials, footer and SEO',
  'website.settings.publish': 'Publish settings changes',
  'website.analytics.view': 'View aggregated download and visitor analytics',
  'website.submissions.review': 'Review public inquiries and prayer requests',
  'website.roles.manage': 'Create, assign and revoke website roles (inert in phase 1)',
};

export interface BuiltInRole {
  id: string;
  name: string;
  description: string;
  grants: readonly WebsitePermission[];
}

const CONTENT_EDIT: WebsitePermission[] = [
  'website.pages.edit', 'website.blog.edit', 'website.events.manage', 'website.rhapsody.manage',
  'website.media.upload', 'website.media.manage', 'website.navigation.edit',
];

// Mirrors Phase D1 section 5.3. Website Administrator holds every content permission but not website.roles.manage,
// because role management is limited to core Hub administrators in phase 1.
export const BUILT_IN_ROLES: readonly BuiltInRole[] = [
  {
    id: 'website-administrator',
    name: 'Website Administrator',
    description: 'Runs the public website: all content, navigation, settings, analytics and submissions. Cannot manage roles.',
    grants: [
      ...CONTENT_EDIT, 'website.pages.publish', 'website.blog.publish', 'website.events.publish',
      'website.rhapsody.publish', 'website.settings.edit', 'website.settings.publish',
      'website.analytics.view', 'website.submissions.review',
    ],
  },
  {
    id: 'website-editor',
    name: 'Website Editor',
    description: 'Edits pages, blog, events, Rhapsody, media and menus. Cannot publish anything.',
    grants: [...CONTENT_EDIT],
  },
  {
    id: 'website-publisher',
    name: 'Website Publisher',
    description: 'Edits and publishes pages, blog posts, events, Rhapsody editions and settings.',
    grants: [
      'website.pages.edit', 'website.pages.publish', 'website.blog.edit', 'website.blog.publish',
      'website.events.manage', 'website.events.publish', 'website.rhapsody.manage', 'website.rhapsody.publish',
      'website.media.upload', 'website.settings.publish',
    ],
  },
  {
    id: 'website-contributor',
    name: 'Website Contributor',
    description: 'Writes blog drafts and uploads media. Cannot publish.',
    grants: ['website.blog.edit', 'website.media.upload'],
  },
  {
    id: 'website-analyst',
    name: 'Website Analyst',
    description: 'Reads aggregated analytics only. No content or personal data.',
    grants: ['website.analytics.view'],
  },
];

export function isWebsitePermission(value: string): value is WebsitePermission {
  return (WEBSITE_PERMISSIONS as readonly string[]).includes(value);
}

/** Union of grants from a set of roles. Unknown keys are dropped, so a custom role cannot smuggle a permission in. */
export function grantsFor(roles: readonly BuiltInRole[]): Set<WebsitePermission> {
  const out = new Set<WebsitePermission>();
  for (const role of roles) for (const key of role.grants) if (isWebsitePermission(key)) out.add(key);
  return out;
}

/** Client-side convenience check. Never used as the security boundary. */
export function can(granted: ReadonlySet<WebsitePermission>, key: WebsitePermission): boolean {
  return granted.has(key);
}
