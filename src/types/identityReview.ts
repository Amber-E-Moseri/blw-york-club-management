// Identity review (migration 097). Visible only to active admins and coordinators.
// Summaries carry names, never identity values. Submitted and canonical identity is requested one record at a time,
// and every request is recorded with a reason.

export type IdentityClaimStatus = 'unique' | 'open' | 'attached' | 'kept_separate' | 'superseded';

export type IdentityResolutionDecision = 'attach' | 'keep_separate';

export interface IdentityClaimSummary {
  claimId: string;
  contactId: string;
  contactName: string;
  cellId: string | null;
  status: IdentityClaimStatus;
  candidatePersonIds: string[];
  candidateNames: string[];
  createdAt: string;
}

export interface ClaimIdentity {
  submittedEmail: string | null;
  submittedPhone: string | null;
}

export interface PersonIdentity {
  fullName: string;
  email: string | null;
  phone: string | null;
}

export const IDENTITY_REASON_MIN = 3;
export const IDENTITY_REASON_MAX = 500;
