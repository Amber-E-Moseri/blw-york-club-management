import { useEffect, useState, type ReactNode } from 'react';
import type { ContentKind, ContentState, VersionRow, WebsiteApi } from '../api/websiteApi';
import { moveItem, moveItemTo, PREVIEW_WIDTHS, summarizePublish, type PreviewDevice, type SectionState } from './logic';
import { Button, ConfirmDialog, Card, errorMessage, Field, inputClass, Notice, PreviewFrame } from './common';
import type { WebsitePermission } from './permissions';

interface Ctx { api: WebsiteApi; perms: ReadonlySet<WebsitePermission> }

const PAGE_KEYS: Array<{ key: string; label: string }> = [
  { key: 'home', label: 'Home' }, { key: 'about', label: 'About' }, { key: 'what_we_do', label: 'What we do' },
  { key: 'foundation_school', label: 'Foundation School' }, { key: 'new_here', label: 'New Here?' }, { key: 'contact', label: 'Contact Us' },
];

const SECTION_TYPES = ['hero', 'text', 'cta', 'faq', 'contact_details', 'ministries', 'events', 'blog', 'rhapsody', 'foundation_cta', 'new_here_points'] as const;

interface Section { type: string; heading: string; body: string; url: string; visible: boolean }
interface PageDraft { title: string; seo_title: string; seo_description: string; visible: boolean; sections: Section[] }

function pageFrom(body: Record<string, unknown>): PageDraft {
  const sections = Array.isArray(body.sections) ? (body.sections as Record<string, unknown>[]) : [];
  return {
    title: String(body.title ?? ''), seo_title: String(body.seo_title ?? ''), seo_description: String(body.seo_description ?? ''),
    visible: body.visible !== false,
    sections: sections.map((s) => ({ type: String(s.type ?? 'text'), heading: String(s.heading ?? ''), body: String(s.body ?? ''), url: String(s.url ?? ''), visible: s.visible !== false })),
  };
}

function pageBody(d: PageDraft): Record<string, unknown> {
  return {
    title: d.title.trim(), seo_title: d.seo_title.trim(), seo_description: d.seo_description.trim(), visible: d.visible,
    sections: d.sections.map((s) => {
      const out: Record<string, unknown> = { type: s.type, heading: s.heading.trim(), body: s.body.trim(), visible: s.visible };
      if (s.url.trim()) out.url = s.url.trim();
      return out;
    }),
  };
}

function sectionStates(sections: Section[]): SectionState[] {
  return sections.map((s, i) => ({ id: `${i}:${s.type}:${s.heading}`, title: s.heading || s.type, visible: s.visible }));
}

/** Compares the draft with the published body by section identity, so a reorder, hide, show or removal is reported. */
function publishSummary(draft: PageDraft, published: Record<string, unknown> | null): string[] {
  const before = published ? sectionStates(pageFrom(published).sections) : [];
  return summarizePublish(before, sectionStates(draft.sections));
}

