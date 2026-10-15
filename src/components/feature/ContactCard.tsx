import React from 'react';
import { Modal } from '../foundation/Modal';
import { Button } from '../foundation/Button';
import { Tag } from '../foundation/Tag';
import type { Contact, ContactAuditLogEntry, ContactFollowUp, ContactTagRelation } from '../../types';

interface Props {
  isOpen: boolean;
  contact: Contact | null;
  tags: ContactTagRelation[];
  followUps: ContactFollowUp[];
  auditLog?: ContactAuditLogEntry[];
  onEdit: (contact: Contact) => void;
  onReassign: (contact: Contact) => void;
  onMove: (contact: Contact) => void;
  onClose: () => void;
}

export const ContactCard: React.FC<Props> = ({
  isOpen,
  contact,
  tags,
  followUps,
  auditLog = [],
  onEdit,
  onReassign,
  onMove,
  onClose,
}) => {
  if (!contact) return null;

  const activeFollowUp = followUps.find((item) => item.status === 'active');

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={contact.contact_name}
      subtitle="Contact details"
      size="large"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button variant="secondary" onClick={() => onMove(contact)}>Move</Button>
          <Button variant="secondary" onClick={() => onReassign(contact)}>Reassign</Button>
          <Button variant="primary" onClick={() => onEdit(contact)}>Edit</Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 dark:text-slate-100">
          <Info label="Phone" value={contact.contact_phone || 'Not recorded'} />
          <Info label="Email" value={contact.email || 'Not recorded'} />
          <Info label="Status" value={contact.follow_up_status || 'Not set'} />
          <Info label="Date Contacted" value={contact.date_contacted} />
        </div>

        {contact.notes && (
          <section>
            <h3 className="text-sm font-bold text-gray-900 dark:text-slate-100 mb-2">Notes</h3>
            <p className="text-sm text-gray-600 dark:text-slate-300 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-md p-3">
              {contact.notes}
            </p>
          </section>
        )}

        <section>
          <h3 className="text-sm font-bold text-gray-900 dark:text-slate-100 mb-2">Tags</h3>
          {tags.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => (
                <span key={tag.id} title={[tag.tagged_on, tag.tag_notes].filter(Boolean).join(' - ')}>
                  <Tag color={tag.tag_color} variant="light">{tag.tag_name}</Tag>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">No detailed tags recorded.</p>
          )}
        </section>

        <section>
          <h3 className="text-sm font-bold text-gray-900 dark:text-slate-100 mb-2">Follow-up</h3>
          {activeFollowUp ? (
            <p className="text-sm text-gray-600">
              Current assignee: <span className="font-semibold text-gray-900">{activeFollowUp.assignee?.full_name ?? activeFollowUp.assignee?.email ?? activeFollowUp.assigned_to}</span>
            </p>
          ) : (
            <p className="text-sm text-gray-500">No active follow-up history.</p>
          )}
          {followUps.length > 0 && (
            <div className="mt-3 divide-y divide-gray-100 dark:divide-slate-700 border border-gray-200 dark:border-slate-700 rounded-md">
              {followUps.map((item) => (
                <div key={item.id} className="p-3 text-sm dark:bg-slate-800">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-gray-800">{item.assignee?.full_name ?? item.assignee?.email ?? item.assigned_to}</span>
                    <span className="text-xs text-gray-400">{new Date(item.assigned_on).toLocaleDateString()}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{item.status}{item.notes ? ` - ${item.notes}` : ''}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        {auditLog.length > 0 && (
          <section>
            <h3 className="text-sm font-bold text-gray-900 dark:text-slate-100 mb-2">Audit Log</h3>
            <div className="divide-y divide-gray-100 dark:divide-slate-700 border border-gray-200 dark:border-slate-700 rounded-md">
              {auditLog.map((entry) => (
                <div key={entry.id} className="p-3 text-sm dark:bg-slate-800">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-gray-800">{entry.action}</span>
                    <span className="text-xs text-gray-400">{new Date(entry.created_at).toLocaleString()}</span>
                  </div>
                  {entry.reason && <p className="text-xs text-gray-500 mt-1">{entry.reason}</p>}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </Modal>
  );
};

const Info: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-md border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3">
    <p className="text-xs uppercase tracking-wide text-gray-400 dark:text-slate-500 font-semibold">{label}</p>
    <p className="text-sm text-gray-800 dark:text-slate-200 mt-1">{value}</p>
  </div>
);
