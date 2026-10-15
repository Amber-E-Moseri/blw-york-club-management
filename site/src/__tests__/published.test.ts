import { describe, expect, it } from 'vitest';
import { sampleContent } from '../content/sample-data';
import { applyPublishedContent, eventsToSiteContent, isSafeHref, mergePublished, postsToSiteContent, unpublishedBase } from '../content/published';

const settings = (body: Record<string, unknown>) => ({ kind: 'settings' as const, key: 'site', body, versionNo: 1, publishedAt: '2026-10-01T00:00:00Z' });

describe('published settings', () => {
  it('applies published identity, contact and service fields', () => {
    const out = applyPublishedContent(sampleContent, [settings({ site_name: 'BLW York', tagline: 'Live well', contact_email: 'hi@blwyork.example', address_text: 'Keele', service_day: 'Sundays', service_time_text: '11:00 AM' })]);
    expect(out.settings).toMatchObject({ name: 'BLW York', tagline: 'Live well', email: 'hi@blwyork.example', address: 'Keele', serviceDay: 'Sundays', serviceTime: '11:00 AM' });
  });

  it('keeps the Foundation School link only when it is https', () => {
    const ok = applyPublishedContent(sampleContent, [settings({ site_name: 'X', foundation_enroll_url: 'https://rocksolidops.example/enroll' })]);
    expect(ok.settings.foundationEnrollUrl).toBe('https://rocksolidops.example/enroll');
    const bad = applyPublishedContent(sampleContent, [settings({ site_name: 'X', foundation_enroll_url: 'http://insecure.example/enrol' })]);
    expect(bad.settings.foundationEnrollUrl).toBe('');
  });

  it('drops social links that are not https and labels the rest', () => {
    const out = applyPublishedContent(sampleContent, [settings({ site_name: 'X', socials: ['https://instagram.example/blw', 'http://x.example/no', 'https://www.youtube.com/@blw'] })]);
    expect(out.settings.socials.map((s) => s.label)).toEqual(['Instagram', 'YouTube']);
  });
});

describe('published navigation', () => {
  it('drops unsafe menu links and keeps safe ones', () => {
    const out = applyPublishedContent(sampleContent, [{ kind: 'navigation', key: 'primary', versionNo: 1, publishedAt: 'x', body: { items: [
      { label: 'Home', href: '/' }, { label: 'Bad', href: 'javascript:alert(1)' }, { label: 'Ext', href: 'https://example.org' }, { label: 'Scheme', href: 'http://x.example' },
    ] } }]);
    expect(out.nav.map((n) => n.label)).toEqual(['Home', 'Ext']);
  });

  it('keeps the sample menu when nothing safe is published', () => {
    const out = applyPublishedContent(sampleContent, [{ kind: 'navigation', key: 'primary', versionNo: 1, publishedAt: 'x', body: { items: [{ label: 'Bad', href: 'javascript:x' }] } }]);
    expect(out.nav).toEqual(sampleContent.nav);
  });

  it('recognises only site routes, site paths and https links', () => {
    expect(isSafeHref('/about')).toBe(true);
    expect(isSafeHref('https://example.org/a')).toBe(true);
    expect(isSafeHref('javascript:alert(1)')).toBe(false);
    expect(isSafeHref('//evil.example')).toBe(false);
    expect(isSafeHref('https://user:pw@example.org')).toBe(false);
  });
});

describe('published home and Foundation School copy', () => {
  it('uses the published hero text for the home page', () => {
    const out = applyPublishedContent(sampleContent, [{ kind: 'page', key: 'home', versionNo: 2, publishedAt: 'x', body: { title: 'Home', sections: [{ type: 'hero', heading: 'Welcome home', body: 'We are glad you are here.', visible: true }] } }]);
    expect(out.home.headingLead).toBe('Welcome home');
    expect(out.home.body).toBe('We are glad you are here.');
    expect(out.home.headingAccent).toBe('');
  });

  it('ignores a hidden hero section', () => {
    const out = applyPublishedContent(sampleContent, [{ kind: 'page', key: 'home', versionNo: 2, publishedAt: 'x', body: { title: 'Home', sections: [{ type: 'hero', heading: 'Hidden', body: 'x', visible: false }] } }]);
    expect(out.home.headingLead).toBe(sampleContent.home.headingLead);
  });

  it('uses the published Foundation School title and intro', () => {
    const out = applyPublishedContent(sampleContent, [{ kind: 'page', key: 'foundation_school', versionNo: 1, publishedAt: 'x', body: { title: 'Build your foundation', sections: [{ type: 'text', heading: 'h', body: 'Intro text.', visible: true }] } }]);
    expect(out.foundationSchool.headline).toBe('Build your foundation');
    expect(out.foundationSchool.intro).toBe('Intro text.');
  });
});

describe('posts and events', () => {
  it('maps published posts into the blog shape with paragraphs and a reading time', () => {
    const [p] = postsToSiteContent([{ slug: 'a-post', title: 'A', excerpt: 'E', body: 'One.\n\nTwo words here.', category: 'Faith', authorDisplay: 'BLW York', publishedAt: '2026-10-02T09:00:00Z' }]);
    expect(p).toMatchObject({ slug: 'a-post', date: '2026-10-02', author: 'BLW York', paragraphs: ['One.', 'Two words here.'] });
    expect(p.readMinutes).toBeGreaterThanOrEqual(1);
  });

  it('maps events with a one-hour window and a safe registration link only', () => {
    const [e1, e2] = eventsToSiteContent([
      { slug: 'bible-study', title: 'Bible Study', summary: 'S', eventDate: '2026-11-12', eventTime: '18:30:00', location: 'Hall', category: 'Other', featured: true, registrationUrl: 'https://example.org/register' },
      { slug: 'open', title: 'Open', summary: 'S', eventDate: '2026-11-13', eventTime: null, location: null, category: null, featured: false, registrationUrl: 'javascript:alert(1)' },
    ]);
    expect(e1).toMatchObject({ start: '18:30', end: '19:30', venue: 'Hall', registrationUrl: 'https://example.org/register' });
    expect(e2.registrationUrl).toBe('');
    expect(e2.venue).toBe('Venue to be confirmed');
  });

  it('shows no sample records when nothing is published', () => {
    const merged = mergePublished(unpublishedBase(sampleContent), { content: [], posts: [], events: [] });
    expect(merged.posts).toEqual([]);
    expect(merged.events).toEqual([]);
    expect(merged.rhapsody).toEqual([]);
    expect(merged.about.leaders).toEqual([]);
    expect(merged.settings.isSample).toBe(false);
  });
});
