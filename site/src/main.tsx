import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { PublishedApp } from './content/PublishedApp';
import { readApiConfig } from './api/config';
import './index.css';

// The Website Management area is loaded only when someone visits /admin, so the public site does not download it.
const AdminApp = lazy(() => import('./admin/AdminApp'));

const config = readApiConfig(import.meta.env);
const onAdmin = window.location.pathname.startsWith('/admin');

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      {onAdmin ? (
        <Suspense fallback={<p className="p-8 text-ink-soft">Loading Website Management…</p>}>
          <AdminApp config={config} />
        </Suspense>
      ) : (
        <PublishedApp config={config} />
      )}
    </BrowserRouter>
  </React.StrictMode>,
);
