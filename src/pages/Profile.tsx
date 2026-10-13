import React from 'react';
import { Card } from '../components/foundation/Card';
import { Badge } from '../components/foundation/Badge';
import { getInitials } from '../lib/utils';
import { effectiveRole, type AuthUser } from '../lib/auth';

interface ProfileProps { user: AuthUser | null; }

export const Profile: React.FC<ProfileProps> = ({ user }) => {
  if (!user) return null;

  const role = effectiveRole(user);
  const badgeVariant =
    role === 'coordinator' ? 'primary' :
    role === 'admin' ? 'info' :
    role === 'cell_leader' ? 'success' : 'gray';

  const roleLabel =
    role === 'coordinator' ? 'Coordinator' :
    role === 'admin' ? 'Admin' :
    role === 'cell_leader' ? 'Cell Leader' : 'Member';

  return (
    <div className="flex-1 overflow-y-auto p-0 md:p-4">
      <div className="max-w-lg mx-auto">
        <h1 className="text-h1 mb-6">Profile</h1>
        <Card>
          <div className="flex items-center gap-5 mb-6">
            <div className="w-16 h-16 rounded-full bg-york-600 text-white flex items-center justify-center text-h2 font-bold">
              {getInitials(user.name)}
            </div>
            <div>
              <h2 className="text-h2">{user.name}</h2>
              <Badge variant={badgeVariant} className="mt-1">{roleLabel}</Badge>
            </div>
          </div>
          <dl className="space-y-3 text-small">
            <div className="flex gap-2">
              <dt className="font-semibold text-gray-400 dark:text-slate-400 w-28 shrink-0">Email</dt>
              <dd className="text-gray-900 dark:text-slate-100">{user.email}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-semibold text-gray-400 dark:text-slate-400 w-28 shrink-0">Member since</dt>
              <dd className="text-gray-900 dark:text-slate-100">
                {user.createdAt.toLocaleDateString('en-CA', { year: 'numeric', month: 'long' })}
              </dd>
            </div>
            {user.cellId && (
              <div className="flex gap-2">
                <dt className="font-semibold text-gray-400 dark:text-slate-400 w-28 shrink-0">Cell</dt>
                <dd className="text-gray-900 dark:text-slate-100">{user.cellId}</dd>
              </div>
            )}
          </dl>
        </Card>
      </div>
    </div>
  );
};
