// Live certification of the website backend against a LOCAL Supabase stack started inside a disposable CI job.
// Real GoTrue (password accounts for test users only), real PostgREST with real JWTs, real Storage, real Edge Functions
// served by the local runtime, and the migrations 000-110 applied from this repository.
//
// Never runs against a hosted project: the API URL must be a loopback address, and the database container must be the
// one named for this run's disposable project id. Node 22 built-ins only.
//
// Environment (set by the workflow):
//   CERT_PROJECT_ID        disposable local project id (must start with "websitecert-")
//   CERT_RESULTS_FILE      where to write the JSON results (no secret values)
// The local stack's keys are read from `supabase status -o env`. They are never printed.

import { execFileSync, execSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PROJECT = process.env.CERT_PROJECT_ID ?? '';
const RESULTS = process.env.CERT_RESULTS_FILE ?? 'website-certification-results.json';
if (!/^websitecert-[a-z0-9-]{4,40}$/.test(PROJECT)) fail('CERT_PROJECT_ID must look like websitecert-<run>.');

const statusEnv = parseEnv(execSync('supabase status -o env', { encoding: 'utf8' }));
const API = (statusEnv.API_URL ?? '').replace(/\/+$/, '');
const ANON = statusEnv.ANON_KEY ?? '';
const SERVICE = statusEnv.SERVICE_ROLE_KEY ?? '';
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(API)) fail('API_URL is not a loopback address. Refusing to run.');
if (!ANON || !SERVICE) fail('Local keys are missing from supabase status.');
const DB = `supabase_db_${PROJECT}`;

