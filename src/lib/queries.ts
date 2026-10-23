import { supabase } from './supabase';
import { ANNOUNCEMENT_PAGE_SIZE, type AnnouncementCursor } from './announcementRules';
import type { Event, EventAudience, EventCategory, Member, Announcement, PrayerRequest, DashboardStats } from '../types';

// ─── Events ──────────────────────────────────────────────────────────────────

export async function getUpcomingEvents(limit = 3): Promise<Event[]> {
  const today = new Date().toISOString().split('T')[0];
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .gte('date', today)
    .order('date', { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getAllEvents(): Promise<Event[]> {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .order('date', { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export interface EventInput {
  title: string;
  description?: string;
  date: string;
  time?: string;
  location?: string;
  category: EventCategory;
  created_by: string;
  /** 'all' notifies every active member; 'meeting' notifies the people assigned to audienceMeetingId. */
  audience?: EventAudience;
  audienceMeetingId?: string | null;
}

export async function createEvent(input: EventInput): Promise<Event> {
  const audience = input.audience ?? 'all';
  if (audience === 'meeting' && !input.audienceMeetingId) {
    throw new Error('Choose a meeting for this event audience.');
  }
  const { data, error } = await supabase
    .from('events')
    .insert({
      title: input.title,
      description: input.description ?? null,
      date: input.date,
      time: input.time || null,
      location: input.location ?? null,
      category: input.category,
      created_by: input.created_by,
      audience,
      audience_meeting_id: audience === 'meeting' ? input.audienceMeetingId : null,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export interface EventNotifyResult {
  recipients: number;
  devices: number;
  sent: number;
  failed: number;
  expired: number;
}

/** Sends the new-event push notification through the notify-event edge function. Admins and coordinators only. */
export async function notifyEventMembers(eventId: string): Promise<EventNotifyResult> {
  const { data, error } = await supabase.functions.invoke<EventNotifyResult & { error?: string }>('notify-event', {
    body: { event_id: eventId },
  });
  if (error) {
    // A non-2xx reply carries the function's own message in the response body.
    const detail = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw new Error((detail as { error?: string } | null)?.error ?? error.message);
  }
  if (!data || data.error) throw new Error(data?.error ?? 'Could not send notifications');
  return data;
}

export async function rsvpEvent(eventId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('event_rsvps')
    .upsert({ event_id: eventId, user_id: userId });
  if (error) throw new Error(error.message);
}

export async function cancelRsvp(eventId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('event_rsvps')
    .delete()
    .match({ event_id: eventId, user_id: userId });
  if (error) throw new Error(error.message);
}

// ─── Members ─────────────────────────────────────────────────────────────────

export async function getMembers(): Promise<Member[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('full_name', { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

// ─── Announcements ───────────────────────────────────────────────────────────

export interface AnnouncementPage {
  items: Announcement[];
  hasMore: boolean;
}

/**
 * One page of announcements, newest first. Ordering is (created_at, id), which is total, so a page never shifts
 * under the reader. Pass the cursor from the last shown row to get the rows after it.
 */
export async function getAnnouncementsPage(
  after?: AnnouncementCursor,
  limit = ANNOUNCEMENT_PAGE_SIZE
): Promise<AnnouncementPage> {
  let filtered = supabase.from('announcements').select('*');
  if (after) {
    filtered = filtered.or(
      `created_at.lt."${after.created_at}",and(created_at.eq."${after.created_at}",id.lt.${after.id})`
    );
  }
  const { data, error } = await filtered
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Announcement[];
  return { items: rows.slice(0, limit), hasMore: rows.length > limit };
}

/**
 * Updates the title and message of one announcement. Only those two columns are sent, so author and date are never
 * changed. RLS decides whether the row may be updated; a row the caller may not change is not returned, so an empty
 * result is reported as an error rather than a silent success.
 */
export async function updateAnnouncement(id: string, title: string, body: string): Promise<Announcement> {
  const { data, error } = await supabase
    .from('announcements')
    .update({ title, body })
    .eq('id', id)
    .select('*');
  if (error) throw new Error(error.message);
  const row = ((data ?? []) as Announcement[])[0];
  if (!row) {
    throw new Error('This announcement was not saved. It may have been removed, or your account cannot edit it.');
  }
  return row;
}

/** Deletes one announcement by id. An empty result means RLS refused it or the row is already gone. */
export async function deleteAnnouncement(id: string): Promise<void> {
  const { data, error } = await supabase.from('announcements').delete().eq('id', id).select('id');
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    throw new Error('This announcement was not deleted. It may already be removed, or your account cannot delete it.');
  }
}

/** Saves an announcement and returns its id. Nothing is pushed here; see notifyAnnouncementMembers. */
export async function createAnnouncement(
  title: string,
  body: string,
  authorId: string,
  authorName: string
): Promise<string> {
  const { data, error } = await supabase
    .from('announcements')
    .insert({ title, body, author_id: authorId, author_name: authorName })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

export interface AnnouncementNotifyResult {
  recipients: number;
  devices: number;
  sent: number;
  failed: number;
  expired: number;
}

/** Sends the push notification for a saved announcement through the notify-announcement edge function. */
export async function notifyAnnouncementMembers(announcementId: string): Promise<AnnouncementNotifyResult> {
  const { data, error } = await supabase.functions.invoke<AnnouncementNotifyResult & { error?: string }>(
    'notify-announcement',
    { body: { announcement_id: announcementId } }
  );
  if (error) {
    // A non-2xx reply carries the function's own message in the response body.
    const detail = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw new Error((detail as { error?: string } | null)?.error ?? error.message);
  }
  if (!data || data.error) throw new Error(data?.error ?? 'Could not send notifications');
  return data;
}

// ─── Prayer Requests ─────────────────────────────────────────────────────────

export async function getPrayerRequests(): Promise<PrayerRequest[]> {
  const { data, error } = await supabase
    .from('prayer_requests')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

// ─── Dashboard Stats ─────────────────────────────────────────────────────────

export async function getDashboardStats(): Promise<DashboardStats> {
  const today = new Date().toISOString().split('T')[0];
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const [members, newMembers, events, announcements, prayers] = await Promise.all([
    supabase.from('profiles').select('id', { count: 'exact', head: true }),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).gte('joined_at', monthAgo),
    supabase.from('events').select('id', { count: 'exact', head: true }).gte('date', today).lte('date', new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]),
    supabase.from('announcements').select('id', { count: 'exact', head: true }),
    supabase.from('prayer_requests').select('id', { count: 'exact', head: true }).eq('is_active', true).gte('created_at', weekAgo),
  ]);

  return {
    member_count: members.count ?? 0,
    member_growth: newMembers.count ?? 0,
    upcoming_events: events.count ?? 0,
    announcement_count: announcements.count ?? 0,
    unread_announcements: 0,
    active_prayer_requests: prayers.count ?? 0,
  };
}
