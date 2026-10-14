// Fixture helpers for the local end-to-end suites. They change profile state ONLY through the approved workflows, signed
// in as a coordinator. The service-role key is used for auth accounts (create and delete) and for reads, never to write a
// profile (migration 094 removes those privileges).
//
// The coordinator account is provisioned once by the owner-level bootstrap, before the suite runs. It is the only account
// the suite does not create itself. Required environment (local stack only):
//   SUPABASE_URL, SUPABASE_ANON_KEY, E2E_COORDINATOR_EMAIL, E2E_COORDINATOR_PASSWORD
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const options = { auth: { persistSession: false, autoRefreshToken: false } };

export function requireCoordinatorEnv(): { email: string; password: string } {
  const email = process.env.E2E_COORDINATOR_EMAIL;
  const password = process.env.E2E_COORDINATOR_PASSWORD;
  if (!email || !password) {
    throw new Error('E2E_COORDINATOR_EMAIL and E2E_COORDINATOR_PASSWORD are required: provision the coordinator with the owner bootstrap first');
  }
  return { email, password };
}

/** A coordinator session, signed in with the provisioned account. */
export async function coordinatorSession(url: string, anonKey: string): Promise<{ client: SupabaseClient; id: string }> {
  const { email, password } = requireCoordinatorEnv();
  const client = createClient(url, anonKey, options);
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw new Error(`coordinator sign-in failed: ${error?.message}`);
  return { client, id: data.user.id };
}

function check<T>(label: string, result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data as T;
}

/** Approves a pending applicant (approve_pending_member). Pending to active. */
export async function approveApplicant(coord: SupabaseClient, memberId: string): Promise<void> {
  check(`approve ${memberId}`, await coord.rpc('approve_pending_member', { target_member_id: memberId }));
}

/** Sets an active member's role. Role changes need an active account (migration 048). */
export async function setRole(coord: SupabaseClient, memberId: string, role: string): Promise<void> {
  const rows = check(`role ${memberId}`, await coord.from('profiles').update({ role }).eq('id', memberId).select('id'));
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error(`role ${memberId}: no row changed`);
}

/** Places an active member in a cell (transfer_member_cell). A reason is required and is audited. */
export async function placeActiveMember(coord: SupabaseClient, memberId: string, cellId: string, reason: string): Promise<void> {
  check(`place ${memberId}`, await coord.rpc('transfer_member_cell', { p_member_id: memberId, p_cell_id: cellId, p_reason: reason }));
}

/** Places a pending applicant in a cell (assign_pending_applicant_to_cell). A reason is required and is audited. */
export async function placeApplicant(coord: SupabaseClient, memberId: string, cellId: string, reason: string): Promise<void> {
  check(`place applicant ${memberId}`, await coord.rpc('assign_pending_applicant_to_cell', { p_member_id: memberId, p_cell_id: cellId, p_reason: reason }));
}

/** Links an active member to a BSC (assign_member_to_bsc). Pending accounts cannot be linked. */
export async function assignBsc(coord: SupabaseClient, memberId: string, bscId: string): Promise<void> {
  check(`bsc ${memberId}`, await coord.rpc('assign_member_to_bsc', { p_member_id: memberId, p_bsc_id: bscId }));
}

/** Changes status through the status workflow (set_member_status). A reason is required. */
export async function setStatus(coord: SupabaseClient, memberId: string, status: 'active' | 'inactive', reason: string): Promise<void> {
  check(`status ${memberId}`, await coord.rpc('set_member_status', { p_member_id: memberId, p_status: status, p_reason: reason }));
}
