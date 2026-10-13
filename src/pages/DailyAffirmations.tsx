import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, AlertCircle } from 'lucide-react';
import { AffirmationCard } from '../components/feature/AffirmationCard';
import { Button } from '../components/foundation/Button';
import { Input } from '../components/foundation/Input';
import { Modal } from '../components/foundation/Modal';
import { useAffirmations } from '../hooks/useAffirmations';
import { parseAffirmationImport } from '../lib/affirmationImport';
import { createAffirmations } from '../lib/queries/affirmations';
import {
  createSavedGroup,
  createTargetedAffirmation,
  fetchAudienceCells,
  fetchSavedGroups,
} from '../lib/queries/audience';
import { getMembers } from '../lib/queries';
import { canTargetAffirmations } from '../lib/audience/audienceRules';
import { emptySpecDraft } from '../lib/audience/spec';
import { validateAudienceSpec } from '../lib/audience/resolveAudience';
import { AudienceSelector, ERROR_TEXT } from '../components/feature/AudienceSelector';
import type {
  AudienceCandidate,
  AudienceCell,
  AudienceSavedGroup,
  AudienceScope,
  AudienceSpecDraft,
} from '../types/audience';
import type { AuthUser } from '../lib/auth';
import type { Member } from '../types';

interface Props { user: AuthUser | null; }

const canManage = (role: string) => ['coordinator', 'admin'].includes(role);

const selectClass =
  'w-full rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-gray-900 dark:text-slate-100';

