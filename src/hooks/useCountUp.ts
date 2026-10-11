import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// useLayoutEffect avoids a paint of the final value before the count starts.
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Animates a numeric value from its previous shown value (0 on first mount)
 * to `target`. Renders `target` on the first server/static pass so markup is
 * stable, and skips the animation when the user prefers reduced motion.
 */
export function useCountUp(target: number, duration = 800): number {
  const [display, setDisplay] = useState(target);
  const shownRef = useRef<number | null>(null);

  useIsomorphicLayoutEffect(() => {
    if (!Number.isFinite(target)) return;

    const reduceMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const from = shownRef.current ?? 0;
    if (reduceMotion || from === target) {
      shownRef.current = target;
      setDisplay(target);
      return;
    }

    let frame = 0;
    const start = performance.now();
    setDisplay(from);

    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = Math.round(from + (target - from) * eased);
      shownRef.current = next;
      setDisplay(next);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(frame);
  }, [target, duration]);

  return display;
}
