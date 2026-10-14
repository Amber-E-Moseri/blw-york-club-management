import { supabase } from '../supabase';
import type { SearchResult } from '../../types';
import type { AuthUser } from '../auth';

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
  role: AuthUser['role'],
  cellId?: string,
): Promise<SearchResult[]> {
  const term = query.trim();
  if (term.length < 2) return [];
  const like = `%${term}%`;
  const isAdmin = role === 'admin' || role === 'coordinator';

  let contacts = supabase
    .from('contacts')
    .select('id,contact_name,contact_phone,cell_id')
    .or(`contact_name.ilike.${like},contact_phone.ilike.${like}`)
    .eq('archived', false)
    .limit(8);

  if (role === 'cell_leader' && cellId) contacts = contacts.eq('cell_id', cellId);
  if (role === 'member') contacts = contacts.eq('logged_by', userId);

  const [contactRows, testimonyRows, memberRows, meetingRows] = await Promise.all([
    contacts,
    supabase
      .from('testimonies')
      .select('id,title,body,author_name,status,visibility')
      .or(`title.ilike.${like},body.ilike.${like}`)
      .neq('status', 'archived')
      .limit(8),
    isAdmin
      // Pending applicants are excluded: their email and student number are for the approvals page only.
      ? supabase.from('profiles').select('id,full_name,email,role').neq('status', 'pending').or(`full_name.ilike.${like},email.ilike.${like}`).limit(8)
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
      href: '/contacts',
    })),
    ...((testimonyRows.data ?? []) as any[]).map((row) => ({
      id: row.id,
      type: 'testimony' as const,
      title: row.title,
      subtitle: `By ${row.author_name}`,
      href: '/testimonies',
    })),
    ...((memberRows.data ?? []) as any[]).map((row) => ({
      id: row.id,
      type: 'member' as const,
      title: row.full_name || row.email,
      subtitle: row.role,
      href: `/profile?id=${row.id}`,
    })),
    ...((meetingRows.data ?? []) as any[]).map((row) => ({
      id: row.id,
      type: 'meeting' as const,
      title: row.title,
      subtitle: `${row.date} ${row.time}`,
      href: '/meetings',
    })),
  ];

  return results.sort((a, b) => rank(a, term) - rank(b, term)).slice(0, 20);
}
