import { describe, expect, it } from 'vitest';
import { clientMediaError } from '../lib/mediaRules';

describe('client media checks', () => {
  it('requires a file', () => {
    expect(clientMediaError('site-media', null, 'Alt')).toBe('Choose a file to upload.');
  });

  it('accepts a web image with a description', () => {
    expect(clientMediaError('site-media', { type: 'image/webp', size: 1000 }, 'Team photo')).toBeNull();
  });

  it('requires a description for public images', () => {
    expect(clientMediaError('site-media', { type: 'image/png', size: 1000 }, '   ')).toMatch(/screen readers/);
  });

  it('rejects an image that is not a web image type, even if its name says otherwise', () => {
    expect(clientMediaError('site-media', { type: 'image/svg+xml', size: 1000 }, 'Logo')).toMatch(/JPEG, PNG or WebP/);
    expect(clientMediaError('site-media', { type: 'application/pdf', size: 1000 }, 'Logo')).toMatch(/JPEG, PNG or WebP/);
  });

  it('rejects oversize and empty files', () => {
    expect(clientMediaError('site-media', { type: 'image/jpeg', size: 5 * 1024 * 1024 + 1 }, 'x')).toMatch(/5 MB/);
    expect(clientMediaError('rhapsody-pdfs', { type: 'application/pdf', size: 0 }, '')).toMatch(/25 MB/);
  });

  it('accepts a PDF for the private library without a description', () => {
    expect(clientMediaError('rhapsody-pdfs', { type: 'application/pdf', size: 1024 }, '')).toBeNull();
    expect(clientMediaError('rhapsody-pdfs', { type: 'image/png', size: 1024 }, '')).toMatch(/must be PDFs/);
  });
});
