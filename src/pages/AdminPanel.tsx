import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Clock, Users, CalendarDays, Megaphone, BookMarked, CheckSquare,
  BarChart2, KeyRound, ClipboardList, Video, Download, Mail, Settings,
  Heart, type LucideIcon,
} from 'lucide-react';
import { Card } from '../components/foundation/Card';
import type { AuthUser } from '../lib/auth';

interface AdminPanelProps { user: AuthUser | null; }

const ADMIN_ITEMS: { label: string; desc: string; icon: LucideIcon; path?: string }[] = [
  { label: 'Pending Approvals',    desc: 'Review and approve new member sign-up requests',             icon: Clock,         path: '/admin/pending' },
  { label: 'Manage Members',       desc: 'View, promote, or remove members',                           icon: Users,         path: '/members' },
  { label: 'Manage Events',        desc: 'Schedule or archive club events',                            icon: CalendarDays,  path: '/events' },
  { label: 'Manage Announcements', desc: 'Post or archive announcements',                              icon: Megaphone,     path: '/announcements' },
  { label: 'Daily Bread Upload',   desc: 'Convert monthly PDFs into daily images',                     icon: BookMarked,    path: '/admin/devotionals' },
  { label: 'Testimony Moderation', desc: 'Approve or reject submitted testimonies & prophecies',       icon: CheckSquare,   path: '/admin/testimonies' },
  { label: 'Devotional Reports',   desc: 'View daily devotional engagement stats',                     icon: BarChart2,     path: '/admin/reports' },
  { label: 'Role Management',      desc: 'Create custom admin roles and assign permissions',           icon: KeyRound,      path: '/admin/roles' },
  { label: 'Contact Reports',      desc: 'Evangelism and outreach activity analytics',                 icon: ClipboardList, path: '/admin/contact-reports' },
  { label: 'Zoom Integration',     desc: 'Connect Zoom to auto-create video meetings',                icon: Video,         path: '/admin/zoom' },
  { label: 'Data Export',          desc: 'Download members, contacts, and attendance backups',         icon: Download,      path: '/admin/exports' },
  { label: 'Email Log',            desc: 'View sent, failed and bounced emails',                       icon: Mail,          path: '/admin/email-log' },
  { label: 'Settings',             desc: 'Club settings and preferences',                              icon: Settings },
  { label: 'Prayer Requests',      desc: 'Moderate prayer request board',                              icon: Heart },
];

export const AdminPanel: React.FC<AdminPanelProps> = ({ user }) => {
  const navigate = useNavigate();

  if (!['admin', 'coordinator', 'cell_leader'].includes(user?.role ?? '')) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <p className="text-small text-gray-400">Access denied.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-h1 mb-6">Admin Panel</h1>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {ADMIN_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <Card
                key={item.label}
                hoverable
                className="flex flex-col gap-2"
                onClick={item.path ? () => navigate(item.path!) : undefined}
              >
                <Icon className="w-6 h-6 text-york-600" />
                <h3 className="text-h3">{item.label}</h3>
                <p className="text-small text-gray-400">{item.desc}</p>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
};
