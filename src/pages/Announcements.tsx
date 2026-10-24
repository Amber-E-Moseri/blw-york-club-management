import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnnouncementCard } from '../components/feature';
import { Button } from '../components/foundation/Button';
import { Input } from '../components/foundation/Input';
import { Modal } from '../components/foundation/Modal';
import {
  appendUniqueAnnouncements,
  canChangeAnnouncement,
  canPostAnnouncements,
  cursorAfter,
  removeAnnouncement,
  replaceAnnouncement,
  type AnnouncementActor,
} from '../lib/announcementRules';
import {
  createAnnouncement,
  deleteAnnouncement,
  getAnnouncementsPage,
  getMembers,
  updateAnnouncement,
} from '../lib/queries';
import {
  audienceCandidatesFromMembers,
  createAudienceSpec,
  fetchAudienceCells,
  fetchSavedGroups,
} from '../lib/queries/audience';
import { AudienceSelector } from '../components/feature/AudienceSelector';
import { emptySpecDraft } from '../lib/audience/spec';
import type { Announcement } from '../types';
import { effectiveRole, type AuthUser } from '../lib/auth';
import type {
  AudienceCandidate,
  AudienceCell,
  AudienceSavedGroup,
  AudienceScope,
  AudienceSpecDraft,
  AudienceValidationError,
} from '../types/audience';
import { PageHeader } from '../components/foundation/PageHeader';

interface AnnouncementsProps { user: AuthUser | null; }

type FormMode = 'create' | 'edit' | null;

const LOAD_ERROR = 'Announcements could not be loaded.';
const LOAD_MORE_ERROR = 'More announcements could not be loaded.';

