// Shared audience model. The contract lives in docs/audience-infrastructure-contract.md.
// Recipients are always profiles.id values derived from terms. Clients never supply recipient ids as authority.

export type AudienceTermType = 'everyone' | 'cell' | 'saved_group' | 'member';
export type AudienceEffect = 'include' | 'exclude';
export type AudienceResolutionMode = 'dynamic' | 'snapshot';
export type AudienceConsumerType =
  | 'meeting'
  | 'event'
  | 'announcement'
  | 'message'
  | 'assignment'
  | 'affirmation';
export type AudienceGroupVisibility = 'owner' | 'organisation';

export interface AudienceTerm {
  type: AudienceTermType;
  /** null for 'everyone'; cell id, group id or profile id otherwise. */
  refId: string | null;
  effect: AudienceEffect;
}

export interface AudienceDraft {
  terms: AudienceTerm[];
  resolutionMode: AudienceResolutionMode;
}

export interface AudienceCandidate {
  /** profiles.id */
  id: string;
  fullName: string;
  email: string | null;
  /** profiles.cell_id */
  cellId: string | null;
  status: 'active' | 'pending' | 'rejected' | 'inactive';
}

export interface AudienceCell {
  id: string;
  name: string;
}

export interface AudienceSavedGroup {
  id: string;
  name: string;
  ownerId: string;
  visibility: AudienceGroupVisibility;
  archivedAt: string | null;
  memberIds: string[];
}

/** What the actor may use. Computed server-side; the client copy only shapes the UI. */
export interface AudienceScope {
  /** true only for core admin / coordinator */
  canUseEveryone: boolean;
  /** cells where cells.leader_id = actor */
  ledCellIds: string[];
}

export type AudienceValidationError =
  | 'no_include_terms'
  | 'empty_audience'
  | 'everyone_not_permitted'
  | 'out_of_scope_member'
  | 'out_of_scope_cell'
  | 'unknown_group'
  | 'malformed_term';

export interface AudienceData {
  candidates: AudienceCandidate[];
  groups: AudienceSavedGroup[];
  cells: AudienceCell[];
}

export interface AudienceResolution {
  /** Sorted, unique. Empty whenever any hard error is present (the server rejects the whole request). */
  recipientIds: string[];
  errors: AudienceValidationError[];
}
