import { supabase } from '../supabase';
import type {
  Contact, ContactInput, ContactFilters, ContactTag, ContactStatus,
  Cell, ContactTagRelation, ContactFollowUp, ContactAuditLogEntry,
  BulkImportRow, ImportResult,
} from '../../types';

// Fields a client may write on a contact. Mirrors the column grant in migration 098. person_id, logged_by,
// idempotency_key, id and created_at are never sent, so an edit cannot reassign a contact or change its author.
const CONTACT_UPDATE_FIELDS = [
  'cell_id', 'contact_name', 'contact_phone', 'phone_hidden', 'email', 'tag', 'follow_up_status',
  'follow_up_assignee', 'date_contacted', 'notes', 'is_member', 'member_id', 'archived',
] as const;

// Rows per submit_contacts_batch call. Matches the server limit.
const IMPORT_BATCH_SIZE = 500;

const IMPORT_ERROR_MESSAGES: Record<string, string> = {
  not_authorized: 'You cannot log a contact in that cell.',
  invalid: 'This row has invalid details.',
  retry: 'This row could not be saved. Try again.',
  internal: 'This row could not be saved.',
};

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

// Every contact write goes through submit_contact (migration 097). The database resolves the person, applies cell
// authorization and records logged_by = auth.uid(). The client never sends logged_by or person_id. The response carries
// only the contact id, which is then re-read under the ordinary contact read policy.
export async function createContact(
  input: ContactInput & { logged_by?: string }
): Promise<Contact> {
  const { data, error } = await supabase.rpc('submit_contact', {
    p_contact_name: input.contact_name,
    p_cell_id: input.cell_id ? input.cell_id : null,
    p_contact_phone: input.contact_phone || null,
    p_email: input.email || null,
    p_phone_hidden: input.phone_hidden ?? false,
    p_tag: input.tag || null,
    p_notes: input.notes || null,
    p_follow_up_status: input.follow_up_status || null,
    p_follow_up_assignee: input.follow_up_assignee || null,
    p_date_contacted: input.date_contacted || null,
    p_is_member: input.is_member ?? false,
    p_idempotency_key: input.idempotency_key || null,
  });
  if (error) throw new Error(error.message ?? 'Unknown error');
  const row = (Array.isArray(data) ? data[0] : data) as { contact_id?: string } | null;
  if (!row?.contact_id) throw new Error('The contact could not be saved.');
  const contact = await fetchContact(row.contact_id);
  if (!contact) throw new Error('The contact could not be saved.');
  return contact;
}

/** Keeps only the fields the database grants, and turns an unassigned cell into null. */
function contactUpdatePayload(input: Partial<ContactInput>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const field of CONTACT_UPDATE_FIELDS) {
    if (field in input) payload[field] = (input as Record<string, unknown>)[field];
  }
  if (payload.cell_id === '') payload.cell_id = null;
  return payload;
}

export async function updateContact(
  id: string,
  input: Partial<ContactInput>
): Promise<Contact> {
  const { data, error } = await supabase
    .from('contacts').update(contactUpdatePayload(input)).eq('id', id).select().single();
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

/** Active (not archived) cells. Archived cells take no members, so every picker built on this list excludes them. */
export async function fetchCells(): Promise<Cell[]> {
  const { data, error } = await supabase
    .from('cells').select('id, name, leader_id').is('archived_at', null).order('name', { ascending: true });
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

  // One submit_contacts_batch call per 500 rows. Each row carries its own idempotency key, derived from a per-import
  // id, so a repeated click for the same import cannot duplicate rows. A refused row is reported on its own line and
  // never blocks the rest of the import.
  const importId = `import-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const inserted: Array<{ id: string } | null> = validRows.map(() => null);

  for (let start = 0; start < validRows.length; start += IMPORT_BATCH_SIZE) {
    const slice = validRows.slice(start, start + IMPORT_BATCH_SIZE);
    const { data, error } = await supabase.rpc('submit_contacts_batch', {
      p_rows: slice.map((r, j) => ({
        contact_name: r.contact.contact_name,
        cell_id: r.contact.cell_id || null,
        contact_phone: r.contact.contact_phone || null,
        email: r.contact.email || null,
        phone_hidden: false,
        tag: '',
        notes: r.contact.notes || null,
        follow_up_status: 'new',
        follow_up_assignee: r.assigneeId || null,
        date_contacted: r.contact.date_contacted,
        is_member: false,
        idempotency_key: `${importId}:${start + j}`,
      })),
    });
    if (error) {
      for (const r of slice) {
        result.failed++;
        result.errors.push({ row: r.rowIndex, message: 'This row could not be saved. Try again.' });
      }
      continue;
    }
    const outcomes = (data ?? []) as Array<{
      row_index: number; outcome: string; contact_id: string | null; error_code: string | null;
    }>;
    for (const out of outcomes) {
      const target = slice[out.row_index - 1];
      if (!target) continue;
      if (out.outcome === 'logged' && out.contact_id) {
        inserted[start + out.row_index - 1] = { id: out.contact_id };
      } else {
        result.failed++;
        result.errors.push({
          row: target.rowIndex,
          message: IMPORT_ERROR_MESSAGES[out.error_code ?? 'internal'] ?? IMPORT_ERROR_MESSAGES.internal,
        });
      }
    }
  }

  result.imported = inserted.filter((row) => row !== null).length;

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
