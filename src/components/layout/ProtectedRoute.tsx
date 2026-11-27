import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { AuthUser } from '../../lib/auth';
import { hasPermission } from '../../lib/auth';
import { useLeadership } from '../../hooks/useLeadership';

interface ProtectedRouteProps {
  user: AuthUser | null;
  loading?: boolean;
  requiredPermission?: string;
  /**
   * Staff roles only. `cell_leader` is deliberately excluded: a leader is recognised by a cell assignment
   * (`requiresLeadership`), never by the profile role.
   */
  requiredRole?: Exclude<AuthUser['role'], 'cell_leader'>;
  /** Admin, coordinator, or an active assigned cell leader. The role alone never satisfies this. */
  requiresLeadership?: boolean;
  children: React.ReactNode;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  user,
  loading = false,
  requiredPermission,
  requiredRole,
  requiresLeadership = false,
  children,
}) => {
  const location = useLocation();
  const leadership = useLeadership();

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-8 h-8 border-4 border-york-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/hub/login" state={{ from: location }} replace />;
  }

  if (requiredRole) {
    const roleOrder: AuthUser['role'][] = ['member', 'cell_leader', 'admin', 'coordinator'];
    const userLevel = roleOrder.indexOf(user.role);
    const requiredLevel = roleOrder.indexOf(requiredRole);
    if (userLevel < requiredLevel) {
      return <Navigate to="/hub" replace />;
    }
  }

  if (requiredPermission && !hasPermission(user.role, requiredPermission)) {
    return <Navigate to="/hub" replace />;
  }

  if (requiresLeadership) {
    if (leadership.loading) {
      return (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="w-8 h-8 border-4 border-york-600 border-t-transparent rounded-full animate-spin" />
        </div>
      );
    }
    if (leadership.error) {
      return (
        <div className="flex-1 p-8 flex flex-col items-center justify-center gap-3">
          <p className="text-sm text-red-700" role="alert">{leadership.error}</p>
          <button type="button" className="text-sm text-york-600 underline" onClick={leadership.refresh}>
            Try again
          </button>
        </div>
      );
    }
    if (!leadership.canUseLeaderPages) {
      return <Navigate to="/hub" replace />;
    }
  }

  return <>{children}</>;
};
