import { useState, useEffect, useCallback, useRef } from 'react';
import type { Contact, ContactFilters, ContactTag, ContactStatus, Cell, ContactTagRelation, ContactFollowUp } from '../types';
import {
  fetchContacts, fetchContact, createContact, updateContact,
  archiveContact, deleteContact, bulkArchiveContacts, bulkDeleteContacts,
  fetchTags, fetchStatuses, fetchCells, fetchContactTags, fetchContactFollowUps,
  fetchContactAuditLog, fetchAssignableUsers, reassignFollowUp, moveContactToCell,
  bulkImportContacts,
} from '../lib/queries/contacts';
import type { BulkImportRow, ContactAuditLogEntry, ContactInput, ImportResult, User } from '../types';

export function useContacts(filters: ContactFilters = {}) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Stable serialization for useEffect dep
  const filtersKey = JSON.stringify(filters);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchContacts(JSON.parse(filtersKey));
      setContacts(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load contacts.');
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey]);

  useEffect(() => { load(); }, [load]);

  return { contacts, loading, error, refetch: load };
}

export function useContact(id: string | null) {
  const [contact, setContact] = useState<Contact | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetchContact(id)
      .then(setContact)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load.'))
      .finally(() => setLoading(false));
  }, [id]);

  return { contact, loading, error };
}

export function useContactMutations(onSuccess?: () => void) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useRef(makeIdempotencyKey());

  const run = async (fn: () => Promise<unknown>) => {
    setSaving(true);
    setError(null);
    try {
      await fn();
      onSuccess?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Operation failed.');
    } finally {
      setSaving(false);
    }
  };

  // Rethrows on failure so the caller (ContactForm) can show the error and keep the form open.
  // Swallowing it here made failed saves look successful: the dialog closed with nothing saved.
  const save = async (input: ContactInput & { logged_by: string }, id?: string) => {
    setSaving(true);
    setError(null);
    try {
      const saved = id
        ? await updateContact(id, input)
        : await createContact({ ...input, idempotency_key: input.idempotency_key ?? idempotencyKey.current });
      if (!id) idempotencyKey.current = makeIdempotencyKey();
      onSuccess?.();
      return saved;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Save failed.';
      setError(message);
      throw e;
    } finally {
      setSaving(false);
    }
  };

  const archive = (id: string) => run(() => archiveContact(id));
  const remove   = (id: string) => run(() => deleteContact(id));
  const bulkArchive = (ids: string[]) => run(() => bulkArchiveContacts(ids));
  const bulkRemove  = (ids: string[]) => run(() => bulkDeleteContacts(ids));
  const reassign = (contactId: string, assigneeId: string, assignedBy: string, notes?: string) =>
    run(() => reassignFollowUp(contactId, assigneeId, assignedBy, notes));
  const moveToCell = (
    contactId: string,
    newCellId: string,
    movedBy: string,
    reason?: string,
    newAssigneeId?: string,
  ) => run(() => moveContactToCell(contactId, newCellId, movedBy, reason, newAssigneeId));
  const bulkImport = (
    rows: BulkImportRow[],
    importedBy: string,
    cells: Cell[],
    users: Pick<User, 'id' | 'email' | 'full_name'>[] = [],
  ): Promise<ImportResult> =>
    bulkImportContacts(rows, importedBy, cells, users).then((result) => {
      onSuccess?.();
      return result;
    });

  return { save, archive, remove, bulkArchive, bulkRemove, reassign, moveToCell, bulkImport, saving, error };
}

function makeIdempotencyKey() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useTagsAndStatuses() {
  const [tags, setTags] = useState<ContactTag[]>([]);
  const [statuses, setStatuses] = useState<ContactStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    Promise.all([fetchTags(), fetchStatuses()])
      .then(([t, s]) => { setTags(t); setStatuses(s); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return { tags, statuses, loading };
}

export function useCells() {
  const [cells, setCells] = useState<Cell[]>([]);
  const [loading, setLoading] = useState(true);
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    fetchCells()
      .then(setCells)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return { cells, loading };
}

export function useContactTags(contactId: string | null) {
  const [tags, setTags] = useState<ContactTagRelation[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!contactId) return;
    setLoading(true);
    try { setTags(await fetchContactTags(contactId)); }
    catch { /* ignore */ }
    finally { setLoading(false); }
  }, [contactId]);

  useEffect(() => { load(); }, [load]);

  return { tags, loading, refetch: load };
}

export function useContactFollowUps(contactId: string | null) {
  const [followUps, setFollowUps] = useState<ContactFollowUp[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!contactId) return;
    setLoading(true);
    fetchContactFollowUps(contactId)
      .then(setFollowUps)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [contactId]);

  return { followUps, loading };
}

export function useContactAuditLog(contactId: string | null) {
  const [log, setLog] = useState<ContactAuditLogEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!contactId) return;
    setLoading(true);
    try { setLog(await fetchContactAuditLog(contactId)); }
    catch { /* audit log is admin-only; silently omit for non-admins */ }
    finally { setLoading(false); }
  }, [contactId]);

  useEffect(() => { load(); }, [load]);

  return { log, loading, refetch: load };
}

export function useAssignableUsers() {
  const [users, setUsers] = useState<Pick<User, 'id' | 'email' | 'full_name'>[]>([]);
  const [loading, setLoading] = useState(true);
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    fetchAssignableUsers()
      .then(setUsers)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return { users, loading };
}
