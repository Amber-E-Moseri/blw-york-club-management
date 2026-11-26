import { supabase } from '../supabase';
import { sendEmail, getAppOrigin } from '../email/emailService';
import { accountApprovedTemplate } from '../email/emailTemplates';
import type { Member } from '../../types';
import { APPROVED_STATUS } from '../membership';

export interface ApprovalResult {
  approval: 'success' | 'not_pending' | 'not_found';
  email: 'sent' | 'failed' | 'skipped';
  emailError?: string;
}

/**
 * Activates a pending member account and requests an account-approved notification.
 * Email failure does NOT roll back the profile activation.
 * Idempotent: if the member is already active, no duplicate email is sent.
 */
export async function approvePendingMember(
  memberId: string,
  _actingUserId?: string,
): Promise<ApprovalResult> {
  // Fetch target; guard against already-active (idempotency)
  const { data: target, error: fetchErr } = await supabase
    .from('member_directory')
    .select('id, email, full_name, status')
    .eq('id', memberId)
    .maybeSingle();

  if (fetchErr || !target) return { approval: 'not_found', email: 'skipped' };
  if (target.status !== 'pending') return { approval: 'not_pending', email: 'skipped' };

  // Activate profile through DB-authorized RPC. This is the authority.
  const { data: approvedRows, error: updateErr } = await supabase
    .rpc('approve_pending_member', { target_member_id: memberId });

  if (updateErr) throw new Error(updateErr.message ?? 'Profile activation failed.');
  const approved = Array.isArray(approvedRows) ? approvedRows[0] : approvedRows;
  if (!approved) return { approval: 'not_pending', email: 'skipped' };

  // Request notification — failure here must not undo the activation
  const loginUrl = `${getAppOrigin()}/`;
  const { subject, html, text } = accountApprovedTemplate({
    memberId,
    memberName: target.full_name || target.email,
    loginUrl,
  });

  try {
    await sendEmail({ to: target.email, subject, html, text, memberId, templateType: 'account_approved' });
    return { approval: 'success', email: 'sent' };
  } catch (err) {
    return {
      approval: 'success',
      email: 'failed',
      emailError: err instanceof Error ? err.message : 'Unknown email error',
    };
  }
}

export interface MemberFilters {
  search?: string;
  role?: string;
  cellId?: string;
}

export async function assignMemberToCell(memberId: string, cellId: string | null): Promise<void> {
  const { error } = await supabase.from('profiles').update({ cell_id: cellId }).eq('id', memberId);
  if (error) throw new Error(error.message ?? 'Failed to assign member to cell.');
}

/**
 * Approved members only. Pending and rejected accounts are registered but not members, so they are not listed in the
 * directory, the cell rosters, the unassigned count or the weekly audience. Pending accounts are handled by the
 * approvals screen (AdminPendingApprovals). This does not change any record.
 */
export async function fetchMembersFiltered(filters: MemberFilters = {}): Promise<Member[]> {
  let q = supabase
    .from('member_directory')
    .select('id, full_name, email, avatar_url, role, joined_at, cell_id, bsc_id, bsc_name')
    .eq('status', APPROVED_STATUS)
    .order('full_name', { ascending: true });

  if (filters.search) {
    const like = `%${filters.search}%`;
    q = q.or(`full_name.ilike.${like},email.ilike.${like}`);
  }
  if (filters.role) q = q.eq('role', filters.role);
  if (filters.cellId) q = q.eq('cell_id', filters.cellId);

  const { data, error } = await q;
  if (error) throw new Error(error.message ?? 'Failed to load members.');
  return (data ?? []) as Member[];
}
