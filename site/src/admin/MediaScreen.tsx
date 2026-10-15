import { useEffect, useState } from 'react';
import type { MediaRow, WebsiteApi } from '../api/websiteApi';
import type { WebsitePermission } from './permissions';
import { Button, Card, errorMessage, Field, inputClass, Notice } from './common';
import { clientMediaError, MEDIA_LIMITS, type MediaBucketName } from '../lib/mediaRules';

interface Ctx { api: WebsiteApi; perms: ReadonlySet<WebsitePermission> }
type Msg = { tone: 'ok' | 'error' | 'info'; text: string } | null;

/** Upload screen. The file goes through the signed-upload function; the database checks the user's permissions. */
export function MediaScreen({ api, perms }: Ctx) {
  const canUploadImages = perms.has('website.media.upload');
  const canUploadPdfs = perms.has('website.media.upload') && perms.has('website.rhapsody.manage');
  const [rows, setRows] = useState<MediaRow[]>([]);
  const [bucket, setBucket] = useState<MediaBucketName>('site-media');
  const [file, setFile] = useState<File | null>(null);
  const [alt, setAlt] = useState('');
  const [busy, setBusy] = useState(false);
  const [fileKey, setFileKey] = useState(0);
  const [msg, setMsg] = useState<Msg>(null);

  const refresh = async () => {
    try {
      setRows(await api.listMedia());
    } catch (e) {
      setMsg({ tone: 'error', text: errorMessage(e) });
    }
  };
  useEffect(() => { void refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const allowedBuckets = (Object.keys(MEDIA_LIMITS) as MediaBucketName[]).filter((b) => (b === 'site-media' ? canUploadImages : canUploadPdfs));

  const upload = async () => {
    const problem = clientMediaError(bucket, file, alt);
    if (problem || !file) {
      setMsg({ tone: 'error', text: problem ?? 'Choose a file to upload.' });
      return;
    }
    setBusy(true);
    setMsg({ tone: 'info', text: 'Uploading…' });
    try {
      await api.uploadMedia({ bucket, mime: file.type, file, altText: alt.trim() });
      setMsg({ tone: 'ok', text: 'File uploaded and registered.' });
      setFile(null);
      setAlt('');
      setFileKey((k) => k + 1); // clears the file input
      await refresh();
    } catch (e) {
      setMsg({ tone: 'error', text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-6">
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <Card title="Media library">
        <p className="mb-4 text-sm text-ink-soft">
          Images are public once published. PDFs are private and reached only through tracked, short-lived links. Uploaded
          files get a generated name; the original file name is not kept.
        </p>
        {allowedBuckets.length === 0 && (
          <p className="mb-4 text-sm text-ink-soft">You can view the library. Uploading needs the media upload permission.</p>
        )}
        {allowedBuckets.length > 0 && (
          <div className="grid gap-4 rounded-xl border border-paper-edge p-4 md:grid-cols-2">
            <Field label="Upload to">{(p) => (
              <select {...p} className={inputClass} value={bucket} disabled={busy} onChange={(e) => setBucket(e.target.value as MediaBucketName)}>
                {allowedBuckets.map((b) => <option key={b} value={b}>{MEDIA_LIMITS[b].label}</option>)}
              </select>
            )}</Field>
            <Field label="File" hint={bucket === 'site-media' ? 'JPEG, PNG or WebP, up to 5 MB.' : 'PDF, up to 25 MB.'}>{(p) => (
              <input
                {...p}
                key={fileKey}
                type="file"
                accept={MEDIA_LIMITS[bucket].mimes.join(',')}
                disabled={busy}
                className="min-h-[44px] w-full text-sm"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            )}</Field>
            <div className="md:col-span-2">
              <Field label="Description for screen readers" hint={bucket === 'site-media' ? 'Required for images.' : 'Optional for PDFs.'}>{(p) => (
                <input {...p} className={inputClass} value={alt} disabled={busy} onChange={(e) => setAlt(e.target.value)} />
              )}</Field>
            </div>
            <div className="md:col-span-2">
              <Button onClick={upload} disabled={busy}>{busy ? 'Uploading…' : 'Upload file'}</Button>
            </div>
          </div>
        )}
        <ul className="mt-5 grid gap-2">
          {rows.map((m) => (
            <li key={m.id} className="flex flex-wrap justify-between gap-2 border-b border-paper-edge pb-2 text-sm">
              <span className="font-bold">{m.bucket === 'rhapsody-pdfs' ? 'Private PDF' : m.storagePath}</span>
              <span className="text-ink-soft">{m.bucket} · {m.mime} · {m.altText || 'no description'}</span>
            </li>
          ))}
        </ul>
        {rows.length === 0 && <p className="mt-4 text-sm text-ink-soft">No files uploaded yet.</p>}
      </Card>
    </div>
  );
}
