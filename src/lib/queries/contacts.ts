import { supabase } from '../supabase';
import { resolvePersonId } from './people';
import type {
  Contact, ContactInput, ContactFilters, ContactTag, ContactStatus,
  Cell, ContactTagRelation, ContactFollowUp, ContactAuditLogEntry,
  BulkImportRow, ImportResult,
} from '../../types';

export async function fetchContacts(filters: ContactFilters = {}): Promise<Contact[]> {
  let q = supabase
    .from('contacts')
    .select('*')
    .eq('archived', filters.archived ?? false)
    .order('date_contacted', { ascending: false });

  if (filters.search)    q = q.ilike('contact_name', `%${filters.search}%`);
  if (filters.cell_id)   q = q.eq('cell_id', filters.cell_id);
  if (filters.tag)       q = q.eq('tag', filters.tag);
  if (filters.status)    q = q.eq('follow_up_status', filters.status);
  if (filters.date_from) q = q.gte('date_contacted', filters.date_from);
  if (filters.date_to)   q = q.lte('date_contacted', filters.date_to);

  const { data, error } = await q;
  if (error) throw new Error(error.message ?? 'Unknown error');
  return data ?? [];
}

export async function fetchContact(id: string): Promise<Contact | null> {
  const { data, error } = await supabase
    .from('contacts').select('*').eq('id', id).single();
  if (error) throw new Error(error.message ?? 'Unknown error');
  return data;
}

export async function fetchContactWithTags(
  id: string,
): Promise<{ contact: Contact | null; tags: ContactTagRelation[] }> {
  const [contact, tags] = await Promise.all([
    fetchContact(id),
    fetchContactTags(id),
  ]);
  return { contact, tags };
}

// cell_id is a nullable uuid column. An empty string is not a valid uuid, so an unassigned
// cell must be sent as null. logged_by and the other fields are passed through unchanged.
function withNullableCellId<T extends { cell_id?: string }>(input: T): T {
  return input.cell_id === '' ? ({ ...input, cell_id: null } as unknown as T) : input;
}

export async function createContact(
  input: ContactInput & { logged_by: string }
): Promise<Contact> {
  // contacts.person_id is NOT NULL. Resolve or create the person first, the same way Quick Add does,
  // so every Outreach contact is linked to a person record.
  const person_id = await resolvePersonId({
    fullName: input.contact_name,
    email: input.email,
    phone: input.contact_phone,
  });
  const { data, error } = await supabase
    .from('contacts').insert(withNullableCellId({ ...input, person_id })).select().single();
  if (error && input.idempotency_key && /duplicate key|unique/i.test(error.message ?? '')) {
    const { data: existing, error: existingError } = await supabase
      .from('contacts')
      .select('*')
      .eq('logged_by', input.logged_by)
      .eq('idempotency_key', input.idempotency_key)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message ?? 'Unknown error');
    if (existing) return existing;
  }
  if (error) throw new Error(error.message ?? 'Unknown error');
  return data;
}

export async function updateContact(
  id: string,
  input: Partial<ContactInput>
): Promise<Contact> {
  const { data, error } = await supabase
    .from('contacts').update(withNullableCellId(input)).eq('id', id).select().single();
  if (error) throw new Error(error.message ?? 'Unknown error');
  return data;
}

export async function archiveContact(id: string): Promise<void> {
  const { error } = await supabase
    .from('contacts').update({ archived: true }).eq('id', id);
  if (error) throw new Error(error.message ?? 'Unknown error');
}

export async function unarchiveContact(id: string): Promise<void> {
  const { error } = await supabase
    .from('contacts').update({ archived: false }).eq('id', id);
  if (error) throw new Error(error.message ?? 'Unknown error');
}

export async function deleteContact(id: string): Promise<void> {
  const { error } = await supabase.from('contacts').delete().eq('id', id);
  if (error) throw new Error(error.message ?? 'Unknown error');
}

export async function bulkArchiveContacts(ids: string[]): Promise<void> {
  const { error } = await supabase
    .from('contacts').update({ archived: true }).in('id', ids);
  if (error) throw new Error(error.message ?? 'Unknown error');
}

export async function bulkDeleteContacts(ids: string[]): Promise<void> {
  const { error } = await supabase.from('contacts').delete().in('id', ids);
  if (error) throw new Error(error.message ?? 'Unknown error');
}

export async function fetchTags(): Promise<ContactTag[]> {
  const { data, error } = await supabase
    .from('tags_settings')
    .select('*')
    .order('sort_order', { ascending: true });
  if (error) throw new Error(error.message ?? 'Unknown error');
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    tag_name: r.tag_name as string,
    color: r.color as string,
    sort_order: (r.sort_order ?? r.order ?? 0) as number,
  }));
}

