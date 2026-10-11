import React, { useEffect, useState } from 'react';
import { AnnouncementCard } from '../components/feature';
import { Button } from '../components/foundation/Button';
import { Input } from '../components/foundation/Input';
import { getAnnouncements, createAnnouncement } from '../lib/queries';
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

  useEffect(() => {
    getAnnouncements(20).then(setItems).catch(console.error).finally(() => setLoading(false));
  }, []);

  async function handlePost() {
    if (!user || !title.trim() || !body.trim()) return;
    setSaving(true);
    setPostError(null);
    try {
      await createAnnouncement(title, body, user.id, user.name);
      const fresh = await getAnnouncements(20);
      setItems(fresh);
      setTitle('');
      setBody('');
      setShowForm(false);
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
            {postError && (
              <div className="rounded-md border border-york-200 bg-york-50 px-4 py-3 text-sm text-york-700" role="alert">
                {postError}
              </div>
            )}
            <Button onClick={handlePost} loading={saving}>Post Announcement</Button>
          </div>
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
