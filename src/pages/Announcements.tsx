import React, { useEffect, useState } from 'react';
import { AnnouncementCard } from '../components/feature';
import { Button } from '../components/foundation/Button';
import { Input } from '../components/foundation/Input';
import { getAnnouncements, createAnnouncement, getMembers } from '../lib/queries';
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

/** Staff start on "everyone" (a live broadcast). A cell leader must choose one of their own cells. */
function defaultAudience(user: AuthUser | null): AudienceSpecDraft {
  const staff = user?.role === 'admin' || user?.role === 'coordinator';
  return staff ? { ...emptySpecDraft(), mode: 'all' } : emptySpecDraft();
}

export const Announcements: React.FC<AnnouncementsProps> = ({ user }) => {
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [audience, setAudience] = useState<AudienceSpecDraft>(() => defaultAudience(user));
  const [audienceErrors, setAudienceErrors] = useState<AudienceValidationError[]>([]);
  const [cells, setCells] = useState<AudienceCell[]>([]);
  const [groups, setGroups] = useState<AudienceSavedGroup[]>([]);
  const [candidates, setCandidates] = useState<AudienceCandidate[]>([]);

  useEffect(() => {
    getAnnouncements(20).then(setItems).catch(console.error).finally(() => setLoading(false));
  }, []);

  // Audience choices load when the form opens. Leaders may pick only the cells they lead (scope below).
  useEffect(() => {
    if (!showForm || !user) return;
    let cancelled = false;
    Promise.all([fetchAudienceCells(), fetchSavedGroups(), getMembers()])
      .then(([c, g, m]) => {
        if (cancelled) return;
        setCells(c);
        setGroups(g);
        setCandidates(audienceCandidatesFromMembers(m));
      })
      .catch((e: unknown) => {
        if (!cancelled) setPostError(e instanceof Error ? e.message : 'Could not load the audience choices.');
      });
    return () => { cancelled = true; };
  }, [showForm, user]);

  const isStaff = user?.role === 'admin' || user?.role === 'coordinator';
  const scope: AudienceScope = isStaff
    ? { canUseEveryone: true, ledCellIds: [], canExclude: true }
    : {
        canUseEveryone: false,
        ledCellIds: cells.filter((c) => c.leaderId === user?.id).map((c) => c.id),
        canExclude: false,
      };

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
      const fresh = await getAnnouncements(20);
      setItems(fresh);
      setTitle('');
      setBody('');
      setAudience(defaultAudience(user));
      setShowForm(false);
    } catch (e) {
      setPostError(e instanceof Error ? e.message : 'Failed to post.');
    } finally {
      setSaving(false);
    }
  }

  const canPost = ['admin', 'coordinator', 'cell_leader'].includes(effectiveRole(user));

  return (
    <div className="flex-1 overflow-y-auto p-0 md:p-4">
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <PageHeader
            eyebrow="Community"
            title="Announcements"
            description="News and updates from BLW York leadership."
            actions={canPost ? (
              <Button onClick={() => setShowForm((v) => !v)}>
                {showForm ? 'Cancel' : '+ New'}
              </Button>
            ) : undefined}
          />
        </div>

        {showForm && (
          <div className="card mb-6 space-y-3">
            <Input label="Title" value={title} onChange={setTitle} />
            <Input label="Message" type="textarea" value={body} onChange={setBody} />
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
            {postError && (
              <div className="rounded-md border border-york-200 dark:border-york-800 bg-york-50 dark:bg-york-900/30 px-4 py-3 text-sm text-york-700 dark:text-york-300" role="alert">
                {postError}
              </div>
            )}
            <Button onClick={handlePost} loading={saving}>Post Announcement</Button>
          </div>
        )}

        {loading ? (
          <p className="text-small text-gray-400 dark:text-slate-400">Loading…</p>
        ) : (
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700 px-6">
            {items.map((a) => <AnnouncementCard key={a.id} announcement={a} />)}
          </div>
        )}
      </div>
    </div>
  );
};
