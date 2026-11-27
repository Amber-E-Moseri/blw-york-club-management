import type { DriveLinkMetadata } from '../types';

export function getGoogleDriveFileId(url: string): string | null {
  const patterns = [
    /\/file\/d\/([^/]+)/,
    /\/document\/d\/([^/]+)/,
    /\/spreadsheets\/d\/([^/]+)/,
    /\/presentation\/d\/([^/]+)/,
    /[?&]id=([^&]+)/,
    /\/folders\/([^/?]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match?.[1]) return decodeURIComponent(match[1]);
  }

  return null;
}

/**
 * A Drive viewer link ("/file/d/ID/view", "/uc?id=ID") is a web page, not an image, so an <img> cannot show it.
 * Returns a thumbnail address for the same file, which an image element can load. Anything else is returned unchanged.
 * The file must be shared as "anyone with the link" for the thumbnail to load.
 */
export function toDisplayImageUrl(url: string): string {
  if (!url) return url;
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    return url;
  }
  if (!host.endsWith('drive.google.com')) return url;
  if (/\/thumbnail(\?|$)/.test(url)) return url;
  const fileId = getGoogleDriveFileId(url);
  if (!fileId) return url;
  return `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w2000`;
}

export function getDriveResourceType(url: string): DriveLinkMetadata['resource_type'] {
  if (/\/document\/d\//.test(url)) return 'doc';
  if (/\/spreadsheets\/d\//.test(url)) return 'sheet';
  if (/\/presentation\/d\//.test(url)) return 'presentation';
  if (/\/folders\//.test(url)) return 'folder';
  if (/\.pdf(\?|$)/i.test(url)) return 'pdf';
  if (/\.(png|jpe?g|webp|gif)(\?|$)/i.test(url)) return 'image';
  return 'unknown';
}

export function validateDriveUrl(url: string): string | null {
  if (!/^https?:\/\//i.test(url)) return 'Link must start with http:// or https://.';
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes('drive.google.com') && !parsed.hostname.includes('docs.google.com')) {
      return 'Use a Google Drive or Google Docs link.';
    }
    return null;
  } catch {
    return 'Enter a valid URL.';
  }
}

export function buildDriveMetadata(url: string, fallbackTitle = 'Google Drive resource'): DriveLinkMetadata {
  const fileId = getGoogleDriveFileId(url);
  const resourceType = getDriveResourceType(url);

  return {
    url,
    file_id: fileId,
    provider: fileId ? 'google-drive' : 'external',
    title: fallbackTitle,
    resource_type: resourceType,
    thumbnail_url: fileId ? `https://drive.google.com/thumbnail?id=${fileId}` : undefined,
    embed_url: fileId && resourceType !== 'folder' ? `https://drive.google.com/file/d/${fileId}/preview` : undefined,
  };
}
