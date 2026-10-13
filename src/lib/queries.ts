import { supabase } from './supabase';
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
  /** A targeted audience (migration 072). Recipients are frozen when the event is saved. */
  audienceSpecId?: string | null;
}

export async function createEvent(input: EventInput): Promise<Event> {
  const audience = input.audience ?? 'all';
  if (audience === 'meeting' && !input.audienceMeetingId) {
    throw new Error('Choose a meeting for this event audience.');
  }
  // Every audience other than 'all' and 'meeting' needs a spec. The database refuses it otherwise.
  if (audience !== 'all' && audience !== 'meeting' && !input.audienceSpecId) {
    throw new Error('Choose who this event is for.');
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
      audience_spec_id: input.audienceSpecId ?? null,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export interface EventNotifyResult {
  /** Active members the audience resolved to. */
  recipients: number;
  /** Members with at least one device that accepted the push. */
  members_sent: number;
  /** Members whose every device failed. */
  members_failed: number;
  /** Push subscriptions attempted (one member can have several devices). */
  devices: number;
  sent: number;
  failed: number;
  expired: number;
  /** False if the delivery log could not be written after the pushes went out. */
  log_saved: boolean;
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

export async function getAnnouncements(limit = 5): Promise<Announcement[]> {
  const { data, error } = await supabase
    .from('announcements')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * audienceSpecId null is a fellowship-wide broadcast, which only staff may post (migration 068).
 * A cell leader must pass the spec of a single cell they lead (migrations 068 and 072).
 */
export async function createAnnouncement(
  title: string,
  body: string,
  authorId: string,
  authorName: string,
  audienceSpecId: string | null = null
): Promise<void> {
  const { error } = await supabase
    .from('announcements')
    .insert({ title, body, author_id: authorId, author_name: authorName, audience_spec_id: audienceSpecId });
  if (error) throw new Error(error.message);
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
