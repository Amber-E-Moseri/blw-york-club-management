// ─── Auth & Users ────────────────────────────────────────────────────────────

export type UserRole = 'coordinator' | 'admin' | 'cell_leader' | 'member';

export interface User {
  id: string;
  email: string;
  full_name: string;
  avatar_url?: string;
  role: UserRole;
  joined_at: string;
  cell_id?: string;
}

// ─── Events ──────────────────────────────────────────────────────────────────

export type EventCategory = 'Bible Study' | 'Worship' | 'Fellowship' | 'Outreach' | 'Prayer' | 'Other';

export type EventAudience = 'all' | 'meeting';

export interface Event {
  id: string;
  title: string;
  description: string;
  date: string;
  time: string;
  location: string;
  category: EventCategory;
  created_by: string;
  created_at: string;
  audience?: EventAudience;
  audience_meeting_id?: string | null;
  notified_at?: string | null;
  rsvp_count?: number;
  user_rsvp?: boolean;
}

// ─── Members ─────────────────────────────────────────────────────────────────

export interface Member {
  id: string;
  full_name: string;
  email: string;
  avatar_url?: string;
  role: UserRole;
  joined_at: string;
  phone?: string;
  student_number?: string;
  cell_id?: string;
  status?: 'pending' | 'active' | 'inactive' | 'rejected';
  /** Bible Study Class the member is in, when the viewer can see it. A cell change is blocked while it is set. */
  bsc_name?: string | null;
}

// ─── Announcements ───────────────────────────────────────────────────────────

export interface Announcement {
  id: string;
  title: string;
  body: string;
  author_id: string;
  author_name: string;
  created_at: string;
  is_read?: boolean;
}

// ─── Prayer Requests ─────────────────────────────────────────────────────────

