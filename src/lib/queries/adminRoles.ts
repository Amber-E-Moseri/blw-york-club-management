import { supabase } from '../supabase';
import type { AdminPermissionKey, AdminRole, AdminRoleAssignment, Member } from '../../types';

export interface AdminRoleInput {
  name: string;
  description?: string;
  permissions: AdminPermissionKey[];
}

export async function fetchAdminRoles(): Promise<AdminRole[]> {
  const { data, error } = await supabase
    .from('admin_roles')
    .select('*, admin_role_permissions(permission_key)')
    .order('name', { ascending: true });

  if (error) throw new Error(error.message ?? 'Unknown error');

  return (data ?? []).map((role: Record<string, unknown>) => ({
    ...(role as unknown as AdminRole),
    permissions: ((role.admin_role_permissions as { permission_key: AdminPermissionKey }[] | undefined) ?? [])
      .map((p) => p.permission_key),
  }));
}

export async function createAdminRole(input: AdminRoleInput, createdBy: string): Promise<AdminRole> {
  const { data: role, error } = await supabase
    .from('admin_roles')
    .insert({
      name: input.name.trim(),
      description: input.description?.trim() || null,
      created_by: createdBy,
    })
    .select('*')
    .single();

  if (error) throw new Error(error.message ?? 'Unknown error');
  await replaceRolePermissions(role.id, input.permissions);
  return { ...role, permissions: input.permissions };
}

export async function updateAdminRole(id: string, input: AdminRoleInput): Promise<AdminRole> {
  const { data: role, error } = await supabase
    .from('admin_roles')
    .update({
      name: input.name.trim(),
      description: input.description?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('is_system', false)
    .select('*')
    .single();

  if (error) throw new Error(error.message ?? 'Unknown error');
  await replaceRolePermissions(id, input.permissions);
  return { ...role, permissions: input.permissions };
}

export async function deleteAdminRole(id: string): Promise<void> {
  const { error } = await supabase
    .from('admin_roles')
    .delete()
    .eq('id', id)
    .eq('is_system', false);

  if (error) throw new Error(error.message ?? 'Unknown error');
}

export async function replaceRolePermissions(roleId: string, permissions: AdminPermissionKey[]): Promise<void> {
  const { error: deleteError } = await supabase
    .from('admin_role_permissions')
    .delete()
    .eq('role_id', roleId);
  if (deleteError) throw deleteError;

  if (permissions.length === 0) return;

  const { error } = await supabase
    .from('admin_role_permissions')
    .insert(permissions.map((permission_key) => ({ role_id: roleId, permission_key })));

  if (error) throw new Error(error.message ?? 'Unknown error');
}

export async function fetchRoleAssignments(): Promise<AdminRoleAssignment[]> {
  const { data, error } = await supabase
    .from('admin_role_assignments')
    .select('*, role:admin_roles(*), user:profiles!user_id(id,email,full_name,role)')
    .order('assigned_at', { ascending: false });

  if (error) throw new Error(error.message ?? 'Unknown error');
  return data ?? [];
}

export async function assignAdminRole(roleId: string, userId: string, assignedBy: string): Promise<void> {
  const { error } = await supabase
    .from('admin_role_assignments')
    .upsert(
      { role_id: roleId, user_id: userId, assigned_by: assignedBy },
      { onConflict: 'role_id,user_id' },
    );

  if (error) throw new Error(error.message ?? 'Unknown error');
}

export async function removeAdminRoleAssignment(assignmentId: string, currentUserId: string): Promise<void> {
  const { data: assignment, error: readError } = await supabase
    .from('admin_role_assignments')
    .select('user_id')
    .eq('id', assignmentId)
    .single();

  if (readError) throw readError;
  if (assignment.user_id === currentUserId) {
    throw new Error('You cannot remove your own admin role assignment.');
  }

  const { error } = await supabase.from('admin_role_assignments').delete().eq('id', assignmentId);
  if (error) throw new Error(error.message ?? 'Unknown error');
}

export async function fetchAssignableUsers(): Promise<Member[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id,email,full_name,role,joined_at,avatar_url')
    .order('full_name', { ascending: true });

  if (error) throw new Error(error.message ?? 'Unknown error');
  return data ?? [];
}
