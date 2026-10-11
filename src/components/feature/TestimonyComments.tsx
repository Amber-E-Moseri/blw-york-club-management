import React, { useEffect, useState } from 'react';
import { formatRelativeTime } from '../../lib/utils';
import { useTestimonyComments } from '../../hooks/useTestimonies';
import type { AuthUser } from '../../lib/auth';

interface Props {
  testimonyId: string;
  user: AuthUser | null;
}

export const TestimonyComments: React.FC<Props> = ({ testimonyId, user }) => {
  const { comments, loading, loaded, load, addComment, removeComment } = useTestimonyComments(testimonyId);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);

  useEffect(() => { if (!loaded) load(); }, [loaded, load]);

  const handlePost = async () => {
    if (!draft.trim() || !user) return;
    setPosting(true);
    try {
      await addComment(draft.trim(), user.name);
      setDraft('');
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="pt-3 border-t border-gray-100 dark:border-slate-800 space-y-3">
      {loading && <p className="text-xs text-gray-400 dark:text-slate-400 pl-1">Loading comments…</p>}

      {loaded && comments.length === 0 && (
        <p className="text-xs text-gray-400 pl-1">No comments yet. Be the first!</p>
      )}

      <div className="space-y-2">
        {comments.map((c) => (
          <div key={c.id} className="flex items-start gap-2 group">
            <div className="w-7 h-7 rounded-full bg-york-100 dark:bg-york-900/40 text-york-700 dark:text-york-300 flex items-center justify-center text-xs font-bold shrink-0">
              {c.author_name.split(' ').slice(0, 2).map((n) => n[0]).join('').toUpperCase()}
            </div>
            <div className="flex-1 bg-gray-50 dark:bg-slate-900 rounded-lg px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-gray-700 dark:text-slate-300">{c.author_name}</span>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-400">{formatRelativeTime(c.created_at)}</span>
                  {c.is_mine && (
                    <button
                      onClick={() => window.confirm('Delete comment?') && removeComment(c.id)}
                      className="text-gray-300 hover:text-york-500 transition-colors opacity-0 group-hover:opacity-100"
                      title="Delete"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
              <p className="text-xs text-gray-600 dark:text-slate-300 mt-0.5 leading-relaxed">{c.body}</p>
            </div>
          </div>
        ))}
      </div>

      {user && (
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-york-600 text-white flex items-center justify-center text-xs font-bold shrink-0">
            {user.name.split(' ').slice(0, 2).map((n) => n[0]).join('').toUpperCase()}
          </div>
          <div className="flex-1 flex items-center gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handlePost()}
              placeholder="Add a comment…"
              maxLength={500}
              className="flex-1 text-xs px-3 py-2 border border-gray-200 dark:border-slate-700 rounded-full focus:outline-none focus:border-york-400 bg-white dark:bg-slate-800"
            />
            <button
              onClick={handlePost}
              disabled={posting || !draft.trim()}
              className="text-xs font-semibold text-york-600 dark:text-york-400 hover:text-york-700 disabled:text-gray-300 transition-colors px-1"
            >
              {posting ? '…' : 'Post'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
