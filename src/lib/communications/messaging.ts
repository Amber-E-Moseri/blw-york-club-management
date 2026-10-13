// Client-side message rules: draft validation, the shape sent to send_message, which audience modes a role may
// pick (UX only), and how a delivery outcome is labelled.
//
// Nothing here is authoritative. send_message and preview_audience (migration 067) re-check every rule in the
// database. These helpers exist so the composer can explain a problem before a round trip.

export type AudienceMode = 'all' | 'cells' | 'saved_groups' | 'explicit';
export type Channel = 'inbox' | 'email' | 'push';
export type UserRole = 'coordinator' | 'admin' | 'cell_leader' | 'member';

export interface AudienceSelection {
  mode: AudienceMode;
  cellIds: string[];
  groupIds: string[];
  profileIds: string[];
}

export interface DraftInput {
  subject: string;
  body: string;
  selection: AudienceSelection;
  channels: Channel[];
}

export const SUBJECT_MAX = 200;
export const BODY_MAX = 10000;

export function emptySelection(mode: AudienceMode = 'explicit'): AudienceSelection {
  return { mode, cellIds: [], groupIds: [], profileIds: [] };
}

/**
 * Leadership is an assignment (migration 054): cells.leader_id = the caller, on an active account. It is not a role
 * label and not profiles.cell_id (membership). `ledCellIds` is the list of cells the caller leads, read from cells.
 * The database applies the same rule in assert_can_send_message (migration 067).
 */
export function allowedModes(role: UserRole, ledCellIds: string[]): AudienceMode[] {
  if (role === 'admin' || role === 'coordinator') return ['all', 'cells', 'saved_groups', 'explicit'];
  if (ledCellIds.length > 0) return ['cells'];
  return [];
}

/** Email and push go to the whole membership, so they are staff-only until separately approved. */
export function canSendExternal(role: UserRole): boolean {
  return role === 'admin' || role === 'coordinator';
}

/**
 * Returns a message to show, or null when the selection is allowed. A leader may pick only cells they lead.
 * Staff are not limited by ledCellIds.
 */
export function selectionProblem(role: UserRole, ledCellIds: string[], selection: AudienceSelection): string | null {
  if (!allowedModes(role, ledCellIds).includes(selection.mode)) return 'You cannot send to this audience.';
  if (selection.mode === 'cells') {
    if (selection.cellIds.length === 0) return 'Choose a cell.';
    const isStaff = role === 'admin' || role === 'coordinator';
    if (!isStaff && selection.cellIds.some((id) => !ledCellIds.includes(id))) {
      return 'You can message only the cells you lead.';
    }
  }
  if (selection.mode === 'saved_groups' && selection.groupIds.length === 0) return 'Choose at least one group.';
  if (selection.mode === 'explicit' && selection.profileIds.length === 0) return 'Choose at least one person.';
  return null;
}

/** Validation for subject, body, channels and selection. Returns a field-keyed error map; empty means valid. */
export function validateDraft(draft: DraftInput): Record<string, string> {
  const errors: Record<string, string> = {};
  const subject = draft.subject.trim();
  const body = draft.body.trim();
  if (!subject) errors.subject = 'Add a subject.';
  else if (subject.length > SUBJECT_MAX) errors.subject = `Keep the subject under ${SUBJECT_MAX} characters.`;
  if (!body) errors.body = 'Write a message.';
  else if (body.length > BODY_MAX) errors.body = `Keep the message under ${BODY_MAX} characters.`;
  if (!draft.channels.includes('inbox')) errors.channels = 'Every message is sent to the inbox.';
  return errors;
}

/** Arguments for the send_message RPC. Unused id lists are sent empty so the database sees one shape. */
export function toSendArgs(draft: DraftInput, idempotencyKey: string) {
  const { selection } = draft;
  return {
    p_subject: draft.subject.trim(),
    p_body: draft.body.trim(),
    p_mode: selection.mode,
    p_cell_ids: selection.mode === 'cells' ? selection.cellIds : [],
    p_group_ids: selection.mode === 'saved_groups' ? selection.groupIds : [],
    p_profile_ids: selection.mode === 'explicit' ? selection.profileIds : [],
    p_channels: Array.from(new Set<Channel>(['inbox', ...draft.channels.filter((c) => c !== 'inbox')])),
    p_idempotency_key: idempotencyKey,
  };
}

/** Human labels for a stored delivery status. 'stored' and 'accepted' are never shown as delivered. */
export function deliveryLabel(channel: Channel, status: string, reason?: string | null): string {
  const where = channel === 'inbox' ? 'Inbox' : channel === 'email' ? 'Email' : 'Push';
  switch (status) {
    case 'stored':
      return `${where}: in member inbox`;
    case 'accepted':
      return channel === 'email' ? 'Email: accepted by mail relay' : 'Push: accepted by push service';
    case 'pending':
      return `${where}: waiting to send`;
    case 'sending':
      return `${where}: sending`;
    case 'skipped':
      return `${where}: skipped${reason ? ` (${reason})` : ''}`;
    case 'failed':
      return `${where}: failed${reason ? ` (${reason})` : ''}`;
    default:
      return `${where}: ${status}`;
  }
}

export type MessageStatus = 'sending' | 'complete' | 'partially_failed' | 'failed';

/** Summary across a message's external deliveries. Inbox rows count as complete once stored. */
export function messageStatusFor(statuses: string[]): MessageStatus {
  if (statuses.some((s) => s === 'pending' || s === 'sending')) return 'sending';
  const failed = statuses.filter((s) => s === 'failed').length;
  const counted = statuses.filter((s) => s !== 'skipped').length;
  if (failed === 0) return 'complete';
  if (failed === counted) return 'failed';
  return 'partially_failed';
}

export const MESSAGE_STATUS_LABEL: Record<MessageStatus, string> = {
  sending: 'Sending',
  complete: 'Sent',
  partially_failed: 'Sent with failures',
  failed: 'Failed',
};

export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
