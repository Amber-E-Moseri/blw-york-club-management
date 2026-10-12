import { useCallback, useEffect, useState } from 'react';

export const HOME_SECTIONS = ['needsAttention', 'upcoming', 'growth', 'outreach'] as const;
export type HomeSectionId = (typeof HOME_SECTIONS)[number];

const STORAGE_PREFIX = 'blw-home-order:';

function readOrder(storageKey: string | null): HomeSectionId[] {
  if (!storageKey) return [...HOME_SECTIONS];
  try {
    const saved = localStorage.getItem(storageKey);
    if (!saved) return [...HOME_SECTIONS];
    const parsed: unknown = JSON.parse(saved);
    if (!Array.isArray(parsed)) return [...HOME_SECTIONS];
    const known = parsed.filter((id): id is HomeSectionId => (HOME_SECTIONS as readonly string[]).includes(id));
    // Sections added later, or missing from a saved list, are appended in their default position.
    const missing = HOME_SECTIONS.filter((id) => !known.includes(id));
    return [...known.filter((id, index) => known.indexOf(id) === index), ...missing];
  } catch {
    return [...HOME_SECTIONS];
  }
}

function saveOrder(storageKey: string | null, order: HomeSectionId[]) {
  if (!storageKey) return;
  try {
    localStorage.setItem(storageKey, JSON.stringify(order));
  } catch {
    // Storage can be unavailable in private browsing; the order still applies for this visit.
  }
}

/** Per-user order of the Home sections, kept in this browser. */
export function useHomeLayout(userId: string | undefined) {
  const storageKey = userId ? `${STORAGE_PREFIX}${userId}` : null;
  const [order, setOrder] = useState<HomeSectionId[]>(() => readOrder(storageKey));

  useEffect(() => {
    setOrder(readOrder(storageKey));
  }, [storageKey]);

  const move = useCallback(
    (id: HomeSectionId, direction: -1 | 1) => {
      setOrder((current) => {
        const index = current.indexOf(id);
        const target = index + direction;
        if (index === -1 || target < 0 || target >= current.length) return current;
        const next = [...current];
        [next[index], next[target]] = [next[target], next[index]];
        saveOrder(storageKey, next);
        return next;
      });
    },
    [storageKey]
  );

  const reset = useCallback(() => {
    const next = [...HOME_SECTIONS];
    saveOrder(storageKey, next);
    setOrder(next);
  }, [storageKey]);

  return { order, move, reset };
}
