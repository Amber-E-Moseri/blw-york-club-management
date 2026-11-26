import { supabase } from './supabase';
import type { RecoveryLink } from './recoveryLink';
import type { ConfirmLink } from './confirmLink';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: 'coordinator' | 'admin' | 'cell_leader' | 'member';
  status: 'pending' | 'active' | 'inactive' | 'rejected';
  cellId?: string;
  adminRole?: string;
  createdAt: Date;
}

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

// ─── Permission map ───────────────────────────────────────────────────────────

const ROLE_PERMISSIONS: Record<AuthUser['role'], string[]> = {
  coordinator: ['*'],
  admin: ['manage_members', 'manage_events', 'manage_announcements', 'view_reports', 'manage_cells'],
  cell_leader: ['manage_cell_members', 'create_events', 'post_announcements', 'view_cell_reports'],
  member: ['view_events', 'rsvp_events', 'view_announcements', 'submit_prayer_requests'],
};

// ─── Auth functions ───────────────────────────────────────────────────────────

export async function signUpWithEmail(
  email: string,
  password: string,
  fullName: string,
  studentNumber?: string,
): Promise<void> {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName, student_number: studentNumber ?? null } },
  });
  if (error) throw new AuthError(friendlyMessage(error.message), error.message);
  if (!data.user) throw new AuthError('Sign-up succeeded but no user was returned.');
  console.debug('[auth] signUp:', data.user.id);
}

export async function signInWithEmail(email: string, password: string): Promise<AuthUser> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new AuthError(friendlyMessage(error.message), error.message);
  if (!data.user) throw new AuthError('Sign-in succeeded but no user was returned.');
  console.debug('[auth] signIn:', data.user.id);
  return buildAuthUser(data.user);
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw new AuthError(friendlyMessage(error.message), error.message);
  console.debug('[auth] signed out');
}

