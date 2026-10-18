import { describe, expect, it } from 'vitest';
import { applyIndexingDirective, indexingDirective, type IndexingInputs } from '../lib/indexing';

const APPROVED_PRODUCTION: IndexingInputs = {
  vercelEnv: 'production',
  approved: 'true',
  supabaseUrl: 'https://example.supabase.co',
  supabaseAnonKey: 'anon-key',
  previewDemo: undefined,
};

describe('indexingDirective', () => {
  it('is noindex when nothing is configured', () => {
    expect(indexingDirective({})).toBe('noindex');
  });

  it('is indexable only for an approved, connected production build', () => {
    expect(indexingDirective(APPROVED_PRODUCTION)).toBe('index');
  });

  it.each([
    ['preview', { vercelEnv: 'preview' }],
    ['development', { vercelEnv: 'development' }],
    ['missing VERCEL_ENV', { vercelEnv: undefined }],
    ['unknown VERCEL_ENV', { vercelEnv: 'Production ' }],
  ])('is noindex for %s even when approved and connected', (_label, override) => {
    expect(indexingDirective({ ...APPROVED_PRODUCTION, ...override })).toBe('noindex');
  });

  it.each([
    ['missing approval', undefined],
    ['empty approval', ''],
    ['TRUE in capitals', 'TRUE'],
    ['"1"', '1'],
    ['"yes"', 'yes'],
    ['whitespace-padded true', ' true'],
  ])('is noindex for %s', (_label, approved) => {
    expect(indexingDirective({ ...APPROVED_PRODUCTION, approved })).toBe('noindex');
  });

  it.each([
    ['no backend URL', { supabaseUrl: undefined }],
    ['blank backend URL', { supabaseUrl: '   ' }],
    ['no anon key', { supabaseAnonKey: undefined }],
    ['blank anon key', { supabaseAnonKey: '' }],
  ])('is noindex with %s, so sample copy cannot be the indexed page', (_label, override) => {
    expect(indexingDirective({ ...APPROVED_PRODUCTION, ...override })).toBe('noindex');
  });

  it('is noindex in preview demo mode, which shows labelled sample copy', () => {
    expect(indexingDirective({ ...APPROVED_PRODUCTION, previewDemo: 'true' })).toBe('noindex');
  });
});

describe('applyIndexingDirective', () => {
  const page = '<html><head><title>BLW York</title></head><body></body></html>';

  it('adds a noindex, nofollow tag inside the head', () => {
    const out = applyIndexingDirective(page, 'noindex');
    expect(out).toContain('<meta name="robots" content="noindex, nofollow" />');
    expect(out.indexOf('robots')).toBeLessThan(out.indexOf('</head>'));
  });

  it('adds an index tag only for an indexable page', () => {
    expect(applyIndexingDirective(page, 'index')).toContain('<meta name="robots" content="index, follow" />');
  });

  it('replaces any robots tag already present, so only one directive remains', () => {
    const withTag = '<html><head><meta name="robots" content="index, follow" /></head><body></body></html>';
    const out = applyIndexingDirective(withTag, 'noindex');
    expect(out.match(/name="robots"/g)).toHaveLength(1);
    expect(out).toContain('noindex, nofollow');
  });

  it('refuses to build a page with no head, rather than shipping without a directive', () => {
    expect(() => applyIndexingDirective('<html><body></body></html>', 'noindex')).toThrow(/no <\/head>/);
  });
});
