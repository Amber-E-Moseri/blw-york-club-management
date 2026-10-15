import { createContext, useContext, type ReactNode } from 'react';
import { sampleContent } from './sample-data';
import type { SiteContent } from './types';

// Pages read content only through this context. The future CMS or database loader replaces the default value here
// (or passes a provider with its own SiteContent) without any page or component changing.
const SiteContentContext = createContext<SiteContent>(sampleContent);

export function SiteContentProvider({ content, children }: { content?: SiteContent; children: ReactNode }) {
  return <SiteContentContext.Provider value={content ?? sampleContent}>{children}</SiteContentContext.Provider>;
}

export function useSiteContent(): SiteContent {
  return useContext(SiteContentContext);
}
