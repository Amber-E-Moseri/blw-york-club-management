import React from 'react';
import { TestimonyCard } from '../components/feature/TestimonyCard';
import { usePendingTestimonies } from '../hooks/useTestimonies';
import type { AuthUser } from '../lib/auth';
import { PartyPopper } from 'lucide-react';

interface Props { user: AuthUser | null; }

export const AdminTestimonies: React.FC<Props> = ({ user }) => {
  const { pending, loading, approve, reject } = usePendingTestimonies();

  if (user?.role !== 'admin' && user?.role !== 'coordinator') {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <p className="text-small text-gray-400">Access denied.</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Testimony Moderation</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Review and approve testimonies &amp; prophecies before they are published.
        </p>
      </div>

      {loading && (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <div key={i} className="h-40 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      )}

      {!loading && pending.length === 0 && (
        <div className="text-center py-16 bg-white border border-gray-200 rounded-xl">
          <PartyPopper className="w-8 h-8 mx-auto mb-3 text-york-500" aria-hidden="true" />
          <p className="text-base font-semibold text-gray-700">All caught up!</p>
          <p className="text-sm text-gray-400 mt-1">No pending submissions to review.</p>
        </div>
      )}

      {!loading && pending.length > 0 && (
        <>
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-700">
            ⏳ {pending.length} submission{pending.length !== 1 ? 's' : ''} awaiting review
          </div>
          <div className="space-y-4">
            {pending.map((t) => (
              <TestimonyCard
                key={t.id}
                testimony={t}
                showAdminActions
                onApprove={approve}
                onReject={reject}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
};
