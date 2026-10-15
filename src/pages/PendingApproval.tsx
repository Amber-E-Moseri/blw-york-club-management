import React from 'react';
import { Clock, XCircle } from 'lucide-react';
import { Button } from '../components/foundation/Button';
import type { AuthUser } from '../lib/auth';

interface Props {
  user: AuthUser;
  onSignOut: () => void;
}

export const PendingApproval: React.FC<Props> = ({ user, onSignOut }) => {
  const rejected = user.status === 'rejected';
  const inactive = user.status === 'inactive';

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="BLW York" className="w-14 h-14 object-contain" />
            <div>
              <p className="text-lg font-bold text-gray-900">BLW York Hub</p>
              <p className="text-sm text-gray-400">York University</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-8 text-center space-y-5">
          <div className="flex items-center justify-center">
            {rejected || inactive
              ? <XCircle className="w-14 h-14 text-red-400" aria-hidden="true" />
              : <Clock className="w-14 h-14 text-york-400" aria-hidden="true" />}
          </div>

          <div>
            <h2 className="text-xl font-bold text-gray-900 mb-1">
              {inactive ? 'Account inactive' : rejected ? 'Access not approved' : 'Account pending approval'}
            </h2>
            <p className="text-sm text-gray-500">
              {inactive
                ? 'Your account is inactive. Please contact a coordinator if you need access restored.'
                : rejected
                ? 'Your account request was not approved. Please contact a leader if you think this is a mistake.'
                : 'A leader will review and approve your account. Check back soon.'}
            </p>
          </div>

          <div className="bg-gray-50 rounded-lg px-4 py-3 text-sm text-gray-600 text-left">
            <p className="font-semibold">{user.name || 'Your account'}</p>
            <p className="text-gray-400">{user.email}</p>
          </div>

          <Button variant="ghost" onClick={onSignOut} fullWidth>Sign Out</Button>
        </div>
      </div>
    </div>
  );
};
