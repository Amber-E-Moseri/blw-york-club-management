// Search-indexing policy for the public website. Pure functions, so the build config and the tests share one rule.
// Fail closed: a page is indexable only when every condition below holds. Missing or unknown values mean noindex.

export type IndexingDirective = 'index' | 'noindex';

export interface IndexingInputs {
  /** Set by Vercel at build time: 'production', 'preview' or 'development'. Anything else is not production. */
  vercelEnv?: string;
  /** The owner's explicit approval, given only after real content is published. Only the exact value 'true' counts. */
  approved?: string;
  /** Backend connection. Without it the site shows no published content. */
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  /** Preview demo mode shows labelled sample copy, so it is never indexable. */
  previewDemo?: string;
}

export function indexingDirective(inputs: IndexingInputs): IndexingDirective {
  const connected = Boolean(inputs.supabaseUrl?.trim()) && Boolean(inputs.supabaseAnonKey?.trim());
  const indexable =
    inputs.vercelEnv === 'production' &&
    inputs.approved === 'true' &&
    connected &&
    inputs.previewDemo !== 'true';
  return indexable ? 'index' : 'noindex';
}

export const NOINDEX_TAG = '<meta name="robots" content="noindex, nofollow" />';
export const INDEX_TAG = '<meta name="robots" content="index, follow" />';

/**
 * Writes the directive into the HTML head, replacing any robots tag already there. Throws if there is no head to
 * write into, so a build can never ship without a directive.
 */
export function applyIndexingDirective(html: string, directive: IndexingDirective): string {
  if (!html.includes('</head>')) throw new Error('indexing: HTML has no </head>; refusing to build without a robots directive');
  const withoutRobots = html.replace(/<meta\s+name="robots"[^>]*>\s*/gi, '');
  const tag = directive === 'index' ? INDEX_TAG : NOINDEX_TAG;
  return withoutRobots.replace('</head>', `    ${tag}\n  </head>`);
}
