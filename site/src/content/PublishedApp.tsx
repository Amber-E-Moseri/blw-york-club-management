import { useEffect, useState } from 'react';
import App from '../App';
import { createWebsiteApi } from '../api/websiteApi';
import type { PublicApiConfig } from '../api/config';
import { mergePublished } from './published';
import { sampleContent } from './sample-data';
import type { SiteContent } from './types';

/**
 * Loads the published website content once and renders the public app with it. With no configuration, or on any
 * failure, the sample content stays in place, so the public site never depends on the backend being reachable.
 */
export function PublishedApp({ config }: { config: PublicApiConfig | null }) {
  const [content, setContent] = useState<SiteContent | undefined>(undefined);

  useEffect(() => {
    if (!config) return;
    let cancelled = false;
    // Public reads: the anon key only. No user token is ever attached here.
    const api = createWebsiteApi({ url: config.url, anonKey: config.anonKey, getAccessToken: () => null });
    Promise.all([api.publicContent(), api.publicPosts(), api.publicEvents()])
      .then(([rows, posts, events]) => {
        if (!cancelled) setContent(mergePublished(sampleContent, { content: rows, posts, events }));
      })
      .catch(() => {
        // Keep the sample content. The site stays usable.
      });
    return () => {
      cancelled = true;
    };
  }, [config]);

  return <App content={content} />;
}