function messageFrom(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/** Staff start on "everyone" (a live broadcast). A cell leader must choose one of their own cells. */
function defaultAudience(user: AuthUser | null): AudienceSpecDraft {
  const staff = user?.role === 'admin' || user?.role === 'coordinator';
  return staff ? { ...emptySpecDraft(), mode: 'all' } : emptySpecDraft();
}

export const Announcements: React.FC<AnnouncementsProps> = ({ user }) => {
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  const [formMode, setFormMode] = useState<FormMode>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [audience, setAudience] = useState<AudienceSpecDraft>(() => defaultAudience(user));
  const [audienceErrors, setAudienceErrors] = useState<AudienceValidationError[]>([]);
  const [cells, setCells] = useState<AudienceCell[]>([]);
  const [groups, setGroups] = useState<AudienceSavedGroup[]>([]);
  const [candidates, setCandidates] = useState<AudienceCandidate[]>([]);

  const [pendingDelete, setPendingDelete] = useState<Announcement | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const formRef = useRef<HTMLDivElement>(null);

  const actor: AnnouncementActor | null = user
    ? { id: user.id, role: effectiveRole(user), status: user.status }
    : null;
  const canPost = canPostAnnouncements(actor);

  const loadFirstPage = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setLoadMoreError(null);
    try {
      const page = await getAnnouncementsPage();
      setItems(page.items);
      setHasMore(page.hasMore);
    } catch (e) {
      console.error(e);
      setLoadError(LOAD_ERROR);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFirstPage();
  }, [loadFirstPage]);

  // Audience choices load when the composer opens. Leaders may pick only the cells they lead (scope below).
  useEffect(() => {
    if (formMode !== 'create' || !user) return;
    let cancelled = false;
    Promise.all([fetchAudienceCells(), fetchSavedGroups(), getMembers()])
      .then(([c, g, m]) => {
        if (cancelled) return;
        setCells(c);
        setGroups(g);
        setCandidates(audienceCandidatesFromMembers(m));
      })
      .catch((e: unknown) => {
        if (!cancelled) setPostError(messageFrom(e, 'Could not load the audience choices.'));
      });
    return () => { cancelled = true; };
  }, [formMode, user]);

  useEffect(() => {
    if (formMode !== null) formRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [formMode, editingId]);

  const isStaff = effectiveRole(user) === 'admin' || effectiveRole(user) === 'coordinator';
  const scope: AudienceScope = isStaff
    ? { canUseEveryone: true, ledCellIds: [], canExclude: true }
    : {
        canUseEveryone: false,
        ledCellIds: cells.filter((c) => c.leaderId === user?.id).map((c) => c.id),
        canExclude: false,
      };

  function closeForm() {
    setFormMode(null);
    setEditingId(null);
    setTitle('');
    setBody('');
    setPostError(null);
    setAudience(defaultAudience(user));
  }

  function openCreate() {
    setFormMode('create');
    setEditingId(null);
    setTitle('');
    setBody('');
    setPostError(null);
    setAudience(defaultAudience(user));
  }

  function startEdit(announcement: Announcement) {
    setFormMode('edit');
    setEditingId(announcement.id);
    setTitle(announcement.title);
    setBody(announcement.body);
    setPostError(null);
    setNotice(null);
  }

  async function handleLoadMore() {
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const page = await getAnnouncementsPage(cursorAfter(items));
      setItems((current) => appendUniqueAnnouncements(current, page.items));
      setHasMore(page.hasMore);
    } catch (e) {
      console.error(e);
      setLoadMoreError(LOAD_MORE_ERROR);
    } finally {
      setLoadingMore(false);
    }
  }

  async function handlePost() {
    if (!user || !title.trim() || !body.trim()) return;
    if (audienceErrors.length > 0) {
      setPostError('Fix the audience before posting. Nothing was posted.');
      return;
    }
    setSaving(true);
    setPostError(null);
    try {
      // Staff "everyone" with no exclusions is a live broadcast (NULL spec). Every other choice is frozen as a spec.
      const plainEveryone =
        audience.mode === 'all' &&
        audience.excludedCellIds.length + audience.excludedGroupIds.length + audience.excludedProfileIds.length === 0;
      const audienceSpecId = plainEveryone && isStaff ? null : await createAudienceSpec(audience);
      await createAnnouncement(title, body, user.id, user.name, audienceSpecId);
      const page = await getAnnouncementsPage();
      setItems(page.items);
      setHasMore(page.hasMore);
      setLoadError(null);
      setLoadMoreError(null);
      closeForm();
    } catch (e) {
      setPostError(messageFrom(e, 'Failed to post.'));
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveEdit() {
    if (!editingId || !title.trim() || !body.trim()) return;
    setSaving(true);
    setPostError(null);
    try {
      const updated = await updateAnnouncement(editingId, title, body);
      setItems((current) => replaceAnnouncement(current, updated));
      closeForm();
      setNotice('Announcement updated. Editing does not send a new notification, and the audience is unchanged.');
    } catch (e) {
      setPostError(messageFrom(e, 'Failed to save changes.'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    const target = pendingDelete;
    if (!target) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAnnouncement(target.id);
      setItems((current) => removeAnnouncement(current, target.id));
      if (editingId === target.id) closeForm();
      setPendingDelete(null);
      setNotice('Announcement deleted.');
      await loadFirstPage();
    } catch (e) {
      setDeleteError(messageFrom(e, 'The announcement could not be deleted.'));
    } finally {
      setDeleting(false);
    }
  }

  function dismissDelete() {
    if (deleting) return;
    setPendingDelete(null);
    setDeleteError(null);
  }

  const formOpen = formMode !== null;
  const showEmpty = !loading && !loadError && items.length === 0;

  return (
    <div className="flex-1 overflow-y-auto p-0 md:p-4">
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <PageHeader
            eyebrow="Community"
            title="Announcements"
            description="News and updates from BLW York leadership."
            actions={canPost ? (
              <Button onClick={() => (formOpen ? closeForm() : openCreate())}>
                {formOpen ? 'Cancel' : '+ New'}
              </Button>
            ) : undefined}
          />
        </div>

        {formOpen && (
          <div ref={formRef} className="card mb-6 space-y-3">
            <h2 className="text-base font-bold text-gray-900 dark:text-slate-100">
              {formMode === 'edit' ? 'Edit announcement' : 'New announcement'}
            </h2>
            <Input label="Title" value={title} onChange={setTitle} />
            <Input label="Message" type="textarea" value={body} onChange={setBody} />
            {formMode === 'create' ? (
              <AudienceSelector
                label="Who should read this"
                value={audience}
                onChange={setAudience}
                candidates={candidates}
                cells={cells}
                savedGroups={groups}
                scope={scope}
                onValidityChange={setAudienceErrors}
              />
            ) : (
              <p className="text-tiny text-gray-500 dark:text-slate-400">
                The audience cannot be changed after posting. Saving changes does not send a new notification.
              </p>
            )}
            {postError && (
              <div className="rounded-md border border-york-200 dark:border-york-800 bg-york-50 dark:bg-york-900/30 px-4 py-3 text-sm text-york-700 dark:text-york-300" role="alert">
                {postError}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {formMode === 'edit' ? (
                <Button onClick={handleSaveEdit} loading={saving}>Save changes</Button>
              ) : (
                <Button onClick={handlePost} loading={saving}>Post Announcement</Button>
              )}
              {formMode === 'edit' && (
                <Button variant="ghost" onClick={closeForm} disabled={saving}>Cancel</Button>
              )}
            </div>
          </div>
        )}

        {notice && (
          <p className="text-small text-gray-600 dark:text-slate-300 mb-4" role="status">{notice}</p>
        )}

        {loadError && (
          <div
            className="rounded-md border border-york-200 dark:border-york-800 bg-york-50 dark:bg-york-900/30 px-4 py-3 mb-4 flex flex-wrap items-center justify-between gap-3 text-sm text-york-700 dark:text-york-300"
            role="alert"
          >
            <span>{loadError}</span>
            <Button variant="secondary" size="small" onClick={loadFirstPage}>Retry</Button>
          </div>
        )}

        {loading && items.length === 0 && (
          <p className="text-small text-gray-400 dark:text-slate-400">Loading…</p>
        )}

        {showEmpty && (
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700 px-6 py-10 text-center">
            <p className="text-small font-bold text-gray-700 dark:text-slate-200">No announcements yet.</p>
            <p className="text-tiny text-gray-500 dark:text-slate-400 mt-1">
              {canPost ? 'Use + New to post the first one.' : 'Announcements from club leaders will appear here.'}
            </p>
          </div>
        )}

        {items.length > 0 && (
          <>
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700 px-6">
              {items.map((a) => (
                <AnnouncementCard
                  key={a.id}
                  announcement={a}
                  onEdit={canChangeAnnouncement(actor, a) ? startEdit : undefined}
                  onDelete={canChangeAnnouncement(actor, a)
                    ? (target) => { setDeleteError(null); setPendingDelete(target); }
                    : undefined}
                />
              ))}
            </div>

            {loadMoreError && (
              <div
                className="rounded-md border border-york-200 dark:border-york-800 bg-york-50 dark:bg-york-900/30 px-4 py-3 mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-york-700 dark:text-york-300"
                role="alert"
              >
                <span>{loadMoreError}</span>
                <Button variant="secondary" size="small" onClick={handleLoadMore} loading={loadingMore}>Retry</Button>
              </div>
            )}

            {hasMore && !loadMoreError && (
              <div className="flex justify-center mt-4">
                <Button variant="secondary" onClick={handleLoadMore} loading={loadingMore}>Load more</Button>
              </div>
            )}
          </>
        )}

        <Modal
          isOpen={pendingDelete !== null}
          onClose={dismissDelete}
          title="Delete this announcement?"
          size="small"
          footer={(
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={dismissDelete} disabled={deleting}>Keep announcement</Button>
              <Button variant="danger" onClick={handleDelete} loading={deleting}>Delete</Button>
            </div>
          )}
        >
          <p className="text-small text-gray-700 dark:text-slate-200">
            &ldquo;{pendingDelete?.title}&rdquo; will be removed. Other announcements are not affected.
          </p>
          {deleteError && (
            <div className="mt-3 rounded-md border border-york-200 dark:border-york-800 bg-york-50 dark:bg-york-900/30 px-4 py-3 text-sm text-york-700 dark:text-york-300" role="alert">
              {deleteError}
            </div>
          )}
        </Modal>
      </div>
    </div>
  );
};
