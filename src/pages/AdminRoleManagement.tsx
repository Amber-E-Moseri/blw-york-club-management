import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '../components/foundation/Button';
import { Card } from '../components/foundation/Card';
import { Input } from '../components/foundation/Input';
import { Badge } from '../components/foundation/Badge';
import type { AdminPermissionKey, AdminRole, AdminRoleAssignment, Member } from '../types';
import type { AuthUser } from '../lib/auth';
import { ADMIN_PERMISSIONS, groupPermissions } from '../lib/permissions';
import {
  assignAdminRole,
  createAdminRole,
  deleteAdminRole,
  fetchAdminRoles,
  fetchAssignableUsers,
  fetchRoleAssignments,
  removeAdminRoleAssignment,
  updateAdminRole,
} from '../lib/queries/adminRoles';

interface Props {
  user: AuthUser | null;
}

const emptyPermissions: AdminPermissionKey[] = [];

export const AdminRoleManagement: React.FC<Props> = ({ user }) => {
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [assignments, setAssignments] = useState<AdminRoleAssignment[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedRole, setSelectedRole] = useState<AdminRole | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [permissions, setPermissions] = useState<AdminPermissionKey[]>(emptyPermissions);
  const [assignmentRoleId, setAssignmentRoleId] = useState('');
  const [assignmentUserId, setAssignmentUserId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCoordinator = user?.role === 'coordinator';
  const grouped = useMemo(() => groupPermissions(), []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [roleRows, assignmentRows, memberRows] = await Promise.all([
        fetchAdminRoles(),
        fetchRoleAssignments(),
        fetchAssignableUsers(),
      ]);
      setRoles(roleRows);
      setAssignments(assignmentRows);
      setMembers(memberRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load admin roles.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function startEdit(role: AdminRole) {
    setSelectedRole(role);
    setName(role.name);
    setDescription(role.description ?? '');
    setPermissions(role.permissions ?? []);
  }

  function resetForm() {
    setSelectedRole(null);
    setName('');
    setDescription('');
    setPermissions([]);
  }

  function togglePermission(permission: AdminPermissionKey) {
    setPermissions((current) =>
      current.includes(permission)
        ? current.filter((p) => p !== permission)
        : [...current, permission],
    );
  }

  async function handleSave() {
    if (!user || !name.trim()) {
      setError('Role name is required.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (selectedRole) {
        await updateAdminRole(selectedRole.id, { name, description, permissions });
      } else {
        await createAdminRole({ name, description, permissions }, user.id);
      }
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save admin role.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(role: AdminRole) {
    if (role.is_system) return;
    setError(null);
    try {
      await deleteAdminRole(role.id);
      if (selectedRole?.id === role.id) resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete admin role.');
    }
  }

  async function handleAssign() {
    if (!user || !assignmentRoleId || !assignmentUserId) return;
    setError(null);
    try {
      await assignAdminRole(assignmentRoleId, assignmentUserId, user.id);
      setAssignmentRoleId('');
      setAssignmentUserId('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not assign role.');
    }
  }

  async function handleRemoveAssignment(assignment: AdminRoleAssignment) {
    if (!user) return;
    setError(null);
    try {
      await removeAdminRoleAssignment(assignment.id, user.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove assignment.');
    }
  }

  if (!isCoordinator) {
    return (
      <div className="flex min-h-[360px] items-center justify-center">
        <p className="text-small text-gray-400 dark:text-slate-400">Only coordinators can manage custom admin roles.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-small font-bold uppercase text-york-600 dark:text-york-400">Admin</p>
          <h1 className="text-h1">Role Management</h1>
        </div>
        <Button variant="secondary" onClick={resetForm}>New Role</Button>
      </div>

      {error && <div className="rounded-md border border-york-200 dark:border-york-800 bg-york-50 dark:bg-york-900/30 p-4 text-small text-york-700 dark:text-york-300">{error}</div>}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[380px_1fr]">
        <Card title={selectedRole ? 'Edit Role' : 'Create Role'} hasRedBorder>
          <div className="space-y-4">
            <Input label="Role Name" value={name} onChange={setName} placeholder="Admin-PFCC" required />
            <Input label="Description" value={description} onChange={setDescription} type="textarea" rows={3} />

            <div className="space-y-4">
              {Object.entries(grouped).map(([group, items]) => (
                <div key={group}>
                  <p className="mb-2 text-small font-bold text-gray-900 dark:text-slate-100">{group}</p>
                  <div className="space-y-2">
                    {items.map((permission) => (
                      <label key={permission.key} className="flex items-center gap-3 rounded-md border border-gray-200 dark:border-slate-700 p-3">
                        <input
                          type="checkbox"
                          checked={permissions.includes(permission.key)}
                          onChange={() => togglePermission(permission.key)}
                          className="h-4 w-4 accent-york-600"
                        />
                        <span className="text-small text-gray-700 dark:text-slate-300">{permission.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <Button onClick={handleSave} loading={saving} fullWidth>
              {selectedRole ? 'Save Role' : 'Create Role'}
            </Button>
          </div>
        </Card>

        <div className="space-y-6">
          <Card title="Permission Matrix">
            {loading ? (
              <p className="text-small text-gray-400 dark:text-slate-400">Loading...</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="table-base min-w-[760px]">
                  <thead>
                    <tr>
                      <th>Role</th>
                      {ADMIN_PERMISSIONS.map((permission) => (
                        <th key={permission.key}>{permission.label}</th>
                      ))}
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roles.map((role) => (
                      <tr key={role.id}>
                        <td className="font-bold text-gray-900 dark:text-slate-100">
                          {role.name}
                          {role.is_system && <Badge variant="light" size="small" className="ml-2">System</Badge>}
                        </td>
                        {ADMIN_PERMISSIONS.map((permission) => (
                          <td key={permission.key}>
                            {role.permissions?.includes(permission.key) ? (
                              <span className="font-bold text-success">Yes</span>
                            ) : (
                              <span className="text-gray-300">No</span>
                            )}
                          </td>
                        ))}
                        <td>
                          <div className="flex gap-2">
                            <Button size="small" variant="ghost" onClick={() => startEdit(role)}>Edit</Button>
                            {!role.is_system && (
                              <Button size="small" variant="danger" onClick={() => handleDelete(role)}>Delete</Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Role Assignments" hasRedBorder>
            <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_auto]">
              <select className="input-field" value={assignmentUserId} onChange={(e) => setAssignmentUserId(e.target.value)}>
                <option value="">Select user</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>{member.full_name || member.email}</option>
                ))}
              </select>
              <select className="input-field" value={assignmentRoleId} onChange={(e) => setAssignmentRoleId(e.target.value)}>
                <option value="">Select role</option>
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>{role.name}</option>
                ))}
              </select>
              <Button onClick={handleAssign} disabled={!assignmentUserId || !assignmentRoleId}>Assign</Button>
            </div>

            <div className="space-y-2">
              {assignments.length === 0 ? (
                <p className="text-small text-gray-400 dark:text-slate-400">No custom role assignments yet.</p>
              ) : assignments.map((assignment) => (
                <div key={assignment.id} className="flex flex-col gap-2 rounded-md border border-gray-200 dark:border-slate-700 p-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-small font-bold text-gray-900 dark:text-slate-100">{assignment.user?.full_name || assignment.user?.email}</p>
                    <p className="text-tiny text-gray-400">{assignment.role?.name}</p>
                  </div>
                  <Button size="small" variant="ghost" onClick={() => handleRemoveAssignment(assignment)}>
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};
