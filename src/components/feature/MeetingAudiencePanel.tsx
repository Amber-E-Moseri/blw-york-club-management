import React, { useEffect, useMemo, useState } from 'react';
import { Modal } from '../foundation/Modal';
import { Button } from '../foundation/Button';
import { Input } from '../foundation/Input';
import {
  type AudienceChangeResult,
  type MeetingAudienceSelection,
  MEETING_ATTENDANCE_LABELS,
  MEETING_ATTENDANCE_STATES,
  describeAudienceChange,
  emptyMeetingAudience,
  isAudienceEmpty,
  validateAudienceSelection,
} from '../../lib/audience/meetingAudience';
import {
  fetchActiveAudiencePeople,
  fetchCells,
  fetchMemberGroups,
  createMemberGroup,
  previewMeetingAudience,
  publishMeeting,
  setMeetingAudience,
} from '../../lib/queries/meetingAudience';
import { fetchAttendances, markAttendanceStatus } from '../../lib/queries/meetings';
import type { AudiencePerson, Cell, Meeting, MeetingAttendance, MeetingAttendanceStatus, MemberGroup } from '../../types';
import type { AuthUser } from '../../lib/auth';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  meeting: Meeting | null;
  user: AuthUser | null;
  /** Called after an audience change or publication so the meetings list can refresh. */
  onChanged?: () => void;
}

const INVITED_VIA_LABEL: Record<MeetingAttendance['invited_via'], string> = {
  self: 'Registered',
  member: 'Selected',
  group: 'Saved group',
  cell: 'Cell',
  all: 'All members',
};

const toggle = (list: string[], id: string) =>
  list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