const results = [];
const check = (area, name, ok, detail = '') => {
  results.push({ area, name, ok: !!ok, detail: ok ? '' : String(detail).slice(0, 300) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${area}] ${name}${ok ? '' : ' :: ' + String(detail).slice(0, 200)}`);
};

// ---------- transport helpers
async function http(url, { method = 'GET', headers = {}, body, redirect = 'follow' } = {}) {
  const res = await fetch(url, { method, headers, body, redirect });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, json, text, headers: res.headers };
}
const bearer = (t) => ({ apikey: ANON, Authorization: `Bearer ${t || ANON}` });
const rpc = (fn, args, token) => http(`${API}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { ...bearer(token), 'content-type': 'application/json' }, body: JSON.stringify(args) });
const rest = (pathAndQuery, token, init = {}) => http(`${API}/rest/v1/${pathAndQuery}`, { ...init, headers: { ...bearer(token), ...(init.headers ?? {}) } });
const fn = (name, body, { token = ANON, ip, method = 'POST' } = {}) =>
  http(`${API}/functions/v1/${name}`, {
    method,
    headers: { ...bearer(token), 'content-type': 'application/json', ...(ip ? { 'cf-connecting-ip': ip } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });

// SQL against the disposable database container. Only fixed statements and values this script creates are used.
function sql(statement) {
  return execFileSync('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], {
    input: statement, encoding: 'utf8',
  }).trim();
}
const sqlLit = (v) => `'${String(v).replace(/'/g, "''")}'`;
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const countOf = (table) => Number(sql(`select count(*) from public.${table}`));

// ---------- accounts (test-only, generated per run, never printed)
async function createUser(label) {
  const email = `${label}-${PROJECT}@example.invalid`;
  const password = randomBytes(18).toString('base64url');
  const res = await http(`${API}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { ...bearer(SERVICE), 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (res.status >= 300 || !res.json?.id) throw new Error(`create user ${label}: HTTP ${res.status}`);
  return { id: res.json.id, email, password, token: null };
}
async function signIn(user) {
  const res = await http(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email: user.email, password: user.password }),
  });
  user.token = res.json?.access_token ?? null;
  return !!user.token;
}

function parseEnv(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const m = /^([A-Z_]+)="?([^"]*)"?$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}
function fail(msg) {
  console.error(`FATAL: ${msg}`);
  process.exit(2);
}

// PDF and PNG stand-ins. Storage records the declared content type and size, which registration verifies.
const PDF_BYTES = Buffer.from('%PDF-1.4\n% BLW York certification fixture\n%%EOF\n');
const PNG_BYTES = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

async function signedUpload(token, bucket, mime, bytes) {
  const issued = await fn('website-media-upload', { bucket, mime, bytes: bytes.length }, { token });
  if (issued.status !== 200 || !issued.json?.uploadUrl) return { ok: false, status: issued.status, body: issued.json };
  const put = await http(issued.json.uploadUrl, { method: 'PUT', headers: { 'content-type': mime, 'x-upsert': 'false' }, body: bytes });
  return { ok: put.status < 300, status: put.status, path: issued.json.path, bytes: bytes.length };
}

async function main() {
  // ---------- 0. Schema applied from the repository
  const migrations = Number(sql(`select count(*) from supabase_migrations.schema_migrations`));
  const tables = Number(sql(`select count(*) from information_schema.tables where table_schema='public' and table_name like 'web_%'`));
  check('schema', 'web_* tables are present from migrations 104-110', tables >= 14, `tables=${tables}`);
  check('schema', 'the migration ledger is non-empty', migrations > 0, `migrations=${migrations}`);
  const orphanFn = sql(`select count(*) from pg_proc where proname = 'web_orphaned_uploads'`);
  check('schema', 'migration 110 functions exist', orphanFn === '1', orphanFn);

  // ---------- 1. Real authentication and website roles
  const U = {};
  for (const label of ['bootstrapadmin', 'admin', 'editor', 'publisher', 'contributor', 'analyst', 'member']) U[label] = await createUser(label);
  for (const label of Object.keys(U)) check('auth', `password sign-in works for ${label}`, await signIn(U[label]));
  sql(`update public.profiles set role = 'admin', status = 'active' where id = ${sqlLit(U.bootstrapadmin.id)}`);
  check('auth', 'the bootstrap administrator is a core administrator', (await rpc('web_is_core_admin', {}, U.bootstrapadmin.token)).json === true);
  const ROLE = { admin: '7a000000-0000-4000-8000-000000000001', editor: '7a000000-0000-4000-8000-000000000002', publisher: '7a000000-0000-4000-8000-000000000003', contributor: '7a000000-0000-4000-8000-000000000004', analyst: '7a000000-0000-4000-8000-000000000005' };
  for (const r of ['admin', 'editor', 'publisher', 'contributor', 'analyst']) {
    const who = r === 'admin' ? 'admin' : r;
    const res = await rpc('web_assign_role', { p_profile_id: U[who === 'admin' ? 'admin' : who].id, p_role_id: ROLE[r], p_reason: 'Certification role assignment' }, U.bootstrapadmin.token);
    check('roles', `core administrator assigns the ${r} website role`, res.status < 300, res.json?.message ?? res.status);
  }
  // Keep the website administrator role on the separate "admin" account; it is not a core administrator.
  const selfEscalation = await rpc('web_assign_role', { p_profile_id: U.member.id, p_role_id: ROLE.admin, p_reason: 'Self escalation attempt' }, U.member.token);
  check('roles', 'a member without rights cannot assign roles', selfEscalation.status >= 400, selfEscalation.status);
  const memberPerms = await rpc('web_my_permissions', {}, U.member.token);
  check('roles', 'a member with no website role has no website permissions', Array.isArray(memberPerms.json) && memberPerms.json.length === 0, JSON.stringify(memberPerms.json));
  const analystWrite = await rpc('web_save_draft', { p_kind: 'page', p_key: 'home', p_body: { title: 'x', sections: [] }, p_expected_version: 1 }, U.analyst.token);
  check('roles', 'an analyst cannot edit content', analystWrite.status >= 400, analystWrite.status);

  // ---------- 2. Draft -> publish -> public rendering
  const draftBody = { title: 'Home', sections: [{ type: 'hero', heading: 'Certified heading', body: 'Certified body text.', url: '', visible: true }] };
  const content = await rpc('web_get_content', { p_kind: 'page', p_key: 'home' }, U.editor.token);
  const draftVersion = Array.isArray(content.json) ? content.json[0]?.draft_version : undefined;
  const saved = await rpc('web_save_draft', { p_kind: 'page', p_key: 'home', p_body: draftBody, p_expected_version: draftVersion ?? 1 }, U.editor.token);
  check('content', 'an editor saves a draft', saved.status < 300, saved.json?.message ?? saved.status);
  const cannotPublish = await rpc('web_publish_content', { p_kind: 'page', p_key: 'home', p_expected_draft_version: (draftVersion ?? 1) + 1, p_note: 'x' }, U.editor.token);
  check('content', 'an editor cannot publish', cannotPublish.status >= 400, cannotPublish.status);
  const newDraft = (await rpc('web_get_content', { p_kind: 'page', p_key: 'home' }, U.publisher.token)).json?.[0]?.draft_version;
  const published = await rpc('web_publish_content', { p_kind: 'page', p_key: 'home', p_expected_draft_version: newDraft, p_note: 'Certification' }, U.publisher.token);
  check('content', 'a publisher publishes the draft', published.status < 300, published.json?.message ?? published.status);
  const publicRead = await rest(`v_public_content?select=kind,key,body&kind=eq.page&key=eq.home`, null);
  check('content', 'an anonymous visitor sees the published page', publicRead.status === 200 && JSON.stringify(publicRead.json).includes('Certified heading'), publicRead.status);
  const hiddenDraft = await rpc('web_save_draft', { p_kind: 'page', p_key: 'home', p_body: { title: 'Leak', sections: [] }, p_expected_version: 1 }, null);
  check('content', 'an anonymous caller cannot write content', hiddenDraft.status >= 400, hiddenDraft.status);
  const memberDrafts = await rest('web_content?select=draft', U.member.token);
  check('content', 'a member cannot read draft content', memberDrafts.status >= 400 || (Array.isArray(memberDrafts.json) && memberDrafts.json.length === 0), memberDrafts.status);
  const anonDrafts = await rest('web_content?select=draft', null);
  check('content', 'an anonymous caller cannot read draft content', anonDrafts.status >= 400 || (Array.isArray(anonDrafts.json) && anonDrafts.json.length === 0), anonDrafts.status);

  // ---------- 3. Blog and events
  const post = await rpc('web_save_post', { p_id: null, p_slug: 'certification-post', p_title: 'Certification post', p_excerpt: 'An excerpt.', p_body: 'Body text.', p_category: 'News', p_author: 'Editorial', p_expected_version: 0 }, U.contributor.token);
  check('blog', 'a contributor saves a blog draft', post.status < 300, post.json?.message ?? post.status);
  const postId = typeof post.json === 'string' ? post.json : null;
  const pubPost = await rpc('web_set_post_status', { p_id: postId, p_status: 'published', p_publish_at: null, p_expected_version: 1 }, U.contributor.token);
  check('blog', 'a contributor cannot publish a post', pubPost.status >= 400, pubPost.status);
  const pubPost2 = await rpc('web_set_post_status', { p_id: postId, p_status: 'published', p_publish_at: null, p_expected_version: 1 }, U.publisher.token);
  check('blog', 'a publisher publishes the post', pubPost2.status < 300, pubPost2.json?.message ?? pubPost2.status);
  const publicPosts = await rest('v_public_posts?select=slug', null);
  check('blog', 'the published post is visible to visitors', publicPosts.status === 200 && JSON.stringify(publicPosts.json).includes('certification-post'), publicPosts.status);

  const EVENT = randomUUID();
  sql(`insert into public.events (id, title, date, location, created_by) values (${sqlLit(EVENT)}, 'Certification event', '2026-12-01', 'York University', ${sqlLit(U.admin.id)})`);
  const evPub = await rpc('web_set_event_publication', { p_event_id: EVENT, p_is_public: true, p_featured: false, p_slug: 'certification-event', p_title: 'Certification event', p_summary: 'Open to all.', p_registration_url: '', p_expected_version: 0 }, U.publisher.token);
  check('events', 'a publisher publishes an open event', evPub.status < 300, evPub.json?.message ?? evPub.status);
  const evPublic = await rest('v_public_events?select=slug', null);
  check('events', 'the open event is visible to visitors', evPublic.status === 200 && JSON.stringify(evPublic.json).includes('certification-event'), evPublic.status);
  const hiddenFields = await rest('v_public_events?select=created_by', null);
  check('events', 'the public events view exposes no creator field', hiddenFields.status >= 400, hiddenFields.status);

  // ---------- 4. Contact and New Here: consent, honeypot, abuse controls
  const consentHash = sha256('I agree that BLW York may reply to me.');
  const base = { name: 'Certification Visitor', email: 'visitor@example.invalid', phone: '', message: 'Hello', topic: 'General inquiry', consentVersion: 'v1', consentTextHash: consentHash, honeypot: '', turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX' };
  const before = countOf('web_inbound_submissions');
  const contact = await fn('website-inquiry', { ...base, kind: 'contact' }, { ip: '198.51.100.7' });
  check('inquiries', 'a valid contact message is accepted (Turnstile test token)', contact.status === 202, `${contact.status} ${contact.text.slice(0, 120)}`);
  const newHere = await fn('website-inquiry', { ...base, kind: 'new_here', message: 'Status: first visit.' }, { ip: '198.51.100.7' });
  check('inquiries', 'a valid New Here message is accepted', newHere.status === 202, `${newHere.status}`);
  const bot = await fn('website-inquiry', { ...base, kind: 'contact', honeypot: 'bot-value' }, { ip: '198.51.100.7' });
  check('inquiries', 'a filled honeypot is accepted silently and stored nothing', bot.status === 202, bot.status);
  const after = countOf('web_inbound_submissions');
  check('inquiries', 'exactly the two genuine messages were stored', after - before === 2, `stored=${after - before}`);
  const noConsent = await fn('website-inquiry', { ...base, kind: 'contact', consentTextHash: 'not-a-hash' }, { ip: '198.51.100.8' });
  check('inquiries', 'a malformed consent record is refused', noConsent.status === 400, noConsent.status);
  const noToken = await fn('website-inquiry', { ...base, kind: 'contact', turnstileToken: '' }, { ip: '198.51.100.8' });
  check('inquiries', 'a request without a Turnstile token is refused', noToken.status === 400, noToken.status);
  const extra = await fn('website-inquiry', { ...base, kind: 'contact', role: 'admin' }, { ip: '198.51.100.8' });
  check('inquiries', 'unexpected fields are refused by the schema', extra.status === 400, extra.status);
  let limited = null;
  for (let i = 0; i < 6; i++) limited = await fn('website-inquiry', { ...base, kind: 'contact' }, { ip: '198.51.100.9' });
  check('inquiries', 'the per-client limit refuses the sixth message in the window with 429', limited.status === 429, limited.status);
  const anonInbox = await rest('web_inbound_submissions?select=name,email', null);
  check('inquiries', 'an anonymous caller cannot read submissions', anonInbox.status >= 400 || (Array.isArray(anonInbox.json) && anonInbox.json.length === 0), anonInbox.status);
  const memberInbox = await rpc('web_list_inquiries', { p_status: null }, U.member.token);
  check('inquiries', 'a member cannot list submissions', memberInbox.status >= 400, memberInbox.status);
  const cols = sql(`select string_agg(column_name, ',') from information_schema.columns where table_schema='public' and table_name in ('web_inbound_submissions','web_download_events')`);
  check('privacy', 'no network address or user agent column is stored for submissions or downloads', !/ip_address|user_agent|\bip\b/.test(cols), cols);

  // ---------- 5. Private media upload and registration
  const img = await signedUpload(U.contributor.token, 'site-media', 'image/png', PNG_BYTES);
  check('media', 'a contributor uploads a site image through the signed upload', img.ok, JSON.stringify(img).slice(0, 160));
  const reg = await rpc('web_register_media', { p_bucket: 'site-media', p_storage_path: img.path, p_mime: 'image/png', p_bytes: PNG_BYTES.length, p_alt_text: 'Certification image' }, U.contributor.token);
  check('media', 'the uploaded image is registered', reg.status < 300, reg.json?.message ?? reg.status);
  const publicImg = await http(`${API}/storage/v1/object/public/site-media/${img.path}`);
  check('media', 'the published image is served from the public bucket', publicImg.status === 200, publicImg.status);
  const wrongSize = await rpc('web_register_media', { p_bucket: 'site-media', p_storage_path: img.path, p_mime: 'image/png', p_bytes: 9999, p_alt_text: 'x' }, U.contributor.token);
  check('media', 'registration with a wrong declared size is refused', wrongSize.status >= 400, wrongSize.status);
  const pdfForContributor = await signedUpload(U.contributor.token, 'rhapsody-pdfs', 'application/pdf', PDF_BYTES);
  check('media', 'a contributor cannot upload a Rhapsody PDF', pdfForContributor.ok === false, pdfForContributor.status);
  const noAuthUpload = await fn('website-media-upload', { bucket: 'site-media', mime: 'image/png', bytes: 10 }, { token: ANON });
  check('media', 'an upload without a signed-in user is refused', noAuthUpload.status === 401, noAuthUpload.status);
  const memberUpload = await signedUpload(U.member.token, 'site-media', 'image/png', PNG_BYTES);
  check('media', 'a member without a website role cannot upload', memberUpload.ok === false, memberUpload.status);

  // ---------- 6. Rhapsody: private PDF, signed delivery and download analytics
  const pdf = await signedUpload(U.admin.token, 'rhapsody-pdfs', 'application/pdf', PDF_BYTES);
  check('rhapsody', 'an administrator uploads the private PDF', pdf.ok, pdf.status);
  const pdfId = (await rpc('web_register_media', { p_bucket: 'rhapsody-pdfs', p_storage_path: pdf.path, p_mime: 'application/pdf', p_bytes: PDF_BYTES.length, p_alt_text: '' }, U.admin.token)).json;
  check('rhapsody', 'the PDF is registered', typeof pdfId === 'string', JSON.stringify(pdfId));
  const edition = await rpc('web_save_edition', { p_id: null, p_kind: 'monthly', p_period_start: '2026-11-01', p_title: 'Certification edition', p_description: '', p_pdf_media_id: pdfId, p_expected_version: 0 }, U.admin.token);
  const edId = typeof edition.json === 'string' ? edition.json : null;
  check('rhapsody', 'an edition is saved with its PDF', !!edId, edition.json?.message ?? edition.status);
  const early = await fn('website-rhapsody-pdf', undefined, { token: ANON, method: 'GET' });
  check('rhapsody', 'the download function refuses a missing edition', early.status === 404 || early.status === 400, early.status);
  const unpublished = await fn(`website-rhapsody-pdf?edition=${edId}`, undefined, { token: ANON, method: 'GET', ip: '198.51.100.20' });
  check('rhapsody', 'an unpublished edition is not downloadable', unpublished.status === 404, unpublished.status);
  const selfAuthorise = await rpc('web_authorize_edition', { p_id: edId, p_authorized_by: 'Certification', p_expected_version: 1 }, U.editor.token);
  check('rhapsody', 'an editor cannot authorise an edition', selfAuthorise.status >= 400, selfAuthorise.status);
  const auth = await rpc('web_authorize_edition', { p_id: edId, p_authorized_by: 'Certification', p_expected_version: 1 }, U.publisher.token);
  check('rhapsody', 'a publisher authorises the edition', auth.status < 300, auth.json?.message ?? auth.status);
  const pubEd = await rpc('web_set_edition_status', { p_id: edId, p_status: 'published', p_expected_version: 2 }, U.publisher.token);
  check('rhapsody', 'a publisher publishes the authorised edition', pubEd.status < 300, pubEd.json?.message ?? pubEd.status);
  const dl = await fn(`website-rhapsody-pdf?edition=${edId}&src=certification&utm_source=test&utm_campaign=cert`, undefined, { token: ANON, method: 'GET', ip: '198.51.100.21' });
  check('rhapsody', 'the download returns a redirect to a signed link', dl.status === 302 && typeof dl.headers.get('location') === 'string', dl.status);
  const signedUrl = dl.headers.get('location') ?? '';
  check('rhapsody', 'the signed link is a short-lived signed storage URL', /\/storage\/v1\/object\/sign\/rhapsody-pdfs\/.+\?token=/.test(signedUrl), signedUrl.slice(0, 80));
  check('rhapsody', 'the download response is not cached and does not leak the referrer', dl.headers.get('cache-control') === 'no-store' && dl.headers.get('referrer-policy') === 'no-referrer');
  const file = await http(signedUrl);
  check('rhapsody', 'the signed link delivers the PDF', file.status === 200 && file.text.startsWith('%PDF'), file.status);
  const directPrivate = await http(`${API}/storage/v1/object/public/rhapsody-pdfs/${pdf.path}`);
  check('rhapsody', 'the private PDF is not reachable through the public path', directPrivate.status >= 400, directPrivate.status);
  const directAnon = await http(`${API}/storage/v1/object/rhapsody-pdfs/${pdf.path}`, { headers: bearer(null) });
  check('rhapsody', 'the private PDF is not reachable anonymously', directAnon.status >= 400, directAnon.status);
  const stats = await rpc('web_download_stats', { p_days: 30 }, U.analyst.token);
  check('analytics', 'an analyst reads aggregated download statistics', stats.status < 300 && Array.isArray(stats.json), stats.json?.message ?? stats.status);
  const statsRow = Array.isArray(stats.json) ? stats.json.find((r) => r.title === 'Certification edition') : undefined;
  check('analytics', 'small audiences are shown as "fewer than 5", never an exact count', statsRow?.approx_visitors === 'fewer than 5', JSON.stringify(statsRow));
  const editorStats = await rpc('web_download_stats', { p_days: 30 }, U.editor.token);
  check('analytics', 'an editor cannot read download statistics', editorStats.status >= 400, editorStats.status);
  const rawEvents = await rest('web_download_events?select=visitor_hash', U.analyst.token);
  check('analytics', 'an analyst cannot read raw visitor hashes', rawEvents.status >= 400, rawEvents.status);

  // ---------- 7. Audit logging, append-only evidence
  const audit = await rest('web_audit_log?select=action', U.bootstrapadmin.token);
  const actions = Array.isArray(audit.json) ? audit.json.map((r) => r.action) : [];
  for (const a of ['assignment.created', 'content.published', 'media.registered', 'rhapsody.authorized']) {
    check('audit', `the audit log records ${a}`, actions.includes(a), `${actions.length} entries`);
  }
  const tamper = await rest(`web_audit_log?id=not.is.null`, U.bootstrapadmin.token, { method: 'DELETE' });
  check('audit', 'the audit log cannot be deleted, even by an administrator', tamper.status >= 400, tamper.status);
  const tamper2 = await rest(`web_audit_log?id=not.is.null`, U.bootstrapadmin.token, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'x' }) });
  check('audit', 'the audit log cannot be edited', tamper2.status >= 400, tamper2.status);

  // ---------- 8. Abandoned upload cleanup (referenced assets are kept)
  const orphanPath = `2026/10/${randomUUID()}.png`;
  await http(`${API}/storage/v1/object/site-media/${orphanPath}`, { method: 'POST', headers: { ...bearer(SERVICE), 'content-type': 'image/png' }, body: PNG_BYTES });
  sql(`update storage.objects set created_at = now() - interval '3 days' where bucket_id='site-media' and name = ${sqlLit(orphanPath)}`);
  const denied = await fn('website-media-cleanup', {}, { token: ANON });
  check('cleanup', 'the cleanup function refuses a caller without the service key', denied.status === 401, denied.status);
  const run = await fn('website-media-cleanup', {}, { token: SERVICE });
  check('cleanup', 'the cleanup run completes', run.status === 200, run.status);
  const orphanGone = await http(`${API}/storage/v1/object/public/site-media/${orphanPath}`);
  check('cleanup', 'the abandoned upload is removed', orphanGone.status === 404, orphanGone.status);
  const keptImg = await http(`${API}/storage/v1/object/public/site-media/${img.path}`);
  check('cleanup', 'a registered image is kept', keptImg.status === 200, keptImg.status);
  const keptPdf = await http(`${API}/storage/v1/object/rhapsody-pdfs/${pdf.path}`, { headers: bearer(SERVICE) });
  check('cleanup', 'a registered PDF is kept', keptPdf.status === 200, keptPdf.status);

  // ---------- 9. Backup and restore (website tables, restored into a second database and compared)
  const dir = mkdtempSync(path.join(tmpdir(), 'cert-'));
  const dumpFile = path.join(dir, 'backup.dump');
  writeFileSync(dumpFile, execFileSync('docker', ['exec', DB, 'pg_dump', '-U', 'postgres', '-d', 'postgres', '-Fc', '--schema=public'], { maxBuffer: 1 << 30 }));
  check('recovery', 'a backup of the website schema is written', readFileSync(dumpFile).length > 1000, 'empty dump');
  sql(`drop database if exists restore_check`);
  sql(`create database restore_check`);
  execFileSync('docker', ['cp', dumpFile, `${DB}:/tmp/backup.dump`]);
  let restoreExit = 0;
  try {
    execFileSync('docker', ['exec', DB, 'pg_restore', '-U', 'postgres', '-d', 'restore_check', '--no-owner', '--no-privileges', '/tmp/backup.dump'], { stdio: 'ignore' });
  } catch (e) {
    restoreExit = e.status ?? 1;
  }
  const compare = ['web_versions', 'web_posts', 'web_media', 'web_rhapsody_editions', 'web_audit_log', 'web_download_events'];
  for (const t of compare) {
    const live = sql(`select count(*) from public.${t}`);
    const restored = execFileSync('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-d', 'restore_check', '-At', '-c', `select count(*) from public.${t}`], { encoding: 'utf8' }).trim();
    check('recovery', `restored ${t} matches the live row count`, live === restored, `live=${live} restored=${restored} (restore exit ${restoreExit})`);
  }
  sql(`drop database if exists restore_check`);

  // ---------- Results
  const failed = results.filter((r) => !r.ok);
  const summary = { project: PROJECT, total: results.length, passed: results.length - failed.length, failed: failed.length, results };
  writeFileSync(RESULTS, JSON.stringify(summary, null, 2));
  console.log(`\nWEBSITE LIVE CERTIFICATION: ${summary.passed}/${summary.total} passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  // The message is printed without any request or key material.
  console.error(`FATAL during certification: ${String(e.message ?? e).slice(0, 300)}`);
  process.exit(1);
});
