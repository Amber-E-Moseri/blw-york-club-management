// Daily Bread images stored as Google Drive viewer links must be shown through a thumbnail address. A viewer page
// cannot be an image source.
import { toDisplayImageUrl } from '../lib/drive';

describe('toDisplayImageUrl', () => {
  test('a Drive file viewer link becomes a thumbnail', () => {
    expect(toDisplayImageUrl('https://drive.google.com/file/d/abc123/view?usp=sharing')).toBe(
      'https://drive.google.com/thumbnail?id=abc123&sz=w2000',
    );
  });

  test('a uc download link becomes a thumbnail', () => {
    expect(toDisplayImageUrl('https://drive.google.com/uc?id=abc123&export=download')).toBe(
      'https://drive.google.com/thumbnail?id=abc123&sz=w2000',
    );
  });

  test('an existing thumbnail link is unchanged', () => {
    const url = 'https://drive.google.com/thumbnail?id=abc123&sz=w2000';
    expect(toDisplayImageUrl(url)).toBe(url);
  });

  test('a Supabase storage image is unchanged', () => {
    const url = 'https://project.supabase.co/storage/v1/object/public/devotional-images/2026/11/x/day-01.jpg';
    expect(toDisplayImageUrl(url)).toBe(url);
  });

  test('an empty value is unchanged', () => {
    expect(toDisplayImageUrl('')).toBe('');
  });
});