export interface PrayerRequest {
  id: string;
  content: string;
  author_id: string;
  author_name: string;
  is_anonymous: boolean;
  created_at: string;
  is_active: boolean;
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

export interface DashboardStats {
  member_count: number;
  member_growth: number;
  upcoming_events: number;
  announcement_count: number;
  unread_announcements: number;
  active_prayer_requests: number;
}

// ─── Contacts (CRM) ──────────────────────────────────────────────────────────

export interface Contact {
  id: string;
  cell_id: string;
  contact_name: string;
  contact_phone?: string;
  phone_hidden: boolean;
  email?: string;
  tag: string;
  follow_up_status: string;
  follow_up_assignee?: string;
  date_contacted: string;
  notes?: string;
  is_member: boolean;
  member_id?: string;
  logged_by: string;
  idempotency_key?: string;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface ContactInput {
  cell_id: string;
  contact_name: string;
  contact_phone?: string;
  phone_hidden: boolean;
  email?: string;
  tag: string;
  follow_up_status: string;
  follow_up_assignee?: string;
  date_contacted: string;
  notes?: string;
  is_member: boolean;
  idempotency_key?: string;
}

export interface ContactFilters {
  search?: string;
  cell_id?: string;
  tag?: string;
  status?: string;
  date_from?: string;
  date_to?: string;
  archived?: boolean;
}

export interface ContactTag {
  id: string;
  tag_name: string;
  color: string;
  sort_order: number;
}

export interface ContactStatus {
  id: string;
  status_name: string;
  color: string;
  sort_order: number;
}

export interface Cell {
  id: string;
  name: string;
  leader_id?: string;
}

export interface ContactTagRelation {
  id: string;
  contact_id: string;
  tag_name: string;
  tag_color: string;
  tagged_on: string;
  tag_notes?: string;
  tagged_by: string;
  created_at: string;
}

export interface ContactFollowUp {
  id: string;
  contact_id: string;
  assigned_to: string;
  assigned_by: string;
  assigned_on: string;
  status: 'active' | 'completed' | 'reassigned';
  completed_on?: string;
  notes?: string;
  updated_at: string;
  assignee?: Pick<User, 'id' | 'email' | 'full_name'>;
}

export interface ContactAuditLogEntry {
  id: string;
  contact_id: string | null;
  action: string;
  changed_by: string;
  change_details: Record<string, unknown>;
  reason?: string;
  created_at: string;
}

export interface BulkImportRow {
  contact_name: string;
  phone: string;
  email?: string;
  cell_name: string;
  notes?: string;
  tags?: string;
  follow_up_person?: string;
}

export interface ImportResult {
  imported: number;
  failed: number;
  errors: Array<{ row: number; message: string }>;
}

export type SortDir = 'asc' | 'desc';

export interface SortState {
  column: string;
  dir: SortDir;
}

// ─── Affirmations ────────────────────────────────────────────────────────────

export interface Affirmation {
  id: string;
  title: string;
  body: string;
  scheduled_date: string;
  created_by: string;
  created_at: string;
  is_active: boolean;
  declared_by_me?: boolean;
  declaration_count?: number;
}

export interface AffirmationDeclaration {
  id: string;
  confession_id: string;
  user_id: string;
  declared_at: string;
}

// ─── Testimonies & Prophecies ─────────────────────────────────────────────────

export type TestimonyCategory = 'provision' | 'healing' | 'prayer_answered' | 'growth' | 'other';
export type TestimonyVisibility = 'draft' | 'private' | 'cell' | 'members' | 'public';
export type TestimonyEntryType = 'testimony' | 'prophecy';
export type TestimonyStatus = 'pending' | 'approved' | 'rejected' | 'archived';
export type ReactionType = 'heart' | 'fire' | 'pray';

export interface Testimony {
  id: string;
  author_id: string;
  author_name: string;
  entry_type: TestimonyEntryType;
  title: string;
  body: string;
  category: TestimonyCategory;
  visibility: TestimonyVisibility;
  status: TestimonyStatus;
  image_url?: string;
  cell_id?: string;
  archived_at?: string;
  created_at: string;
  updated_at: string;
  is_mine?: boolean;
  reaction_counts?: Record<ReactionType, number>;
  my_reactions?: ReactionType[];
  comment_count?: number;
}

export interface TestimonyInput {
  entry_type: TestimonyEntryType;
  title: string;
  body: string;
  category: TestimonyCategory;
  visibility: TestimonyVisibility;
  image_url?: string;
}

export interface TestimonyComment {
  id: string;
  testimony_id: string;
  author_id: string;
  author_name: string;
  body: string;
  created_at: string;
  is_mine?: boolean;
}

export interface TestimonyReaction {
  id: string;
  testimony_id: string;
  user_id: string;
  reaction_type: ReactionType;
}

// ─── Book of the Month ────────────────────────────────────────────────────────

export interface BookOfMonth {
  id: string;
  title: string;
  author: string;
  description?: string;
  cover_image_url?: string;
  drive_url: string;
  active_from: string;
  active_until: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export interface BookOfMonthInput {
  title: string;
  author: string;
  description?: string;
  cover_image_url?: string;
  drive_url: string;
  active_from: string;
  active_until: string;
}

// ─── Meetings ─────────────────────────────────────────────────────────────────

export type MeetingVisibility = 'public' | 'leaders' | 'cell' | 'explicit';
export type MeetingCategory = 'general' | 'bsc' | 'cell' | 'leadership';

export interface Meeting {
  id: string;
  title: string;
  description?: string;
  date: string;
  time: string;
  end_time?: string;
  location?: string;
  zoom_link?: string;
  zoom_meeting_id?: string | null;
  zoom_join_url?: string | null;
  zoom_start_url?: string | null;
  zoom_password?: string | null;
  zoom_created?: boolean;
  visibility: MeetingVisibility;
  category: MeetingCategory;
  cell_id?: string;
  allow_join_requests?: boolean;
  /** null while the meeting is a draft. Only organizers can see a draft. */
  published_at?: string | null;
  created_by: string;
  created_at: string;
  reminder_sent: boolean;
  attendance_count?: number;
  user_confirmed?: boolean;
  /** The signed-in user's own attendance state for this meeting, if they have one. */
  user_attendance_status?: MeetingAttendanceStatus | null;
}

export interface MeetingInput {
  title: string;
  description?: string;
  date: string;
  time: string;
  end_time?: string;
  location?: string;
  zoom_link?: string;
  visibility: MeetingVisibility;
  category: MeetingCategory;
  cell_id?: string;
  allow_join_requests?: boolean;
  /** Create as an unpublished draft. Not stored as a column: the query layer maps it to published_at. */
  draft?: boolean;
}

export type MeetingAttendanceStatus = 'invited' | 'confirmed' | 'attended' | 'absent' | 'excused';
export type MeetingInvitationSource = 'self' | 'member' | 'group' | 'cell' | 'all';

export interface MeetingAttendance {
  id: string;
  meeting_id: string;
  user_id: string;
  user_name: string;
  confirmed_at: string;
  attended?: boolean;
  attendance_status: MeetingAttendanceStatus;
  invited_via: MeetingInvitationSource;
  invited_by?: string | null;
}

/** Named, reusable group of members (operational table saved_groups, migration 059). */
export interface SavedGroup {
  id: string;
  name: string;
  description?: string | null;
  created_by: string;
  is_active: boolean;
  created_at: string;
  member_count?: number;
}

export interface AudiencePerson {
  id: string;
  full_name: string | null;
  email: string | null;
  cell_id: string | null;
}

// ─── Message of the Week ─────────────────────────────────────────────────────

export type MessageScope = 'org' | 'personal';
export type RecurrenceType = 'none' | 'weekly' | 'biweekly';

export interface WeeklyMessage {
  id: string;
  created_by: string;
  author_name: string;
  scope: MessageScope;
  title: string;
  body: string;
  drive_link?: string;
  week_start: string;
  week_end: string;
  is_recurring: boolean;
  recurrence_type: RecurrenceType;
  recurrence_weeks: number;
  created_at: string;
  updated_at: string;
}

export interface WeeklyMessageInput {
  scope: MessageScope;
  title: string;
  body: string;
  drive_link?: string;
  week_start: string;
  week_end: string;
  is_recurring: boolean;
  recurrence_type: RecurrenceType;
  recurrence_weeks: number;
}

// ─── Habit Tracker ───────────────────────────────────────────────────────────

export type HabitStatus = 'done' | 'skipped' | 'pending' | 'missed';

export interface HabitTemplate {
  id: string;
  name: string;
  description?: string;
  icon: string;
  target_days: number[] | null;
  created_by: string;
  is_active: boolean;
  order: number;
  created_at: string;
}

export interface HabitTemplateInput {
  name: string;
  description?: string;
  icon: string;
  target_days: number[] | null;
}

export interface HabitEntry {
  id: string;
  template_id: string;
  user_id: string;
  entry_date: string;
  status: 'done' | 'skipped';
  created_at: string;
}

export interface HabitWithStats {
  template: HabitTemplate;
  entries: Record<string, 'done' | 'skipped' | undefined>;
  streak: number;
  completion_rate_7d: number;
  today_status: HabitStatus;
}

export interface HabitMemberAnalytics {
  template_id: string;
  habit_name: string;
  icon: string;
  member_count: number;
  done_today: number;
  completion_7d_avg: number;
}

// ─── UI Helpers ──────────────────────────────────────────────────────────────

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'warning' | 'disabled';
export type BadgeVariant = 'red' | 'green' | 'gray' | 'blue' | 'primary' | 'success' | 'warning' | 'error' | 'light' | 'info';

export interface NavItem {
  label: string;
  path: string;
  icon: string;
  adminOnly?: boolean;
}

export interface MonthlyDevotional {
  id: string;
  month: number;
  year: number;
  title: string;
  book_title: string;
  author: string | null;
  total_days: number;
  total_pages: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface DevotionalDailyPage {
  id: string;
  devotional_id: string;
  day_of_month: number;
  page_range: string;
  image_url: string;
  title: string | null;
  created_at: string;
}

export interface DevotionalView {
  id: string;
  member_id: string;
  devotional_id: string;
  day_of_month: number;
  viewed_date: string;
  viewed_at: string;
  created_at: string;
}

export interface DevotionalEngagementStats {
  devotional_id: string;
  day_of_month: number;
  viewed_count: number;
  last_viewed_at: string | null;
}

export type AdminPermissionKey =
  | 'contacts.view_all'
  | 'contacts.write'
  | 'attendance.view_all'
  | 'testimonies.view_all'
  | 'testimonies.approve'
  | 'reports.generate'
  | 'settings.manage_tags'
  | 'devotionals.manage'
  | 'notifications.send'
  | 'integrations.manage';

export interface AdminRole {
  id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  permissions?: AdminPermissionKey[];
}

export interface AdminRoleAssignment {
  id: string;
  role_id: string;
  user_id: string;
  assigned_by: string;
  assigned_at: string;
  role?: AdminRole;
  user?: Pick<User, 'id' | 'email' | 'full_name' | 'role'>;
}

export interface DevotionalReportDay {
  day_of_month: number;
  viewed_count: number;
  member_count: number;
  percentage: number;
}

export interface DevotionalViewerRow {
  member_id: string;
  member_name: string;
  email: string;
  viewed_at: string | null;
  viewed: boolean;
}

export interface ContactActivityReport {
  total_contacts: number;
  contacts_by_cell: { cell_id: string | null; cell_name: string; count: number }[];
  status_breakdown: { status: string; count: number }[];
  tag_breakdown: { tag: string; count: number }[];
  logger_breakdown: { user_id: string; user_name: string; count: number }[];
  daily_counts: { date: string; count: number }[];
}

export interface DriveLinkMetadata {
  url: string;
  file_id: string | null;
  provider: 'google-drive' | 'external';
  title: string;
  resource_type: 'doc' | 'sheet' | 'pdf' | 'presentation' | 'image' | 'folder' | 'unknown';
  thumbnail_url?: string;
  embed_url?: string;
}

// ─── Email Notifications ──────────────────────────────────────────────────────

export type EmailTemplateType =
  | 'meeting_reminder_8am'
  | 'meeting_reminder_1hr'
  | 'message_notification'
  | 'habit_milestone'
  | 'devotional_reminder'
  | 'testimony_approved'
  | 'weekly_digest'
  | 'account_approved'
  | 'generic';

export type EmailStatus = 'queued' | 'sent' | 'failed' | 'bounced' | 'skipped';

/** Account-owned notification preferences. `user_id` is the authenticated account (profiles.id = auth.users.id). */
export interface EmailPreferences {
  user_id: string;
  meeting_reminders_8am: boolean;
  meeting_reminders_1hr: boolean;
  message_notifications: boolean;
  habit_milestones: boolean;
  devotional_reminders: boolean;
  testimony_approved: boolean;
  weekly_digest: boolean;
  admin_announcements: boolean;
  opt_out_all: boolean;
  created_at: string;
  updated_at: string;
}

export type EmailPreferencesInput = Omit<EmailPreferences, 'user_id' | 'created_at' | 'updated_at'>;

export interface EmailLog {
  id: string;
  member_id: string | null;
  recipient_email: string;
  subject: string;
  template_type: EmailTemplateType;
  status: EmailStatus;
  sent_at: string | null;
  failed_reason: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  created_at: string;
}

export interface ScheduledEmail {
  id: string;
  recipient_email: string;
  subject: string;
  html_content: string;
  scheduled_for: string;
  sent: boolean;
  sent_at: string | null;
}

// ─── Push Notifications ───────────────────────────────────────────────────────

export type PushNotificationType =
  | 'meeting'
  | 'message'
  | 'prophecy'
  | 'habit'
  | 'devotional'
  | 'event';

export type PushStatus = 'queued' | 'sent' | 'failed' | 'clicked' | 'dismissed';

/** A browser/device subscription owned by an account. An account may have many (one per endpoint). */
export interface PushSubscriptionRecord {
  id: string;
  user_id: string;
  endpoint: string;
  auth: string;
  p256dh: string;
  user_agent: string | null;
  is_active: boolean;
  subscribed_at: string;
  last_used: string | null;
  created_at: string;
}

/** One delivery record per recipient account. Written by the backend only. */
export interface PushNotificationLog {
  id: string;
  user_id: string;
  notification_type: PushNotificationType;
  title: string;
  body: string;
  status: PushStatus;
  sent_at: string;
  clicked_at: string | null;
  response_data: Record<string, unknown> | null;
  created_at: string;
}

export interface PushNotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: {
    url: string;
    type: PushNotificationType;
    [key: string]: unknown;
  };
  actions?: Array<{ action: string; title: string }>;
}

// ─── Zoom Integration ─────────────────────────────────────────────────────────

export interface ZoomSettings {
  id: string;
  organization_id: string | null;
  zoom_account_id: string;
  zoom_user_id: string;
  is_active: boolean;
  created_at: string;
}

export interface ZoomParticipant {
  id: string;
  name: string;
  user_email: string;
  join_time: string;
  leave_time: string;
  duration: number;
}

export interface ZoomAttendance {
  id: string;
  meeting_id: string;
  zoom_participant_id: string;
  participant_name: string;
  participant_email: string;
  member_id: string | null;
  join_time: string;
  leave_time: string;
  duration_minutes: number;
  synced_from_zoom: boolean;
  created_at: string;
}

export interface ZoomMeetingData {
  zoom_meeting_id: string | null;
  zoom_join_url: string | null;
  zoom_start_url: string | null;
  zoom_password: string | null;
  zoom_created: boolean;
}

export interface EnhancedDashboardStats extends DashboardStats {
  meetings_this_month: number;
  testimonies_this_month: number;
  contacts_this_week: number;
  cell_contacts_this_week?: number;
  cell_meeting_attendance_rate?: number;
  habit_streak_avg?: number;
  devotional_views_this_month?: number;
  contacts_last_7_days: { date: string; count: number }[];
}

export interface ActivityItem {
  id: string;
  type: 'announcement' | 'testimony' | 'meeting' | 'contact';
  title: string;
  actor?: string;
  timestamp: string;
  href?: string;
}

export interface SearchResult {
  id: string;
  type: 'contact' | 'member' | 'testimony' | 'meeting';
  title: string;
  subtitle?: string;
  href: string;
}
