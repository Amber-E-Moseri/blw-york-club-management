import { supabase } from './supabase';

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
  /** Cells this account leads (cells.leader_id = this account). Leadership authority comes from here, not the role label. */
  ledCellIds?: string[];
}

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

/** Shown when a sign-in is refused because the sign-up email has not been verified yet. Login links to /verify-email. */
export const VERIFY_REQUIRED_MESSAGE = 'Please verify your email address before signing in.';

// ─── Permission map ───────────────────────────────────────────────────────────

const ROLE_PERMISSIONS: Record<AuthUser['role'], string[]> = {
  coordinator: ['*'],
  admin: ['manage_members', 'manage_events', 'manage_announcements', 'view_reports', 'manage_cells'],
  cell_leader: ['manage_cell_members', 'create_events', 'post_announcements', 'view_cell_reports'],
  member: ['view_events', 'rsvp_events', 'view_announcements', 'submit_prayer_requests'],
};

const KNOWN_ROLES: readonly AuthUser['role'][] = ['coordinator', 'admin', 'cell_leader', 'member'];
const KNOWN_STATUSES: readonly AuthUser['status'][] = ['pending', 'active', 'inactive', 'rejected'];

function isKnownRole(value: unknown): value is AuthUser['role'] {
  return typeof value === 'string' && (KNOWN_ROLES as readonly string[]).includes(value);
}

function isKnownStatus(value: unknown): value is AuthUser['status'] {
  return typeof value === 'string' && (KNOWN_STATUSES as readonly string[]).includes(value);
}

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
    redirectTo: `${window.location.origin}/reset-password`,
  });
  if (error) throw new AuthError(friendlyMessage(error.message), error.message);
  console.debug('[auth] reset password email sent to', email);
}

export async function changePassword(newPassword: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new AuthError(friendlyMessage(error.message), error.message);
  console.debug('[auth] password changed');
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return buildAuthUser(data.user);
}

/**
 * Confirms the six-digit sign-up code. Supabase Auth checks it; the account is verified only when this call succeeds.
 * The code and the resulting session are never logged.
 */
export async function verifySignupOtp(email: string, token: string): Promise<void> {
  const { error } = await supabase.auth.verifyOtp({ email, token, type: 'signup' });
  if (error) throw new AuthError(friendlyMessage(error.message), error.code ?? error.message, error.status);
  console.debug('[auth] sign-up email verified');
}

/** Asks Supabase Auth to send a new sign-up code. Supabase owns the throttle and answers 429 when it applies. */
export async function resendSignupOtp(email: string): Promise<void> {
  const { error } = await supabase.auth.resend({ type: 'signup', email });
  if (error) throw new AuthError(friendlyMessage(error.message), error.code ?? error.message, error.status);
  console.debug('[auth] sign-up code re-sent');
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
 * missing or unrecognised status, is unapproved. The database applies the same rule in current_user_role() and
 * is_active_member() (migration 022), so this is a UI gate, not the authority.
 */
export function canUseApp(user: Pick<AuthUser, 'status'> | null | undefined): boolean {
  return user?.status === 'active';
}

/**
 * The role the UI should act on. Cell leadership comes from cells.leader_id (migrations 049 and 054), never from the
 * role label alone: an active member who leads at least one cell acts as a cell leader, and a 'cell_leader' label with
 * no assignment grants nothing. Admins and coordinators keep their role. The database applies the same rule.
 */
export function effectiveRole(
  user: Pick<AuthUser, 'role' | 'status' | 'ledCellIds'> | null | undefined,
): AuthUser['role'] {
  // An account that is not active acts as a plain member, including an admin or coordinator label.
  if (!user || user.status !== 'active') return 'member';
  if (user.role === 'admin' || user.role === 'coordinator') return user.role;
  if ((user.ledCellIds?.length ?? 0) > 0) return 'cell_leader';
  return 'member';
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
 * The column is NOT NULL with a CHECK on the same four statuses (migrations 016 and 028), so the status branch is
 * defence in depth for a malformed or unexpected row.
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
    'Email not confirmed': VERIFY_REQUIRED_MESSAGE,
    'User already registered': 'An account with this email already exists.',
    'Password should be at least 6 characters': 'Password must be at least 6 characters long.',
    'Rate limit exceeded': 'Too many attempts. Please wait a moment and try again.',
  };
  return map[raw] ?? raw;
}
