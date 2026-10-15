import { supabase } from '../supabase';
import { validateIdentityReason } from './identityReview';

// Staff queue for existing members whose verified email matches a person record but whose account is not linked yet
// (migration 103). The database decides who is listed and who is staff; these functions only shape the calls.

export interface IdentityLinkItem {
  profileId: string;
  profileName: string;
  profileMaskedEmail: string | null;
  joinedAt: string;
  emailVerified: boolean;
  pendingEmailChange: boolean;
  candidatePersonId: string;
  candidateName: string;
  candidateMaskedEmail: string | null;
}

type Row = Record<string, unknown>;

function mapItem(row: Row): IdentityLinkItem {
  return {
    profileId: row.profile_id as string,
    profileName: (row.profile_name as string) ?? '',
    profileMaskedEmail: (row.profile_masked_email as string | null) ?? null,
    joinedAt: row.joined_at as string,
    emailVerified: row.email_verified === true,
    pendingEmailChange: row.pending_email_change === true,
    candidatePersonId: row.candidate_person_id as string,
    candidateName: (row.candidate_name as string) ?? '',
    candidateMaskedEmail: (row.candidate_masked_email as string | null) ?? null,
  };
}

export async function listIdentityLinkQueue(limit = 100): Promise<IdentityLinkItem[]> {
  const { data, error } = await supabase.rpc('list_identity_link_queue', { p_limit: limit });
  if (error) throw new Error(error.message ?? 'The linking queue could not be loaded.');
  return ((data ?? []) as Row[]).map(mapItem);
}

/**
 * Links a pending account to the person it matches. The database requires a confirmed email equal to the person's
 * email, no pending email change, and a reason; it writes the audit row. The reason is validated here only to save a
 * round trip.
 */
export async function linkPendingProfileToPerson(profileId: string, personId: string, reason: string): Promise<void> {
  const invalid = validateIdentityReason(reason);
  if (invalid) throw new Error(invalid);
  const { error } = await supabase.rpc('link_pending_profile_to_person', {
    p_profile_id: profileId,
    p_person_id: personId,
    p_reason: reason.trim(),
  });
  if (error) throw new Error(error.message ?? 'The account could not be linked.');
}

/** Maps the approval gate's refusal (migration 103) to the wording staff see on the approvals page. */
export function approvalRefusalMessage(message: string): string {
  return /before approving/i.test(message)
    ? 'This account needs identity linking first. Link it in Identity review, then approve it.'
    : message;
}