export async function fetchStatuses(): Promise<ContactStatus[]> {
  const { data, error } = await supabase
    .from('status_settings')
    .select('*')
    .order('sort_order', { ascending: true });
  if (error) throw new Error(error.message ?? 'Unknown error');
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    status_name: r.status_name as string,
    color: r.color as string,
    sort_order: (r.sort_order ?? r.order ?? 0) as number,
  }));
}

// ─── Cells ────────────────────────────────────────────────────────────────────

export async function fetchCells(): Promise<Cell[]> {
  const { data, error } = await supabase
    .from('cells').select('id, name, leader_id').order('name', { ascending: true });
  if (error) throw new Error(error.message ?? 'Unknown error');
  return data ?? [];
}

// ─── contact_tags ─────────────────────────────────────────────────────────────

export async function fetchContactTags(contactId: string): Promise<ContactTagRelation[]> {
  const { data, error } = await supabase
    .from('contact_tags').select('*').eq('contact_id', contactId)
    .order('tagged_on', { ascending: false });
  if (error) throw new Error(error.message ?? 'Unknown error');
  return data ?? [];
}

export async function replaceContactTags(
  contactId: string,
  tags: Omit<ContactTagRelation, 'id' | 'contact_id' | 'created_at'>[],
): Promise<void> {
  const { error: delErr } = await supabase
    .from('contact_tags').delete().eq('contact_id', contactId);
  if (delErr) throw delErr;
  if (tags.length === 0) return;
  const rows = tags.map((t) => ({ ...t, contact_id: contactId }));
  const { error: insErr } = await supabase.from('contact_tags').insert(rows);
  if (insErr) throw insErr;
}

// ─── contact_follow_ups ───────────────────────────────────────────────────────

export async function fetchContactFollowUps(contactId: string): Promise<ContactFollowUp[]> {
  const { data, error } = await supabase
    .from('contact_follow_ups')
    .select('*, assignee:profiles!assigned_to(id, email, full_name)')
    .eq('contact_id', contactId)
    .order('assigned_on', { ascending: false });
  if (error) throw new Error(error.message ?? 'Unknown error');
  return (data ?? []) as ContactFollowUp[];
}

export async function reassignFollowUp(
  contactId: string,
  assigneeId: string,
  assignedBy: string,
  notes?: string,
): Promise<void> {
  const { error: upd } = await supabase
    .from('contact_follow_ups')
    .update({ status: 'reassigned', updated_at: new Date().toISOString() })
    .eq('contact_id', contactId)
    .eq('status', 'active');
  if (upd) throw upd;

  const { error: ins } = await supabase.from('contact_follow_ups').insert({
    contact_id: contactId,
    assigned_to: assigneeId,
    assigned_by: assignedBy,
    notes: notes ?? null,
    status: 'active',
  });
  if (ins) throw ins;

  const { error: upContact } = await supabase
    .from('contacts').update({ follow_up_assignee: assigneeId }).eq('id', contactId);
  if (upContact) throw upContact;

  await logContactAudit({
    contact_id: contactId,
    action: 'reassigned',
    changed_by: assignedBy,
    change_details: { assignee_id: assigneeId },
    reason: notes,
  });
}

export async function moveContactToCell(
  contactId: string,
  newCellId: string,
  movedBy: string,
  reason?: string,
  newAssigneeId?: string,
): Promise<void> {
  const { error } = await supabase
    .from('contacts').update({ cell_id: newCellId }).eq('id', contactId);
  if (error) throw new Error(error.message ?? 'Unknown error');

  if (newAssigneeId) {
    await reassignFollowUp(contactId, newAssigneeId, movedBy, reason);
  }

  await logContactAudit({
    contact_id: contactId,
    action: 'moved',
    changed_by: movedBy,
    change_details: { new_cell_id: newCellId, new_assignee_id: newAssigneeId ?? null },
    reason,
  });
}

// ─── Bulk import ──────────────────────────────────────────────────────────────

