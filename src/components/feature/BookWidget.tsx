import React from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen } from 'lucide-react';
import { useCurrentBook } from '../../hooks/useBookOfMonth';

export const BookWidget: React.FC = () => {
  const { book, loading } = useCurrentBook();
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 animate-pulse dark:bg-slate-800 dark:border-slate-700">
        <div className="h-4 bg-gray-200 rounded w-1/3 mb-3" />
        <div className="h-24 bg-gray-100 rounded" />
      </div>
    );
  }

  if (!book) return null;

  const today = new Date();
  const until = new Date(book.active_until);
  const daysLeft = Math.ceil((until.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden dark:bg-slate-800 dark:border-slate-700">
      <div className="section-header px-6 pt-5 pb-0">
        <h2 className="text-h3">Book of the Month</h2>
        <button onClick={() => navigate('/books')} className="see-all-link">Archive →</button>
      </div>
      <div className="divider mx-6" />

      <div className="px-6 pb-5 flex gap-4">
        {book.cover_image_url ? (
          <img
            src={book.cover_image_url}
            alt={book.title}
            className="w-16 h-22 object-cover rounded shadow-sm shrink-0"
          />
        ) : (
          <div className="w-16 h-22 bg-york-600 rounded shadow-sm flex items-center justify-center text-white shrink-0">
            <BookOpen className="w-7 h-7" />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-gray-900 text-sm leading-tight">{book.title}</h3>
          <p className="text-xs text-gray-500 mt-0.5">by {book.author}</p>
          {book.description && (
            <p className="text-xs text-gray-600 mt-2 line-clamp-2">{book.description}</p>
          )}
          <div className="flex items-center gap-3 mt-3">
            <a
              href={book.drive_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-york-600 text-white text-xs font-semibold rounded-md hover:bg-york-700 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              Open in Drive
            </a>
            {daysLeft > 0 && (
              <span className="text-xs text-gray-400">{daysLeft}d left</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
