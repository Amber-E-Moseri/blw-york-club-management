// Typed client for the Website Management backend (migrations 104-107). Calls PostgREST RPCs and reads public views.
// Public reads use only the anon key. Administrative calls send the signed-in user's access token, so the database
// checks every permission with that user's identity. No service-role key is ever used in the browser.

export interface ApiConfig {
  url: string;
  anonKey: string;
  /** Returns the signed-in user's access token, or null when signed out. */
  getAccessToken: () => string | null;
  fetchImpl?: typeof fetch;
}

export class ApiError extends Error {
  constructor(public readonly kind: 'forbidden' | 'conflict' | 'rate_limited' | 'invalid' | 'not_found' | 'unauthenticated' | 'network' | 'server', message: string) {
    super(message);
  }
}

/** Maps a PostgREST error body to a user-facing error. Codes come from the database functions. */
export function mapDbError(status: number, body: { code?: string; message?: string } | null): ApiError {
  const message = body?.message ?? 'The request could not be completed.';
  if (body?.code === '42501') return new ApiError('forbidden', 'You do not have permission for this action.');
  if (body?.code === '40001') return new ApiError('conflict', message);
  if (body?.code === 'P0429') return new ApiError('rate_limited', message);
  if (body?.code === '22023') return new ApiError('invalid', message);
  if (body?.code === 'P0002') return new ApiError('not_found', message);
  if (status === 401) return new ApiError('unauthenticated', 'Please sign in again.');
  if (status >= 500) return new ApiError('server', 'The website service is unavailable. Try again shortly.');
  return new ApiError('server', message);
}

export type ContentKind = 'page' | 'settings' | 'navigation';

export interface ContentState {
  draft: Record<string, unknown>;
  draftVersion: number;
  publishedVersionId: string | null;
  publishedBody: Record<string, unknown> | null;
  publishedVersionNo: number | null;
}

export interface VersionRow {
  id: string;
  versionNo: number;
  note: string;
  createdAt: string;
  isPublished: boolean;
}

export interface PostRow {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  body: string;
  category: string;
  authorDisplay: string;
  status: 'draft' | 'published' | 'archived';
  publishAt: string | null;
  publishedAt: string | null;
  version: number;
}

export interface EventPublicationRow {
  eventId: string;
  title: string;
  eventDate: string;
  isPublic: boolean;
  featured: boolean;
  slug: string | null;
  publicTitle: string | null;
  publicSummary: string;
  registrationUrl: string | null;
  version: number;
}

export interface InquiryRow {
  id: string;
  kind: 'contact' | 'new_here' | 'prayer';
  name: string;
  email: string | null;
  phone: string | null;
  message: string;
  topic: string | null;
  status: 'new' | 'in_review' | 'closed';
  consentVersion: string;
  createdAt: string;
  retainUntil: string;
}

export interface MediaRow {
  id: string;
  bucket: 'site-media' | 'rhapsody-pdfs';
  storagePath: string;
  mime: string;
  bytes: number;
  altText: string;
  caption: string;
  status: 'active' | 'archived';
  uploadedAt: string;
}

export interface RoleRow {
  id: string;
  name: string;
  description: string;
  permissions: string[];
}

export interface AssignmentRow {
  id: string;
  roleId: string;
  profileId: string;
  assignedAt: string;
}

export interface PublicContentRow {
  kind: ContentKind;
  key: string;
  body: Record<string, unknown>;
  versionNo: number;
  publishedAt: string;
}

export interface PublicPostRow {
  slug: string;
  title: string;
  excerpt: string;
  body: string;
  category: string;
  authorDisplay: string;
  publishedAt: string;
}

export interface PublicEventRow {
  slug: string;
  title: string;
  summary: string;
  eventDate: string;
  eventTime: string | null;
  location: string | null;
  category: string | null;
  featured: boolean;
  registrationUrl: string | null;
}


export interface EditionRow {
  id: string;
  kind: 'monthly' | 'daily';
  periodStart: string;
  title: string;
  description: string;
  pdfMediaId: string | null;
  pdfPath: string | null;
  authorizedBy: string | null;
  authorizedAt: string | null;
  status: 'draft' | 'published' | 'archived';
  version: number;
}