export async function bulkImportContacts(
  rows: BulkImportRow[],
  importedBy: string,
  cells: Cell[],
  users: Pick<import('../../types').User, 'id' | 'email' | 'full_name'>[] = [],
): Promise<ImportResult> {
  const result: ImportResult = { imported: 0, failed: 0, errors: [] };
  const cellMap = Object.fromEntries(
    cells.map((c) => [c.name.toLowerCase(), c.id])
  );
  const userMap = new Map<string, string>();
  users.forEach((user) => {
    userMap.set(user.full_name.toLowerCase(), user.id);
    userMap.set(user.email.toLowerCase(), user.id);
  });

  const validRows: Array<{
    contact: Omit<Contact, 'id' | 'created_at' | 'updated_at'>;
    tagNames: string[];
    assigneeId?: string;
    rowIndex: number;
  }> = [];

  rows.forEach((row, i) => {
    const cellId = cellMap[row.cell_name.toLowerCase()];
    if (!cellId) {
      result.failed++;
      result.errors.push({ row: i + 1, message: `Cell "${row.cell_name}" not found` });
      return;
    }
    if (!row.contact_name || row.contact_name.length < 2) {
      result.failed++;
      result.errors.push({ row: i + 1, message: 'Name too short' });
      return;
    }
    const assigneeId = row.follow_up_person
      ? userMap.get(row.follow_up_person.toLowerCase())
      : undefined;

    validRows.push({
      contact: {
        cell_id: cellId,
        contact_name: row.contact_name,
        contact_phone: row.phone || undefined,
        phone_hidden: false,
        email: row.email || undefined,
        tag: '',
        follow_up_status: 'new',
        date_contacted: new Date().toISOString().split('T')[0],
        notes: row.notes || undefined,
        is_member: false,
        logged_by: importedBy,
        archived: false,
        follow_up_assignee: assigneeId,
      },
      tagNames: row.tags ? row.tags.split(';').map((t) => t.trim()).filter(Boolean) : [],
      assigneeId,
      rowIndex: i + 1,
    });
  });

  if (validRows.length === 0) return result;

  const { data: inserted, error: insErr } = await supabase
    .from('contacts')
    .insert(validRows.map((r) => r.contact))
    .select('id');

  if (insErr) {
    result.failed += validRows.length;
    result.errors.push({ row: 0, message: insErr.message });
    return result;
  }

  result.imported = inserted?.length ?? 0;

  const tagRows = validRows.flatMap((r, idx) => {
    const contactId = inserted?.[idx]?.id;
    if (!contactId) return [];
    return r.tagNames.map((name) => ({
      contact_id: contactId,
      tag_name: name,
      tag_color: '#cccccc',
      tagged_by: importedBy,
    }));
  });

  if (tagRows.length > 0) {
    const { error: tagErr } = await supabase.from('contact_tags').insert(tagRows);
    if (tagErr) {
      result.errors.push({ row: 0, message: tagErr.message });
    }
  }

  const followUpRows = validRows.flatMap((r, idx) => {
    const contactId = inserted?.[idx]?.id;
    if (!contactId || !r.assigneeId) return [];
    return [{
      contact_id: contactId,
      assigned_to: r.assigneeId,
      assigned_by: importedBy,
      status: 'active',
      notes: 'Assigned during bulk import',
    }];
  });

  if (followUpRows.length > 0) {
    const { error: followErr } = await supabase.from('contact_follow_ups').insert(followUpRows);
    if (followErr) {
      result.errors.push({ row: 0, message: followErr.message });
    }
  }

  await logContactAudit({
    contact_id: null,
    action: 'bulk_imported',
    changed_by: importedBy,
    change_details: { count: result.imported },
  });

  return result;
}

// ─── Audit log ────────────────────────────────────────────────────────────────

export async function logContactAudit(entry: {
  contact_id: string | null;
  action: string;
  changed_by: string;
  change_details: Record<string, unknown>;
  reason?: string;
}): Promise<void> {
  await supabase.from('contact_audit_log').insert(entry);
}

export async function fetchContactAuditLog(contactId: string): Promise<ContactAuditLogEntry[]> {
  const { data, error } = await supabase
    .from('contact_audit_log').select('*').eq('contact_id', contactId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message ?? 'Unknown error');
  return data ?? [];
}

// ─── Assignable users ─────────────────────────────────────────────────────────

export async function fetchAssignableUsers(): Promise<Pick<import('../../types').User, 'id' | 'email' | 'full_name'>[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, full_name')
    .in('role', ['coordinator', 'admin', 'cell_leader', 'member'])
    .order('full_name', { ascending: true });
  if (error) throw new Error(error.message ?? 'Unknown error');
  return data ?? [];
}

/** Export filtered contacts as a CSV string. */
export async function exportContactsCSV(filters: ContactFilters = {}): Promise<string> {
  const rows = await fetchContacts(filters);
  const headers = ['Name', 'Phone', 'Tag', 'Status', 'Date Contacted', 'Is Member', 'Notes'];
  const escape = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const lines = rows.map((c) => [
    escape(c.contact_name),
    escape(c.phone_hidden ? '***-***-XXXX' : (c.contact_phone ?? '')),
    escape(c.tag),
    escape(c.follow_up_status),
    c.date_contacted,
    c.is_member ? 'Yes' : 'No',
    escape(c.notes ?? ''),
  ].join(','));
  return [headers.join(','), ...lines].join('\n');
}
