import React, { useEffect, useMemo, useState } from 'react';
import { Modal } from '../foundation/Modal';
import { Button } from '../foundation/Button';
import { Input } from '../foundation/Input';
import {
  AUDIENCE_MODES,
  AUDIENCE_MODE_LABELS,
  type AudienceChangeResult,
  type AudienceMode,
  type AudienceSelection,
  INVITATION_SOURCE_LABELS,
  MEETING_ATTENDANCE_LABELS,
  MEETING_ATTENDANCE_STATES,
  describeAudienceChange,
  emptyAudienceSelection,
  validateAudienceSelection,
} from '../../lib/audience/audienceContract';
import {
  createSavedGroup,
  fetchActiveAudiencePeople,
  fetchCells,
  fetchSavedGroups,
  fetchSavedGroupMemberIds,
  previewMeetingAudience,
  publishMeeting,
  setMeetingAudience,
  setSavedGroupMembers,
} from '../../lib/queries/meetingAudience';
import { fetchAttendances, markAttendanceStatus } from '../../lib/queries/meetings';
import type { AudiencePerson, Cell, Meeting, MeetingAttendance, MeetingAttendanceStatus, SavedGroup } from '../../types';
import type { AuthUser } from '../../lib/auth';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  meeting: Meeting | null;
  user: AuthUser | null;
  /** Called after an audience change or publication so the meetings list can refresh. */
  onChanged?: () => void;
}

const MODE_HELP: Record<AudienceMode, string> = {
  all: 'Every active member. Admins and coordinators only.',
  cells: 'Every active member of the cells you choose. Cell leaders can choose the cells they lead.',
  saved_groups: 'Every active member of the saved groups you choose. Admins and coordinators only.',
  explicit: 'Only the members you select. Cell leaders can select members of their own cells.',
};

