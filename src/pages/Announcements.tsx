import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnnouncementCard } from '../components/feature';
import { Button } from '../components/foundation/Button';
import { Input } from '../components/foundation/Input';
import { Modal } from '../components/foundation/Modal';
import {
  appendUniqueAnnouncements,
  canManageAnnouncements,
  cursorAfter,
  removeAnnouncement,
  replaceAnnouncement,
} from '../lib/announcementRules';
import {
  createAnnouncement,
  deleteAnnouncement,
  getAnnouncementsPage,
  notifyAnnouncementMembers,
  updateAnnouncement,
} from '../lib/queries';
import type { Announcement } from '../types';
import type { AuthUser } from '../lib/auth';

interface AnnouncementsProps { user: AuthUser | null; }

type FormMode = 'create' | 'edit' | null;

const LOAD_ERROR = 'Announcements could not be loaded.';
const LOAD_MORE_ERROR = 'More announcements could not be loaded.';

function messageFrom(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
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
  const [formError, setFormError] = useState<string | null>(null);
  const [notify, setNotify] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const [pendingDelete, setPendingDelete] = useState<Announcement | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const formRef = useRef<HTMLDivElement>(null);
  const canManage = canManageAnnouncements(user?.role);

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

  useEffect(() => {
    if (formMode !== null) formRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [formMode, editingId]);

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

  function openCreate() {
    setFormMode('create');
    setEditingId(null);
    setTitle('');
    setBody('');
    setFormError(null);
  }

  function closeForm() {
    setFormMode(null);
    setEditingId(null);
    setTitle('');
    setBody('');
    setFormError(null);
  }

  function startEdit(announcement: Announcement) {
    setFormMode('edit');
    setEditingId(announcement.id);
    setTitle(announcement.title);
    setBody(announcement.body);
    setFormError(null);
    setNotice(null);
  }

  async function handlePost() {
    if (!user || !title.trim() || !body.trim()) return;
    setSaving(true);
    setFormError(null);
    try {
      const id = await createAnnouncement(title, body, user.id, user.name);

      // The announcement is saved at this point. A notification failure is reported, not retried by re-posting,
      // which would create a duplicate announcement.
      let postNotice: string | null = null;
      if (notify) {
        try {
          const result = await notifyAnnouncementMembers(id);
          postNotice = result.sent > 0
            ? `Posted. Notified ${result.sent} of ${result.recipients} ${result.recipients === 1 ? 'member' : 'members'}.`
            : `Posted. No one was notified: ${result.recipients === 0 ? 'no members have push enabled' : 'no active push subscriptions'}.`;
          if (result.failed > 0) postNotice += ` ${result.failed} delivery failed.`;
        } catch (e) {
          postNotice = `Posted, but notifications failed: ${e instanceof Error ? e.message : 'unknown error'}.`;
        }
      }

      const page = await getAnnouncementsPage();
      setItems(page.items);
      setHasMore(page.hasMore);
      setLoadError(null);
      setLoadMoreError(null);
      setTitle('');
      setBody('');
      setFormMode(null);
      setEditingId(null);
      setNotice(postNotice);
    } catch (e) {
      setFormError(messageFrom(e, 'Failed to post.'));
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveEdit() {
    if (!editingId || !title.trim() || !body.trim()) return;
    setSaving(true);
    setFormError(null);
    try {
      const updated = await updateAnnouncement(editingId, title, body);
      setItems((current) => replaceAnnouncement(current, updated));
      closeForm();
      setNotice('Announcement updated. Editing does not send a new notification.');
    } catch (e) {
      setFormError(messageFrom(e, 'Failed to save changes.'));
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
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-h1">Announcements</h1>
          {canManage && (
            <Button onClick={() => (formOpen ? closeForm() : openCreate())}>
              {formOpen ? 'Cancel' : '+ New'}
            </Button>
          )}
        </div>

        {formOpen && (
          <div ref={formRef} className="card mb-6 space-y-3">
            <h2 className="text-base font-bold text-gray-900">
              {formMode === 'edit' ? 'Edit announcement' : 'New announcement'}
            </h2>
            <Input label="Title" value={title} onChange={setTitle} />
            <Input label="Message" type="textarea" value={body} onChange={setBody} />
            {formMode === 'create' ? (
              <label className="flex items-center gap-2 text-small text-gray-700">
                <input
                  type="checkbox"
                  checked={notify}
                  onChange={(e) => setNotify(e.target.checked)}
                  className="h-4 w-4 accent-york-600"
                />
                Send a push notification to members
              </label>
            ) : (
              <p className="text-tiny text-gray-500">Saving changes does not send a new notification.</p>
            )}
            {formError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
                {formError}
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
          <p className="text-small text-gray-600 mb-4" role="status">{notice}</p>
        )}

        {loadError && (
          <div
            className="rounded-md border border-red-200 bg-red-50 px-4 py-3 mb-4 flex flex-wrap items-center justify-between gap-3 text-sm text-red-700"
            role="alert"
          >
            <span>{loadError}</span>
            <Button variant="secondary" size="small" onClick={loadFirstPage}>Retry</Button>
          </div>
        )}

        {loading && items.length === 0 && <p className="text-small text-gray-400">Loading…</p>}

        {showEmpty && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 px-6 py-10 text-center">
            <p className="text-small font-bold text-gray-700">No announcements yet.</p>
            <p className="text-tiny text-gray-500 mt-1">
              {canManage ? 'Use + New to post the first one.' : 'Announcements from club leaders will appear here.'}
            </p>
          </div>
        )}

        {items.length > 0 && (
          <>
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 px-6">
              {items.map((a) => (
                <AnnouncementCard
                  key={a.id}
                  announcement={a}
                  onEdit={canManage ? startEdit : undefined}
                  onDelete={canManage ? (target) => { setDeleteError(null); setPendingDelete(target); } : undefined}
                />
              ))}
            </div>

            {loadMoreError && (
              <div
                className="rounded-md border border-red-200 bg-red-50 px-4 py-3 mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-red-700"
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
          <p className="text-small text-gray-700">
            &ldquo;{pendingDelete?.title}&rdquo; will be removed for everyone. Other announcements are not affected.
          </p>
          {deleteError && (
            <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
              {deleteError}
            </div>
          )}
        </Modal>
      </div>
    </div>
  );
};
