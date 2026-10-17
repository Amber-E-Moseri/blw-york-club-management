import {
  BarChart3, BookOpen, Calendar, CalendarDays, ClipboardCheck, ClipboardList, FileText, KeyRound,
  LayoutDashboard, Mail, MessageSquareText, Settings, Sparkles, Users, type LucideIcon,
} from 'lucide-react';
import type { AuthUser } from '../../lib/auth';

export const ROLE_LEVEL: Record<AuthUser['role'], number> = {
  member: 0, cell_leader: 1, admin: 2, coordinator: 3,
};

export interface NavItem {
  labelKey: string;
  label: string;
  path: string;
  icon: LucideIcon;
  minRole: number;
}

export interface NavGroup {
  groupKey: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    groupKey: 'Overview',
    items: [
      { labelKey: 'dashboard', label: 'Overview', path: '/', icon: LayoutDashboard, minRole: 0 },
    ],
  },
  {
    groupKey: 'People',
    items: [
      { labelKey: 'people', label: 'Members', path: '/members', icon: Users, minRole: 1 },
      { labelKey: 'cells', label: 'Cells', path: '/cells', icon: Users, minRole: 1 },
      { labelKey: 'outreach', label: 'Contacts', path: '/contacts', icon: ClipboardList, minRole: 1 },
      { labelKey: 'approvals', label: 'Approvals', path: '/admin/pending', icon: ClipboardCheck, minRole: 2 },
    ],
  },
  {
    groupKey: 'Ministry',
    items: [
      { labelKey: 'meetings', label: 'Meetings', path: '/meetings', icon: Calendar,     minRole: 0 },
      { labelKey: 'events',   label: 'Events',   path: '/events',   icon: CalendarDays, minRole: 0 },
      { labelKey: 'growth',   label: 'Growth',   path: '/growth',   icon: Sparkles,     minRole: 0 },
    ],
  },
  {
    groupKey: 'Resources',
    items: [
      { labelKey: 'devotionals', label: 'Devotionals', path: '/devotionals', icon: BookOpen, minRole: 0 },
      { labelKey: 'messages', label: 'Weekly Messages', path: '/messages', icon: MessageSquareText, minRole: 0 },
      { labelKey: 'books', label: 'Books', path: '/books', icon: FileText, minRole: 0 },
      { labelKey: 'testimonies', label: 'Testimonies', path: '/testimonies', icon: Sparkles, minRole: 0 },
    ],
  },
  {
    groupKey: 'Administration',
    items: [
      { labelKey: 'admin', label: 'Admin', path: '/admin', icon: Settings, minRole: 2 },
      { labelKey: 'reports', label: 'Reports', path: '/admin/contact-reports', icon: BarChart3, minRole: 2 },
      { labelKey: 'roles', label: 'Roles & Access', path: '/admin/roles', icon: KeyRound, minRole: 2 },
      { labelKey: 'communications', label: 'Communications', path: '/admin/email-log', icon: Mail, minRole: 2 },
    ],
  },
];

/** Nav groups with only the items the given role may see. Shared by the desktop sidebar and mobile drawer. */
export function getVisibleNavGroups(role: AuthUser['role'] | undefined): NavGroup[] {
  const level = ROLE_LEVEL[role ?? 'member'] ?? 0;
  return NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((item) => level >= item.minRole) }))
    .filter((g) => g.items.length > 0);
}
