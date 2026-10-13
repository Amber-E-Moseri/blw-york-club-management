// Canonical audience model. Mirrors public.audience_specs (migrations 059, 068) and the contract in
// docs/audience-shared-contract.md. Field names follow the database (camelCase here, snake_case in SQL).
//
// Clients send a SPEC (kinds and exclusions). The database derives recipients. A client never sends
// recipient ids as authority.

export type AudienceMode = 'all' | 'cells' | 'saved_groups' | 'explicit' | 'composite';

export type AudienceConsumerType = 'announcement' | 'affirmation' | 'event' | 'message';

/** What the composer edits. Matches the create_audience_spec() arguments one-to-one. */
export interface AudienceSpecDraft {
  mode: AudienceMode;
  cellIds: string[];
  groupIds: string[];
  profileIds: string[];
  excludedCellIds: string[];
  excludedGroupIds: string[];
  excludedProfileIds: string[];
}

/** Row shape returned for an audience_specs record (read by staff only). */
export interface AudienceSpecRecord {
  id: string;
  mode: AudienceMode;
  cell_ids: string[] | null;
  group_ids: string[] | null;
  profile_ids: string[] | null;
  excluded_cell_ids: string[] | null;
  excluded_group_ids: string[] | null;
  excluded_profile_ids: string[] | null;
}

export interface AudienceCandidate {
  /** profiles.id */
  id: string;
  fullName: string;
  email: string | null;
  /** profiles.cell_id */
  cellId: string | null;
  status: 'active' | 'pending' | 'rejected';
}

export interface AudienceCell {
  id: string;
  name: string;
  /** cells.leader_id; used to scope a cell leader's choices. */
  leaderId?: string | null;
}

export interface AudienceSavedGroup {
  id: string;
  name: string;
  isActive: boolean;
  memberIds: string[];
}

/** What the actor may use. The server enforces this; the client copy only shapes the UI. */
export interface AudienceScope {
  /** true only for admin / coordinator */
  canUseEveryone: boolean;
  /** cells where cells.leader_id = actor */
  ledCellIds: string[];
  /** a cell leader may target only their own cell, with no exclusions */
  canExclude: boolean;
}

export type AudienceValidationError =
  | 'no_include'
  | 'mode_mismatch'
  | 'empty_audience'
  | 'everyone_not_permitted'
  | 'exclusions_not_permitted'
  | 'out_of_scope_cell'
  | 'out_of_scope_member'
  | 'unknown_group';

export interface AudienceData {
  candidates: AudienceCandidate[];
  groups: AudienceSavedGroup[];
  cells: AudienceCell[];
}

export interface AudienceResolution {
  /** Sorted, unique. Empty whenever a hard error is present (the server rejects the whole request). */
  recipientIds: string[];
  errors: AudienceValidationError[];
}
