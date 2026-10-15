import { useEffect, useMemo, useState } from 'react';
import App from '../App';
import { createWebsiteApi } from '../api/websiteApi';
import type { PublicApiConfig } from '../api/config';
import { mergePublished } from './published';
import { sampleContent } from './sample-data';
import { InquirySubmitProvider, type InquirySubmitter } from './InquirySubmitContext';
import { sha256Hex } from '../lib/hash';
import type { SiteContent } from './types';

/**
 * Loads the published website content once and renders the public app with it. With no configuration, or on any
 * failure, the sample content stays in place, so the public site never depends on the backend being reachable.
 */
export function PublishedApp({ config }: { config: PublicApiConfig | null }) {
  const [content, setContent] = useState<SiteContent | undefined>(undefined);
  // Public submissions use the anon key. The database enforces the consent, honeypot and rate limit rules.
  const submitter: InquirySubmitter | null = useMemo(() => {
    if (!config) return null;
    const api = createWebsiteApi({ url: config.url, anonKey: config.anonKey, getAccessToken: () => null });
    return async (input) => {
      await api.submitInquiry({
        kind: input.kind, name: input.name, email: input.email, phone: input.phone, message: input.message,
        topic: input.topic, consentVersion: 'v1', consentTextHash: await sha256Hex(input.consentText), honeypot: input.honeypot,
      });
    };
  }, [config]);

  useEffect(() => {
    if (!config) return;
    let cancelled = false;
    // Public reads: the anon key only. No user token is ever attached here.
    const api = createWebsiteApi({ url: config.url, anonKey: config.anonKey, getAccessToken: () => null });
    Promise.all([api.publicContent(), api.publicPosts(), api.publicEvents(), api.publicEditions()])
      .then(([rows, posts, events, editions]) => {
        if (!cancelled) setContent(mergePublished(sampleContent, { content: rows, posts, events, editions }));
      })
      .catch(() => {
        // Keep the sample content. The site stays usable.
      });
    return () => {
      cancelled = true;
    };
  }, [config]);

  return (
    <InquirySubmitProvider value={submitter}>
      <App content={content} />
    </InquirySubmitProvider>
  );
}
