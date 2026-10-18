import { useEffect, useState } from 'react';
import type { DownloadStatRow, EditionRow, MediaRow, WebsiteApi } from '../api/websiteApi';
import type { WebsitePermission } from './permissions';
import { Button, Card, errorMessage, Field, inputClass, Notice } from './common';

interface Ctx { api: WebsiteApi; perms: ReadonlySet<WebsitePermission> }
type Msg = { tone: 'ok' | 'error' | 'info'; text: string } | null;

const blank = { id: null as string | null, kind: 'monthly' as EditionRow['kind'], periodStart: '', title: '', description: '', pdfMediaId: '', version: 0 };

export function RhapsodyScreen({ api, perms }: Ctx) {
  const canManage = perms.has('website.rhapsody.manage');
  const canPublish = perms.has('website.rhapsody.publish');
  const canStats = perms.has('website.analytics.view');
  const [rows, setRows] = useState<EditionRow[]>([]);
  const [pdfs, setPdfs] = useState<MediaRow[]>([]);
  const [stats, setStats] = useState<DownloadStatRow[] | null>(null);
  const [form, setForm] = useState(blank);
  const [authBy, setAuthBy] = useState('');
  const [msg, setMsg] = useState<Msg>(null);

  const refresh = async () => {
    try {
      setRows(await api.listEditions());
      setPdfs((await api.listMedia()).filter((m) => m.bucket === 'rhapsody-pdfs' && m.status === 'active'));
      if (canStats) setStats(await api.downloadStats(30));
    } catch (e) { setMsg({ tone: 'error', text: errorMessage(e) }); }
  };
  useEffect(() => { void refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (e: EditionRow) => {
    setForm({ id: e.id, kind: e.kind, periodStart: e.periodStart, title: e.title, description: e.description, pdfMediaId: e.pdfMediaId ?? '', version: e.version });
    setAuthBy(e.authorizedBy ?? '');
    setMsg(null);
  };

  const save = async () => {
    try {
      const id = await api.saveEdition({ id: form.id, kind: form.kind, periodStart: form.periodStart, title: form.title.trim(), description: form.description.trim(), pdfMediaId: form.pdfMediaId || null, expectedVersion: form.id ? form.version : 0 });
      setForm({ ...form, id, version: form.id ? form.version + 1 : 1 });
      setMsg({ tone: 'ok', text: 'Edition saved. It is not public until it is authorized and published.' });
      await refresh();
    } catch (e) { setMsg({ tone: 'error', text: errorMessage(e) }); }
  };

  const authorize = async () => {
    if (!form.id) { setMsg({ tone: 'error', text: 'Save the edition first.' }); return; }
    try {
      await api.authorizeEdition(form.id, authBy.trim(), form.version);
      setForm({ ...form, version: form.version + 1 });
      setMsg({ tone: 'ok', text: `Authorized by ${authBy.trim()}.` });
      await refresh();
    } catch (e) { setMsg({ tone: 'error', text: errorMessage(e) }); }
  };

  const setStatus = async (status: EditionRow['status']) => {
    if (!form.id) { setMsg({ tone: 'error', text: 'Save the edition first.' }); return; }
    try {
      await api.setEditionStatus(form.id, status, form.version);
      setForm({ ...form, version: form.version + 1 });
      setMsg({ tone: 'ok', text: status === 'published' ? 'Edition published.' : status === 'archived' ? 'Edition archived.' : 'Edition moved to draft.' });
      await refresh();
    } catch (e) { setMsg({ tone: 'error', text: errorMessage(e) }); }
  };

  return (
    <div className="grid gap-6">
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <Card title={form.id ? 'Edit edition' : 'New edition'} actions={<Button variant="secondary" onClick={() => { setForm(blank); setAuthBy(''); }}>New edition</Button>}>
        <p className="mb-4 text-sm text-ink-soft">A PDF must be uploaded to the private Rhapsody library and registered in Media first. An edition can be published only after it is authorized by a named person.</p>
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Type">{(p) => (
            <select {...p} className={inputClass} value={form.kind} disabled={!canManage} onChange={(e) => setForm({ ...form, kind: e.target.value as EditionRow['kind'] })}>
              <option value="monthly">Monthly</option><option value="daily">Daily</option>
            </select>
          )}</Field>
          <Field label="Period start" hint="First day of the month, or the day for a daily reading.">{(p) => <input {...p} type="date" className={inputClass} value={form.periodStart} disabled={!canManage} onChange={(e) => setForm({ ...form, periodStart: e.target.value })} />}</Field>
          <Field label="Title">{(p) => <input {...p} className={inputClass} value={form.title} disabled={!canManage} onChange={(e) => setForm({ ...form, title: e.target.value })} />}</Field>
          <Field label="PDF from the Rhapsody library">{(p) => (
            <select {...p} className={inputClass} value={form.pdfMediaId} disabled={!canManage} onChange={(e) => setForm({ ...form, pdfMediaId: e.target.value })}>
              <option value="">No PDF yet</option>
              {pdfs.map((m) => <option key={m.id} value={m.id}>{m.storagePath}</option>)}
            </select>
          )}</Field>
          <div className="md:col-span-2"><Field label="Description" hint="Up to 500 characters.">{(p) => <textarea {...p} rows={3} className={inputClass} value={form.description} disabled={!canManage} onChange={(e) => setForm({ ...form, description: e.target.value })} />}</Field></div>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          {canManage && <Button variant="secondary" onClick={save}>Save edition</Button>}
        </div>
        {canPublish && form.id && (
          <div className="mt-6 grid gap-4 rounded-xl border border-paper-edge p-4 md:grid-cols-[1fr_auto_auto] md:items-end">
            <Field label="Authorized by" hint="The named person who approved this edition for publication.">{(p) => <input {...p} className={inputClass} value={authBy} onChange={(e) => setAuthBy(e.target.value)} />}</Field>
            <Button variant="secondary" disabled={!authBy.trim()} onClick={authorize}>Record authorization</Button>
            <div className="flex gap-2">
              <Button onClick={() => setStatus('published')}>Publish</Button>
              <Button variant="ghost" onClick={() => setStatus('archived')}>Archive</Button>
            </div>
          </div>
        )}
      </Card>

      {canStats && (
        <Card title="Downloads, last 30 days">
          <p className="mb-4 text-sm text-ink-soft">Clicks on download links. A click is not a completed download or a record of reading. Visitor counts below five are shown as "fewer than 5".</p>
          {stats && stats.length === 0 && <p className="text-sm text-ink-soft">No published editions yet.</p>}
          {stats && stats.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead><tr className="border-b border-paper-edge"><th scope="col" className="py-2">Edition</th><th scope="col" className="py-2">Clicks</th><th scope="col" className="py-2">Visitors (approx.)</th></tr></thead>
                <tbody>{stats.map((s) => <tr key={s.editionId} className="border-b border-paper-edge"><td className="py-2 font-bold">{s.title}</td><td className="py-2">{s.clicks}</td><td className="py-2">{s.approxVisitors}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Card title="Editions">
        {rows.length === 0 && <p className="text-sm text-ink-soft">No editions yet.</p>}
        <ul className="grid gap-2">
          {rows.map((e) => (
            <li key={e.id}>
              <button type="button" onClick={() => pick(e)} className="flex w-full flex-wrap justify-between gap-2 rounded-lg border border-paper-edge px-4 py-3 text-left hover:bg-paper">
                <span className="font-bold">{e.title}</span>
                <span className="text-sm text-ink-soft">{e.status}{e.authorizedBy ? ` · authorized by ${e.authorizedBy}` : ' · not authorized'}{e.pdfPath ? '' : ' · no PDF'}</span>
              </button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