export const MeetingAudiencePanel: React.FC<Props> = ({ isOpen, onClose, meeting, user, onChanged }) => {
  const isStaff = user?.role === 'admin' || user?.role === 'coordinator';

  const [cells, setCells] = useState<Cell[]>([]);
  const [groups, setGroups] = useState<SavedGroup[]>([]);
  const [people, setPeople] = useState<AudiencePerson[]>([]);
  const [roster, setRoster] = useState<MeetingAttendance[]>([]);
  const [selection, setSelection] = useState<AudienceSelection>(emptyAudienceSelection('cells'));
  const [preview, setPreview] = useState<AudienceChangeResult | null>(null);
  const [personFilter, setPersonFilter] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [groupMemberIds, setGroupMemberIds] = useState<string[]>([]);
  const [publishedAt, setPublishedAt] = useState<string | null>(meeting?.published_at ?? null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ledCellIds = useMemo(
    () => cells.filter((c) => c.leader_id && c.leader_id === user?.id).map((c) => c.id),
    [cells, user?.id],
  );
  const profileCellById = useMemo(
    () => Object.fromEntries(people.map((p) => [p.id, p.cell_id])),
    [people],
  );
  const caller = { isStaff: !!isStaff, ledCellIds, profileCellById };
  const validationErrors = validateAudienceSelection(selection, caller);

  const reloadRoster = async (meetingId: string) => {
    setRoster(await fetchAttendances(meetingId));
  };

  useEffect(() => {
    if (!isOpen || !meeting) return;
    setSelection(emptyAudienceSelection(isStaff ? 'all' : 'cells'));
    setPreview(null);
    setMessage(null);
    setError(null);
    setPublishedAt(meeting.published_at ?? null);
    Promise.all([fetchCells(), fetchSavedGroups(), fetchActiveAudiencePeople(), reloadRoster(meeting.id)])
      .then(([c, g, p]) => {
        setCells(c);
        setGroups(g);
        setPeople(p);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load invitations.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, meeting]);

  if (!meeting) return null;

  const isDraft = publishedAt === null;
  const visibleCells = isStaff ? cells : cells.filter((c) => ledCellIds.includes(c.id));
  const modeAllowed = (mode: AudienceMode) => (mode === 'all' || mode === 'saved_groups' ? !!isStaff : true);
  const filteredPeople = people.filter((p) => {
    const q = personFilter.trim().toLowerCase();
    if (!q) return true;
    return (p.full_name ?? '').toLowerCase().includes(q) || (p.email ?? '').toLowerCase().includes(q);
  });

  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  const changeSelection = (next: AudienceSelection) => {
    setSelection(next);
    setPreview(null);
    setMessage(null);
  };

  const changeMode = (mode: AudienceMode) => changeSelection({ ...emptyAudienceSelection(mode) });

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  };

  const handlePreview = () => run(async () => {
    setPreview(await previewMeetingAudience(meeting.id, selection));
  });

  const handleApply = () => run(async () => {
    const result = await setMeetingAudience(meeting.id, selection);
    setPreview(result);
    setMessage(`Invitations saved. ${describeAudienceChange(result)}`);
    await reloadRoster(meeting.id);
    onChanged?.();
  });

  const handlePublish = () => run(async () => {
    const result = await publishMeeting(meeting.id);
    setPublishedAt(result.published_at);
    setMessage(`Published to ${result.recipients} ${result.recipients === 1 ? 'person' : 'people'}.`);
    onChanged?.();
  });

  const handleCreateGroup = () => run(async () => {
    if (!user) return;
    const created = await createSavedGroup(newGroupName, user.id);
    setGroups((prev) => [...prev, { ...created, member_count: 0 }].sort((a, b) => a.name.localeCompare(b.name)));
    setNewGroupName('');
    setMessage(`Group "${created.name}" created.`);
  });

  const openGroupEditor = (groupId: string) => run(async () => {
    setEditingGroupId(groupId);
    setGroupMemberIds(await fetchSavedGroupMemberIds(groupId));
  });

  const saveGroupMembers = () => run(async () => {
    if (!user || !editingGroupId) return;
    await setSavedGroupMembers(editingGroupId, groupMemberIds, user.id);
    const count = groupMemberIds.length;
    setGroups((prev) => prev.map((g) => (g.id === editingGroupId ? { ...g, member_count: count } : g)));
    setMessage('Group members saved.');
    setEditingGroupId(null);
  });

  const handleStatus = (row: MeetingAttendance, status: MeetingAttendanceStatus) => run(async () => {
    await markAttendanceStatus(meeting.id, row.user_id, status);
    setRoster((prev) => prev.map((r) => (r.user_id === row.user_id ? { ...r, attendance_status: status } : r)));
    onChanged?.();
  });

  const counts = MEETING_ATTENDANCE_STATES.map((state) => ({
    state,
    count: roster.filter((r) => r.attendance_status === state).length,
  }));

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Invitations · ${meeting.title}`}
      size="large"
      footer={<Button variant="ghost" onClick={onClose} disabled={busy}>Close</Button>}
    >
      <div className="space-y-6">
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
          <p>
            <span className="font-semibold">{isDraft ? 'Draft' : 'Published'}</span>
            {' · '}{meeting.date} at {meeting.time.slice(0, 5)}
            {' · '}{roster.length} invited or registered
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {isDraft
              ? 'Only you can see this draft. Preview the invitations, then publish when you are ready.'
              : 'Published. Changes to invitations take effect as soon as you save them.'}
          </p>
        </div>

        {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {message && <div role="status" className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{message}</div>}

        {/* Audience */}
        <section className="space-y-3">
          <h3 className="text-sm font-bold text-gray-800">Who is invited</h3>
          <fieldset className="space-y-2">
            <legend className="sr-only">Audience type</legend>
            {AUDIENCE_MODES.filter(modeAllowed).map((mode) => (
              <label key={mode} className="flex items-start gap-3 text-sm">
                <input
                  type="radio"
                  name="audience-mode"
                  value={mode}
                  checked={selection.mode === mode}
                  onChange={() => changeMode(mode)}
                  className="mt-0.5 text-york-600 focus:ring-york-600"
                />
                <span>
                  <span className="font-semibold text-gray-800">{AUDIENCE_MODE_LABELS[mode]}</span>
                  <span className="block text-xs text-gray-500">{MODE_HELP[mode]}</span>
                </span>
              </label>
            ))}
          </fieldset>

          {selection.mode === 'all' && (
            <p className="text-sm text-gray-700">Every active member will be invited. Pending and rejected accounts are never invited.</p>
          )}

          {selection.mode === 'cells' && (
            <div className="grid grid-cols-2 gap-2">
              {visibleCells.length === 0 && <p className="text-sm text-gray-500 col-span-2">{isStaff ? 'No cells yet.' : 'You do not lead a cell.'}</p>}
              {visibleCells.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm text-gray-800">
                  <input
                    type="checkbox"
                    checked={selection.cellIds.includes(c.id)}
                    onChange={() => changeSelection({ ...selection, cellIds: toggle(selection.cellIds, c.id) })}
                    className="rounded text-york-600 focus:ring-york-600"
                  />
                  {c.name}
                </label>
              ))}
            </div>
          )}

          {selection.mode === 'saved_groups' && (
            <div className="space-y-2">
              {groups.length === 0 && <p className="text-sm text-gray-500">No saved groups yet.</p>}
              <div className="grid grid-cols-2 gap-2">
                {groups.map((g) => (
                  <div key={g.id} className="flex items-center justify-between gap-2 text-sm text-gray-800">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selection.groupIds.includes(g.id)}
                        onChange={() => changeSelection({ ...selection, groupIds: toggle(selection.groupIds, g.id) })}
                        className="rounded text-york-600 focus:ring-york-600"
                      />
                      {g.name} <span className="text-gray-400">({g.member_count ?? 0})</span>
                    </label>
                    <Button variant="ghost" size="small" onClick={() => openGroupEditor(g.id)} disabled={busy}>Members</Button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Input label="New group name" value={newGroupName} onChange={setNewGroupName} maxLength={80} />
                <div className="self-end">
                  <Button variant="ghost" size="small" onClick={handleCreateGroup} disabled={busy || !newGroupName.trim()}>
                    Create group
                  </Button>
                </div>
              </div>
              {editingGroupId && (
                <div className="rounded-lg border border-gray-200 p-3 space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Group members</p>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {people.map((p) => (
                      <label key={p.id} className="flex items-center gap-2 text-sm text-gray-800">
                        <input
                          type="checkbox"
                          checked={groupMemberIds.includes(p.id)}
                          onChange={() => setGroupMemberIds(toggle(groupMemberIds, p.id))}
                          className="rounded text-york-600 focus:ring-york-600"
                        />
                        {p.full_name || p.email || 'Member'}
                      </label>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="primary" size="small" onClick={saveGroupMembers} disabled={busy}>Save members</Button>
                    <Button variant="ghost" size="small" onClick={() => setEditingGroupId(null)} disabled={busy}>Cancel</Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {selection.mode === 'explicit' && (
            <div className="space-y-2">
              <Input label="Find a member" value={personFilter} onChange={setPersonFilter} placeholder="Name or email" />
              <div className="max-h-48 overflow-y-auto rounded-lg border border-gray-200 p-2 space-y-1">
                {filteredPeople.slice(0, 100).map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-sm text-gray-800">
                    <input
                      type="checkbox"
                      checked={selection.profileIds.includes(p.id)}
                      onChange={() => changeSelection({ ...selection, profileIds: toggle(selection.profileIds, p.id) })}
                      className="rounded text-york-600 focus:ring-york-600"
                    />
                    {p.full_name || p.email || 'Member'}
                  </label>
                ))}
              </div>
            </div>
          )}

          {validationErrors.map((e) => (
            <p key={e} className="text-sm text-red-600">{e}</p>
          ))}

          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={handlePreview} disabled={busy || validationErrors.length > 0}>
              Preview recipients
            </Button>
            <Button
              variant="primary"
              onClick={handleApply}
              disabled={busy || !preview || preview.dry_run !== true || validationErrors.length > 0}
            >
              Save invitations
            </Button>
          </div>

          {preview && preview.dry_run && (
            <div className="rounded-lg border border-york-200 bg-red-50 px-4 py-3 text-sm text-gray-800">
              <p className="font-semibold">Invitation preview</p>
              <p>{describeAudienceChange(preview)}</p>
            </div>
          )}
        </section>

        {/* Publication */}
        {isDraft && (
          <section className="space-y-2 border-t border-gray-200 pt-4">
            <h3 className="text-sm font-bold text-gray-800">Publish</h3>
            <p className="text-xs text-gray-600">
              Publishing makes the meeting visible to the people it is meant for. Preview the invitations first.
            </p>
            <Button variant="primary" onClick={handlePublish} disabled={busy || !preview}>
              Publish meeting
            </Button>
          </section>
        )}

        {/* Roster */}
        <section className="space-y-2 border-t border-gray-200 pt-4">
          <h3 className="text-sm font-bold text-gray-800">Attendance</h3>
          <p className="text-xs text-gray-600">
            {counts.filter((c) => c.count > 0).map((c) => `${MEETING_ATTENDANCE_LABELS[c.state]}: ${c.count}`).join(' · ') || 'No one invited yet.'}
          </p>
          {roster.length > 0 && (
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
              {roster.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="text-gray-800">
                    {row.user_name}
                    <span className="ml-2 text-xs text-gray-400">{INVITATION_SOURCE_LABELS[row.invited_via] ?? row.invited_via}</span>
                  </span>
                  <label className="sr-only" htmlFor={`status-${row.id}`}>Attendance for {row.user_name}</label>
                  <select
                    id={`status-${row.id}`}
                    value={row.attendance_status}
                    disabled={busy}
                    onChange={(e) => handleStatus(row, e.target.value as MeetingAttendanceStatus)}
                    className="rounded-md border-gray-300 text-sm"
                  >
                    {MEETING_ATTENDANCE_STATES.map((s) => (
                      <option key={s} value={s}>{MEETING_ATTENDANCE_LABELS[s]}</option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Modal>
  );
};
