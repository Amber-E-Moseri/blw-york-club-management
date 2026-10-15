// Maps published website rows (from the public views) onto the SiteContent shape the public components already render.
// Anything not published keeps its sample value, so the site never shows an empty section. Unsafe links are dropped.
import type { PublicEditionRow, PublicEventRow, PublicPostRow, PublicContentRow } from '../api/websiteApi';
import type { BlogPost, NavItem, PublicEvent, RhapsodyEdition, SiteContent } from './types';
import { resolveBrand } from '../lib/brand';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ROUTES = ['/', '/about', '/events', '/rhapsody', '/foundation-school', '/blog', '/new-here', '/contact'];

export function isSafeHref(href: string): boolean {
  if (ROUTES.includes(href)) return true;
  if (/^\/[A-Za-z0-9/_\-]*$/.test(href)) return true;
  return /^https:\/\/[^\s@/]+(\/[^\s]*)?$/.test(href);
}

export function isSafeHttpsUrl(url: string): boolean {
  return /^https:\/\/[^\s@/:]+(\/[^\s]*)?$/.test(url);
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);

function firstSection(body: Record<string, unknown>, type: string): Record<string, unknown> | undefined {
  const sections = Array.isArray(body.sections) ? (body.sections as Record<string, unknown>[]) : [];
  return sections.find((s) => s.type === type && s.visible !== false);
}

/** Built from a published content row. Only the fields the public components render are read. */
export function applyPublishedContent(base: SiteContent, rows: PublicContentRow[]): SiteContent {
  let next: SiteContent = { ...base, settings: { ...base.settings }, home: { ...base.home }, foundationSchool: { ...base.foundationSchool } };
  for (const row of rows) {
    const b = row.body;
    if (row.kind === 'settings' && row.key === 'site') {
      const name = str(b.site_name);
      const socials = Array.isArray(b.socials)
        ? (b.socials as unknown[]).filter((u): u is string => typeof u === 'string' && isSafeHttpsUrl(u)).map((href) => ({ label: socialLabel(href), href }))
        : undefined;
      const enrol = str(b.foundation_enroll_url);
      next = {
        ...next,
        settings: {
          ...next.settings,
          name: name ?? next.settings.name,
          tagline: str(b.tagline) ?? next.settings.tagline,
          primaryColor: resolveBrand(b.primary_color),
          email: str(b.contact_email) ?? next.settings.email,
          address: str(b.address_text) ?? next.settings.address,
          serviceDay: str(b.service_day) ?? next.settings.serviceDay,
          serviceTime: str(b.service_time_text) ?? next.settings.serviceTime,
          socials: socials && socials.length ? socials : next.settings.socials,
          // An unsafe or empty link hides every enrolment button (the public site's existing rule).
          foundationEnrollUrl: enrol !== undefined && isSafeHttpsUrl(enrol) ? enrol : '',
        },
      };
    } else if (row.kind === 'navigation' && row.key === 'primary' && Array.isArray(b.items)) {
      const items: NavItem[] = (b.items as Record<string, unknown>[])
        .map((i) => ({ label: str(i.label) ?? '', path: str(i.href) ?? '' }))
        .filter((i) => i.label && isSafeHref(i.path));
      if (items.length) next = { ...next, nav: items };
    } else if (row.kind === 'page' && row.key === 'home') {
      const hero = firstSection(b, 'hero');
      next = {
        ...next,
        home: {
          ...next.home,
          headingLead: str(hero?.heading) ?? next.home.headingLead,
          headingAccent: '',
          headingTail: '',
          body: str(hero?.body) ?? next.home.body,
        },
      };
    } else if (row.kind === 'page' && row.key === 'foundation_school') {
      const text = firstSection(b, 'text');
      next = {
        ...next,
        foundationSchool: {
          ...next.foundationSchool,
          headline: str(b.title) ?? next.foundationSchool.headline,
          intro: str(text?.body) ?? next.foundationSchool.intro,
        },
      };
    }
  }
  return next;
}

