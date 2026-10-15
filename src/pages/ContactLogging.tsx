import React, { useCallback, useState } from 'react';
import { Download, Plus, Upload } from 'lucide-react';
import { Button } from '../components/foundation/Button';
import { BulkImportModal } from '../components/feature/BulkImportModal';
import { ContactCard } from '../components/feature/ContactCard';
import { ContactFilters } from '../components/feature/ContactFilters';
import { ContactForm } from '../components/feature/ContactForm';
import { ContactTable } from '../components/feature/ContactTable';
import { MoveToCellModal } from '../components/feature/MoveToCellModal';
import { ReassignContactModal } from '../components/feature/ReassignContactModal';
import {
  useAssignableUsers,
  useCells,
  useContactAuditLog,
  useContactFollowUps,
  useContactMutations,
  useContacts,
  useContactTags,
  useTagsAndStatuses,
} from '../hooks/useContacts';
import { exportContactsCSV } from '../lib/queries/contacts';
import type { AuthUser } from '../lib/auth';
import type { BulkImportRow, Contact, ContactFilters as Filters, ContactInput, ImportResult } from '../types';

interface Props { user: AuthUser | null; }

const canManage = (role: string) => ['coordinator', 'admin', 'cell_leader'].includes(role);
const canSeePhone = (role: string) => ['coordinator', 'admin', 'cell_leader'].includes(role);

export const ContactLogging: React.FC<Props> = ({ user }) => {
  const [filters, setFilters] = useState<Filters>({});
  const [formOpen, setFormOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [selected, setSelected] = useState<Contact | null>(null);

  const { contacts, loading, error, refetch } = useContacts(filters);
  const { tags, statuses } = useTagsAndStatuses();
  const { cells } = useCells();
  const { users } = useAssignableUsers();
  const { tags: selectedTags, refetch: refetchSelectedTags } = useContactTags(selected?.id ?? null);
  const { followUps } = useContactFollowUps(selected?.id ?? null);
  const { log: auditLog } = useContactAuditLog(selected?.id ?? null);
  const mutations = useContactMutations(refetch);

  const role = user?.role ?? 'member';
  const cellId = user?.cellId ?? '';
  const manage = canManage(role);

  const handleView = useCallback((contact: Contact) => {
    setSelected(contact);
    setDetailOpen(true);
  }, []);

  const handleEdit = useCallback((contact: Contact) => {
    setEditing(contact);
    setFormOpen(true);
  }, []);

  const handleReassign = useCallback((contact: Contact) => {
    setSelected(contact);
    setReassignOpen(true);
  }, []);

  const handleMove = useCallback((contact: Contact) => {
    setSelected(contact);
    setMoveOpen(true);
  }, []);

  const handleAdd = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const handleSave = async (input: ContactInput, id?: string) => {
    if (!user) return;
    await mutations.save({
      ...input,
      contact_phone: input.contact_phone || undefined,
      email: input.email || undefined,
      follow_up_assignee: input.follow_up_assignee || undefined,
      logged_by: user.id,
    }, id);
    await refetchSelectedTags();
  };

  const handleBulkImport = async (rows: BulkImportRow[]): Promise<ImportResult> => {
    if (!user) {
      return { imported: 0, failed: rows.length, errors: [{ row: 0, message: 'You must be signed in.' }] };
    }
    return mutations.bulkImport(rows, user.id, cells, users);
  };

  const handleExport = async () => {
    const csv = await exportContactsCSV(filters);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `contacts-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <p className="text-xs text-gray-400 dark:text-slate-500 mb-1">People / Contacts</p>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Contacts</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">Track outreach contacts, follow-ups, and cell handoffs.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="ghost" size="small" onClick={handleExport}>
            <Download className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />Export CSV
          </Button>
          {manage && (
            <Button variant="secondary" size="small" onClick={() => setBulkOpen(true)}>
              <Upload className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />Bulk Import
            </Button>
          )}
          {manage && (
            <Button variant="primary" onClick={handleAdd}>
              <Plus className="w-4 h-4 mr-1" aria-hidden="true" />Add Contact
            </Button>
          )}
        </div>
      </div>

      <ContactFilters
        filters={filters}
        tags={tags}
        statuses={statuses}
        cells={cells}
        onChange={setFilters}
        onClear={() => setFilters({})}
      />

      <p className="text-sm text-gray-500">
        {loading ? 'Loading...' : `${contacts.length} contact${contacts.length !== 1 ? 's' : ''}`}
        {filters.archived && ' (archived)'}
      </p>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {!loading && (
        <ContactTable
          contacts={contacts}
          tags={tags}
          statuses={statuses}
          canEdit={manage}
          showPhone={canSeePhone(role)}
          onEdit={handleView}
          onReassign={handleReassign}
          onMove={handleMove}
          onArchive={(id) => mutations.archive(id)}
          onDelete={(id) => mutations.remove(id)}
          onBulkArchive={manage ? (ids) => mutations.bulkArchive(ids) : undefined}
          onBulkDelete={manage ? (ids) => mutations.bulkRemove(ids) : undefined}
        />
      )}

      {loading && (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-12 bg-gray-100 rounded-lg animate-pulse" />
          ))}
        </div>
      )}

      <ContactForm
        isOpen={formOpen}
        onClose={() => { setFormOpen(false); setEditing(null); }}
        onSave={handleSave}
        contact={editing}
        tags={tags}
        statuses={statuses}
        users={users}
        cellId={cellId}
      />

      <BulkImportModal
        isOpen={bulkOpen}
        onClose={() => setBulkOpen(false)}
        cells={cells}
        onImport={handleBulkImport}
      />

      <ContactCard
        isOpen={detailOpen}
        contact={selected}
        tags={selectedTags}
        followUps={followUps}
        auditLog={auditLog}
        onEdit={(contact) => { setDetailOpen(false); handleEdit(contact); }}
        onReassign={(contact) => { setDetailOpen(false); handleReassign(contact); }}
        onMove={(contact) => { setDetailOpen(false); handleMove(contact); }}
        onClose={() => setDetailOpen(false)}
      />

      <ReassignContactModal
        isOpen={reassignOpen}
        onClose={() => setReassignOpen(false)}
        contact={selected}
        users={users}
        onSave={async (assigneeId, reason) => {
          if (!user || !selected) return;
          await mutations.reassign(selected.id, assigneeId, user.id, reason);
        }}
      />

      <MoveToCellModal
        isOpen={moveOpen}
        onClose={() => setMoveOpen(false)}
        contact={selected}
        cells={cells}
        users={users}
        onSave={async (newCellId, newAssigneeId, reason) => {
          if (!user || !selected) return;
          await mutations.moveToCell(selected.id, newCellId, user.id, reason, newAssigneeId);
        }}
      />
    </div>
  );
};