export interface DownloadStatRow {
  editionId: string;
  title: string;
  clicks: number;
  /** A number as text, or "fewer than 5". Visitor counts under five are never shown as numbers. */
  approxVisitors: string;
  firstDay: string | null;
  lastDay: string | null;
}

export interface PublicEditionRow {
  editionId: string;
  kind: 'monthly' | 'daily';
  periodStart: string;
  title: string;
  description: string;
  authorizedBy: string;
}

type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

export function createWebsiteApi(config: ApiConfig) {
  const doFetch = config.fetchImpl ?? fetch;
  const base = config.url.replace(/\/$/, '');

  async function parse(res: Response): Promise<unknown> {
    const text = await res.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch { return text; }
  }

  async function call<T>(path: string, init: { method?: string; body?: Json; token?: boolean; prefer?: string } = {}): Promise<T> {
    const headers: Record<string, string> = { apikey: config.anonKey, 'Content-Type': 'application/json' };
    const token = init.token === false ? null : config.getAccessToken();
    headers.Authorization = `Bearer ${token ?? config.anonKey}`;
    if (init.prefer) headers.Prefer = init.prefer;
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, { method: init.method ?? 'GET', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
    } catch {
      throw new ApiError('network', 'Could not reach the website service. Check your connection.');
    }
    const data = await parse(res);
    if (!res.ok) throw mapDbError(res.status, (data && typeof data === 'object' ? data : null) as { code?: string; message?: string } | null);
    return data as T;
  }

  const rpc = <T>(fn: string, args: Record<string, unknown>) => call<T>(`/rest/v1/rpc/${fn}`, { method: 'POST', body: args });
  const publicRead = <T>(path: string) => call<T>(path, { token: false });

  return {
    // ---- session and permissions
    async myPermissions(): Promise<string[]> {
      const rows = await rpc<{ permission_key: string }[]>('web_my_permissions', {});
      return rows.map((r) => r.permission_key);
    },
    async isCoreAdmin(): Promise<boolean> {
      return rpc<boolean>('web_is_core_admin', {});
    },

    // ---- content (pages, settings, navigation)
    async getContent(kind: ContentKind, key: string): Promise<ContentState> {
      const rows = await rpc<Array<{ draft: Record<string, unknown>; draft_version: number; published_version_id: string | null; published_body: Record<string, unknown> | null; published_version_no: number | null }>>('web_get_content', { p_kind: kind, p_key: key });
      const r = rows[0];
      if (!r) throw new ApiError('not_found', 'That content does not exist.');
      return { draft: r.draft, draftVersion: r.draft_version, publishedVersionId: r.published_version_id, publishedBody: r.published_body, publishedVersionNo: r.published_version_no };
    },
    saveDraft(kind: ContentKind, key: string, body: Record<string, unknown>, expectedVersion: number): Promise<number> {
      return rpc<number>('web_save_draft', { p_kind: kind, p_key: key, p_body: body, p_expected_version: expectedVersion });
    },
    publishContent(kind: ContentKind, key: string, expectedDraftVersion: number, note: string): Promise<string> {
      return rpc<string>('web_publish_content', { p_kind: kind, p_key: key, p_expected_draft_version: expectedDraftVersion, p_note: note });
    },
    rollbackContent(kind: ContentKind, key: string, versionId: string, reason: string): Promise<void> {
      return rpc<void>('web_rollback_content', { p_kind: kind, p_key: key, p_version_id: versionId, p_reason: reason });
    },
    /** Withdraws a published page from the public site. The draft and every version are kept. */
    unpublishPage(key: string, reason: string): Promise<void> {
      return rpc<void>('web_unpublish_content', { p_kind: 'page', p_key: key, p_reason: reason });
    },
    async listVersions(kind: ContentKind, key: string): Promise<VersionRow[]> {
      const rows = await rpc<Array<{ id: string; version_no: number; note: string; created_at: string; is_published: boolean }>>('web_list_versions', { p_kind: kind, p_key: key });
      return rows.map((r) => ({ id: r.id, versionNo: r.version_no, note: r.note, createdAt: r.created_at, isPublished: r.is_published }));
    },

    // ---- blog
    async listPosts(): Promise<PostRow[]> {
      const rows = await rpc<Array<Record<string, unknown>>>('web_list_posts', {});
      return rows.map(mapPost);
    },
    savePost(input: { id: string | null; slug: string; title: string; excerpt: string; body: string; category: string; author: string; expectedVersion: number | null }): Promise<string> {
      return rpc<string>('web_save_post', { p_id: input.id, p_slug: input.slug, p_title: input.title, p_excerpt: input.excerpt, p_body: input.body, p_category: input.category, p_author: input.author, p_expected_version: input.expectedVersion });
    },
    setPostStatus(id: string, status: 'draft' | 'published' | 'archived', publishAt: string | null, expectedVersion: number): Promise<void> {
      return rpc<void>('web_set_post_status', { p_id: id, p_status: status, p_publish_at: publishAt, p_expected_version: expectedVersion });
    },

    // ---- events
    async listEventPublications(): Promise<EventPublicationRow[]> {
      const rows = await rpc<Array<Record<string, unknown>>>('web_list_event_publications', {});
      return rows.map((r) => ({
        eventId: r.event_id as string, title: r.title as string, eventDate: r.event_date as string,
        isPublic: r.is_public as boolean, featured: r.featured as boolean, slug: (r.slug as string) ?? null,
        publicTitle: (r.public_title as string) ?? null, publicSummary: (r.public_summary as string) ?? '',
        registrationUrl: (r.registration_url as string) ?? null, version: r.version as number,
      }));
    },
    setEventPublication(input: { eventId: string; isPublic: boolean; featured: boolean; slug: string; title: string; summary: string; registrationUrl: string; expectedVersion: number }): Promise<void> {
      return rpc<void>('web_set_event_publication', { p_event_id: input.eventId, p_is_public: input.isPublic, p_featured: input.featured, p_slug: input.slug, p_title: input.title, p_summary: input.summary, p_registration_url: input.registrationUrl, p_expected_version: input.expectedVersion });
    },

    // ---- inquiries
    async listInquiries(status: InquiryRow['status'] | null): Promise<InquiryRow[]> {
      const rows = await rpc<Array<Record<string, unknown>>>('web_list_inquiries', { p_status: status });
      return rows.map((r) => ({
        id: r.id as string, kind: r.kind as InquiryRow['kind'], name: r.name as string, email: (r.email as string) ?? null,
        phone: (r.phone as string) ?? null, message: r.message as string, topic: (r.topic as string) ?? null,
        status: r.status as InquiryRow['status'], consentVersion: r.consent_version as string,
        createdAt: r.created_at as string, retainUntil: r.retain_until as string,
      }));
    },
    setInquiryStatus(id: string, status: InquiryRow['status']): Promise<void> {
      return rpc<void>('web_set_inquiry_status', { p_id: id, p_status: status });
    },

    // ---- media
    async listMedia(): Promise<MediaRow[]> {
      const rows = await rpc<Array<Record<string, unknown>>>('web_list_media', {});
      return rows.map((r) => ({
        id: r.id as string, bucket: r.bucket as MediaRow['bucket'], storagePath: r.storage_path as string, mime: r.mime as string,
        bytes: Number(r.bytes), altText: r.alt_text as string, caption: r.caption as string, status: r.status as MediaRow['status'], uploadedAt: r.uploaded_at as string,
      }));
    },
    registerMedia(input: { bucket: MediaRow['bucket']; storagePath: string; mime: string; bytes: number; altText: string }): Promise<string> {
      return rpc<string>('web_register_media', { p_bucket: input.bucket, p_storage_path: input.storagePath, p_mime: input.mime, p_bytes: input.bytes, p_alt_text: input.altText });
    },

    /**
     * Uploads a file: the signed-upload function checks the user's permission and issues a short-lived URL, the bytes go
     * straight to storage, and then the object is registered. The stored name is generated, never the original file name.
     * Returns the stored path.
     */
    async uploadMedia(input: { bucket: MediaRow['bucket']; mime: string; file: Blob; altText: string }): Promise<string> {
      const token = config.getAccessToken();
      if (!token) throw new ApiError('unauthenticated', 'Please sign in to upload.');
      const bytes = input.file.size;
      let issuedRes: Response;
      try {
        issuedRes = await doFetch(`${base}/functions/v1/website-media-upload`, {
          method: 'POST',
          headers: { apikey: config.anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ bucket: input.bucket, mime: input.mime, bytes }),
        });
      } catch {
        throw new ApiError('network', 'Could not reach the website service. Check your connection.');
      }
      const issued = (await parse(issuedRes)) as { path?: string; uploadUrl?: string; error?: string } | null;
      if (!issuedRes.ok || !issued?.path || !issued.uploadUrl) {
        if (issuedRes.status === 401) throw new ApiError('unauthenticated', 'Please sign in again.');
        if (issuedRes.status === 403) throw new ApiError('forbidden', 'You do not have permission to upload here.');
        throw new ApiError(issuedRes.status === 400 ? 'invalid' : 'server', typeof issued?.error === 'string' ? issued.error : 'The file could not be uploaded.');
      }
      let put: Response;
      try {
        put = await doFetch(issued.uploadUrl, { method: 'PUT', headers: { 'Content-Type': input.mime, 'x-upsert': 'false' }, body: input.file });
      } catch {
        throw new ApiError('network', 'The file could not be uploaded. Check your connection and try again.');
      }
      if (!put.ok) throw new ApiError('server', 'The file could not be uploaded. Please try again.');
      await rpc<string>('web_register_media', { p_bucket: input.bucket, p_storage_path: issued.path, p_mime: input.mime, p_bytes: bytes, p_alt_text: input.altText });
      return issued.path;
    },

    // ---- roles (core administrators)
    async listRoles(): Promise<RoleRow[]> {
      const rows = await rpc<Array<{ id: string; name: string; description: string; permissions: string[] }>>('web_list_website_roles', {});
      return rows.map((r) => ({ id: r.id, name: r.name, description: r.description, permissions: r.permissions }));
    },
    async listAssignments(): Promise<AssignmentRow[]> {
      const rows = await rpc<Array<{ id: string; role_id: string; profile_id: string; assigned_at: string }>>('web_list_website_assignments', {});
      return rows.map((r) => ({ id: r.id, roleId: r.role_id, profileId: r.profile_id, assignedAt: r.assigned_at }));
    },
    /** One call creates the role and its permissions together, so a refused permission leaves no partial role. */
    createRole(name: string, description: string, permissions: string[], reason: string): Promise<string> {
      return rpc<string>('web_create_website_role', { p_name: name, p_description: description, p_permissions: permissions, p_reason: reason });
    },
    setRolePermission(roleId: string, permission: string, grant: boolean, reason: string): Promise<void> {
      return rpc<void>('web_set_website_permission', { p_role_id: roleId, p_permission: permission, p_grant: grant, p_reason: reason });
    },
    assignRole(profileId: string, roleId: string, reason: string): Promise<string> {
      return rpc<string>('web_assign_website_role', { p_profile_id: profileId, p_role_id: roleId, p_reason: reason });
    },
    revokeAssignment(assignmentId: string, reason: string): Promise<void> {
      return rpc<void>('web_unassign_website_role', { p_assignment_id: assignmentId, p_reason: reason });
    },

    // ---- Rhapsody (staff)
    async listEditions(): Promise<EditionRow[]> {
      const rows = await rpc<Array<Record<string, unknown>>>('web_list_editions', {});
      return rows.map((r) => ({
        id: r.id as string, kind: r.kind as EditionRow['kind'], periodStart: r.period_start as string, title: r.title as string,
        description: r.description as string, pdfMediaId: (r.pdf_media_id as string) ?? null, pdfPath: (r.pdf_path as string) ?? null,
        authorizedBy: (r.authorized_by as string) ?? null, authorizedAt: (r.authorized_at as string) ?? null,
        status: r.status as EditionRow['status'], version: r.version as number,
      }));
    },
    saveEdition(input: { id: string | null; kind: EditionRow['kind']; periodStart: string; title: string; description: string; pdfMediaId: string | null; expectedVersion: number }): Promise<string> {
      return rpc<string>('web_save_edition', { p_id: input.id, p_kind: input.kind, p_period_start: input.periodStart, p_title: input.title, p_description: input.description, p_pdf_media_id: input.pdfMediaId, p_expected_version: input.expectedVersion });
    },
    authorizeEdition(id: string, authorizedBy: string, expectedVersion: number): Promise<void> {
      return rpc<void>('web_authorize_edition', { p_id: id, p_authorized_by: authorizedBy, p_expected_version: expectedVersion });
    },
    setEditionStatus(id: string, status: EditionRow['status'], expectedVersion: number): Promise<void> {
      return rpc<void>('web_set_edition_status', { p_id: id, p_status: status, p_expected_version: expectedVersion });
    },
    async downloadStats(days: number): Promise<DownloadStatRow[]> {
      const rows = await rpc<Array<Record<string, unknown>>>('web_download_stats', { p_days: days });
      return rows.map((r) => ({
        editionId: r.edition_id as string, title: r.title as string, clicks: Number(r.clicks), approxVisitors: String(r.approx_visitors),
        firstDay: (r.first_day as string) ?? null, lastDay: (r.last_day as string) ?? null,
      }));
    },

    publicEditions(): Promise<PublicEditionRow[]> {
      return publicRead<Array<Record<string, unknown>>>('/rest/v1/v_public_editions?select=edition_id,kind,period_start,title,description,authorized_by&order=period_start.desc').then((rows) =>
        rows.map((r) => ({ editionId: r.edition_id as string, kind: r.kind as PublicEditionRow['kind'], periodStart: r.period_start as string, title: r.title as string, description: r.description as string, authorizedBy: r.authorized_by as string })));
    },

    // ---- public reads (anon key only; published rows only, enforced by the database views)
    publicContent(): Promise<PublicContentRow[]> {
      return publicRead<Array<Record<string, unknown>>>('/rest/v1/v_public_content?select=kind,key,body,version_no,published_at').then((rows) =>
        rows.map((r) => ({ kind: r.kind as ContentKind, key: r.key as string, body: r.body as Record<string, unknown>, versionNo: r.version_no as number, publishedAt: r.published_at as string })));
    },
    publicPosts(): Promise<PublicPostRow[]> {
      return publicRead<Array<Record<string, unknown>>>('/rest/v1/v_public_posts?select=slug,title,excerpt,body,category,author_display,published_at&order=published_at.desc').then((rows) =>
        rows.map((r) => ({ slug: r.slug as string, title: r.title as string, excerpt: r.excerpt as string, body: r.body as string, category: r.category as string, authorDisplay: r.author_display as string, publishedAt: r.published_at as string })));
    },
    publicEvents(): Promise<PublicEventRow[]> {
      return publicRead<Array<Record<string, unknown>>>('/rest/v1/v_public_events?select=slug,title,summary,event_date,event_time,location,category,featured,registration_url&order=event_date.asc').then((rows) =>
        rows.map((r) => ({ slug: r.slug as string, title: r.title as string, summary: r.summary as string, eventDate: r.event_date as string, eventTime: (r.event_time as string) ?? null, location: (r.location as string) ?? null, category: (r.category as string) ?? null, featured: r.featured as boolean, registrationUrl: (r.registration_url as string) ?? null })));
    },
  };
}

export type WebsiteApi = ReturnType<typeof createWebsiteApi>;

function mapPost(r: Record<string, unknown>): PostRow {
  return {
    id: r.id as string, slug: r.slug as string, title: r.title as string, excerpt: r.excerpt as string, body: r.body as string,
    category: r.category as string, authorDisplay: r.author_display as string, status: r.status as PostRow['status'],
    publishAt: (r.publish_at as string) ?? null, publishedAt: (r.published_at as string) ?? null, version: r.version as number,
  };
}
