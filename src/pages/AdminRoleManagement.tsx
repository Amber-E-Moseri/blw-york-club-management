import React, { useEffect, useState } from 'react';
import { ChevronRight, Plus, Shield, Users } from 'lucide-react';
import { Button } from '../components/foundation/Button';
import { Input } from '../components/foundation/Input';
import type { AdminPermissionKey, AdminRole, AdminRoleAssignment, Member, UserRole } from '../types';
import type { AuthUser } from '../lib/auth';
import { ADMIN_PERMISSIONS } from '../lib/permissions';
import { cn } from '../lib/utils';
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

/** Built-in profile roles. Their membership comes from profiles.role and is not editable here. */
const BUILT_IN_ROLES: { key: UserRole; label: string }[] = [
  { key: 'coordinator', label: 'Coordinator' },
  { key: 'admin', label: 'Admin' },
  { key: 'cell_leader', label: 'Cell leader' },
  { key: 'member', label: 'Member' },
];

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

interface ToggleProps {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: () => void;
}

const Toggle: React.FC<ToggleProps> = ({ checked, disabled = false, label, onChange }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={onChange}
    className={cn(
      'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
      checked ? 'bg-york-600' : 'bg-gray-300 dark:bg-slate-600',
      disabled && 'cursor-not-allowed opacity-50',
    )}
  >
    <span
      className={cn(
        'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
        checked ? 'translate-x-5' : 'translate-x-0.5',
      )}
    />
  </button>
);

