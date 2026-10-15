import { supabase } from '../supabase';
import type { AuthUser } from '../auth';
import type { ActivityItem, EnhancedDashboardStats, Meeting } from '../../types';

export interface AttentionContact {
  id: string;
  contact_name: string;
  date_contacted: string;
  follow_up_status: string;
  follow_up_assignee?: string;
}

function toDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

function monthStart(date = new Date()): string {
  return toDate(new Date(date.getFullYear(), date.getMonth(), 1));
}

function monthEnd(date = new Date()): string {
  return toDate(new Date(date.getFullYear(), date.getMonth() + 1, 0));
}

function sevenDays(): string[] {
  return Array.from({ length: 7 }, (_, index) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - index));
    return toDate(d);
  });
}

export async function getEnhancedDashboardStats(
  userId: string,
  role: AuthUser['role'],
  cellId?: string,
): Promise<EnhancedDashboardStats> {
  const today = toDate(new Date());
  const weekAgo = toDate(new Date(Date.now() - 6 * 86400000));
  const start = monthStart();
  const end = monthEnd();

  const [
    members,
    newMembers,
    meetings,
    announcements,
    prayers,
    testimonies,
    contacts,
    personalHabits,
    devotionalViews,
  ] = await Promise.all([
    supabase.from('profiles').select('id', { count: 'exact', head: true }),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).gte('joined_at', start),
    supabase.from('meetings').select('id', { count: 'exact', head: true }).gte('date', today).lte('date', end),
    supabase.from('announcements').select('id', { count: 'exact', head: true }),
    supabase.from('prayer_requests').select('id', { count: 'exact', head: true }).eq('is_active', true).gte('created_at', weekAgo),
    supabase.from('testimonies').select('id', { count: 'exact', head: true }).gte('created_at', start).lte('created_at', `${end}T23:59:59`),
    supabase.from('contacts').select('id,date_contacted,cell_id', { count: 'exact' }).gte('date_contacted', weekAgo).lte('date_contacted', today).eq('archived', false),
    supabase.from('habit_entries').select('template_id,entry_date,status').eq('user_id', userId).gte('entry_date', weekAgo).lte('entry_date', today),
    supabase.from('devotional_views').select('id', { count: 'exact', head: true }).eq('member_id', userId).gte('viewed_date', start).lte('viewed_date', end),
  ]);

  // Only throw for errors on tables we know must exist (profiles, meetings, contacts, testimonies).
  // Optional tables (announcements, habit_entries, devotional_views) may not be migrated yet —
  // those queries return null data which falls back to 0 below.
  [members.error, newMembers.error, meetings.error, testimonies.error, contacts.error].forEach((error) => {
    if (error) throw new Error(error.message);
  });

  const contactRows = contacts.data ?? [];
  const contactsByDate = new Map(sevenDays().map((date) => [date, 0]));
  contactRows.forEach((row) => {
    contactsByDate.set(row.date_contacted, (contactsByDate.get(row.date_contacted) ?? 0) + 1);
  });

  const doneHabits = (personalHabits.data ?? []).filter((entry) => entry.status === 'done').length;
  const habitStreakAvg = personalHabits.data?.length ? Math.round((doneHabits / personalHabits.data.length) * 7) : 0;

  return {
    member_count: members.count ?? 0,
    member_growth: newMembers.count ?? 0,
    upcoming_events: meetings.count ?? 0,
    announcement_count: announcements.count ?? 0,
    unread_announcements: 0,
    active_prayer_requests: prayers.count ?? 0,
    meetings_this_month: meetings.count ?? 0,
    testimonies_this_month: testimonies.count ?? 0,
    contacts_this_week: contacts.count ?? 0,
    cell_contacts_this_week: role === 'cell_leader'
      ? contactRows.filter((row) => row.cell_id === cellId).length
      : undefined,
    cell_meeting_attendance_rate: role === 'cell_leader' ? 0 : undefined,
    habit_streak_avg: habitStreakAvg,
    devotional_views_this_month: devotionalViews.count ?? 0,
    contacts_last_7_days: Array.from(contactsByDate, ([date, count]) => ({ date, count })),
  };
}

export async function getRecentActivity(
  userId: string,
  role: AuthUser['role'],
  limit = 10,
): Promise<ActivityItem[]> {
  const isAdmin = role === 'admin' || role === 'coordinator';
  const [announcements, testimonies, meetings, contacts] = await Promise.all([
    supabase.from('announcements').select('id,title,author_name,created_at').order('created_at', { ascending: false }).limit(limit),
    supabase.from('testimonies').select('id,title,author_name,created_at,status').neq('status', 'archived').order('created_at', { ascending: false }).limit(limit),
    supabase.from('meetings').select('id,title,created_at').order('created_at', { ascending: false }).limit(limit),
    isAdmin
      ? supabase.from('contacts').select('id,contact_name,created_at,logged_by').eq('archived', false).order('created_at', { ascending: false }).limit(limit)
      : supabase.from('contacts').select('id,contact_name,created_at,logged_by').eq('archived', false).eq('logged_by', userId).order('created_at', { ascending: false }).limit(limit),
  ]);

  // Silently skip missing optional tables — activity feed shows partial data gracefully
  [testimonies.error, meetings.error, contacts.error].forEach((error) => {
    if (error) throw new Error(error.message);
  });

  return [
    ...(announcements.data ?? []).map((row) => ({
      id: `announcement-${row.id}`,
      type: 'announcement' as const,
      title: row.title,
      actor: row.author_name,
      timestamp: row.created_at,
      href: '/announcements',
    })),
    ...(testimonies.data ?? []).map((row) => ({
      id: `testimony-${row.id}`,
      type: 'testimony' as const,
      title: row.title,
      actor: row.author_name,
      timestamp: row.created_at,
      href: '/testimonies',
    })),
    ...(meetings.data ?? []).map((row) => ({
      id: `meeting-${row.id}`,
      type: 'meeting' as const,
      title: row.title,
      timestamp: row.created_at,
      href: '/meetings',
    })),
    ...(contacts.data ?? []).map((row) => ({
      id: `contact-${row.id}`,
      type: 'contact' as const,
      title: row.contact_name,
      timestamp: row.created_at,
      href: '/contacts',
    })),
  ]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit);
}

export async function getContactsNeedingAttention(
  role: AuthUser['role'],
  userId: string,
  cellId?: string,
  limit = 6,
): Promise<AttentionContact[]> {
  if (role === 'member') return [];

  let query = supabase
    .from('contacts')
    .select('id, contact_name, date_contacted, follow_up_status, follow_up_assignee')
    .eq('archived', false)
    .in('follow_up_status', ['Will Follow Up', 'Following Up'])
    .order('date_contacted', { ascending: true })
    .limit(limit);

  if (role === 'cell_leader' && cellId) {
    query = query.eq('cell_id', cellId);
  }

  const { data } = await query;
  return (data ?? []) as AttentionContact[];
}

export async function getUpcomingMeetings(
  _userId: string,
  cellId?: string,
  limit = 3,
): Promise<Meeting[]> {
  const today = toDate(new Date());
  let query = supabase
    .from('meetings')
    .select('*')
    .gte('date', today)
    .order('date', { ascending: true })
    .order('time', { ascending: true })
    .limit(limit);

  if (cellId) {
    query = query.or(`visibility.in.(public,leaders),cell_id.eq.${cellId}`);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message ?? 'Unknown error');

  return (data ?? []).map((row: Record<string, any>) => ({
    ...(row as Meeting),
  }));
}
