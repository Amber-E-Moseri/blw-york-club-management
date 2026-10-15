import React, { useCallback, useState } from 'react';
import { BulkImportModal } from '../components/feature/BulkImportModal';
import { ContactCard } from '../components/feature/ContactCard';
import { ContactFilters } from '../components/feature/ContactFilters';
import { ContactForm } from '../components/feature/ContactForm';
import { ContactTable } from '../components/feature/ContactTable';
import { MoveToCellModal } from '../components/feature/MoveToCellModal';
import { ReassignContactModal } from '../components/feature/ReassignContactModal';
import { Skeleton } from '../components/dashboard/DashboardCard';
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

const ROLE_LEVEL: Record<AuthUser['role'], number> = {
  member: 0, cell_leader: 1, admin: 2, coordinator: 3,
};

interface Props { user: AuthUser | null; }

const canManage = (role: string) => ['coordinator', 'admin', 'cell_leader'].includes(role);
const canSeePhone = (role: string) => ['coordinator', 'admin', 'cell_leader'].includes(role);

const sevenDaysAgo = (): string => {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().slice(0, 10);
};

export const Outreach: React.FC<Props> = ({ user }) => {
  const level = ROLE_LEVEL[user?.role ?? 'member'] ?? 0;

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

  // Derived stats from loaded contacts
  const cutoff = sevenDaysAgo();
  const newThisWeek = contacts.filter((c) => c.date_contacted >= cutoff).length;
  const inPipeline  = contacts.filter((c) => !c.is_member && !c.archived).length;
  const becameMembers = contacts.filter((c) => c.is_member).length;

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

  if (level < 1) {
    return (
      <div className="flex-1 p-8 flex items-center justify-center">
        <p className="text-sm text-york-600 font-medium">Leaders only — access denied.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-4">
      {/* Header */}
      <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl shadow-sm overflow-hidden">
        <div className="border-t-4 border-york-600 px-5 py-5 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs font-semibold text-york-600 uppercase tracking-wider">Outreach CRM</p>
            <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100 mt-1">Outreach</h1>
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
              Track every conversation, next step, owner, and cell handoff.
            </p>
          </div>
          {manage && (
            <button
              type="button"
              onClick={handleAdd}
              className="shrink-0 h-9 px-4 bg-york-600 hover:bg-york-700 text-white text-sm font-semibold rounded-xl transition-colors"
            >
              + Log contact
            </button>
          )}
        </div>
      </div>

      {/* Stats strip */}
      {!loading && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatChip label="New this week" value={newThisWeek} />
          <StatChip label="In pipeline"   value={inPipeline} />
          <StatChip label="Became members" value={becameMembers} />
          <StatChip label="Total contacts" value={contacts.length} />
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-york-200 bg-york-50 dark:bg-york-900/20 p-4 text-sm text-york-700 dark:text-york-300">
          {error}
        </div>
      )}

      {/* Filters + secondary actions row */}
      <div className="flex flex-col sm:flex-row sm:items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <ContactFilters
            filters={filters}
            tags={tags}
            statuses={statuses}
            cells={cells}
            onChange={setFilters}
            onClear={() => setFilters({})}
          />
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            type="button"
            onClick={handleExport}
            className="h-9 px-3 text-sm font-medium text-gray-600 dark:text-slate-400 border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 hover:border-gray-300 dark:hover:border-slate-600 transition-colors"
          >
            Export CSV
          </button>
          {manage && (
            <button
              type="button"
              onClick={() => setBulkOpen(true)}
              className="h-9 px-3 text-sm font-medium text-gray-600 dark:text-slate-400 border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 hover:border-gray-300 dark:hover:border-slate-600 transition-colors"
            >
              Bulk import
            </button>
          )}
        </div>
      </div>

      {/* Count label */}
      {!loading && (
        <p className="text-xs text-gray-400 dark:text-slate-500">
          {contacts.length} contact{contacts.length !== 1 ? 's' : ''}
          {filters.archived ? ' · archived view' : ''}
        </p>
      )}

      {/* Contact table */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-2xl" />
          ))}
        </div>
      ) : (
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

      {/* Modals */}
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

const StatChip: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl shadow-sm px-4 py-3">
    <p className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider">{label}</p>
    <p className="text-2xl font-bold text-gray-900 dark:text-slate-100 mt-0.5">{value}</p>
  </div>
);
