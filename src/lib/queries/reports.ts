import { supabase } from '../supabase';
import type { ContactActivityReport, DevotionalReportDay, DevotionalViewerRow } from '../../types';
import { APPROVED_STATUS } from '../membership';

interface ProfileRow {
  id: string;
  full_name: string;
  email: string;
}

interface ViewRow {
  member_id: string;
  viewed_at: string;
}

export async function fetchDevotionalViewerRows(
  devotionalId: string,
  dayOfMonth: number
): Promise<DevotionalViewerRow[]> {
  const [profilesResult, viewsResult] = await Promise.all([
    supabase.from('profiles').select('id, full_name, email').order('full_name', { ascending: true }),
    supabase
      .from('devotional_views')
      .select('member_id, viewed_at')
      .eq('devotional_id', devotionalId)
      .eq('day_of_month', dayOfMonth),
  ]);

  if (profilesResult.error) throw profilesResult.error;
  if (viewsResult.error) throw viewsResult.error;

  const profiles: ProfileRow[] = profilesResult.data ?? [];
  const views: ViewRow[] = viewsResult.data ?? [];
  const viewMap = new Map(views.map((v) => [v.member_id, v.viewed_at]));

  return profiles.map((p) => {
    const viewedAt = viewMap.get(p.id) ?? null;
    return {
      member_id: p.id,
      member_name: p.full_name,
      email: p.email,
      viewed: viewMap.has(p.id),
      viewed_at: viewedAt,
    };
  });
}

export async function fetchDevotionalMonthReport(
  devotionalId: string,
  totalDays: number
): Promise<DevotionalReportDay[]> {
  // The denominator is approved members only. Registered but unapproved accounts never read devotionals on the
  // member's behalf, so counting them understated every percentage.
  const [profilesResult, viewsResult] = await Promise.all([
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('status', APPROVED_STATUS),
    supabase
      .from('devotional_views')
      .select('member_id, day_of_month')
      .eq('devotional_id', devotionalId),
  ]);

  if (profilesResult.error) throw profilesResult.error;
  if (viewsResult.error) throw viewsResult.error;

  const totalMembers = profilesResult.count ?? 0;
  const views: { member_id: string; day_of_month: number }[] = viewsResult.data ?? [];

  const countsByDay = new Map<number, Set<string>>();
  for (const v of views) {
    if (!countsByDay.has(v.day_of_month)) countsByDay.set(v.day_of_month, new Set());
    countsByDay.get(v.day_of_month)!.add(v.member_id);
  }

  return Array.from({ length: totalDays }, (_, i) => {
    const day = i + 1;
    const viewedCount = countsByDay.get(day)?.size ?? 0;
    return {
      day_of_month: day,
      viewed_count: viewedCount,
      member_count: totalMembers,
      percentage: totalMembers > 0 ? Math.round((viewedCount / totalMembers) * 100) : 0,
    };
  });
}

export async function fetchContactActivityReport(filters?: {
  date_from?: string;
  date_to?: string;
}): Promise<ContactActivityReport> {
  let query = supabase.from('contacts').select(
    'id, cell_id, follow_up_status, tag, logged_by, date_contacted, cells!left(name)'
  );

  if (filters?.date_from) query = query.gte('date_contacted', filters.date_from);
  if (filters?.date_to) query = query.lte('date_contacted', filters.date_to);

  const { data, error } = await query.eq('archived', false);
  if (error) throw new Error(error.message ?? 'Unknown error');

  const rows = data ?? [];

  const cellMap = new Map<string | null, { cell_name: string; count: number }>();
  const statusMap = new Map<string, number>();
  const tagMap = new Map<string, number>();
  const loggerMap = new Map<string, number>();
  const dailyMap = new Map<string, number>();

  for (const row of rows) {
    const cellId = row.cell_id ?? null;
    const cellName = (row.cells as { name?: string } | null)?.name ?? 'Unassigned';
    const existing = cellMap.get(cellId);
    cellMap.set(cellId, existing ? { cell_name: cellName, count: existing.count + 1 } : { cell_name: cellName, count: 1 });

    if (row.follow_up_status) statusMap.set(row.follow_up_status, (statusMap.get(row.follow_up_status) ?? 0) + 1);
    if (row.tag) tagMap.set(row.tag, (tagMap.get(row.tag) ?? 0) + 1);
    if (row.logged_by) loggerMap.set(row.logged_by, (loggerMap.get(row.logged_by) ?? 0) + 1);
    if (row.date_contacted) dailyMap.set(row.date_contacted, (dailyMap.get(row.date_contacted) ?? 0) + 1);
  }

  const loggerIds = Array.from(loggerMap.keys());
  let loggerNames: Record<string, string> = {};
  if (loggerIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', loggerIds);
    loggerNames = Object.fromEntries((profiles ?? []).map((p) => [p.id, p.full_name]));
  }

  return {
    total_contacts: rows.length,
    contacts_by_cell: Array.from(cellMap.entries()).map(([cell_id, v]) => ({ cell_id, ...v })),
    status_breakdown: Array.from(statusMap.entries()).map(([status, count]) => ({ status, count })),
    tag_breakdown: Array.from(tagMap.entries()).map(([tag, count]) => ({ tag, count })),
    logger_breakdown: Array.from(loggerMap.entries()).map(([user_id, count]) => ({
      user_id,
      user_name: loggerNames[user_id] ?? user_id,
      count,
    })),
    daily_counts: Array.from(dailyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count })),
  };
}

export function exportDevotionalReportCsv(rows: DevotionalViewerRow[]): string {
  const header = 'Name,Email,Viewed,Time\n';
  const body = rows
    .map((r) => {
      const time = r.viewed_at
        ? new Date(r.viewed_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        : '';
      return `"${r.member_name}","${r.email}",${r.viewed ? 'Yes' : 'No'},"${time}"`;
    })
    .join('\n');
  return header + body;
}