export function PagesScreen({ api, perms }: Ctx) {
  const canEdit = perms.has('website.pages.edit');
  const canPublish = perms.has('website.pages.publish');
  const [key, setKey] = useState('home');
  const [loaded, setLoaded] = useState<ContentState | null>(null);
  const [draft, setDraft] = useState<PageDraft | null>(null);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error' | 'info'; text: string } | null>(null);
  const [confirm, setConfirm] = useState<string[] | null>(null);
  const [device, setDevice] = useState<PreviewDevice>('desktop');
  const [rollbackReason, setRollbackReason] = useState('');

  const load = async (k: string) => {
    try {
      const state = await api.getContent('page', k);
      setLoaded(state);
      setDraft(pageFrom(state.draft));
      setVersions(await api.listVersions('page', k));
      setNotice(null);
    } catch (e) {
      setNotice({ tone: 'error', text: errorMessage(e) });
    }
  };
  useEffect(() => { void load(key); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!draft || !loaded) return <Card title="Pages">{notice && <Notice tone={notice.tone}>{notice.text}</Notice>}</Card>;

  const update = (patch: Partial<PageDraft>) => setDraft({ ...draft, ...patch });
  const setSection = (i: number, patch: Partial<Section>) => update({ sections: draft.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  const save = async () => {
    try {
      const v = await api.saveDraft('page', key, pageBody(draft), loaded.draftVersion);
      setNotice({ tone: 'ok', text: `Draft saved (version ${v}). The public site is unchanged until you publish.` });
      await load(key);
    } catch (e) { setNotice({ tone: 'error', text: errorMessage(e) }); }
  };
  const publish = async () => {
    try {
      await api.publishContent('page', key, loaded.draftVersion, 'Published from the dashboard');
      setConfirm(null);
      setNotice({ tone: 'ok', text: 'Published. The public page now shows this version.' });
      await load(key);
    } catch (e) { setConfirm(null); setNotice({ tone: 'error', text: errorMessage(e) }); }
  };
  const rollback = async (v: VersionRow) => {
    if (rollbackReason.trim().length < 5) { setNotice({ tone: 'error', text: 'Give a reason of at least 5 characters to roll back.' }); return; }
    try {
      await api.rollbackContent('page', key, v.id, rollbackReason.trim());
      setRollbackReason('');
      setNotice({ tone: 'ok', text: `Rolled back to version ${v.versionNo}.` });
      await load(key);
    } catch (e) { setNotice({ tone: 'error', text: errorMessage(e) }); }
  };

  return (
    <div className="grid gap-6">
      <Card title="Pages" actions={
        <Field label="Page">{(p) => (
          <select {...p} className={inputClass + ' md:w-72'} value={key} onChange={(e) => setKey(e.target.value)}>
            {PAGE_KEYS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
          </select>
        )}</Field>
      }>
        {notice && <div className="mb-4"><Notice tone={notice.tone}>{notice.text}</Notice></div>}
        <p className="mb-4 text-sm text-ink-soft">
          Published version: {loaded.publishedVersionNo ?? 'none yet'}. Draft version: {loaded.draftVersion}.
          {!canEdit && ' You can view this page but not edit it.'}
          {canEdit && !canPublish && ' You can edit drafts. A publisher needs to publish them.'}
        </p>
        <div className="grid gap-5">
          <Field label="Page title">{(p) => <input {...p} className={inputClass} value={draft.title} disabled={!canEdit} onChange={(e) => update({ title: e.target.value })} />}</Field>
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Search title (SEO)" hint="Up to 60 characters.">{(p) => <input {...p} className={inputClass} value={draft.seo_title} disabled={!canEdit} onChange={(e) => update({ seo_title: e.target.value })} />}</Field>
            <Field label="Search description (SEO)" hint="Up to 160 characters.">{(p) => <input {...p} className={inputClass} value={draft.seo_description} disabled={!canEdit} onChange={(e) => update({ seo_description: e.target.value })} />}</Field>
          </div>
          <label className="flex items-center gap-3 text-sm font-bold">
            <input type="checkbox" className="h-5 w-5 accent-brand" checked={draft.visible} disabled={!canEdit} onChange={(e) => update({ visible: e.target.checked })} />
            Page is visible on the public site
          </label>
        </div>
      </Card>

      <Card title="Sections" actions={canEdit && (
        <Button variant="secondary" onClick={() => update({ sections: [...draft.sections, { type: 'text', heading: '', body: '', url: '', visible: true }] })}>Add section</Button>
      )}>
        {draft.sections.length === 0 && <p className="text-sm text-ink-soft">This page has no sections yet.</p>}
        <ol className="grid gap-4">
          {draft.sections.map((s, i) => (
            <li key={i} className="rounded-xl border border-paper-edge p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-bold">Section {i + 1}: {s.heading || s.type}</span>
                {canEdit && (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="ghost" disabled={i === 0} onClick={() => update({ sections: moveItem(draft.sections, i, -1) })}>Move up</Button>
                    <Button variant="ghost" disabled={i === draft.sections.length - 1} onClick={() => update({ sections: moveItem(draft.sections, i, 1) })}>Move down</Button>
                    <Button variant="ghost" disabled={i === 0} onClick={() => update({ sections: moveItemTo(draft.sections, i, 0) })}>Move to top</Button>
                    <Button variant="ghost" onClick={() => update({ sections: draft.sections.filter((_, j) => j !== i) })}>Remove</Button>
                  </div>
                )}
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Type">{(p) => (
                  <select {...p} className={inputClass} value={s.type} disabled={!canEdit} onChange={(e) => setSection(i, { type: e.target.value })}>
                    {SECTION_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                  </select>
                )}</Field>
                <Field label="Heading">{(p) => <input {...p} className={inputClass} value={s.heading} disabled={!canEdit} onChange={(e) => setSection(i, { heading: e.target.value })} />}</Field>
                <Field label="Text" hint="Plain text. Line breaks are kept; HTML is not allowed.">{(p) => <textarea {...p} rows={4} className={inputClass} value={s.body} disabled={!canEdit} onChange={(e) => setSection(i, { body: e.target.value })} />}</Field>
                <div className="grid gap-4">
                  <Field label="Link (optional)" hint="An https address or a site path such as /events.">{(p) => <input {...p} className={inputClass} value={s.url} disabled={!canEdit} onChange={(e) => setSection(i, { url: e.target.value })} />}</Field>
                  <label className="flex items-center gap-3 text-sm font-bold">
                    <input type="checkbox" className="h-5 w-5 accent-brand" checked={s.visible} disabled={!canEdit} onChange={(e) => setSection(i, { visible: e.target.checked })} />
                    Show this section
                  </label>
                </div>
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-6 flex flex-wrap gap-3">
          {canEdit && <Button variant="secondary" onClick={save}>Save draft</Button>}
          {canPublish && <Button onClick={() => setConfirm(publishSummary(draft, loaded.publishedBody))}>Publish…</Button>}
        </div>
      </Card>

      <Card title="Preview" actions={
        <Field label="Device">{(p) => (
          <select {...p} className={inputClass + ' md:w-56'} value={device} onChange={(e) => setDevice(e.target.value as PreviewDevice)}>
            <option value="mobile">Phone (375 px)</option><option value="tablet">Tablet (768 px)</option>
            <option value="smallDesktop">Small desktop (1024 px)</option><option value="desktop">Desktop (1440 px)</option>
          </select>
        )}</Field>
      }>
        <PreviewFrame width={PREVIEW_WIDTHS[device]}>
          <h3 className="font-display text-3xl font-bold text-ink">{draft.title || 'Untitled page'}</h3>
          {draft.sections.filter((s) => s.visible).map((s, i) => (
            <div key={i} className="mt-5">
              {s.heading && <h4 className="font-display text-xl font-bold text-ink">{s.heading}</h4>}
              {s.body.split(/\n+/).filter(Boolean).map((line, j) => <p key={j} className="mt-2 text-ink-soft">{line}</p>)}
            </div>
          ))}
        </PreviewFrame>
      </Card>

      <Card title="History">
        {versions.length === 0 && <p className="text-sm text-ink-soft">No published versions yet.</p>}
        <ul className="grid gap-3">
          {versions.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-paper-edge p-3">
              <span className="text-sm">Version {v.versionNo} · {new Date(v.createdAt).toLocaleString('en-CA')} {v.isPublished && <strong className="text-brand">· live</strong>}</span>
              {canPublish && !v.isPublished && <Button variant="secondary" onClick={() => rollback(v)}>Roll back to this version</Button>}
            </li>
          ))}
        </ul>
        {canPublish && (
          <div className="mt-4 max-w-xl">
            <Field label="Reason for a rollback" hint="Required. At least 5 characters. Recorded in the audit trail.">{(p) => <input {...p} className={inputClass} value={rollbackReason} onChange={(e) => setRollbackReason(e.target.value)} />}</Field>
          </div>
        )}
      </Card>

      {confirm && <ConfirmDialog title="Publish this page?" summary={confirm} confirmLabel="Publish now" onConfirm={publish} onCancel={() => setConfirm(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------

interface SettingsDraft {
  site_name: string; tagline: string; contact_email: string; address_text: string; service_day: string; service_time_text: string;
  footer_text: string; primary_color: string; logo_url: string; favicon_url: string; hero_image_url: string;
  foundation_enroll_url: string; socials: string; seo_title: string; seo_description: string;
}

const EMPTY_SETTINGS: SettingsDraft = {
  site_name: '', tagline: '', contact_email: '', address_text: '', service_day: '', service_time_text: '', footer_text: '',
  primary_color: '', logo_url: '', favicon_url: '', hero_image_url: '', foundation_enroll_url: '', socials: '', seo_title: '', seo_description: '',
};

function settingsFrom(body: Record<string, unknown>): SettingsDraft {
  const s = { ...EMPTY_SETTINGS } as Record<string, string>;
  for (const k of Object.keys(EMPTY_SETTINGS)) if (k !== 'socials' && typeof body[k] === 'string') s[k] = body[k] as string;
  s.socials = Array.isArray(body.socials) ? (body.socials as string[]).join('\n') : '';
  return s as unknown as SettingsDraft;
}

function settingsBody(d: SettingsDraft): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d) as [string, string][]) {
    if (k === 'socials') { const list = v.split('\n').map((x) => x.trim()).filter(Boolean); if (list.length) out.socials = list; continue; }
    const t = v.trim();
    if (t !== '') out[k] = t;
  }
  return out;
}

export function SettingsScreen({ api, perms }: Ctx) {
  const canEdit = perms.has('website.settings.edit');
  const canPublish = perms.has('website.settings.publish');
  const [loaded, setLoaded] = useState<ContentState | null>(null);
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error' | 'info'; text: string } | null>(null);
  const [confirm, setConfirm] = useState(false);

  const load = async () => {
    try {
      const s = await api.getContent('settings', 'site');
      setLoaded(s);
      setDraft(settingsFrom(s.draft));
    } catch (e) { setNotice({ tone: 'error', text: errorMessage(e) }); }
  };
  // Loads once when the screen mounts; `load` only reads the api passed in at mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!draft || !loaded) return <Card title="Settings">{notice && <Notice tone={notice.tone}>{notice.text}</Notice>}</Card>;
  const set = (k: keyof SettingsDraft, v: string) => setDraft({ ...draft, [k]: v });
  const text = (k: keyof SettingsDraft, label: string, hint?: string, multiline = false) => (
    <Field key={k} label={label} hint={hint}>{(p) => multiline
      ? <textarea {...p} rows={4} className={inputClass} value={draft[k]} disabled={!canEdit} onChange={(e) => set(k, e.target.value)} />
      : <input {...p} className={inputClass} value={draft[k]} disabled={!canEdit} onChange={(e) => set(k, e.target.value)} />}</Field>
  );

  const save = async () => {
    try {
      const v = await api.saveDraft('settings', 'site', settingsBody(draft), loaded.draftVersion);
      setNotice({ tone: 'ok', text: `Settings draft saved (version ${v}). Publish to show them on the public site.` });
      await load();
    } catch (e) { setNotice({ tone: 'error', text: errorMessage(e) }); }
  };
  const publish = async () => {
    try {
      await api.publishContent('settings', 'site', loaded.draftVersion, 'Published from the dashboard');
      setConfirm(false);
      setNotice({ tone: 'ok', text: 'Settings published.' });
      await load();
    } catch (e) { setConfirm(false); setNotice({ tone: 'error', text: errorMessage(e) }); }
  };

  return (
    <div className="grid gap-6">
      <Card title="Identity and branding" actions={!canEdit && <span className="text-sm text-ink-muted">View only</span>}>
        {notice && <div className="mb-4"><Notice tone={notice.tone}>{notice.text}</Notice></div>}
        <div className="grid gap-5 md:grid-cols-2">
          {text('site_name', 'Site name')}
          {text('tagline', 'Tagline', 'Up to 140 characters.')}
          {text('primary_color', 'Primary colour', 'Six-digit hex, for example #C8102E.')}
          {text('logo_url', 'Logo address', 'An https address or a site path.')}
          {text('favicon_url', 'Favicon address', 'An https address or a site path.')}
          {text('hero_image_url', 'Hero image address', 'An https address or a site path.')}
        </div>
      </Card>
      <Card title="Service information and contact">
        <div className="grid gap-5 md:grid-cols-2">
          {text('service_day', 'Service day')}
          {text('service_time_text', 'Service time')}
          {text('address_text', 'Location')}
          {text('contact_email', 'Contact email')}
        </div>
      </Card>
      <Card title="Foundation School">
        <div className="grid gap-5">
          {text('foundation_enroll_url', 'Enrolment link (Rock Solid Ops)', 'Must be https with no login details. Leave empty to hide every enrolment button.')}
        </div>
      </Card>
      <Card title="Social links and footer">
        <div className="grid gap-5">
          {text('socials', 'Social links', 'One https address per line, up to 8.', true)}
          {text('footer_text', 'Footer text', 'Up to 500 characters.', true)}
        </div>
      </Card>
      <Card title="Search (SEO)">
        <div className="grid gap-5 md:grid-cols-2">
          {text('seo_title', 'Search title', 'Up to 60 characters.')}
          {text('seo_description', 'Search description', 'Up to 160 characters.')}
        </div>
      </Card>
      <div className="flex flex-wrap gap-3">
        {canEdit && <Button variant="secondary" onClick={save}>Save draft</Button>}
        {canPublish ? <Button onClick={() => setConfirm(true)}>Publish…</Button> : <p className="self-center text-sm text-ink-soft">A publisher needs to publish settings changes.</p>}
      </div>
      {confirm && <ConfirmDialog title="Publish these settings?" summary={['Updates the public site identity, contact details, service information and links.']} confirmLabel="Publish now" onConfirm={publish} onCancel={() => setConfirm(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------

interface NavItem { label: string; href: string }

export function NavigationScreen({ api, perms }: Ctx) {
  const canEdit = perms.has('website.navigation.edit');
  const [loaded, setLoaded] = useState<ContentState | null>(null);
  const [items, setItems] = useState<NavItem[]>([]);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error' | 'info'; text: string } | null>(null);
  const [confirm, setConfirm] = useState(false);

  const load = async () => {
    try {
      const s = await api.getContent('navigation', 'primary');
      setLoaded(s);
      const raw = Array.isArray(s.draft.items) ? (s.draft.items as Record<string, unknown>[]) : [];
      setItems(raw.map((i) => ({ label: String(i.label ?? ''), href: String(i.href ?? '') })));
    } catch (e) { setNotice({ tone: 'error', text: errorMessage(e) }); }
  };
  // Loads once when the screen mounts; `load` only reads the api passed in at mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, []);

  if (!loaded) return <Card title="Navigation">{notice && <Notice tone={notice.tone}>{notice.text}</Notice>}</Card>;
  const body = { items: items.map((i) => ({ label: i.label.trim(), href: i.href.trim() })) };

  const save = async () => {
    try {
      const v = await api.saveDraft('navigation', 'primary', body, loaded.draftVersion);
      setNotice({ tone: 'ok', text: `Menu draft saved (version ${v}).` });
      await load();
    } catch (e) { setNotice({ tone: 'error', text: errorMessage(e) }); }
  };
  const publish = async () => {
    try {
      await api.publishContent('navigation', 'primary', loaded.draftVersion, 'Menu published from the dashboard');
      setConfirm(false);
      setNotice({ tone: 'ok', text: 'Menu published.' });
      await load();
    } catch (e) { setConfirm(false); setNotice({ tone: 'error', text: errorMessage(e) }); }
  };

  return (
    <Card title="Navigation menu" actions={canEdit && items.length < 12 && (
      <Button variant="secondary" onClick={() => setItems([...items, { label: '', href: '/' }])}>Add menu item</Button>
    )}>
      {notice && <div className="mb-4"><Notice tone={notice.tone}>{notice.text}</Notice></div>}
      <p className="mb-4 text-sm text-ink-soft">Up to 12 items. Links must be https or a site path such as /events.</p>
      <ol className="grid gap-4">
        {items.map((it, i) => (
          <li key={i} className="grid gap-3 rounded-xl border border-paper-edge p-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
            <Field label={`Label ${i + 1}`}>{(p) => <input {...p} className={inputClass} value={it.label} disabled={!canEdit} onChange={(e) => setItems(items.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />}</Field>
            <Field label="Link">{(p) => <input {...p} className={inputClass} value={it.href} disabled={!canEdit} onChange={(e) => setItems(items.map((x, j) => j === i ? { ...x, href: e.target.value } : x))} />}</Field>
            {canEdit && (
              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" disabled={i === 0} onClick={() => setItems(moveItem(items, i, -1))}>Up</Button>
                <Button variant="ghost" disabled={i === items.length - 1} onClick={() => setItems(moveItem(items, i, 1))}>Down</Button>
                <Button variant="ghost" onClick={() => setItems(items.filter((_, j) => j !== i))}>Remove</Button>
              </div>
            )}
          </li>
        ))}
      </ol>
      <div className="mt-6 flex flex-wrap gap-3">
        {canEdit && <Button variant="secondary" onClick={save}>Save draft</Button>}
        {canEdit && <Button onClick={() => setConfirm(true)}>Publish…</Button>}
      </div>
      {confirm && <ConfirmDialog title="Publish this menu?" summary={[`The public menu will show ${items.length} item${items.length === 1 ? '' : 's'}.`]} confirmLabel="Publish now" onConfirm={publish} onCancel={() => setConfirm(false)} />}
    </Card>
  );
}

export type { ContentKind, ReactNode };
