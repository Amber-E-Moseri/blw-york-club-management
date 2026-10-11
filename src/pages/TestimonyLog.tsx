import React, { useState } from 'react';
import { Button } from '../components/foundation/Button';
import { Input } from '../components/foundation/Input';
import { TestimonyCard } from '../components/feature/TestimonyCard';
import { TestimonyForm } from '../components/feature/TestimonyForm';
import { useTestimonies } from '../hooks/useTestimonies';
import type { AuthUser } from '../lib/auth';
import type { Testimony, TestimonyInput, TestimonyCategory, TestimonyEntryType, ReactionType } from '../types';
import { Banknote, BookOpen, Eye, HandHeart, HeartHandshake, type LucideIcon, Sparkles, Sprout } from 'lucide-react';

interface Props { user: AuthUser | null; }

const CATEGORIES: { value: TestimonyCategory | 'all'; label: string; icon: LucideIcon }[] = [
  { value: 'all',            label: 'All',          icon: Sparkles },
  { value: 'provision',      label: 'Provision',    icon: Banknote },
  { value: 'healing',        label: 'Healing',      icon: HeartHandshake },
  { value: 'prayer_answered',label: 'Prayer',       icon: HandHeart },
  { value: 'growth',         label: 'Growth',       icon: Sprout },
  { value: 'other',          label: 'Other',        icon: BookOpen },
];

type Tab = 'all' | 'testimony' | 'prophecy';

const TABS: { value: Tab; label: string; icon: LucideIcon }[] = [
  { value: 'all',       label: 'All',        icon: Sparkles },
  { value: 'testimony', label: 'Testimonies', icon: BookOpen },
  { value: 'prophecy',  label: 'Prophecies', icon: Eye },
];

export const TestimonyLog: React.FC<Props> = ({ user }) => {
  const [search,   setSearch]   = useState('');
  const [category, setCategory] = useState<TestimonyCategory | 'all'>('all');
  const [tab,      setTab]      = useState<Tab>('all');
  const [myOnly,   setMyOnly]   = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing,  setEditing]  = useState<Testimony | null>(null);

  const { testimonies, loading, error, save, remove, archive, react } = useTestimonies({
    search:     search || undefined,
    category:   category === 'all' ? undefined : category,
    entry_type: tab === 'all' ? undefined : tab as TestimonyEntryType,
    my_only:    myOnly || undefined,
  });

  const handleEdit = (t: Testimony) => { setEditing(t); setFormOpen(true); };
  const handleAdd  = () => { setEditing(null); setFormOpen(true); };

  const handleSave = async (input: TestimonyInput, id?: string) => {
    if (!user) return;
    await save({ ...input, author_id: user.id, author_name: user.name }, id);
  };

  const handleReact = (id: string, type: ReactionType) => react(id, type);

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Testimonies &amp; Prophecies</h1>
          <p className="text-sm text-gray-500 mt-0.5">Celebrate what God has done</p>
        </div>
        <Button variant="primary" onClick={handleAdd}>+ Share</Button>
      </div>

      {/* Type tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
              tab === t.value ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <t.icon className="w-4 h-4 inline mr-1.5 -mt-0.5" aria-hidden="true" />{t.label}
          </button>
        ))}
      </div>

      {/* Search + filters */}
      <div className="space-y-3">
        <Input
          placeholder="Search…"
          value={search}
          onChange={setSearch}
          icon={
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          }
          iconPosition="left"
        />
        <div className="flex flex-wrap gap-2 items-center">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.value}
              onClick={() => setCategory(cat.value)}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                category === cat.value
                  ? 'bg-york-600 text-white border-york-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-york-400'
              }`}
            >
              <cat.icon className="w-4 h-4 inline mr-1.5 -mt-0.5" aria-hidden="true" />{cat.label}
            </button>
          ))}
          <label className="inline-flex items-center gap-1.5 ml-2 cursor-pointer">
            <input
              type="checkbox"
              checked={myOnly}
              onChange={(e) => setMyOnly(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-gray-300 text-york-600"
            />
            <span className="text-xs text-gray-600 font-medium">Mine only</span>
          </label>
        </div>
      </div>

      <p className="text-sm text-gray-400">
        {loading ? 'Loading…' : `${testimonies.length} entr${testimonies.length !== 1 ? 'ies' : 'y'}`}
      </p>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>
      )}

      {loading && (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-40 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {!loading && testimonies.length === 0 && (
        <div className="text-center py-16 bg-white border border-gray-200 rounded-xl">
          <Sparkles className="w-8 h-8 mx-auto mb-3 text-york-500" aria-hidden="true" />
          <p className="text-base font-semibold text-gray-700">Nothing here yet</p>
          <p className="text-sm text-gray-400 mt-1">Be the first to share!</p>
          <div className="mt-4">
            <Button variant="primary" size="small" onClick={handleAdd}>Share First Entry</Button>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {!loading && testimonies.map((t) => (
          <TestimonyCard
            key={t.id}
            testimony={t}
            user={user}
            onEdit={handleEdit}
            onDelete={remove}
            onArchive={archive}
            onReact={handleReact}
          />
        ))}
      </div>

      <TestimonyForm
        isOpen={formOpen}
        onClose={() => { setFormOpen(false); setEditing(null); }}
        onSave={handleSave}
        testimony={editing}
        userId={user?.id}
      />
    </div>
  );
};
