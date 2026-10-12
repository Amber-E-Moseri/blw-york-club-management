import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AuthUser } from '../../lib/auth';
import { useSearch } from '../../hooks/useSearch';
import { cn } from '../../lib/utils';

export const GlobalSearch: React.FC<{ user: AuthUser | null; collapsed?: boolean }> = ({ user, collapsed = false }) => {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const { results, loading, error } = useSearch(query, user, open);

  useEffect(() => {
    function onOutsideClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onOutsideClick);
    return () => document.removeEventListener('mousedown', onOutsideClick);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
        window.setTimeout(() => inputRef.current?.focus(), 0);
      }
      if (event.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  function go(index: number) {
    const result = results[index];
    if (!result) return;
    setOpen(false);
    setQuery('');
    navigate(result.href);
  }

  if (collapsed) {
    return (
      <button
        type="button"
        title="Search"
        onClick={() => setOpen(true)}
        className="mx-auto flex h-10 w-10 items-center justify-center rounded-md text-sm font-bold text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-700"
      >
        /
      </button>
    );
  }

  return (
    <div ref={containerRef} className="relative px-3 py-2">
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded={open}
        aria-controls="global-search-results"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveIndex((i) => Math.min(i + 1, results.length - 1));
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex((i) => Math.max(i - 1, 0));
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            go(activeIndex);
          }
        }}
        placeholder="Search..."
        className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-york-600 focus:ring-2 focus:ring-york-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      />
      {open && query.trim().length > 0 && (
        <div id="global-search-results" className="absolute left-3 right-3 top-12 z-50 max-h-96 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {loading && <p className="p-3 text-small text-gray-400 dark:text-slate-400">Searching...</p>}
          {error && <p className="p-3 text-small text-error">{error}</p>}
          {!loading && !error && results.length === 0 && <p className="p-3 text-small text-gray-400">No results.</p>}
          {!loading && results.map((result, index) => (
            <button
              key={`${result.type}-${result.id}`}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => go(index)}
              className={cn(
                'block w-full px-3 py-2 text-left text-sm',
                index === activeIndex ? 'bg-york-50 dark:bg-york-900/30 text-york-700 dark:text-york-300' : 'text-gray-700 hover:bg-gray-100 dark:text-slate-200 dark:hover:bg-slate-800',
              )}
            >
              <span className="block font-bold">{result.title}</span>
              <span className="block text-xs text-gray-400 dark:text-slate-400">{result.type}{result.subtitle ? ` - ${result.subtitle}` : ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
