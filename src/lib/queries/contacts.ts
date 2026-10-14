import { supabase } from '../supabase';
import { fingerprintText } from '../importAttempt';
import type {
  Contact, ContactInput, ContactFilters, ContactTag, ContactStatus,
  Cell, ContactTagRelation, ContactFollowUp, ContactAuditLogEntry,
  BulkImportRow, ImportResult, ImportAttempt,
} from '../../types';

// Fields a client may write on a contact. Mirrors the column grant in migration 098. person_id, logged_by,
// idempotency_key, id and created_at are never sent, so an edit cannot reassign a contact or change its author.
const CONTACT_UPDATE_FIELDS = [
  'cell_id', 'contact_name', 'contact_phone', 'phone_hidden', 'email', 'tag', 'follow_up_status',
  'follow_up_assignee', 'date_contacted', 'notes', 'is_member', 'member_id', 'archived',
] as const;

// Rows per submit_contacts_batch call. Matches the server limit.
const IMPORT_BATCH_SIZE = 500;

/** The content of one file row, as the fingerprint of an already-written row. Edits to it are detected, never applied. */
function rowContentFingerprint(row: BulkImportRow): string {
  return fingerprintText(JSON.stringify([
    row.contact_name, row.phone ?? '', row.email ?? '', row.cell_name, row.notes ?? '', row.tags ?? '', row.follow_up_person ?? '',
  ]));
}

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
  users: Pick<import('../../types').User, 'id' | 'email' | 'full_name'>[],
  attempt: ImportAttempt,
): Promise<ImportResult> {
  if (!attempt.attemptId) throw new Error('An import attempt id is required.');
  const result: ImportResult = {
    imported: 0, alreadyCompleted: 0, editedAfterImport: 0, failed: 0, errors: [], nextAttempt: null,
  };
  const confirmed: Record<string, string> = { ...attempt.confirmed };
  const cellMap = Object.fromEntries(
    cells.map((c) => [c.name.toLowerCase(), c.id])
  );
  const userMap = new Map<string, string>();
  users.forEach((user) => {
    userMap.set(user.full_name.toLowerCase(), user.id);
    userMap.set(user.email.toLowerCase(), user.id);
  });

  // A row keeps its ORIGINAL file position (rowNumber) for the life of the attempt, so its key never moves when other rows
  // are corrected. A row this attempt has already confirmed is not sent again.
  const validRows: Array<{
    contact: Omit<Contact, 'id' | 'created_at' | 'updated_at'>;
    tagNames: string[];
    assigneeId?: string;
    rowNumber: number;
    fingerprint: string;
  }> = [];

  rows.forEach((row, i) => {
    const rowNumber = row.file_row ?? i + 1;
    const fingerprint = rowContentFingerprint(row);
    const earlier = confirmed[String(rowNumber)];
    if (earlier !== undefined) {
      result.alreadyCompleted++;
      if (earlier !== fingerprint) result.editedAfterImport++;
      return;
    }
    const cellId = cellMap[row.cell_name.toLowerCase()];
    if (!cellId) {
      result.failed++;
      result.errors.push({ row: rowNumber, message: `Cell "${row.cell_name}" not found` });
      return;
    }
    if (!row.contact_name || row.contact_name.length < 2) {
      result.failed++;
      result.errors.push({ row: rowNumber, message: 'Name too short' });
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
      rowNumber,
      fingerprint,
    });
  });

  // Keys are '<attemptId>:<original row number>'. A row that an uncertain response left unknown is sent again with the same
  // key, and the database replays it if it was in fact written. A row's tags and follow-up are written by the database in
  // the same transaction as its contact, so a replay never duplicates them.
  for (let start = 0; start < validRows.length; start += IMPORT_BATCH_SIZE) {
    const slice = validRows.slice(start, start + IMPORT_BATCH_SIZE);
    const { data, error } = await supabase.rpc('submit_contacts_batch', {
      p_rows: slice.map((r) => ({
        contact_name: r.contact.contact_name,
        cell_id: r.contact.cell_id || null,
        contact_phone: r.contact.contact_phone || null,
        email: r.contact.email || null,
        phone_hidden: false,
        tag: '',
        tag_names: r.tagNames,
        notes: r.contact.notes || null,
        follow_up_status: 'new',
        follow_up_assignee: r.assigneeId || null,
        date_contacted: r.contact.date_contacted,
        is_member: false,
        idempotency_key: `${attempt.attemptId}:${r.rowNumber}`,
      })),
    });
    if (error) {
      // An uncertain response. Nothing is assumed written: the rows stay unconfirmed and the same attempt retries them.
      for (const r of slice) {
        result.failed++;
        result.errors.push({ row: r.rowNumber, message: 'This row could not be confirmed. Retry this import to finish it.' });
      }
      continue;
    }
    const outcomes = (data ?? []) as Array<{
      row_index: number; outcome: string; contact_id: string | null; error_code: string | null;
    }>;
    const answered = new Set<number>();
    for (const out of outcomes) {
      const target = slice[out.row_index - 1];
      if (!target) continue;
      answered.add(out.row_index);
      if ((out.outcome === 'imported' || out.outcome === 'already_imported') && out.contact_id) {
        confirmed[String(target.rowNumber)] = target.fingerprint;
        if (out.outcome === 'imported') result.imported++;
        else result.alreadyCompleted++;
      } else {
        result.failed++;
        result.errors.push({
          row: target.rowNumber,
          message: IMPORT_ERROR_MESSAGES[out.error_code ?? 'internal'] ?? IMPORT_ERROR_MESSAGES.internal,
        });
      }
    }
    // A row the response did not mention is unknown, not written. It stays unconfirmed and is reported.
    slice.forEach((r, j) => {
      if (answered.has(j + 1)) return;
      result.failed++;
      result.errors.push({ row: r.rowNumber, message: 'This row could not be confirmed. Retry this import to finish it.' });
    });
  }

  // The attempt carries on until every row is confirmed. Then the next upload is a new import.
  result.nextAttempt = result.failed === 0 ? null : { attemptId: attempt.attemptId, confirmed };

  if (result.imported > 0) {
    await logContactAudit({
      contact_id: null,
      action: 'bulk_imported',
      changed_by: importedBy,
      change_details: { count: result.imported },
    });
  }

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
