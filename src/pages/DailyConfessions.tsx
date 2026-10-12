import React, { useMemo, useState } from 'react';
import { BookOpen } from 'lucide-react';
import { ConfessionCard } from '../components/feature/ConfessionCard';
import { Button } from '../components/foundation/Button';
import { Input } from '../components/foundation/Input';
import { Modal } from '../components/foundation/Modal';
import { useConfessions } from '../hooks/useConfessions';
import { parseConfessionImport } from '../lib/confessionImport';
import { createConfessions } from '../lib/queries/confessions';
import type { AuthUser } from '../lib/auth';

interface Props { user: AuthUser | null; }

const canManage = (role: string) => ['coordinator', 'admin'].includes(role);

export const DailyConfessions: React.FC<Props> = ({ user }) => {
  const today = new Date().toISOString().split('T')[0];
  const [viewDate, setViewDate] = useState(today);
  const { confessions, loading, error, declare, undeclare, add, remove, refetch } = useConfessions(viewDate);

  const [addOpen, setAddOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [newDate, setNewDate] = useState(today);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importSaving, setImportSaving] = useState(false);
  const [importError, setImportError] = useState('');
  const [importNotice, setImportNotice] = useState('');
  const importCheck = useMemo(
    () => parseConfessionImport(importText, user?.id ?? ''),
    [importText, user?.id]
  );

  const isManager = canManage(user?.role ?? 'member');

  const handleImport = async () => {
    if (!user || importCheck.errors.length > 0 || importCheck.rows.length === 0) return;
    setImportError('');
    setImportSaving(true);
    try {
      const saved = await createConfessions(importCheck.rows);
      setImportOpen(false);
      setImportText('');
      setImportNotice(`Imported ${saved} confession${saved === 1 ? '' : 's'}.`);
      await refetch();
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'Import failed. Nothing was saved.');
    } finally {
      setImportSaving(false);
    }
  };

  const handleAdd = async () => {
    if (!newTitle.trim() || !newBody.trim() || !user) return;
    setFormError('');
    setSaving(true);
    try {
      await add({ title: newTitle.trim(), body: newBody.trim(), scheduled_date: newDate, created_by: user.id });
      setAddOpen(false);
      setNewTitle('');
      setNewBody('');
      setNewDate(today);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Daily Confessions</h1>
          <p className="text-sm text-gray-500 mt-0.5">Declare God's word over your life</p>
        </div>
        {isManager && (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setImportOpen(true)}>Bulk Import</Button>
            <Button variant="primary" onClick={() => setAddOpen(true)}>+ New Confession</Button>
          </div>
        )}
      </div>

      {/* Date navigation */}
      <div className="flex items-center gap-3">
        <button
          className="w-8 h-8 flex items-center justify-center rounded-full border border-gray-200 hover:bg-gray-50 text-gray-500"
          onClick={() => {
            const d = new Date(viewDate);
            d.setDate(d.getDate() - 1);
            setViewDate(d.toISOString().split('T')[0]);
          }}
        >‹</button>
        <Input
          type="date"
          value={viewDate}
          onChange={setViewDate}
          className="max-w-[160px]"
        />
        <button
          className="w-8 h-8 flex items-center justify-center rounded-full border border-gray-200 hover:bg-gray-50 text-gray-500"
          onClick={() => {
            const d = new Date(viewDate);
            d.setDate(d.getDate() + 1);
            setViewDate(d.toISOString().split('T')[0]);
          }}
        >›</button>
        {viewDate !== today && (
          <Button variant="ghost" size="small" onClick={() => setViewDate(today)}>Today</Button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>
      )}

      {importNotice && (
        <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg px-4 py-3 text-sm">{importNotice}</div>
      )}

      {loading && (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-32 bg-gray-100 rounded-lg animate-pulse" />
          ))}
        </div>
      )}

      {!loading && confessions.length === 0 && (
        <div className="text-center py-16 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg">
          <BookOpen className="w-10 h-10 mx-auto mb-3 text-gray-300 dark:text-slate-600" />
          <p className="text-base font-semibold text-gray-700">No confessions for this day</p>
          {isManager && (
            <p className="text-sm text-gray-400 mt-1">
              Add confessions using the button above.
            </p>
          )}
        </div>
      )}

      {!loading && confessions.map((c) => (
        <ConfessionCard
          key={c.id}
          confession={c}
          userId={user?.id}
          onDeclare={(id) => user && declare(id, user.id)}
          onUndeclare={(id) => user && undeclare(id, user.id)}
          canDelete={isManager}
          onDelete={remove}
        />
      ))}

      {/* Bulk import modal */}
      <Modal
        isOpen={importOpen}
        onClose={() => setImportOpen(false)}
        title="Bulk Import Confessions"
        subtitle="One confession per line: date, title, confession text"
        size="large"
        footer={
          <>
            <Button variant="ghost" onClick={() => setImportOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              loading={importSaving}
              disabled={importCheck.errors.length > 0 || importCheck.rows.length === 0}
              onClick={handleImport}
            >
              Import {importCheck.rows.length} confession{importCheck.rows.length === 1 ? '' : 's'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Paste confessions"
            type="textarea"
            rows={8}
            value={importText}
            onChange={setImportText}
            placeholder={'2026-10-12\tGod is my provider\tI declare that...\nOctober 13, 2026\tPeace over my mind\tI declare that...'}
            helpText={'Separate date, title and text with a tab, or with " | ". Dates: 2026-10-12 or October 12, 2026. Nothing is saved until every line is valid.'}
          />
          {importError && <p className="text-sm text-red-600">⚠️ {importError}</p>}
          {importCheck.errors.length > 0 && (
            <div className="rounded-md border border-york-200 bg-york-50 p-3 text-sm text-york-700 space-y-1">
              {importCheck.errors.map((message) => (
                <p key={message}>{message}</p>
              ))}
            </div>
          )}
          {importCheck.rows.length > 0 && (
            <div className="max-h-64 overflow-y-auto rounded-md border border-gray-200 dark:border-slate-700">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-slate-800 text-left text-xs uppercase text-gray-500 dark:text-slate-400">
                  <tr>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Title</th>
                  </tr>
                </thead>
                <tbody>
                  {importCheck.rows.map((row) => (
                    <tr key={`${row.scheduled_date}-${row.title}`} className="border-t border-gray-100 dark:border-slate-700">
                      <td className="px-3 py-2 whitespace-nowrap">{row.scheduled_date}</td>
                      <td className="px-3 py-2">{row.title}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Modal>

      {/* Add modal */}
      <Modal
        isOpen={addOpen}
        onClose={() => setAddOpen(false)}
        title="New Confession"
        subtitle="Schedule a confession for a specific day"
        size="medium"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={handleAdd}>Save</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Title"
            placeholder="e.g. God is my provider"
            value={newTitle}
            onChange={setNewTitle}
            required
            maxLength={100}
          />
          <Input
            label="Confession Text"
            type="textarea"
            placeholder="Write the full declaration…"
            value={newBody}
            onChange={setNewBody}
            required
            rows={5}
          />
          <Input
            label="Scheduled Date"
            type="date"
            value={newDate}
            onChange={setNewDate}
            required
          />
          {formError && <p className="text-sm text-red-600">⚠️ {formError}</p>}
        </div>
      </Modal>
    </div>
  );
};
