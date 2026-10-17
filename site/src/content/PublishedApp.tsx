import { useEffect, useMemo, useState } from 'react';
import App from '../App';
import { createWebsiteApi } from '../api/websiteApi';
import { postProtectedInquiry } from '../api/inquiryFunction';
import type { PublicApiConfig } from '../api/config';
import { mergePublished, unpublishedBase } from './published';
import { sampleContent } from './sample-data';
import {
  InquirySubmitProvider,
  TurnstileProvider,
  type InquirySubmitter,
  type TurnstileHandle,
} from './InquirySubmitContext';
import { sha256Hex } from '../lib/hash';
import { applyBrandVariables, DEFAULT_BRAND } from '../lib/brand';
import { ServiceStatus } from '../components/ServiceStatus';
import type { SiteContent } from './types';

/**
 * Production never shows the sample copy. Without a configured backend the site says it is unavailable. In development,
 * the sample copy is shown as a demo, with a banner and forms that send nothing.
 * With a backend, only published rows are shown. Any failure shows an unavailable state, never sample records.
 */
export function PublishedApp({ config }: { config: PublicApiConfig | null }) {
  if (!config) {
    // Preview builds may set VITE_PREVIEW_DEMO=true to show the labelled sample copy. It never reaches a backend.
    if (import.meta.env.PROD && import.meta.env.VITE_PREVIEW_DEMO !== 'true') {
      return <ServiceStatus title="Website temporarily unavailable" message="The website is not connected to its content service yet. Please check back soon." live="alert" />;
    }
    return (
      <InquirySubmitProvider value={null}>
        <TurnstileProvider value={null}>
          <App />
        </TurnstileProvider>
      </InquirySubmitProvider>
    );
  }
  return <ConnectedSite config={config} />;
}

type LoadState = { status: 'loading' } | { status: 'ready'; content: SiteContent } | { status: 'unavailable' };

function ConnectedSite({ config }: { config: PublicApiConfig }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  // A single-use token holder for Turnstile. Null when no site key is configured, so forms use the direct path.
  const turnstile = useMemo<TurnstileHandle | null>(() => {
    if (!config.turnstileSiteKey) return null;
    const handle: TurnstileHandle = {
      siteKey: config.turnstileSiteKey,
      token: null,
      reset: null,
      setToken: (token) => {
        handle.token = token;
      },
    };
    return handle;
  }, [config.turnstileSiteKey]);

  // Public messages are accepted only through the protected Edge Function (Turnstile plus per-client limits). Without a
  // Turnstile key the site refuses to send: no message is ever reported as sent when nothing was delivered. The direct
  // database path is not used by the public site.
  const submitter: InquirySubmitter = useMemo(() => {
    if (!turnstile) {
      return async () => {
        throw new Error('Messages cannot be sent right now. Please try again later.');
      };
    }
    return async (input) => {
      const token = turnstile.token;
      turnstile.token = null; // single use
      try {
        if (!token) throw new Error('Please complete the security check, then send your message again.');
        await postProtectedInquiry(config.url, config.anonKey, {
          kind: input.kind, name: input.name, email: input.email, phone: input.phone, message: input.message,
          topic: input.topic, consentVersion: 'v1', consentTextHash: await sha256Hex(input.consentText),
          honeypot: input.honeypot, turnstileToken: token,
        });
      } finally {
        turnstile.reset?.();
      }
    };
  }, [config, turnstile]);

  useEffect(() => {
    // Explicit configuration error for whoever builds the site. Visitors see the refusal above, not a success.
    if (!config.turnstileSiteKey) console.error('Configuration error: VITE_TURNSTILE_SITE_KEY is not set, so public messages cannot be sent.');
  }, [config.turnstileSiteKey]);

  useEffect(() => {
    let cancelled = false;
    const api = createWebsiteApi({ url: config.url, anonKey: config.anonKey, getAccessToken: () => null });
    Promise.all([api.publicContent(), api.publicPosts(), api.publicEvents(), api.publicEditions()])
      .then(([rows, posts, events, editions]) => {
        if (cancelled) return;
        const content = mergePublished(unpublishedBase(sampleContent), { content: rows, posts, events, editions }, {
          pdfBase: `${config.url}/functions/v1/website-rhapsody-pdf`,
        });
        setState({ status: 'ready', content });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'unavailable' });
      });
    return () => {
      cancelled = true;
    };
  }, [config]);

  const brand = state.status === 'ready' ? state.content.settings.primaryColor : DEFAULT_BRAND;
  useEffect(() => {
    // Only a non-default accent is written; the approved defaults live in index.css.
    if (brand !== DEFAULT_BRAND) applyBrandVariables(document.documentElement, brand);
  }, [brand]);

  const favicon = state.status === 'ready' ? state.content.settings.faviconUrl : '';
  useEffect(() => {
    if (!favicon) return;
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = favicon;
  }, [favicon]);

  if (state.status === 'loading') {
    return <ServiceStatus title="Loading" message="Loading the latest published information." live="status" />;
  }
  if (state.status === 'unavailable') {
    return <ServiceStatus title="Website temporarily unavailable" message="We could not load the latest information. Please try again later." live="alert" />;
  }
  return (
    <InquirySubmitProvider value={submitter}>
      <TurnstileProvider value={turnstile}>
        <App content={state.content} />
      </TurnstileProvider>
    </InquirySubmitProvider>
  );
}
