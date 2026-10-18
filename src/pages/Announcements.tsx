import React, { useEffect, useState } from 'react';
import { AnnouncementCard } from '../components/feature';
import { Button } from '../components/foundation/Button';
import { Input } from '../components/foundation/Input';
import { getAnnouncements, createAnnouncement, notifyAnnouncementMembers } from '../lib/queries';
import type { Announcement } from '../types';
import type { AuthUser } from '../lib/auth';

interface AnnouncementsProps { user: AuthUser | null; }

export const Announcements: React.FC<AnnouncementsProps> = ({ user }) => {
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [notify, setNotify] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    getAnnouncements(20).then(setItems).catch(console.error).finally(() => setLoading(false));
  }, []);

  async function handlePost() {
    if (!user || !title.trim() || !body.trim()) return;
    setSaving(true);
    setPostError(null);
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

      const fresh = await getAnnouncements(20);
      setItems(fresh);
      setTitle('');
      setBody('');
      setShowForm(false);
      setNotice(postNotice);
    } catch (e) {
      setPostError(e instanceof Error ? e.message : 'Failed to post.');
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
            <Input label="Title" value={title} onChange={setTitle} />
            <Input label="Message" type="textarea" value={body} onChange={setBody} />
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
