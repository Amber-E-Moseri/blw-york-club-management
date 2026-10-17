// Client-side checks for media uploads. These only give quick feedback. The signed-upload function and the storage
// bucket limits enforce the same rules on the server (supabase/functions/_shared/website-guards.ts, migration 107).

export type MediaBucketName = 'site-media' | 'rhapsody-pdfs';

export const MEDIA_LIMITS: Record<MediaBucketName, { maxBytes: number; mimes: readonly string[]; label: string }> = {
  'site-media': { maxBytes: 5 * 1024 * 1024, mimes: ['image/jpeg', 'image/png', 'image/webp'], label: 'Images (public)' },
  'rhapsody-pdfs': { maxBytes: 25 * 1024 * 1024, mimes: ['application/pdf'], label: 'Rhapsody PDFs (private)' },
};

/** Returns a message for the first problem found, or null when the file may be uploaded. */
export function clientMediaError(bucket: MediaBucketName, file: { type: string; size: number } | null, altText: string): string | null {
  if (!file) return 'Choose a file to upload.';
  const rules = MEDIA_LIMITS[bucket];
  if (!rules.mimes.includes(file.type)) {
    return bucket === 'site-media' ? 'Images must be JPEG, PNG or WebP.' : 'Rhapsody files must be PDFs.';
  }
  if (file.size < 1 || file.size > rules.maxBytes) {
    return `Files must be between 1 byte and ${Math.round(rules.maxBytes / (1024 * 1024))} MB.`;
  }
  if (bucket === 'site-media' && altText.trim() === '') return 'Add a short description for screen readers before uploading an image.';
  return null;
}
