import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { AuthUser } from '../../lib/auth';
import { effectiveRole, hasPermission } from '../../lib/auth';

interface ProtectedRouteProps {
  user: AuthUser | null;
  loading?: boolean;
  requiredPermission?: string;
  requiredRole?: AuthUser['role'];
  children: React.ReactNode;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  user,
  loading = false,
  requiredPermission,
  requiredRole,
  children,
}) => {
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-8 h-8 border-4 border-york-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (requiredRole) {
    const roleOrder: AuthUser['role'][] = ['member', 'cell_leader', 'admin', 'coordinator'];
    const userLevel = roleOrder.indexOf(effectiveRole(user));
    const requiredLevel = roleOrder.indexOf(requiredRole);
    if (userLevel < requiredLevel) {
      return <Navigate to="/" replace />;
    }
  }

  if (requiredPermission && !hasPermission(effectiveRole(user), requiredPermission)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};