export const MeetingAudiencePanel: React.FC<Props> = ({ isOpen, onClose, meeting, user, onChanged }) => {
  const isStaff = user?.role === 'admin' || user?.role === 'coordinator';

  const [cells, setCells] = useState<Cell[]>([]);
  const [groups, setGroups] = useState<MemberGroup[]>([]);
  const [people, setPeople] = useState<AudiencePerson[]>([]);
  const [roster, setRoster] = useState<MeetingAttendance[]>([]);
  const [selection, setSelection] = useState<MeetingAudienceSelection>(emptyMeetingAudience());
  const [preview, setPreview] = useState<AudienceChangeResult | null>(null);
  const [personFilter, setPersonFilter] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [publishedAt, setPublishedAt] = useState<string | null>(meeting?.published_at ?? null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ledCellIds = useMemo(
    () => cells.filter((c) => c.leader_id && c.leader_id === user?.id).map((c) => c.id),
    [cells, user?.id],
  );

  const reloadRoster = async (meetingId: string) => {
    setRoster(await fetchAttendances(meetingId));
  };

  useEffect(() => {
    if (!isOpen || !meeting) return;
    setSelection(emptyMeetingAudience());
    setPreview(null);
    setMessage(null);
    setError(null);
    setPublishedAt(meeting.published_at ?? null);
    Promise.all([fetchCells(), fetchMemberGroups(), fetchActiveAudiencePeople(), reloadRoster(meeting.id)])
      .then(([c, g, p]) => {
        setCells(c);
        setGroups(g);
        setPeople(p);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load invitations.'));
  }, [isOpen, meeting]);

  if (!meeting) return null;

  const visibleCells = isStaff ? cells : cells.filter((c) => ledCellIds.includes(c.id));
  const validationErrors = validateAudienceSelection(selection, { isStaff: !!isStaff, ledCellIds });
  const filteredPeople = people.filter((p) => {
    const q = personFilter.trim().toLowerCase();
    if (!q) return true;
    return (p.full_name ?? '').toLowerCase().includes(q) || (p.email ?? '').toLowerCase().includes(q);
  });
  const isDraft = publishedAt === null;

  const changeSelection = (next: MeetingAudienceSelection) => {
    setSelection(next);
    setPreview(null);
    setMessage(null);
  };

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
    const created = await createMemberGroup(newGroupName, user.id);
    setGroups((prev) => [...prev, { ...created, member_count: 0 }].sort((a, b) => a.name.localeCompare(b.name)));
    setNewGroupName('');
    setMessage(`Group "${created.name}" created. Add its members from the people list after saving.`);
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
        <div className="rounded-lg border border-gray-200 bg-gray-50 dark:border-slate-700 dark:bg-slate-800/60 px-4 py-3 text-sm text-gray-700 dark:text-slate-300">
          <p>
            <span className="font-semibold">{isDraft ? 'Draft' : 'Published'}</span>
            {' · '}{meeting.date} at {meeting.time.slice(0, 5)}
            {' · '}{roster.length} invited or registered
          </p>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
            {isDraft
              ? 'Only you can see this draft. Preview the invitations, then publish when you are ready.'
              : 'Published. Changes to invitations take effect as soon as you save them.'}
          </p>
        </div>

        {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</div>}
        {message && <div role="status" className="rounded-lg border border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950 px-4 py-3 text-sm text-green-800 dark:text-green-200">{message}</div>}

        {/* Audience */}
        <section className="space-y-3">
          <h3 className="text-sm font-bold text-gray-800 dark:text-slate-200">Who is invited</h3>

          {isStaff && (
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={selection.allMembers}
                onChange={(e) => changeSelection({ ...selection, allMembers: e.target.checked })}
                className="rounded text-york-600 focus:ring-york-600"
              />
              <span className="text-sm text-gray-800 dark:text-slate-200">Every active member</span>
            </label>
          )}

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-1">Cells</p>
            {visibleCells.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-slate-400">{isStaff ? 'No cells yet.' : 'You do not lead a cell.'}</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {visibleCells.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm text-gray-800 dark:text-slate-200">
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
          </div>

          {isStaff && (
            <>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-1">Saved groups</p>
                {groups.length === 0 && <p className="text-sm text-gray-500 dark:text-slate-400">No saved groups yet.</p>}
                <div className="grid grid-cols-2 gap-2">
                  {groups.map((g) => (
                    <label key={g.id} className="flex items-center gap-2 text-sm text-gray-800 dark:text-slate-200">
                      <input
                        type="checkbox"
                        checked={selection.groupIds.includes(g.id)}
                        onChange={() => changeSelection({ ...selection, groupIds: toggle(selection.groupIds, g.id) })}
                        className="rounded text-york-600 focus:ring-york-600"
                      />
                      {g.name} <span className="text-gray-400 dark:text-slate-500">({g.member_count ?? 0})</span>
                    </label>
                  ))}
                </div>
                <div className="flex gap-2 mt-2">
                  <Input label="New group name" value={newGroupName} onChange={setNewGroupName} maxLength={80} />
                  <div className="self-end">
                    <Button variant="ghost" size="small" onClick={handleCreateGroup} disabled={busy || !newGroupName.trim()}>
                      Create group
                    </Button>
                  </div>
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-1">Specific people</p>
                <Input label="Find a member" value={personFilter} onChange={setPersonFilter} placeholder="Name or email" />
                <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-gray-200 dark:border-slate-700 p-2 space-y-1">
                  {filteredPeople.slice(0, 100).map((p) => (
                    <label key={p.id} className="flex items-center gap-2 text-sm text-gray-800 dark:text-slate-200">
                      <input
                        type="checkbox"
                        checked={selection.memberIds.includes(p.id)}
                        onChange={() => changeSelection({ ...selection, memberIds: toggle(selection.memberIds, p.id) })}
                        className="rounded text-york-600 focus:ring-york-600"
                      />
                      {p.full_name || p.email || 'Member'}
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}

          {validationErrors.map((e) => (
            <p key={e} className="text-sm text-red-600 dark:text-red-400">{e}</p>
          ))}

          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={handlePreview} disabled={busy || validationErrors.length > 0}>
              Preview recipients
            </Button>
            <Button
              variant="primary"
              onClick={handleApply}
              disabled={busy || !preview || validationErrors.length > 0 || preview.dry_run === false}
            >
              Save invitations
            </Button>
          </div>

          {preview && (
            <div className="rounded-lg border border-york-200 dark:border-york-800 bg-york-50 dark:bg-york-900/30 px-4 py-3 text-sm text-gray-800 dark:text-slate-200">
              <p className="font-semibold">Invitation preview</p>
              <p>{describeAudienceChange(preview)}</p>
              {isAudienceEmpty(selection) && (
                <p className="text-xs text-gray-600 dark:text-slate-400 mt-1">
                  An empty selection removes every invitation that has no recorded attendance.
                </p>
              )}
            </div>
          )}
        </section>

        {/* Publication */}
        {isDraft && (
          <section className="space-y-2 border-t border-gray-200 dark:border-slate-700 pt-4">
            <h3 className="text-sm font-bold text-gray-800 dark:text-slate-200">Publish</h3>
            <p className="text-xs text-gray-600 dark:text-slate-400">
              Publishing makes the meeting visible to the people it is meant for. Preview the invitations first.
            </p>
            <Button variant="primary" onClick={handlePublish} disabled={busy || !preview}>
              Publish meeting
            </Button>
          </section>
        )}

        {/* Roster */}
        <section className="space-y-2 border-t border-gray-200 dark:border-slate-700 pt-4">
          <h3 className="text-sm font-bold text-gray-800 dark:text-slate-200">Attendance</h3>
          <p className="text-xs text-gray-600 dark:text-slate-400">
            {counts.filter((c) => c.count > 0).map((c) => `${MEETING_ATTENDANCE_LABELS[c.state]}: ${c.count}`).join(' · ') || 'No one invited yet.'}
          </p>
          {roster.length > 0 && (
            <ul className="divide-y divide-gray-100 dark:divide-slate-800 rounded-lg border border-gray-200 dark:border-slate-700">
              {roster.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="text-gray-800 dark:text-slate-200">
                    {row.user_name}
                    <span className="ml-2 text-xs text-gray-400 dark:text-slate-500">{INVITED_VIA_LABEL[row.invited_via] ?? row.invited_via}</span>
                  </span>
                  <label className="sr-only" htmlFor={`status-${row.id}`}>Attendance for {row.user_name}</label>
                  <select
                    id={`status-${row.id}`}
                    value={row.attendance_status}
                    disabled={busy}
                    onChange={(e) => handleStatus(row, e.target.value as MeetingAttendanceStatus)}
                    className="rounded-md border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 text-sm"
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
