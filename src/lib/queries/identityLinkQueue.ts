import { supabase } from '../supabase';
import { validateIdentityReason } from './identityReview';

// Accounts awaiting link (migration 103). One operational queue, one RPC: list_account_link_queue. The database decides
// who is listed and who is staff, and it writes the audit row for every read. These functions only shape the calls.
// The rows carry names and identifiers only. No email address or phone number comes back from the queue.

export interface AccountLinkItem {
  profileId: string;
  displayName: string;
  createdAt: string;
  /** The exact normalized-email match computed by the database, or null when no person holds this account's email. */
  personId: string | null;
  personName: string | null;
}

type Row = Record<string, unknown>;

function mapItem(row: Row): AccountLinkItem {
  return {
    profileId: row.profile_id as string,
    displayName: (row.display_name as string) ?? '',
    createdAt: row.created_at as string,
    personId: (row.person_id as string | null) ?? null,
    personName: (row.person_name as string | null) ?? null,
  };
}

/** Staff only. The reason is required and recorded by the database for every call. */
export async function listAccountLinkQueue(reason: string): Promise<AccountLinkItem[]> {
  const invalid = validateIdentityReason(reason);
  if (invalid) throw new Error(invalid);
  const { data, error } = await supabase.rpc('list_account_link_queue', { p_reason: reason.trim() });
  if (error) throw new Error(error.message ?? 'The linking queue could not be loaded.');
  return ((data ?? []) as Row[]).map(mapItem);
}

/**
 * Links a pending account to the person it matches, after staff confirmed the match. The database re-checks every rule
 * (pending only, verified email equal to the person's email, no pending email change, one account per person) and
 * writes the audit row. Failures surface the database message.
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

/** Maps the approval gate's refusal (migration 103) to the next step staff should take on the approvals page. */
export function approvalRefusalMessage(message: string): string {
  return /before approving/i.test(message)
    ? 'This account is not linked to a person yet, so it cannot be approved. Link it under Accounts awaiting link below, then approve it here.'
    : message;
}
