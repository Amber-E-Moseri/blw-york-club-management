// Shared meeting audience contract.
//
// This module is the client side of the single audience system described in
// supabase/migrations/039_meeting_audience_and_invitations.sql and docs/meeting-audience-contract.md.
// The database is authoritative: every rule here is repeated in set_meeting_audience() and the RLS policies, and
// is only used to give organizers immediate feedback before a request is sent.
//
// It has no Supabase import, so it can be unit tested and reused by other feature areas.

export const MEETING_INVITATION_SOURCES = ['member', 'group', 'cell', 'all', 'self'] as const;
export type MeetingInvitationSource = (typeof MEETING_INVITATION_SOURCES)[number];

export const MEETING_ATTENDANCE_STATES = ['invited', 'confirmed', 'attended', 'absent', 'excused'] as const;
export type MeetingAttendanceState = (typeof MEETING_ATTENDANCE_STATES)[number];

/** States a staff member may record. Invitees may only choose 'confirmed' or 'excused' for themselves. */
export const STAFF_ATTENDANCE_STATES: readonly MeetingAttendanceState[] = MEETING_ATTENDANCE_STATES;
export const INVITEE_RESPONSE_STATES = ['confirmed', 'excused'] as const;
export type InviteeResponseState = (typeof INVITEE_RESPONSE_STATES)[number];

export const MEETING_ATTENDANCE_LABELS: Record<MeetingAttendanceState, string> = {
  invited: 'Invited',
  confirmed: 'Confirmed',
  attended: 'Attended',
  absent: 'Absent',
  excused: 'Excused',
};

/** The audience an organizer is building. Empty arrays and false mean "not included". */
export interface MeetingAudienceSelection {
  allMembers: boolean;
  cellIds: string[];
  groupIds: string[];
  memberIds: string[];
}

export const emptyMeetingAudience = (): MeetingAudienceSelection => ({
  allMembers: false,
  cellIds: [],
  groupIds: [],
  memberIds: [],
});

export function isAudienceEmpty(selection: MeetingAudienceSelection): boolean {
  return !selection.allMembers
    && selection.cellIds.length === 0
    && selection.groupIds.length === 0
    && selection.memberIds.length === 0;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AudienceCaller {
  /** Admins and coordinators. */
  isStaff: boolean;
  /** Cells the caller leads. Used only when the caller is not staff. */
  ledCellIds: string[];
}

/**
 * Returns the reasons a selection cannot be sent, or an empty list when it can. Mirrors set_meeting_audience():
 *   - all members, saved groups and specific members are staff-only;
 *   - a cell leader may only pick cells they lead;
 *   - every id must be a UUID.
 * Whether a specific member is active is checked by the database, not here.
 */
export function validateAudienceSelection(selection: MeetingAudienceSelection, caller: AudienceCaller): string[] {
  const errors: string[] = [];

  if (isAudienceEmpty(selection)) {
    // An empty selection is valid: it removes every invitation that has no recorded attendance.
    return errors;
  }

  const ids = [...selection.cellIds, ...selection.groupIds, ...selection.memberIds];
  if (ids.some((id) => !UUID.test(id))) errors.push('The audience contains an unknown reference.');

  if (!caller.isStaff) {
    if (selection.allMembers) errors.push('Only admins and coordinators can invite all members.');
    if (selection.groupIds.length > 0) errors.push('Only admins and coordinators can invite a saved group.');
    if (selection.memberIds.length > 0) errors.push('Only admins and coordinators can invite selected members.');
    const led = new Set(caller.ledCellIds);
    if (selection.cellIds.some((id) => !led.has(id))) errors.push('You can only invite members of cells you lead.');
  }

  return errors;
}

/** Parameters for the set_meeting_audience RPC. */
export function toSetAudienceParams(meetingId: string, selection: MeetingAudienceSelection, dryRun: boolean) {
  return {
    p_meeting_id: meetingId,
    p_all_members: selection.allMembers,
    p_cell_ids: selection.cellIds,
    p_group_ids: selection.groupIds,
    p_member_ids: selection.memberIds,
    p_dry_run: dryRun,
  };
}

/** The result shape returned by set_meeting_audience(). */
export interface AudienceChangeResult {
  dry_run: boolean;
  recipients: number;
  added: number;
  removed: number;
}

/** A one-line preview for the organizer, written before anything is published. */
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

/** Parameters for the publish_meeting RPC. */
export function toPublishParams(meetingId: string) {
  return { p_meeting_id: meetingId };
}

/** Whether a stored attendance row still belongs to a person who was invited (rather than registered themselves). */
export function isInvitation(row: { invited_via?: MeetingInvitationSource | null }): boolean {
  return !!row.invited_via && row.invited_via !== 'self';
}
