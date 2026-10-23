import React, { useEffect, useState } from 'react';
import { AnnouncementCard } from '../components/feature';
import { Button } from '../components/foundation/Button';
import { Input } from '../components/foundation/Input';
import { getAnnouncements, createAnnouncement, notifyAnnouncementMembers } from '../lib/queries';
import type { Announcement } from '../types';
import type { AuthUser } from '../lib/auth';

interface AnnouncementsProps { user: AuthUser | null; }

/** Explains a failed insert. The announcement was not written when this runs, so the message says nothing was saved. */
export function describePostError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/row-level security|permission denied|violates/i.test(message)) {
    return 'Your account is not allowed to post announcements, so nothing was saved. Ask a coordinator to check your role and approval status.';
  }
  if (/jwt|expired|not authenticated|refresh token/i.test(message)) {
    return 'Your session has expired, so nothing was saved. Sign out, sign in again, and post once more.';
  }
  if (/failed to fetch|network/i.test(message)) {
    return 'Could not reach the server, so nothing was saved. Check your connection and try again.';
  }
  return message
    ? `Could not post the announcement, so nothing was saved: ${message}`
    : 'Could not post the announcement, so nothing was saved. Try again.';
}

export const Announcements: React.FC<AnnouncementsProps> = ({ user }) => {
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [titleError, setTitleError] = useState<string | null>(null);
  const [bodyError, setBodyError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [notify, setNotify] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    getAnnouncements(20).then(setItems).catch(console.error).finally(() => setLoading(false));
  }, []);

  /** Shows a message next to each empty field. Returns true only when both fields have content. */
  function validate(): boolean {
    const titleProblem = title.trim() ? null : 'Enter a title for the announcement.';
    const bodyProblem = body.trim() ? null : 'Enter the message to post.';
    setTitleError(titleProblem);
    setBodyError(bodyProblem);
    return !titleProblem && !bodyProblem;
  }

  async function handlePost() {
    if (!user) {
      setPostError('You are not signed in, so nothing was saved. Sign in again and retry.');
      return;
    }
    if (!validate()) return;

    setSaving(true);
    setPostError(null);
    setNotice(null);
    try {
      let id: string;
      try {
        id = await createAnnouncement(title.trim(), body.trim(), user.id, user.name);
      } catch (e) {
        // Nothing was written. Keep the author's text so they can retry without retyping.
        setPostError(describePostError(e));
        return;
      }

      // The announcement is saved from here on. Anything that fails afterwards is reported as a notice, never as a
      // failed post, so the author does not post again and create a duplicate.
      let postNotice = 'Announcement posted.';
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

      try {
        setItems(await getAnnouncements(20));
      } catch {
        postNotice += ' The list did not refresh. Reload the page to see the new announcement.';
      }
      setTitle('');
      setBody('');
      setShowForm(false);
      setNotice(postNotice);
    } finally {
      setSaving(false);
    }
  }

  const canPost = user?.role === 'admin' || user?.role === 'coordinator' || user?.role === 'cell_leader';

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-h1">Announcements</h1>
          {canPost && (
            <Button onClick={() => setShowForm((v) => !v)}>
              {showForm ? 'Cancel' : '+ New'}
            </Button>
          )}
        </div>

        {showForm && (
          <div className="card mb-6 space-y-3">
            <Input
              label="Title"
              value={title}
              onChange={(v) => { setTitle(v); setTitleError(null); }}
              error={titleError ?? undefined}
            />
            <Input
              label="Message"
              type="textarea"
              value={body}
              onChange={(v) => { setBody(v); setBodyError(null); }}
              error={bodyError ?? undefined}
            />
            <label className="flex items-center gap-2 text-small text-gray-700">
              <input
                type="checkbox"
                checked={notify}
                onChange={(e) => setNotify(e.target.checked)}
                className="h-4 w-4 accent-york-600"
              />
              Send a push notification to members
            </label>
            {postError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
                {postError}
              </div>
            )}
            <Button onClick={handlePost} loading={saving}>Post Announcement</Button>
          </div>
        )}

        {notice && (
          <p className="text-small text-gray-600 mb-4" role="status">{notice}</p>
        )}

        {loading ? (
          <p className="text-small text-gray-400">Loading…</p>
        ) : (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 px-6">
            {items.map((a) => <AnnouncementCard key={a.id} announcement={a} />)}
          </div>
        )}
      </div>
    </div>
  );
};