export const AdminRoleManagement: React.FC<Props> = ({ user }) => {
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [assignments, setAssignments] = useState<AdminRoleAssignment[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedRole, setSelectedRole] = useState<AdminRole | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [permissions, setPermissions] = useState<AdminPermissionKey[]>(emptyPermissions);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignmentRoleId, setAssignmentRoleId] = useState('');
  const [assignmentUserId, setAssignmentUserId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCoordinator = user?.role === 'coordinator';
  const isSystemSelected = !!selectedRole?.is_system;

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
    setCreating(false);
    setAssignOpen(false);
    setAssignmentRoleId(role.id);
    setName(role.name);
    setDescription(role.description ?? '');
    setPermissions(role.permissions ?? []);
  }

  function resetForm() {
    setSelectedRole(null);
    setCreating(false);
    setAssignOpen(false);
    setName('');
    setDescription('');
    setPermissions([]);
  }

  function startCreate() {
    resetForm();
    setCreating(true);
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
        <p className="text-sm text-gray-400">Only coordinators can manage custom admin roles.</p>
      </div>
    );
  }

  const selectedAssignments = selectedRole
    ? assignments.filter((a) => a.role_id === selectedRole.id)
    : [];
  const builtInCount = (key: UserRole) => members.filter((m) => m.role === key).length;
  const assignmentCount = (roleId: string) => assignments.filter((a) => a.role_id === roleId).length;
  const showPanel = !!selectedRole || creating;

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-4">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-york-600">Administration</p>
          <h1 className="mt-1 text-2xl font-bold text-gray-900 dark:text-slate-100">Roles &amp; access</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">Control what each role can see and change.</p>
        </div>
        <Button variant="primary" onClick={startCreate} className="w-fit" icon={<Plus className="w-4 h-4" />}>
          New role
        </Button>
      </div>

      {error && (
        <div className="rounded-xl border border-york-200 bg-york-50 p-4 text-sm text-york-700 dark:border-york-800 dark:bg-york-900/20 dark:text-york-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
        {/* Role list */}
        <div className="self-start overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
          {loading ? (
            <p className="px-4 py-6 text-sm text-gray-400">Loading…</p>
          ) : (
            <>
              <ul className="divide-y divide-gray-100 dark:divide-slate-700">
                {BUILT_IN_ROLES.map((role) => (
                  <li key={role.key} className="flex items-center gap-3 px-4 py-3.5">
                    <RoleIcon />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-gray-900 dark:text-slate-100">{role.label}</p>
                      <p className="text-xs text-gray-500 dark:text-slate-400">
                        {builtInCount(role.key)} {plural(builtInCount(role.key), 'person', 'people')}
                      </p>
                    </div>
                  </li>
                ))}
                {roles.map((role) => {
                  const active = selectedRole?.id === role.id;
                  const count = assignmentCount(role.id);
                  return (
                    <li key={role.id}>
                      <button
                        type="button"
                        onClick={() => startEdit(role)}
                        aria-current={active ? 'true' : undefined}
                        className={cn(
                          'flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors',
                          active ? 'bg-red-50 dark:bg-york-900/30' : 'hover:bg-gray-50 dark:hover:bg-slate-700/40',
                        )}
                      >
                        <RoleIcon active={active} />
                        <div className="min-w-0 flex-1">
                          <p className={cn('truncate text-sm font-semibold', active ? 'text-york-600 dark:text-york-300' : 'text-gray-900 dark:text-slate-100')}>
                            {role.name}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-slate-400">
                            {count} {plural(count, 'person', 'people')}
                            {role.is_system && ' · System'}
                          </p>
                        </div>
                        <ChevronRight className="h-4 w-4 shrink-0 text-gray-300 dark:text-slate-600" aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="border-t border-gray-100 px-4 py-3 text-xs text-gray-400 dark:border-slate-700 dark:text-slate-500">
                Built-in roles are fixed. Custom roles can be edited.
              </p>
            </>
          )}
        </div>

        {/* Detail panel */}
        {showPanel ? (
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-4 dark:border-slate-700">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-gray-900 dark:text-slate-100">
                  {selectedRole ? selectedRole.name : 'New role'}
                </p>
                <p className="text-xs text-gray-500 dark:text-slate-400">
                  {selectedRole
                    ? `${selectedAssignments.length} ${plural(selectedAssignments.length, 'person', 'people')} hold this role`
                    : 'Not saved yet'}
                </p>
              </div>
              {selectedRole && (
                <button
                  type="button"
                  onClick={() => setAssignOpen((open) => !open)}
                  className="flex h-9 shrink-0 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  <Users className="h-4 w-4" aria-hidden="true" />
                  Assign people
                </button>
              )}
            </div>

            {/* Assign people */}
            {selectedRole && assignOpen && (
              <div className="space-y-4 border-b border-gray-100 px-5 py-4 dark:border-slate-700">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <select
                    className="input-field flex-1"
                    value={assignmentUserId}
                    onChange={(e) => setAssignmentUserId(e.target.value)}
                    aria-label="Person to assign"
                  >
                    <option value="">Select person</option>
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>{member.full_name || member.email}</option>
                    ))}
                  </select>
                  <Button onClick={handleAssign} disabled={!assignmentUserId || !assignmentRoleId}>Assign</Button>
                </div>
                {selectedAssignments.length === 0 ? (
                  <p className="text-xs text-gray-400 dark:text-slate-500">No one has this role yet.</p>
                ) : (
                  <ul className="divide-y divide-gray-100 dark:divide-slate-700">
                    {selectedAssignments.map((assignment) => (
                      <li key={assignment.id} className="flex items-center justify-between gap-3 py-2.5">
                        <p className="min-w-0 truncate text-sm text-gray-900 dark:text-slate-100">
                          {assignment.user?.full_name || assignment.user?.email}
                        </p>
                        <button
                          type="button"
                          onClick={() => handleRemoveAssignment(assignment)}
                          className="text-xs font-semibold text-york-600 hover:text-york-700 dark:text-york-300"
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Name and description */}
            <div className="space-y-3 border-b border-gray-100 px-5 py-4 dark:border-slate-700">
              <Input
                label="Role name"
                value={name}
                onChange={setName}
                placeholder="e.g. Outreach team"
                required
                disabled={isSystemSelected}
              />
              <Input
                label="Description"
                value={description}
                onChange={setDescription}
                type="textarea"
                rows={2}
                disabled={isSystemSelected}
              />
            </div>

            {/* Permissions */}
            <ul className="divide-y divide-gray-100 dark:divide-slate-700">
              {ADMIN_PERMISSIONS.map((permission) => (
                <li key={permission.key} className="flex items-center justify-between gap-4 px-5 py-3.5">
                  <span className="text-sm text-gray-700 dark:text-slate-300">{permission.label}</span>
                  <Toggle
                    checked={permissions.includes(permission.key)}
                    disabled={isSystemSelected}
                    label={permission.label}
                    onChange={() => togglePermission(permission.key)}
                  />
                </li>
              ))}
            </ul>

            {isSystemSelected && (
              <p className="border-t border-gray-100 px-5 py-3 text-xs text-gray-400 dark:border-slate-700 dark:text-slate-500">
                System roles can’t be edited.
              </p>
            )}

            {/* Footer */}
            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-gray-100 px-5 py-4 dark:border-slate-700">
              {selectedRole && !selectedRole.is_system && (
                <button
                  type="button"
                  onClick={() => handleDelete(selectedRole)}
                  className="mr-auto text-xs font-semibold text-york-600 hover:text-york-700 dark:text-york-300"
                >
                  Delete role
                </button>
              )}
              <button
                type="button"
                onClick={() => (selectedRole ? startEdit(selectedRole) : resetForm())}
                className="h-10 rounded-xl border border-gray-200 bg-white px-5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                Discard
              </button>
              <Button onClick={handleSave} loading={saving} disabled={isSystemSelected}>
                {selectedRole ? 'Save changes' : 'Create role'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex min-h-[240px] items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-800">
            <p className="text-sm text-gray-500 dark:text-slate-400">Select a role to see its permissions, or create a new one.</p>
          </div>
        )}
      </div>
    </div>
  );
};

const RoleIcon: React.FC<{ active?: boolean }> = ({ active = false }) => (
  <span
    className={cn(
      'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
      active ? 'bg-york-600 text-white' : 'bg-york-50 text-york-600 dark:bg-york-900/30 dark:text-york-300',
    )}
  >
    <Shield className="h-4 w-4" aria-hidden="true" />
  </span>
);
