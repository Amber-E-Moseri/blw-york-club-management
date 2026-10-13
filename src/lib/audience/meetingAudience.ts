import { emptySelection, type AudienceMode, type AudienceSelection } from '../communications/messaging';

export type { AudienceMode, AudienceSelection };

// Shared audience contract (docs/ops-shared-contracts.md §1–4).
//
// Every audience-aware feature uses these four modes and this selection shape. Meetings use it through
// set_meeting_audience(); events, announcements, assignments and affirmations use the same audience_specs rows through
// their own RPCs. The database is authoritative. The checks here only give immediate feedback and mirror the RPCs.
//
// No Supabase import, so this module can be unit tested and used by any feature area.

/**
 * Meeting audiences use the shared model from the messaging module (the same four modes and selection shape as
 * send_message, preview_audience and the audience_specs rows). Only the meeting-specific role rules live here.
 */
export const AUDIENCE_MODES: readonly AudienceMode[] = ['all', 'cells', 'saved_groups', 'explicit'];

export const AUDIENCE_MODE_LABELS: Record<AudienceMode, string> = {
  all: 'Every active member',
  cells: 'Cells',
  saved_groups: 'Saved groups',
  explicit: 'Specific members',
};

export function emptyMeetingAudience(mode: AudienceMode = 'all'): AudienceSelection {
  return emptySelection(mode);
}

/** Modes a meeting organiser may use. A cell leader may invite their own cells, and members of their own cells. */
export function meetingAllowedModes(isStaff: boolean, ledCellIds: readonly string[]): AudienceMode[] {
  if (isStaff) return [...AUDIENCE_MODES];
  return ledCellIds.length > 0 ? ['cells', 'explicit'] : [];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AudienceCaller {
  /** Admins and coordinators. */
  isStaff: boolean;
  /** Cells the caller leads (cells.leader_id = caller). Only used when the caller is not staff. */
  ledCellIds: string[];
  /** Cell of each profile the caller may invite, when known. Used for the explicit-mode check by cell leaders. */
  profileCellById?: Record<string, string | null>;
}

/**
 * Reasons a selection cannot be sent, or an empty list when it can. Mirrors set_meeting_audience() (migration 066):
 *   all, saved_groups: admins and coordinators;
 *   cells: at least one cell; a cell leader may only pick cells they lead;
 *   explicit: at least one member; a cell leader may only pick members of their own cells;
 *   every id must be a UUID.
 * Whether a profile is active is decided by the database.
 */
export function validateAudienceSelection(selection: AudienceSelection, caller: AudienceCaller): string[] {
  const errors: string[] = [];
  const ids = [...selection.cellIds, ...selection.groupIds, ...selection.profileIds];
  if (ids.some((id) => !UUID.test(id))) errors.push('The audience contains an unknown reference.');

  switch (selection.mode) {
    case 'all':
      if (!caller.isStaff) errors.push('Only admins and coordinators can invite all members.');
      break;
    case 'saved_groups':
      if (!caller.isStaff) errors.push('Only admins and coordinators can invite a saved group.');
      if (selection.groupIds.length === 0) errors.push('Choose at least one saved group.');
      break;
    case 'cells': {
      if (selection.cellIds.length === 0) errors.push('Choose at least one cell.');
      const led = new Set(caller.ledCellIds);
      if (!caller.isStaff && selection.cellIds.some((id) => !led.has(id))) {
        errors.push('You can only invite members of cells you lead.');
      }
      break;
    }
    case 'explicit': {
      if (selection.profileIds.length === 0) errors.push('Choose at least one member.');
      if (!caller.isStaff && caller.profileCellById) {
        const led = new Set(caller.ledCellIds);
        const outside = selection.profileIds.some((id) => {
          const cell = caller.profileCellById?.[id];
          return !cell || !led.has(cell);
        });
        if (outside) errors.push('You can only invite members of your own cells.');
      }
      break;
    }
  }
  return errors;
}

/** Parameters for set_meeting_audience(). Arrays not used by the mode are sent empty. */
export function toSetAudienceParams(meetingId: string, selection: AudienceSelection, dryRun: boolean) {
  return {
    p_meeting_id: meetingId,
    p_mode: selection.mode,
    p_cell_ids: selection.mode === 'cells' ? selection.cellIds : [],
    p_group_ids: selection.mode === 'saved_groups' ? selection.groupIds : [],
    p_profile_ids: selection.mode === 'explicit' ? selection.profileIds : [],
    p_dry_run: dryRun,
  };
}

/** The result of set_meeting_audience(). */
export interface AudienceChangeResult {
  dry_run: boolean;
  recipients: number;
  added: number;
  removed: number;
  audience_spec_id?: string;
}

export function describeAudienceChange(result: AudienceChangeResult): string {
  const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;
  const change = [
    result.added > 0 ? `${result.added} added` : null,
    result.removed > 0 ? `${result.removed} removed` : null,
  ].filter(Boolean).join(', ');
  return change
    ? `This meeting will be sent to ${people(result.recipients)} (${change}).`
    : `This meeting will be sent to ${people(result.recipients)}. No changes.`;
}

/** Recipient provenance, as stored in meeting_attendances.invited_via. Self means the person registered themselves. */
export const INVITATION_SOURCES = ['self', 'member', 'group', 'cell', 'all'] as const;
export type InvitationSource = (typeof INVITATION_SOURCES)[number];

/** The invited_via value that a spec mode produces. */
export function invitationSourceFor(mode: AudienceMode): Exclude<InvitationSource, 'self'> {
  switch (mode) {
    case 'all': return 'all';
    case 'cells': return 'cell';
    case 'saved_groups': return 'group';
    case 'explicit': return 'member';
  }
}

export const INVITATION_SOURCE_LABELS: Record<InvitationSource, string> = {
  self: 'Registered',
  member: 'Selected',
  group: 'Saved group',
  cell: 'Cell',
  all: 'All members',
};

export function isInvitation(row: { invited_via?: InvitationSource | null }): boolean {
  return !!row.invited_via && row.invited_via !== 'self';
}

/** Attendance states, as stored in meeting_attendances.attendance_status. */
export const MEETING_ATTENDANCE_STATES = ['invited', 'confirmed', 'attended', 'absent', 'excused'] as const;
export type MeetingAttendanceState = (typeof MEETING_ATTENDANCE_STATES)[number];

export const MEETING_ATTENDANCE_LABELS: Record<MeetingAttendanceState, string> = {
  invited: 'Invited',
  confirmed: 'Confirmed',
  attended: 'Attended',
  absent: 'Absent',
  excused: 'Excused',
};

/** Recorded outcomes. Once set by staff these cannot be reset to an invitation or confirmation. */
export const RECORDED_OUTCOME_STATES: readonly MeetingAttendanceState[] = ['attended', 'absent'];
