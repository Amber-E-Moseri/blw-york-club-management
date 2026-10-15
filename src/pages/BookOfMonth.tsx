import React, { useState } from 'react';
import { BookOpen, ExternalLink } from 'lucide-react';
import { Button } from '../components/foundation/Button';
import { Input } from '../components/foundation/Input';
import { Modal } from '../components/foundation/Modal';
import { useBooks } from '../hooks/useBookOfMonth';
import type { AuthUser } from '../lib/auth';
import type { BookOfMonth, BookOfMonthInput } from '../types';
import { format } from 'date-fns';

interface Props { user: AuthUser | null; }

const EMPTY: BookOfMonthInput = {
  title: '', author: '', description: '', cover_image_url: '', drive_url: '',
  active_from: '', active_until: '',
};

const canManage = (u: AuthUser | null) => u?.role === 'admin' || u?.role === 'coordinator';

export const BookOfMonthPage: React.FC<Props> = ({ user }) => {
  const { books, loading, saving, error, save, remove } = useBooks();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing]   = useState<BookOfMonth | null>(null);
  const [form, setForm]         = useState<BookOfMonthInput>(EMPTY);
  const [formErrors, setFormErrors] = useState<Partial<BookOfMonthInput>>({});

  const today = new Date().toISOString().split('T')[0];
  const currentBook = books.find((b) => b.active_from <= today && b.active_until >= today);
  const pastBooks   = books.filter((b) => b.id !== currentBook?.id);

  const openAdd = () => {
    setEditing(null);
    setForm(EMPTY);
    setFormErrors({});
    setFormOpen(true);
  };

  const openEdit = (b: BookOfMonth) => {
    setEditing(b);
    setForm({
      title: b.title, author: b.author, description: b.description ?? '',
      cover_image_url: b.cover_image_url ?? '', drive_url: b.drive_url,
      active_from: b.active_from, active_until: b.active_until,
    });
    setFormErrors({});
    setFormOpen(true);
  };

  const set = <K extends keyof BookOfMonthInput>(k: K, v: BookOfMonthInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const validate = () => {
    const e: Partial<BookOfMonthInput> = {};
    if (!form.title.trim())      e.title      = 'Title required.';
    if (!form.author.trim())     e.author     = 'Author required.';
    if (!form.drive_url.trim())  e.drive_url  = 'Drive link required.';
    if (!form.active_from)       e.active_from = 'Start date required.';
    if (!form.active_until)      e.active_until = 'End date required.';
    setFormErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (!validate() || !user) return;
    try {
      await save(form, user.id, editing?.id);
      setFormOpen(false);
    } catch { /* error shown via hook */ }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-york-600" aria-hidden="true" />
            Book of the Month
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Reading together as a fellowship</p>
        </div>
        {canManage(user) && (
          <Button variant="primary" onClick={openAdd}>+ Add Book</Button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>
      )}

      {/* Current book */}
      {currentBook && (
        <div className="bg-gradient-to-r from-york-600 to-york-700 rounded-2xl p-6 text-white">
          <p className="text-xs font-semibold uppercase tracking-wider opacity-80 mb-3">Currently Reading</p>
          <div className="flex gap-5">
            {currentBook.cover_image_url ? (
              <img src={currentBook.cover_image_url} alt={currentBook.title}
                className="w-24 h-32 object-cover rounded-lg shadow-lg shrink-0" />
            ) : (
              <div className="w-24 h-32 bg-york-800 rounded-lg shadow-lg flex items-center justify-center shrink-0">
                <BookOpen className="w-10 h-10 text-york-200" aria-hidden="true" />
              </div>
            )}
            <div className="flex-1">
              <h2 className="text-xl font-bold leading-tight">{currentBook.title}</h2>
              <p className="text-sm opacity-80 mt-1">by {currentBook.author}</p>
              {currentBook.description && (
                <p className="text-sm opacity-90 mt-3 line-clamp-3">{currentBook.description}</p>
              )}
              <div className="flex gap-3 mt-4 flex-wrap">
                <a
                  href={currentBook.drive_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-white text-york-700 text-sm font-bold rounded-lg hover:bg-york-50 transition-colors"
                >
                  <ExternalLink className="w-4 h-4" aria-hidden="true" />
                  Open in Google Drive
                </a>
                {canManage(user) && (
                  <button onClick={() => openEdit(currentBook)}
                    className="px-4 py-2 border-2 border-white text-white text-sm font-semibold rounded-lg hover:bg-york-700 transition-colors">
                    Edit
                  </button>
                )}
              </div>
              <p className="text-xs opacity-60 mt-3">
                Active: {format(new Date(currentBook.active_from), 'MMM d')} – {format(new Date(currentBook.active_until), 'MMM d, yyyy')}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Archive */}
      {!loading && pastBooks.length > 0 && (
        <div>
          <h2 className="text-lg font-bold text-gray-800 mb-4">Archive</h2>
          <div className="grid gap-4">
            {pastBooks.map((b) => (
              <div key={b.id} className="bg-white border border-gray-200 rounded-xl p-4 flex gap-4 hover:shadow-sm transition-shadow">
                {b.cover_image_url ? (
                  <img src={b.cover_image_url} alt={b.title}
                    className="w-14 h-20 object-cover rounded-lg shrink-0" />
                ) : (
                  <div className="w-14 h-20 bg-gray-100 dark:bg-slate-700 rounded-lg flex items-center justify-center shrink-0">
                    <BookOpen className="w-6 h-6 text-gray-400 dark:text-slate-500" aria-hidden="true" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-gray-900 text-sm">{b.title}</h3>
                  <p className="text-xs text-gray-500">by {b.author}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {format(new Date(b.active_from), 'MMM yyyy')} – {format(new Date(b.active_until), 'MMM yyyy')}
                  </p>
                  <div className="flex gap-2 mt-2">
                    <a
                      href={b.drive_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-york-600 hover:underline font-medium"
                    >
                      Open in Drive →
                    </a>
                    {canManage(user) && (
                      <>
                        <button onClick={() => openEdit(b)} className="text-xs text-gray-400 hover:text-gray-600">Edit</button>
                        <button
                          onClick={() => window.confirm('Delete this book?') && remove(b.id)}
                          className="text-xs text-gray-400 hover:text-red-500"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading && (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      )}

      {!loading && books.length === 0 && (
        <div className="text-center py-16 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl">
          <BookOpen className="w-10 h-10 mx-auto mb-3 text-gray-300 dark:text-slate-600" aria-hidden="true" />
          <p className="text-base font-semibold text-gray-700 dark:text-slate-300">No books added yet</p>
          {canManage(user) && (
            <div className="mt-4"><Button variant="primary" size="small" onClick={openAdd}>Add First Book</Button></div>
          )}
        </div>
      )}

      {/* Form modal */}
      <Modal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'Edit Book' : 'Add Book of the Month'}
        size="medium"
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)} disabled={saving}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={handleSave}>Save</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input label="Title" placeholder="e.g. Born to Win" value={form.title} onChange={(v) => set('title', v)} error={formErrors.title} required />
          <Input label="Author" placeholder="e.g. Kenneth Hagin" value={form.author} onChange={(v) => set('author', v)} error={formErrors.author} required />
          <Input label="Description" type="textarea" rows={3} placeholder="Brief summary…" value={form.description ?? ''} onChange={(v) => set('description', v)} />
          <Input label="Google Drive URL" placeholder="https://drive.google.com/…" value={form.drive_url} onChange={(v) => set('drive_url', v)} error={formErrors.drive_url} required />
          <Input label="Cover Image URL" placeholder="https://… (optional)" value={form.cover_image_url ?? ''} onChange={(v) => set('cover_image_url', v)} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Active From" type="date" value={form.active_from} onChange={(v) => set('active_from', v)} error={formErrors.active_from} required />
            <Input label="Active Until" type="date" value={form.active_until} onChange={(v) => set('active_until', v)} error={formErrors.active_until} required />
          </div>
        </div>
      </Modal>
    </div>
  );
};
