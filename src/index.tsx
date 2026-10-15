import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/globals.css';
import './i18n';
import App from './App';
import { register as registerSW } from './serviceWorkerRegistration';

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Register CRA's Workbox service worker for offline/PWA support
registerSW({
  onUpdate: (registration) => {
    console.log('[PWA] Update available. Reload to get the latest version.');
    if (window.confirm('A new version of the app is available. Reload now?')) {
      registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
      window.location.reload();
    }
  },
});

// Parse emojis via Twemoji for consistent cross-platform rendering
declare const twemoji: { parse: (el: Element | Document, opts?: Record<string, unknown>) => void };
if (typeof twemoji !== 'undefined') {
  const applyTwemoji = () => twemoji.parse(document.body, { folder: 'svg', ext: '.svg' });
  applyTwemoji();
  new MutationObserver(applyTwemoji).observe(document.body, { childList: true, subtree: true });
}

// Register the custom push notification service worker (production only — dev
// bundles are served at stable /static/ paths which the SW would cache-first,
// causing stale bundles after HMR recompiles).
if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
  navigator.serviceWorker
    .register('/service-worker.js')
    .then((reg) => console.log('[Push SW] Registered, scope:', reg.scope))
    .catch((err) => console.warn('[Push SW] Registration failed:', err));
}