export async function resetPassword(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/hub/reset-password`,
  });
  if (error) throw new AuthError(friendlyMessage(error.message), error.message);
  console.debug('[auth] reset password email sent to', email);
}

export async function changePassword(newPassword: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new AuthError(friendlyMessage(error.message), error.message);
  console.debug('[auth] password changed');
}

export type RecoveryStatus = 'ready' | 'expired' | 'invalid' | 'missing';

/**
 * Turns a password-recovery callback into a session that changePassword can use. Returns a status only. The code,
 * token hash and tokens are never logged or returned.
 */
export async function establishRecoverySession(link: RecoveryLink): Promise<RecoveryStatus> {
  switch (link.kind) {
    case 'none':
      return 'missing';
    case 'expired':
      return 'expired';
    case 'invalid':
      return 'invalid';
    case 'pkce': {
      // When a PKCE verifier is stored, supabase-js exchanges the code itself during initialization. A second
      // exchange would fail, so an existing session counts as ready.
      const existing = await supabase.auth.getSession();
      if (!existing.error && existing.data.session) return 'ready';
      const { error } = await supabase.auth.exchangeCodeForSession(link.code);
      return error ? 'expired' : 'ready';
    }
    case 'token_hash': {
      const { error } = await supabase.auth.verifyOtp({ type: 'recovery', token_hash: link.tokenHash });
      return error ? 'expired' : 'ready';
    }
    case 'implicit': {
      // The client already consumed the fragment and stored the session before this runs.
      const { data, error } = await supabase.auth.getSession();
      return !error && data.session ? 'ready' : 'expired';
    }
  }
}

export async function resendConfirmation(email: string): Promise<void> {
  const { error } = await supabase.auth.resend({ type: 'signup', email });
  if (error) throw new AuthError(friendlyMessage(error.message), error.message);
  console.debug('[auth] confirmation resent to', email);
}

/**
 * Verifies a 6-digit OTP code sent to the user's email after sign-up.
 */
export async function verifyEmailOtp(email: string, token: string): Promise<void> {
  const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
  if (error) throw new AuthError(friendlyMessage(error.message), error.message);
  console.debug('[auth] email OTP verified');
}

export type ConfirmStatus = 'confirmed' | 'expired' | 'invalid' | 'missing';

/**
 * Turns an email-confirmation callback into a verified Supabase session. Returns a status only.
 */
export async function establishConfirmSession(link: ConfirmLink): Promise<ConfirmStatus> {
  switch (link.kind) {
    case 'none':
      return 'missing';
    case 'expired':
      return 'expired';
    case 'invalid':
      return 'invalid';
    case 'pkce': {
      const existing = await supabase.auth.getSession();
      if (!existing.error && existing.data.session) return 'confirmed';
      const { error } = await supabase.auth.exchangeCodeForSession(link.code);
      return error ? 'expired' : 'confirmed';
    }
    case 'token_hash': {
      const { error } = await supabase.auth.verifyOtp({ type: 'email', token_hash: link.tokenHash });
      return error ? 'expired' : 'confirmed';
    }
  }
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return buildAuthUser(data.user);
}

export async function verifyEmail(token: string): Promise<void> {
  const { error } = await supabase.auth.verifyOtp({ token_hash: token, type: 'email' });
  if (error) throw new AuthError(friendlyMessage(error.message), error.message);
  console.debug('[auth] email verified');
}

// ─── Role & permissions ───────────────────────────────────────────────────────

export async function getUserRole(userId: string): Promise<AuthUser['role']> {
  const { data, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single();
  if (error) throw new AuthError('Could not fetch role.', error.message);
  // An unrecognised role label grants the least privilege, never the label's nominal rights.
  return isKnownRole(data?.role) ? data.role : 'member';
}

const KNOWN_ROLES: readonly AuthUser['role'][] = ['coordinator', 'admin', 'cell_leader', 'member'];
const KNOWN_STATUSES: readonly AuthUser['status'][] = ['pending', 'active', 'inactive', 'rejected'];

function isKnownRole(value: unknown): value is AuthUser['role'] {
  return typeof value === 'string' && (KNOWN_ROLES as readonly string[]).includes(value);
}

function isKnownStatus(value: unknown): value is AuthUser['status'] {
  return typeof value === 'string' && (KNOWN_STATUSES as readonly string[]).includes(value);
}

/** Only a recognised role has permissions. Unknown labels, including prototype names such as "constructor", get none. */
export function getUserPermissions(role: AuthUser['role']): string[] {
  return isKnownRole(role) ? ROLE_PERMISSIONS[role] : [];
}

export function hasPermission(role: AuthUser['role'], permission: string): boolean {
  const perms = getUserPermissions(role);
  return perms.includes('*') || perms.includes(permission);
}

/**
 * The only approval state that may enter the Hub. It is an allowlist: a pending, rejected or inactive account, and any
 * missing or unrecognised status, is unapproved. The database applies the same rule through is_active_member()
 * (migration 022), so this is a UI gate, not the authority.
 */
export function canUseApp(user: Pick<AuthUser, 'status'> | null | undefined): boolean {
  return user?.status === 'active';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Builds a display-only user from the Auth session. It deliberately NEVER derives role, status, cell or admin role
 * from `user_metadata`: signed-in users can edit that object themselves. Authorization comes only from the
 * `profiles` table (see useAuth.loadProfile / buildProfile), and the database enforces it with RLS.
 */
function buildAuthUser(supabaseUser: { id: string; email?: string; user_metadata?: Record<string, unknown>; created_at?: string }): AuthUser {
  return {
    id: supabaseUser.id,
    email: supabaseUser.email ?? '',
    name: (supabaseUser.user_metadata?.['full_name'] as string) ?? '',
    role: 'member',
    status: 'pending',
    createdAt: new Date(supabaseUser.created_at ?? Date.now()),
  };
}

/**
 * Build an AuthUser from a Supabase `profiles` table row. Fails closed:
 *  - a missing row throws, so no profile means no access;
 *  - a missing or unrecognised status becomes 'pending', so the account stays unapproved;
 *  - an unrecognised role becomes 'member', the least-privileged role.
 */
export function buildProfile(row: Record<string, unknown> | null | undefined): AuthUser {
  if (!row || typeof row['id'] !== 'string' || row['id'] === '') {
    throw new AuthError('Profile not found.');
  }
  return {
    id: row['id'],
    email: (row['email'] as string) ?? '',
    name: (row['full_name'] as string) ?? '',
    role: isKnownRole(row['role']) ? row['role'] : 'member',
    status: isKnownStatus(row['status']) ? row['status'] : 'pending',
    cellId: row['cell_id'] as string | undefined,
    adminRole: row['admin_role'] as string | undefined,
    createdAt: new Date((row['joined_at'] as string) ?? Date.now()),
  };
}

function friendlyMessage(raw: string): string {
  const map: Record<string, string> = {
    'Invalid login credentials': 'Incorrect email or password. Please try again.',
    'Email not confirmed': 'Please confirm your email address before signing in.',
    'User already registered': 'An account with this email already exists.',
    'Password should be at least 6 characters': 'Password must be at least 6 characters long.',
    'Rate limit exceeded': 'Too many attempts. Please wait a moment and try again.',
  };
  return map[raw] ?? raw;
}
