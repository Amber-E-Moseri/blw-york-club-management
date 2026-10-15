import React from 'react';
import type { UserRole } from '../../types';

const ROLE_META: Record<UserRole, { label: string; classes: string }> = {
  coordinator: {
    label: 'Coordinator',
    classes: 'bg-york-50 text-york-700 dark:bg-york-900/30 dark:text-york-300',
  },
  admin: {
    label: 'Admin',
    classes: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  },
  cell_leader: {
    label: 'Cell Leader',
    classes: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  },
  member: {
    label: 'Member',
    classes: 'bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-slate-400',
  },
};

interface PersonStatusBadgeProps {
  role: UserRole;
  size?: 'sm' | 'xs';
}

export const PersonStatusBadge: React.FC<PersonStatusBadgeProps> = ({ role, size = 'sm' }) => {
  const { label, classes } = ROLE_META[role] ?? ROLE_META.member;
  const sizeClass = size === 'xs' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-0.5';
  return (
    <span className={`inline-flex items-center font-semibold rounded-full ${sizeClass} ${classes}`}>
      {label}
    </span>
  );
};

export function roleLabel(role: UserRole): string {
  return ROLE_META[role]?.label ?? role;
}
