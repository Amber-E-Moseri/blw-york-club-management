import { useEffect, useState } from 'react';
import type { EventPublicationRow, InquiryRow, PostRow, RoleRow, AssignmentRow, WebsiteApi } from '../api/websiteApi';
import { BUILT_IN_ROLES, PERMISSION_GROUPS, PERMISSION_LABELS, WEBSITE_PERMISSIONS, type WebsitePermission } from './permissions';
import { isFutureSchedule, PREVIEW_WIDTHS, type PreviewDevice } from './logic';
import { Button, Card, errorMessage, Field, inputClass, Notice, PreviewFrame } from './common';

interface Ctx { api: WebsiteApi; perms: ReadonlySet<WebsitePermission> }
type Tone = 'ok' | 'error' | 'info';
type Msg = { tone: Tone; text: string } | null;

// ---------------------------------------------------------------------------------------------------------------------
export function DashboardScreen({ api, perms }: Ctx) {
  const [posts, setPosts] = useState<PostRow[] | null>(null);
  const [inquiries, setInquiries] = useState<InquiryRow[] | null>(null);
  const [events, setEvents] = useState<EventPublicationRow[] | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  useEffect(() => {
    (async () => {
      try {
        if (perms.has('website.blog.edit') || perms.has('website.blog.publish')) setPosts(await api.listPosts());
        if (perms.has('website.submissions.review')) setInquiries(await api.listInquiries(null));
        if (perms.has('website.events.manage') || perms.has('website.events.publish')) setEvents(await api.listEventPublications());
      } catch (e) { setMsg({ tone: 'error', text: errorMessage(e) }); }
    })();
  }, [api, perms]);
  const now = new Date();
  const scheduled = posts?.filter((p) => p.status === 'published' && p.publishAt && isFutureSchedule(new Date(p.publishAt), now)) ?? [];
  return (
    <div className="grid gap-6">
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {posts && <Stat label="Blog drafts" value={posts.filter((p) => p.status === 'draft').length} />}
        {posts && <Stat label="Posts live" value={posts.filter((p) => p.status === 'published' && !scheduled.includes(p)).length} />}
        {posts && <Stat label="Scheduled posts" value={scheduled.length} />}
        {inquiries && <Stat label="New inquiries" value={inquiries.filter((i) => i.status === 'new').length} />}
        {events && <Stat label="Public events" value={events.filter((e) => e.isPublic).length} />}
      </div>
      <Card title="Recent blog activity">
        {!posts && <p className="text-sm text-ink-soft">You do not have access to blog activity.</p>}
        {posts && posts.length === 0 && <p className="text-sm text-ink-soft">No posts yet. Create one from Blog.</p>}
        <ul className="grid gap-2">
          {posts?.slice(0, 6).map((p) => (
            <li key={p.id} className="flex flex-wrap justify-between gap-2 border-b border-paper-edge pb-2 text-sm">
              <span className="font-bold">{p.title}</span>
              <span className="text-ink-soft">{p.status}{p.publishAt && p.status === 'published' ? ` · scheduled ${new Date(p.publishAt).toLocaleString('en-CA')}` : ''}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-paper-edge bg-white p-5">
      <p className="text-xs font-bold uppercase tracking-[0.12em] text-ink-muted">{label}</p>
      <p className="mt-2 font-display text-4xl font-bold text-ink">{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
const emptyPost = { id: null as string | null, slug: '', title: '', excerpt: '', body: '', category: 'Uncategorised', author: 'BLW York', version: null as number | null };

export function BlogScreen({ api, perms }: Ctx) {
  const canEdit = perms.has('website.blog.edit');
  const canPublish = perms.has('website.blog.publish');
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [form, setForm] = useState(emptyPost);
  const [schedule, setSchedule] = useState('');
  const [device, setDevice] = useState<PreviewDevice>('desktop');
  const [msg, setMsg] = useState<Msg>(null);
  const refresh = async () => { try { setPosts(await api.listPosts()); } catch (e) { setMsg({ tone: 'error', text: errorMessage(e) }); } };
  useEffect(() => { void refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (p: PostRow) => { setForm({ id: p.id, slug: p.slug, title: p.title, excerpt: p.excerpt, body: p.body, category: p.category, author: p.authorDisplay, version: p.version }); setMsg(null); };
  const save = async () => {
    try {
      const id = await api.savePost({ id: form.id, slug: form.slug, title: form.title, excerpt: form.excerpt, body: form.body, category: form.category, author: form.author, expectedVersion: form.version });
      setForm({ ...form, id, version: form.version === null ? 1 : form.version + 1 });
      setMsg({ tone: 'ok', text: 'Post saved as a draft. It is not visible to the public yet.' });
      await refresh();
    } catch (e) { setMsg({ tone: 'error', text: errorMessage(e) }); }
  };
  const setStatus = async (status: 'draft' | 'published' | 'archived', publishAt: string | null) => {
    if (!form.id || form.version === null) { setMsg({ tone: 'error', text: 'Save the post first.' }); return; }
    try {
      await api.setPostStatus(form.id, status, publishAt, form.version);
      const when = publishAt ? ` It will appear on ${new Date(publishAt).toLocaleString('en-CA')}.` : '';
      setMsg({ tone: 'ok', text: status === 'published' ? `Post published.${when}` : status === 'draft' ? 'Post moved back to draft and hidden from the public site.' : 'Post archived.' });
      setForm({ ...form, version: form.version + 1 });
      await refresh();
    } catch (e) { setMsg({ tone: 'error', text: errorMessage(e) }); }
  };

  return (
    <div className="grid gap-6">
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <Card title={form.id ? 'Edit post' : 'New post'} actions={<Button variant="secondary" onClick={() => setForm(emptyPost)}>New post</Button>}>
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Title">{(p) => <input {...p} className={inputClass} value={form.title} disabled={!canEdit} onChange={(e) => setForm({ ...form, title: e.target.value })} />}</Field>
          <Field label="Web address (slug)" hint="Lowercase letters, numbers and hyphens, 3 to 100 characters.">{(p) => <input {...p} className={inputClass} value={form.slug} disabled={!canEdit} onChange={(e) => setForm({ ...form, slug: e.target.value })} />}</Field>
          <Field label="Category">{(p) => <input {...p} className={inputClass} value={form.category} disabled={!canEdit} onChange={(e) => setForm({ ...form, category: e.target.value })} />}</Field>
          <Field label="Author shown on the post">{(p) => <input {...p} className={inputClass} value={form.author} disabled={!canEdit} onChange={(e) => setForm({ ...form, author: e.target.value })} />}</Field>
          <div className="md:col-span-2"><Field label="Summary (shown in listings)" hint="Up to 300 characters.">{(p) => <textarea {...p} rows={2} className={inputClass} value={form.excerpt} disabled={!canEdit} onChange={(e) => setForm({ ...form, excerpt: e.target.value })} />}</Field></div>
          <div className="md:col-span-2"><Field label="Body" hint="Plain text. Separate paragraphs with a blank line. HTML is not allowed.">{(p) => <textarea {...p} rows={10} className={inputClass} value={form.body} disabled={!canEdit} onChange={(e) => setForm({ ...form, body: e.target.value })} />}</Field></div>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          {canEdit && <Button variant="secondary" onClick={save}>Save draft</Button>}
          {canPublish && form.id && <Button onClick={() => setStatus('published', null)}>Publish now</Button>}
          {canPublish && form.id && <Button variant="secondary" onClick={() => setStatus('draft', null)}>Unpublish</Button>}
          {canPublish && form.id && <Button variant="ghost" onClick={() => setStatus('archived', null)}>Archive</Button>}
        </div>
        {canPublish && form.id && (
          <div className="mt-6 grid gap-3 rounded-xl border border-paper-edge p-4 md:grid-cols-[1fr_auto] md:items-end">
            <Field label="Schedule publication" hint="Choose a future date and time. The post appears automatically at that time.">{(p) => <input {...p} type="datetime-local" className={inputClass} value={schedule} onChange={(e) => setSchedule(e.target.value)} />}</Field>
            <Button variant="secondary" disabled={!schedule} onClick={() => {
              const when = new Date(schedule);
              if (!isFutureSchedule(when, new Date())) { setMsg({ tone: 'error', text: 'Choose a time in the future.' }); return; }
              void setStatus('published', when.toISOString());
            }}>Schedule</Button>
          </div>
        )}
        {!canEdit && <p className="mt-4 text-sm text-ink-soft">You can view posts but not edit them.</p>}
      </Card>

      <Card title="Preview" actions={
        <Field label="Device">{(p) => (
          <select {...p} className={inputClass + ' md:w-56'} value={device} onChange={(e) => setDevice(e.target.value as PreviewDevice)}>
            <option value="mobile">Phone (375 px)</option><option value="tablet">Tablet (768 px)</option><option value="smallDesktop">Small desktop (1024 px)</option><option value="desktop">Desktop (1440 px)</option>
          </select>
        )}</Field>
      }>
        <PreviewFrame width={PREVIEW_WIDTHS[device]}>
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-brand">{form.category}</p>
          <h3 className="mt-2 font-display text-3xl font-bold text-ink">{form.title || 'Untitled post'}</h3>
          <p className="mt-1 text-sm text-ink-muted">{form.author}</p>
          {form.excerpt && <p className="mt-3 font-medium text-ink">{form.excerpt}</p>}
          {form.body.split(/\n\s*\n/).filter(Boolean).map((para, i) => <p key={i} className="mt-3 text-ink-soft">{para}</p>)}
        </PreviewFrame>
      </Card>

      <Card title="All posts">
        {posts.length === 0 && <p className="text-sm text-ink-soft">No posts yet.</p>}
        <ul className="grid gap-2">
          {posts.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => pick(p)} className="flex w-full flex-wrap justify-between gap-2 rounded-lg border border-paper-edge px-4 py-3 text-left hover:bg-paper">
                <span className="font-bold">{p.title}</span>
                <span className="text-sm text-ink-soft">{p.status}{p.publishAt && p.status === 'published' ? ` · scheduled ${new Date(p.publishAt).toLocaleString('en-CA')}` : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
export function EventsScreen({ api, perms }: Ctx) {
  const canManage = perms.has('website.events.manage');
  const canPublish = perms.has('website.events.publish');
  const [rows, setRows] = useState<EventPublicationRow[]>([]);
  const [msg, setMsg] = useState<Msg>(null);
  const refresh = async () => { try { setRows(await api.listEventPublications()); } catch (e) { setMsg({ tone: 'error', text: errorMessage(e) }); } };
  useEffect(() => { void refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (id: string, p: Partial<EventPublicationRow>) => setRows(rows.map((r) => (r.eventId === id ? { ...r, ...p } : r)));
  const save = async (r: EventPublicationRow) => {
    try {
      await api.setEventPublication({
        eventId: r.eventId, isPublic: r.isPublic, featured: r.featured, slug: r.slug ?? '', title: r.publicTitle ?? '',
        summary: r.publicSummary, registrationUrl: r.registrationUrl ?? '', expectedVersion: r.version,
      });
      setMsg({ tone: 'ok', text: `Saved "${r.title}".${r.isPublic ? ' It is public on the website.' : ' It is not public.'}` });
      await refresh();
    } catch (e) { setMsg({ tone: 'error', text: errorMessage(e) }); }
  };

  return (
    <Card title="Public events">
      {msg && <div className="mb-4"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      <p className="mb-4 text-sm text-ink-soft">Only events open to everyone can appear on the website. Events limited to a cell, group or meeting stay private to the Hub.</p>
      <ul className="grid gap-5">
        {rows.map((r) => (
          <li key={r.eventId} className="grid gap-4 rounded-xl border border-paper-edge p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-display text-xl font-bold">{r.title}</span>
              <span className="text-sm text-ink-soft">{r.eventDate}</span>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="flex items-center gap-3 text-sm font-bold">
                <input type="checkbox" className="h-5 w-5 accent-brand" checked={r.isPublic} disabled={!canManage || !canPublish} onChange={(e) => patch(r.eventId, { isPublic: e.target.checked })} />
                Show on the website
              </label>
              <label className="flex items-center gap-3 text-sm font-bold">
                <input type="checkbox" className="h-5 w-5 accent-brand" checked={r.featured} disabled={!canManage} onChange={(e) => patch(r.eventId, { featured: e.target.checked })} />
                Feature on the home page
              </label>
              <Field label="Web address (slug)" hint="Required before publishing.">{(p) => <input {...p} className={inputClass} value={r.slug ?? ''} disabled={!canManage} onChange={(e) => patch(r.eventId, { slug: e.target.value })} />}</Field>
              <Field label="Public title" hint="Leave empty to use the event title.">{(p) => <input {...p} className={inputClass} value={r.publicTitle ?? ''} disabled={!canManage} onChange={(e) => patch(r.eventId, { publicTitle: e.target.value })} />}</Field>
              <div className="md:col-span-2"><Field label="Public summary" hint="Up to 300 characters.">{(p) => <textarea {...p} rows={2} className={inputClass} value={r.publicSummary} disabled={!canManage} onChange={(e) => patch(r.eventId, { publicSummary: e.target.value })} />}</Field></div>
              <Field label="Registration link (optional)" hint="https only.">{(p) => <input {...p} className={inputClass} value={r.registrationUrl ?? ''} disabled={!canManage} onChange={(e) => patch(r.eventId, { registrationUrl: e.target.value })} />}</Field>
            </div>
            {canManage && <div><Button variant="secondary" onClick={() => save(r)}>Save event</Button></div>}
          </li>
        ))}
      </ul>
      {rows.length === 0 && <p className="text-sm text-ink-soft">No events yet. Create events in the Hub; they appear here.</p>}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
export function InquiriesScreen({ api, perms }: Ctx) {
  const canReview = perms.has('website.submissions.review');
  const [filter, setFilter] = useState<InquiryRow['status'] | null>('new');
  const [rows, setRows] = useState<InquiryRow[]>([]);
  const [msg, setMsg] = useState<Msg>(null);
  const load = async () => { try { setRows(await api.listInquiries(filter)); } catch (e) { setMsg({ tone: 'error', text: errorMessage(e) }); } };
  useEffect(() => { if (canReview) void load(); }, [filter, canReview]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!canReview) return <Card title="Inquiries"><p className="text-sm text-ink-soft">You do not have access to public inquiries.</p></Card>;
  const set = async (id: string, status: InquiryRow['status']) => {
    try { await api.setInquiryStatus(id, status); setMsg({ tone: 'ok', text: 'Status updated.' }); await load(); }
    catch (e) { setMsg({ tone: 'error', text: errorMessage(e) }); }
  };
  return (
    <Card title="Inquiries" actions={
      <Field label="Show">{(p) => (
        <select {...p} className={inputClass + ' md:w-56'} value={filter ?? 'all'} onChange={(e) => setFilter(e.target.value === 'all' ? null : (e.target.value as InquiryRow['status']))}>
          <option value="new">New</option><option value="in_review">In review</option><option value="closed">Closed</option><option value="all">All</option>
        </select>
      )}</Field>
    }>
      {msg && <div className="mb-4"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      <p className="mb-4 text-sm text-ink-soft">Messages from the public website. Prayer requests are kept for 90 days and then redacted.</p>
      <ul className="grid gap-4">
        {rows.map((r) => (
          <li key={r.id} className="grid gap-2 rounded-xl border border-paper-edge p-4">
            <div className="flex flex-wrap justify-between gap-2 text-sm">
              <span className="font-bold">{r.name} · {r.kind.replace('_', ' ')}{r.topic ? ` · ${r.topic}` : ''}</span>
              <span className="text-ink-soft">{new Date(r.createdAt).toLocaleString('en-CA')} · {r.status.replace('_', ' ')}</span>
            </div>
            <p className="text-ink-soft">{r.message}</p>
            <p className="text-sm">{r.email ?? 'No email'}{r.phone ? ` · ${r.phone}` : ''} · consent version {r.consentVersion}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" disabled={r.status === 'in_review'} onClick={() => set(r.id, 'in_review')}>Mark in review</Button>
              <Button variant="ghost" disabled={r.status === 'closed'} onClick={() => set(r.id, 'closed')}>Close</Button>
            </div>
          </li>
        ))}
      </ul>
      {rows.length === 0 && <p className="text-sm text-ink-soft">Nothing to show.</p>}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
export function PeopleScreen({ api, perms, isCore }: Ctx & { isCore: boolean }) {
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [msg, setMsg] = useState<Msg>(null);
  const [newRole, setNewRole] = useState({ name: '', description: '', perms: [] as string[] });
  const [assign, setAssign] = useState({ profileId: '', roleId: '', reason: '' });
  const refresh = async () => {
    try { setRoles(await api.listRoles()); setAssignments(await api.listAssignments()); }
    catch (e) { setMsg({ tone: 'error', text: errorMessage(e) }); }
  };
  useEffect(() => { if (isCore) void refresh(); }, [isCore]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isCore) return <Card title="People and website roles"><p className="text-sm text-ink-soft">Only a core administrator of BLW York can manage website roles. Coordinators do not receive website access automatically.</p></Card>;
  void perms;

  const togglePerm = (k: string) => setNewRole({ ...newRole, perms: newRole.perms.includes(k) ? newRole.perms.filter((x) => x !== k) : [...newRole.perms, k] });
  const createRole = async () => {
    try { await api.createRole(newRole.name.trim(), newRole.description.trim(), newRole.perms); setMsg({ tone: 'ok', text: 'Role created.' }); setNewRole({ name: '', description: '', perms: [] }); await refresh(); }
    catch (e) { setMsg({ tone: 'error', text: errorMessage(e) }); }
  };
  const doAssign = async () => {
    try { await api.assignRole(assign.profileId.trim(), assign.roleId, assign.reason.trim()); setMsg({ tone: 'ok', text: 'Role assigned. It takes effect on the person’s next action.' }); setAssign({ profileId: '', roleId: '', reason: '' }); await refresh(); }
    catch (e) { setMsg({ tone: 'error', text: errorMessage(e) }); }
  };
  const revoke = async (a: AssignmentRow, reason: string) => {
    try { await api.revokeAssignment(a.id, reason.trim()); setMsg({ tone: 'ok', text: 'Role revoked.' }); await refresh(); }
    catch (e) { setMsg({ tone: 'error', text: errorMessage(e) }); }
  };
  const archive = async (r: RoleRow, reason: string) => {
    try { await api.archiveRole(r.id, reason.trim()); setMsg({ tone: 'ok', text: 'Role archived and its assignments revoked.' }); await refresh(); }
    catch (e) { setMsg({ tone: 'error', text: errorMessage(e) }); }
  };

  return (
    <div className="grid gap-6">
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <Card title="Website roles">
        <ul className="grid gap-3">
          {roles.map((r) => <RoleRowView key={r.id} role={r} onArchive={archive} />)}
        </ul>
      </Card>
      <Card title="Create a custom role" actions={<span className="text-sm text-ink-muted">Up to 16 permissions</span>}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Role name">{(p) => <input {...p} className={inputClass} value={newRole.name} onChange={(e) => setNewRole({ ...newRole, name: e.target.value })} />}</Field>
          <Field label="Description">{(p) => <input {...p} className={inputClass} value={newRole.description} onChange={(e) => setNewRole({ ...newRole, description: e.target.value })} />}</Field>
        </div>
        <fieldset className="mt-5">
          <legend className="mb-2 text-sm font-bold">Permissions</legend>
          <div className="grid gap-4 md:grid-cols-2">
            {Object.entries(PERMISSION_GROUPS).map(([group, keys]) => (
              <div key={group}>
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-ink-muted">{group}</p>
                {keys.map((k) => (
                  <label key={k} className="mt-1 flex min-h-[44px] items-center gap-3 text-sm">
                    <input type="checkbox" className="h-5 w-5 accent-brand" checked={newRole.perms.includes(k)} onChange={() => togglePerm(k)} />
                    <span>{PERMISSION_LABELS[k]}</span>
                  </label>
                ))}
              </div>
            ))}
          </div>
        </fieldset>
        <div className="mt-5"><Button onClick={createRole} disabled={!newRole.name.trim()}>Create role</Button></div>
      </Card>
      <Card title="Assign a role">
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Person (profile ID)" hint="The account's profile ID from the Hub member record.">{(p) => <input {...p} className={inputClass} value={assign.profileId} onChange={(e) => setAssign({ ...assign, profileId: e.target.value })} />}</Field>
          <Field label="Role">{(p) => (
            <select {...p} className={inputClass} value={assign.roleId} onChange={(e) => setAssign({ ...assign, roleId: e.target.value })}>
              <option value="">Choose a role</option>
              {roles.filter((r) => r.status === 'active').map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          )}</Field>
          <Field label="Reason" hint="At least 5 characters. Recorded in the audit trail.">{(p) => <input {...p} className={inputClass} value={assign.reason} onChange={(e) => setAssign({ ...assign, reason: e.target.value })} />}</Field>
        </div>
        <div className="mt-5"><Button onClick={doAssign} disabled={!assign.profileId || !assign.roleId || assign.reason.trim().length < 5}>Assign role</Button></div>
      </Card>
      <Card title="Current assignments">
        <ul className="grid gap-3">
          {assignments.map((a) => <AssignmentView key={a.id} a={a} roles={roles} onRevoke={revoke} />)}
        </ul>
        {assignments.length === 0 && <p className="text-sm text-ink-soft">No assignments yet.</p>}
      </Card>
      <Card title="Built-in role definitions">
        <ul className="grid gap-2 text-sm">
          {BUILT_IN_ROLES.map((r) => <li key={r.id}><strong>{r.name}:</strong> {r.description}</li>)}
        </ul>
        <p className="mt-3 text-sm text-ink-soft">The catalogue of {WEBSITE_PERMISSIONS.length} permissions is fixed in the database.</p>
      </Card>
    </div>
  );
}

function RoleRowView({ role, onArchive }: { role: RoleRow; onArchive: (r: RoleRow, reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <li className="grid gap-2 rounded-xl border border-paper-edge p-4 md:grid-cols-[1fr_auto] md:items-end">
      <div>
        <p className="font-bold">{role.name} {role.isBuiltin && <span className="text-xs font-normal text-ink-muted">· built in</span>} {role.status === 'archived' && <span className="text-xs text-brand">· archived</span>}</p>
        <p className="text-sm text-ink-soft">{role.description}</p>
      </div>
      {role.status === 'active' && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Reason to archive">{(p) => <input {...p} className={inputClass + ' md:w-64'} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
          <Button variant="secondary" disabled={reason.trim().length < 5} onClick={() => onArchive(role, reason)}>Archive</Button>
        </div>
      )}
    </li>
  );
}

function AssignmentView({ a, roles, onRevoke }: { a: AssignmentRow; roles: RoleRow[]; onRevoke: (a: AssignmentRow, reason: string) => void }) {
  const [reason, setReason] = useState('');
  const role = roles.find((r) => r.id === a.roleId);
  return (
    <li className="grid gap-2 rounded-xl border border-paper-edge p-4 md:grid-cols-[1fr_auto] md:items-end">
      <div className="text-sm">
        <p className="font-bold">{role?.name ?? 'Role'} · profile {a.profileId}</p>
        <p className="text-ink-soft">Assigned {new Date(a.assignedAt).toLocaleString('en-CA')} · {a.reason}{a.revokedAt ? ` · revoked ${new Date(a.revokedAt).toLocaleString('en-CA')}` : ''}</p>
      </div>
      {!a.revokedAt && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Reason to revoke">{(p) => <input {...p} className={inputClass + ' md:w-64'} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
          <Button variant="secondary" disabled={reason.trim().length < 5} onClick={() => onRevoke(a, reason)}>Revoke</Button>
        </div>
      )}
    </li>
  );
}
