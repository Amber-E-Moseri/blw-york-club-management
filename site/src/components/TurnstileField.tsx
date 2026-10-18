import { useEffect, useRef } from 'react';
import { useTurnstile } from '../content/InquirySubmitContext';

// Cloudflare Turnstile widget. Rendered only when a site key is configured. The script is loaded once, from
// Cloudflare, and nothing else is loaded for it.
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | null = null;

export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!loading) {
    loading = new Promise<TurnstileApi>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SCRIPT_URL;
      script.async = true;
      script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile unavailable')));
      script.onerror = () => {
        loading = null;
        reject(new Error('Turnstile unavailable'));
      };
      document.head.appendChild(script);
    });
  }
  return loading;
}

export function TurnstileField() {
  const handle = useTurnstile();
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!handle || !host.current) return;
    let cancelled = false;
    let widgetId: string | undefined;
    let api: TurnstileApi | undefined;
    loadTurnstile()
      .then((ts) => {
        if (cancelled || !host.current) return;
        api = ts;
        widgetId = ts.render(host.current, {
          sitekey: handle.siteKey,
          callback: (token: string) => handle.setToken(token),
          'expired-callback': () => handle.setToken(null),
          'error-callback': () => handle.setToken(null),
        });
        handle.reset = () => {
          handle.setToken(null);
          if (widgetId) api?.reset(widgetId);
        };
      })
      .catch(() => {
        // Without the widget no token can be created, so submission stays blocked with a visible message.
      });
    return () => {
      cancelled = true;
      handle.reset = null;
    };
  }, [handle]);

  if (!handle) return null;
  return (
    <div className="mt-6">
      <div ref={host} />
      <p className="mt-2 text-sm text-ink-muted">If the security check does not appear, refresh the page to try again.</p>
    </div>
  );
}
