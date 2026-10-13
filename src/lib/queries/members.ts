import { supabase } from '../supabase';
import { sendEmail, getAppOrigin } from '../email/emailService';
import { accountApprovedTemplate } from '../email/emailTemplates';
import type { Member } from '../../types';

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

export async function fetchMembersFiltered(filters: MemberFilters = {}): Promise<Member[]> {
  let q = supabase
    .from('member_directory')
    .select('id, full_name, email, avatar_url, role, joined_at, cell_id, status')
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

export type ManagedMemberStatus = 'active' | 'inactive' | 'rejected' | 'pending';

/**
 * The status changes set_member_status allows (migration 083). Mirrors the database, which decides. Pending accounts
 * are not listed because they leave the pending state only through the approvals page.
 */
const MEMBER_STATUS_CHANGES: Partial<Record<ManagedMemberStatus, ManagedMemberStatus[]>> = {
  active: ['inactive'],
  inactive: ['active'],
  rejected: ['pending'],
};

export function allowedStatusChanges(current: string): ManagedMemberStatus[] {
  return MEMBER_STATUS_CHANGES[current as ManagedMemberStatus] ?? [];
}

/**
 * The one authorised way to change an account's status: the set_member_status RPC (migration 080). It checks the
 * caller, the reason and the target, writes one row and its audit record in one transaction. A refusal from the
 * database is thrown as-is, so the reason is shown to the user. A missing returned row is reported as not saved.
 */
export async function setMemberStatus(
  memberId: string,
  status: ManagedMemberStatus,
  reason: string,
): Promise<ManagedMemberStatus> {
  const { data, error } = await supabase.rpc('set_member_status', {
    p_member_id: memberId,
    p_status: status,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) throw new Error('The status was not saved. Check that your account is still active.');
  return row.status as ManagedMemberStatus;
}
