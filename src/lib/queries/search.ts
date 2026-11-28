import { supabase } from '../supabase';
import type { SearchResult } from '../../types';
import { NO_SCOPE, type LeadershipScope } from '../leadership';

function rank(result: SearchResult, query: string): number {
  const q = query.toLowerCase();
  const title = result.title.toLowerCase();
  if (title === q) return 0;
  if (title.startsWith(q)) return 1;
  if (title.includes(q)) return 2;
  return 3;
}

export async function globalSearch(
  query: string,
  userId: string,
  scope: LeadershipScope = NO_SCOPE,
): Promise<SearchResult[]> {
  const term = query.trim();
  if (term.length < 2) return [];
  const like = `%${term}%`;
  const isAdmin = scope.isStaff;

  let contacts = supabase
    .from('contacts')
    .select('id,contact_name,contact_phone,cell_id')
    .or(`contact_name.ilike.${like},contact_phone.ilike.${like}`)
    .eq('archived', false)
    .limit(8);

  // Staff see all contacts. A leader sees contacts in the cells they lead. Everyone else sees only what they logged.
  if (!isAdmin) {
    contacts = scope.ledCellIds.length > 0
      ? contacts.in('cell_id', scope.ledCellIds)
      : contacts.eq('logged_by', userId);
  }

  const [contactRows, testimonyRows, memberRows, meetingRows] = await Promise.all([
    contacts,
    supabase
      .from('testimonies')
      .select('id,title,body,author_name,status,visibility')
      .or(`title.ilike.${like},body.ilike.${like}`)
      .neq('status', 'archived')
      .limit(8),
    isAdmin
      ? supabase.from('profiles').select('id,full_name,email,role').or(`full_name.ilike.${like},email.ilike.${like}`).limit(8)
      : Promise.resolve({ data: [], error: null }),
    supabase.from('meetings').select('id,title,date,time,visibility,cell_id').ilike('title', like).limit(8),
  ]);

  [contactRows.error, testimonyRows.error, memberRows.error, meetingRows.error].forEach((error) => {
    if (error) throw new Error(error.message ?? 'Unknown error');
  });

  const results: SearchResult[] = [
    ...((contactRows.data ?? []) as any[]).map((row) => ({
      id: row.id,
      type: 'contact' as const,
      title: row.contact_name,
      subtitle: row.contact_phone || 'Contact',
      href: '/hub/contacts',
    })),
    ...((testimonyRows.data ?? []) as any[]).map((row) => ({
      id: row.id,
      type: 'testimony' as const,
      title: row.title,
      subtitle: `By ${row.author_name}`,
      href: '/hub/testimonies',
    })),
    ...((memberRows.data ?? []) as any[]).map((row) => ({
      id: row.id,
      type: 'member' as const,
      title: row.full_name || row.email,
      subtitle: row.role,
      href: `/hub/profile?id=${row.id}`,
    })),
    ...((meetingRows.data ?? []) as any[]).map((row) => ({
      id: row.id,
      type: 'meeting' as const,
      title: row.title,
      subtitle: `${row.date} ${row.time}`,
      href: '/hub/meetings',
    })),
  ];

  return results.sort((a, b) => rank(a, term) - rank(b, term)).slice(0, 20);
}
