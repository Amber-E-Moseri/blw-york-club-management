import { supabase } from '../supabase';
import {
  IDENTITY_REASON_MAX,
  IDENTITY_REASON_MIN,
  type ClaimIdentity,
  type IdentityClaimStatus,
  type IdentityClaimSummary,
  type IdentityResolutionDecision,
  type PersonIdentity,
} from '../../types/identityReview';

/** Mirrors _f2_valid_reason in migration 097. The database is the authority; this only saves a round trip. */
export function validateIdentityReason(reason: string): string | null {
  const trimmed = reason.trim();
  if (trimmed.length < IDENTITY_REASON_MIN || trimmed.length > IDENTITY_REASON_MAX) {
    return `Give a reason (${IDENTITY_REASON_MIN} to ${IDENTITY_REASON_MAX} characters).`;
  }
  return null;
}

type Row = Record<string, unknown>;

function mapSummary(row: Row): IdentityClaimSummary {
  return {
    claimId: row.claim_id as string,
    contactId: row.contact_id as string,
    contactName: (row.contact_name as string) ?? '',
    cellId: (row.cell_id as string | null) ?? null,
    status: row.status as IdentityClaimStatus,
    candidatePersonIds: (row.candidate_person_ids as string[] | null) ?? [],
    candidateNames: (row.candidate_names as string[] | null) ?? [],
    createdAt: row.created_at as string,
  };
}

function firstRow(data: unknown): Row | null {
  if (Array.isArray(data)) return (data[0] as Row | undefined) ?? null;
  return (data as Row | null) ?? null;
}

export async function listIdentityClaims(
  status: IdentityClaimStatus = 'open',
  limit = 50,
): Promise<IdentityClaimSummary[]> {
  const { data, error } = await supabase.rpc('list_identity_claims', { p_status: status, p_limit: limit });
  if (error) throw new Error(error.message ?? 'Unknown error');
  return ((data ?? []) as Row[]).map(mapSummary);
}

/** Reveals the submitted identity behind one open review. Audited server-side under the given reason. */
export async function getClaimIdentity(claimId: string, reason: string): Promise<ClaimIdentity> {
  const invalid = validateIdentityReason(reason);
  if (invalid) throw new Error(invalid);
  const { data, error } = await supabase.rpc('get_claim_identity', { p_claim_id: claimId, p_reason: reason.trim() });
  if (error) throw new Error(error.message ?? 'Unknown error');
  const row = firstRow(data);
  return {
    submittedEmail: (row?.submitted_email as string | null) ?? null,
    submittedPhone: (row?.submitted_phone as string | null) ?? null,
  };
}

/** Reveals a canonical person's identity. Audited server-side under the given reason. */
export async function getPersonIdentity(personId: string, reason: string): Promise<PersonIdentity> {
  const invalid = validateIdentityReason(reason);
  if (invalid) throw new Error(invalid);
  const { data, error } = await supabase.rpc('get_person_identity', { p_person_id: personId, p_reason: reason.trim() });
  if (error) throw new Error(error.message ?? 'Unknown error');
  const row = firstRow(data);
  return {
    fullName: (row?.full_name as string) ?? '',
    email: (row?.email as string | null) ?? null,
    phone: (row?.phone as string | null) ?? null,
  };
}

/**
 * Resolves one open review once. 'attach' needs one of the review's candidates. The server returns the final status:
 * attached, kept_separate or superseded (when the chosen candidate no longer exists).
 */
export async function resolveIdentityClaim(
  claimId: string,
  decision: IdentityResolutionDecision,
  candidateId: string | null,
  reason: string,
): Promise<string> {
  const invalid = validateIdentityReason(reason);
  if (invalid) throw new Error(invalid);
  if (decision === 'attach' && !candidateId) throw new Error('Choose one of the matching people.');
  const { data, error } = await supabase.rpc('resolve_identity_claim', {
    p_claim_id: claimId,
    p_decision: decision,
    p_candidate_id: decision === 'attach' ? candidateId : null,
    p_reason: reason.trim(),
  });
  if (error) throw new Error(error.message ?? 'Unknown error');
  return (data as string) ?? '';
}