function socialLabel(href: string): string {
  if (/instagram\./.test(href)) return 'Instagram';
  if (/youtube\./.test(href)) return 'YouTube';
  if (/tiktok\./.test(href)) return 'TikTok';
  if (/(^|\.)x\.com/.test(href) || /twitter\./.test(href)) return 'X';
  if (/facebook\./.test(href)) return 'Facebook';
  return 'Link';
}

export function postsToSiteContent(posts: PublicPostRow[]): BlogPost[] {
  return posts.map((p) => {
    const paragraphs = p.body.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
    const words = p.body.trim().split(/\s+/).filter(Boolean).length;
    return {
      slug: p.slug,
      title: p.title,
      category: p.category,
      date: p.publishedAt.slice(0, 10),
      readMinutes: Math.max(1, Math.round(words / 200)),
      author: p.authorDisplay,
      excerpt: p.excerpt,
      tags: [],
      paragraphs: paragraphs.length ? paragraphs : [p.excerpt],
    };
  });
}

export function eventsToSiteContent(events: PublicEventRow[]): PublicEvent[] {
  return events.map((e) => {
    const start = (e.eventTime ?? '10:00').slice(0, 5);
    const [h, m] = start.split(':').map(Number);
    const endH = Math.min(23, (h || 0) + 1);
    const end = `${String(endH).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}`;
    return {
      slug: e.slug,
      title: e.title,
      date: e.eventDate,
      start,
      end,
      venue: e.location ?? 'Venue to be confirmed',
      location: e.location ?? 'York University, Toronto, ON',
      summary: e.summary,
      body: e.summary,
      registrationUrl: e.registrationUrl && isSafeHttpsUrl(e.registrationUrl) ? e.registrationUrl : '',
      kind: 'gathering',
    };
  });
}

/**
 * Rhapsody editions from the published view. Their PDFs are private, so pdfPath stays empty until the signed-link
 * service exists. The reader then hides its PDF controls rather than showing a broken link.
 */
export function editionsToSiteContent(rows: PublicEditionRow[], pdfBase = ''): RhapsodyEdition[] {
  // The link goes through the delivery function, which issues a short-lived signed URL for each request.
  return rows.map((r) => ({
    slug: r.editionId,
    title: r.title,
    kind: r.kind === 'daily' ? 'Daily' : 'Monthly',
    period: r.periodStart,
    blurb: r.description,
    pdfPath: pdfBase && UUID.test(r.editionId) ? `${pdfBase}?edition=${r.editionId}` : '',
    authorizedBy: r.authorizedBy,
  }));
}

/**
 * The production base: the sample copy with every record removed. Nothing fictional (people, events, posts, dates,
 * contact details, links, the sample banner) survives into a connected site. Unpublished text sections keep their
 * approved copy until they are published, and that copy must be approved before launch.
 */
export function unpublishedBase(sample: SiteContent): SiteContent {
  return {
    ...sample,
    settings: {
      ...sample.settings,
      name: 'BLW York Hub',
      tagline: '',
      email: '',
      address: '',
      serviceDay: '',
      serviceTime: '',
      venue: '',
      socials: [],
      foundationEnrollUrl: '',
      isSample: false,
    },
    about: { ...sample.about, leaders: [] },
    events: [],
    posts: [],
    rhapsody: [],
  };
}

export interface PublishedBundle {
  content: PublicContentRow[];
  posts: PublicPostRow[];
  events: PublicEventRow[];
  editions?: PublicEditionRow[];
}

/** Combines the published rows with the production base. Lists come only from published rows, never from samples. */
export function mergePublished(base: SiteContent, published: PublishedBundle, options: { pdfBase?: string } = {}): SiteContent {
  const withContent = applyPublishedContent(base, published.content);
  return {
    ...withContent,
    settings: { ...withContent.settings, isSample: false },
    posts: postsToSiteContent(published.posts),
    events: eventsToSiteContent(published.events),
    rhapsody: editionsToSiteContent(published.editions ?? [], options.pdfBase ?? ''),
  };
}