export const DailyAffirmations: React.FC<Props> = ({ user }) => {
  const today = new Date().toISOString().split('T')[0];
  const [viewDate, setViewDate] = useState(today);
  const { affirmations, loading, error, declare, undeclare, remove, refetch } = useAffirmations(viewDate);

  const [addOpen, setAddOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [newDate, setNewDate] = useState(today);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [audience, setAudience] = useState<AudienceSpecDraft>(emptySpecDraft());
  const [cells, setCells] = useState<AudienceCell[]>([]);
  const [groups, setGroups] = useState<AudienceSavedGroup[]>([]);
  const [people, setPeople] = useState<Member[]>([]);
  const [audienceLoadError, setAudienceLoadError] = useState('');

  const [groupsOpen, setGroupsOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupMemberIds, setGroupMemberIds] = useState<string[]>([]);
  const [groupSaving, setGroupSaving] = useState(false);
  const [groupError, setGroupError] = useState('');

  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importSaving, setImportSaving] = useState(false);
  const [importError, setImportError] = useState('');
  const [importNotice, setImportNotice] = useState('');

  // The shared selector works on candidates, cells, groups and a scope. Candidates are the active members loaded
  // above. The scope mirrors the server: only admins and coordinators address everyone or exclude people.
  const audienceCandidates = useMemo<AudienceCandidate[]>(() => people.map((p) => ({
    id: p.id,
    fullName: p.full_name ?? '',
    email: p.email ?? null,
    cellId: p.cell_id ?? null,
    status: 'active' as const,
  })), [people]);
  const savedGroupsForSelector = groups;
  const canAddressAudience = canTargetAffirmations(user?.role ?? 'member');
  const audienceScope: AudienceScope = { canUseEveryone: canAddressAudience, ledCellIds: [], canExclude: canAddressAudience };
  const audienceData = { candidates: audienceCandidates, groups: savedGroupsForSelector, cells };
  const importCheck = useMemo(
    () => parseAffirmationImport(importText, user?.id ?? ''),
    [importText, user?.id]
  );

  const isManager = canManage(user?.role ?? 'member');

  const handleImport = async () => {
    if (!user || importCheck.errors.length > 0 || importCheck.rows.length === 0) return;
    setImportError('');
    setImportSaving(true);
    try {
      const saved = await createAffirmations(importCheck.rows);
      setImportOpen(false);
      setImportText('');
      setImportNotice(`Imported ${saved} affirmation${saved === 1 ? '' : 's'}.`);
      await refetch();
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'Import failed. Nothing was saved.');
    } finally {
      setImportSaving(false);
    }
  };

  const canTarget = canTargetAffirmations(user?.role ?? 'member');

  // Audience data is loaded only for staff, when the form or groups modal opens.
  useEffect(() => {
    if (!canTarget || (!addOpen && !groupsOpen)) return;
    let cancelled = false;
    setAudienceLoadError('');
    Promise.all([fetchAudienceCells(), fetchSavedGroups(), getMembers()])
      .then(([c, g, m]) => {
        if (cancelled) return;
        setCells(c);
        setGroups(g);
        setPeople(m.filter((p) => (p as Member & { status?: string }).status === 'active'));
      })
      .catch((e: unknown) => {
        if (!cancelled) setAudienceLoadError(e instanceof Error ? e.message : 'Could not load audiences.');
      });
    return () => { cancelled = true; };
  }, [canTarget, addOpen, groupsOpen]);

  const resetAddForm = () => {
    setNewTitle('');
    setNewBody('');
    setNewDate(today);
    setAudience(emptySpecDraft());
  };

  const handleAdd = async () => {
    if (!newTitle.trim() || !newBody.trim() || !user) return;
    const audienceErrors = validateAudienceSpec(audience, audienceData, audienceScope);
    if (audienceErrors.length > 0) {
      setFormError(ERROR_TEXT[audienceErrors[0]]);
      return;
    }
    setFormError('');
    setSaving(true);
    try {
      await createTargetedAffirmation({
        title: newTitle.trim(),
        body: newBody.trim(),
        scheduledDate: newDate,
        audience,
      });
      setAddOpen(false);
      resetAddForm();
      await refetch();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const toggleIn = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  const handleSaveGroup = async () => {
    if (!groupName.trim() || groupMemberIds.length === 0 || !user) {
      setGroupError('Name the group and choose at least one person.');
      return;
    }
    setGroupError('');
    setGroupSaving(true);
    try {
      await createSavedGroup({ name: groupName, memberIds: groupMemberIds });
      setGroupName('');
      setGroupMemberIds([]);
      setGroups(await fetchSavedGroups());
    } catch (e) {
      setGroupError(e instanceof Error ? e.message : 'Could not save the group.');
    } finally {
      setGroupSaving(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Daily Affirmations</h1>
          <p className="text-sm text-gray-500 mt-0.5">Declare God's word over your life</p>
        </div>
        {isManager && (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setImportOpen(true)}>Bulk Import</Button>
            {canTarget && <Button variant="secondary" onClick={() => setGroupsOpen(true)}>Saved Groups</Button>}
            <Button variant="primary" onClick={() => setAddOpen(true)}>+ New Affirmation</Button>
          </div>
        )}
      </div>

      {/* Date navigation */}
      <div className="flex items-center gap-3">
        <button
          className="w-8 h-8 flex items-center justify-center rounded-full border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800 text-gray-500 dark:text-slate-400"
          onClick={() => {
            const d = new Date(viewDate);
            d.setDate(d.getDate() - 1);
            setViewDate(d.toISOString().split('T')[0]);
          }}
        >‹</button>
        <Input
          type="date"
          value={viewDate}
          onChange={setViewDate}
          className="max-w-[160px]"
        />
        <button
          className="w-8 h-8 flex items-center justify-center rounded-full border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800 text-gray-500 dark:text-slate-400"
          onClick={() => {
            const d = new Date(viewDate);
            d.setDate(d.getDate() + 1);
            setViewDate(d.toISOString().split('T')[0]);
          }}
        >›</button>
        {viewDate !== today && (
          <Button variant="ghost" size="small" onClick={() => setViewDate(today)}>Today</Button>
        )}
      </div>

      {error && (
        <div className="bg-york-50 dark:bg-york-900/30 border border-york-200 dark:border-york-800 text-york-700 dark:text-york-300 rounded-lg px-4 py-3 text-sm">{error}</div>
      )}

      {importNotice && (
        <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg px-4 py-3 text-sm">{importNotice}</div>
      )}

      {loading && (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-32 bg-gray-100 dark:bg-slate-800 rounded-lg animate-pulse" />
          ))}
        </div>
      )}

      {!loading && affirmations.length === 0 && (
        <div className="text-center py-16 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg">
          <BookOpen className="w-10 h-10 mx-auto mb-3 text-gray-300 dark:text-slate-600" />
          <p className="text-base font-semibold text-gray-700 dark:text-slate-200">No affirmations for this day</p>
          {isManager && (
            <p className="text-sm text-gray-400 mt-1">
              Add affirmations using the button above.
            </p>
          )}
        </div>
      )}

      {!loading && affirmations.map((c) => (
        <AffirmationCard
          key={c.id}
          affirmation={c}
          userId={user?.id}
          onDeclare={(id) => user && declare(id, user.id)}
          onUndeclare={(id) => user && undeclare(id, user.id)}
          canDelete={isManager}
          onDelete={remove}
        />
      ))}

      {/* Bulk import modal */}
      <Modal
        isOpen={importOpen}
        onClose={() => setImportOpen(false)}
        title="Bulk Import Affirmations"
        subtitle="One affirmation per line: date, title, affirmation text"
        size="large"
        footer={
          <>
            <Button variant="ghost" onClick={() => setImportOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              loading={importSaving}
              disabled={importCheck.errors.length > 0 || importCheck.rows.length === 0}
              onClick={handleImport}
            >
              Import {importCheck.rows.length} affirmation{importCheck.rows.length === 1 ? '' : 's'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Paste affirmations"
            type="textarea"
            rows={8}
            value={importText}
            onChange={setImportText}
            placeholder={'2026-10-12\tGod is my provider\tI declare that...\nOctober 13, 2026\tPeace over my mind\tI declare that...'}
            helpText={'Separate date, title and text with a tab, or with " | ". Dates: 2026-10-12 or October 12, 2026. Nothing is saved until every line is valid.'}
          />
          {importError && <p className="text-sm text-red-600">⚠️ {importError}</p>}
          {importCheck.errors.length > 0 && (
            <div className="rounded-md border border-york-200 bg-york-50 p-3 text-sm text-york-700 space-y-1">
              {importCheck.errors.map((message) => (
                <p key={message}>{message}</p>
              ))}
            </div>
          )}
          {importCheck.rows.length > 0 && (
            <div className="max-h-64 overflow-y-auto rounded-md border border-gray-200 dark:border-slate-700">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-slate-800 text-left text-xs uppercase text-gray-500 dark:text-slate-400">
                  <tr>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Title</th>
                  </tr>
                </thead>
                <tbody>
                  {importCheck.rows.map((row) => (
                    <tr key={`${row.scheduled_date}-${row.title}`} className="border-t border-gray-100 dark:border-slate-700">
                      <td className="px-3 py-2 whitespace-nowrap">{row.scheduled_date}</td>
                      <td className="px-3 py-2">{row.title}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Modal>

      {/* Add modal */}
      <Modal
        isOpen={addOpen}
        onClose={() => setAddOpen(false)}
        title="New Affirmation"
        subtitle="Schedule an affirmation for a specific day"
        size="medium"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={handleAdd}>Save</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Title"
            placeholder="e.g. God is my provider"
            value={newTitle}
            onChange={setNewTitle}
            required
            maxLength={100}
          />
          <Input
            label="Affirmation Text"
            type="textarea"
            placeholder="Write the full declaration…"
            value={newBody}
            onChange={setNewBody}
            required
            rows={5}
          />
          <Input
            label="Scheduled Date"
            type="date"
            value={newDate}
            onChange={setNewDate}
            required
          />

          {canTarget && (
            <fieldset className="space-y-3 rounded-md border border-gray-200 dark:border-slate-700 p-3">
              <legend className="px-1 text-sm font-medium text-gray-700 dark:text-slate-300">Who receives this</legend>
              <AudienceSelector
                value={audience}
                onChange={setAudience}
                candidates={audienceCandidates}
                cells={cells}
                savedGroups={savedGroupsForSelector}
                scope={audienceScope}
                disabled={saving}
              />
              {audienceLoadError && <p className="text-xs text-york-600 dark:text-york-400">{audienceLoadError}</p>}
              <p className="text-xs text-gray-500 dark:text-slate-400">
                Only the people you choose can see this affirmation. Who declared it is never shown in targeting.
              </p>
            </fieldset>
          )}

          {formError && <p className="text-sm text-york-600 dark:text-york-400"><AlertCircle className="inline w-3.5 h-3.5 mr-1 -mt-0.5" aria-hidden="true" />{formError}</p>}
        </div>
      </Modal>

      {/* Saved groups modal */}
      <Modal
        isOpen={groupsOpen}
        onClose={() => setGroupsOpen(false)}
        title="Saved Groups"
        subtitle="Reusable groups for targeting affirmations"
        size="medium"
        footer={
          <>
            <Button variant="ghost" onClick={() => setGroupsOpen(false)}>Close</Button>
            <Button variant="primary" loading={groupSaving} onClick={handleSaveGroup}>Save group</Button>
          </>
        }
      >
        <div className="space-y-4">
          {groups.length > 0 && (
            <ul className="text-sm divide-y divide-gray-100 dark:divide-slate-700 rounded-md border border-gray-200 dark:border-slate-700">
              {groups.map((g) => (
                <li key={g.id} className="flex justify-between px-3 py-2">
                  <span>{g.name}</span>
                  <span className="text-gray-500 dark:text-slate-400">{g.memberIds.length} people</span>
                </li>
              ))}
            </ul>
          )}
          <Input label="New group name" value={groupName} onChange={setGroupName} maxLength={100} placeholder="e.g. Sunday ushers" />
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">People in this group</legend>
            <div className="max-h-56 overflow-y-auto rounded-md border border-gray-200 dark:border-slate-700 divide-y divide-gray-100 dark:divide-slate-700">
              {people.map((p) => (
                <label key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={groupMemberIds.includes(p.id)}
                    onChange={() => setGroupMemberIds((ids) => toggleIn(ids, p.id))}
                  />
                  <span>{p.full_name || p.id}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {groupError && <p className="text-sm text-york-600 dark:text-york-400">{groupError}</p>}
          {audienceLoadError && <p className="text-xs text-york-600 dark:text-york-400">{audienceLoadError}</p>}
        </div>
      </Modal>
    </div>
  );
};
