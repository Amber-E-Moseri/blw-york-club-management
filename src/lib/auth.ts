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
  return data.role as AuthUser['role'];
}

export function getUserPermissions(role: AuthUser['role']): string[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function hasPermission(role: AuthUser['role'], permission: string): boolean {
  const perms = ROLE_PERMISSIONS[role] ?? [];
  return perms.includes('*') || perms.includes(permission);
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

/** Build an AuthUser from a Supabase `profiles` table row. */
export function buildProfile(row: Record<string, unknown>): AuthUser {
  return {
    id: row['id'] as string,
    email: (row['email'] as string) ?? '',
    name: (row['full_name'] as string) ?? '',
    role: (row['role'] as AuthUser['role']) ?? 'member',
    status: (row['status'] as AuthUser['status']) ?? 'active',
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
