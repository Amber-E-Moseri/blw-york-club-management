// Brand colour handling for the public site. The published primary colour becomes the accent used by every brand
// token. It is accepted only when it is a six-digit hex value and white text on it meets WCAG AA contrast (4.5:1).
// Anything else falls back to the approved default, so a bad value can never make the site unreadable.

export const DEFAULT_BRAND = '#C8102E';
const WCAG_AA_TEXT = 4.5;

export interface BrandPalette {
  brand: string;
  hover: string;
  deep: string;
  soft: string;
}

export function isHexColour(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value);
}

function toRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function toHex(rgb: number[]): string {
  return '#' + rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** Moves a colour toward a target by the given fraction (0 keeps the colour, 1 is the target). */
function mix(hex: string, target: [number, number, number], amount: number): string {
  const c = toRgb(hex);
  return toHex(c.map((v, i) => v + (target[i] - v) * amount));
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of a six-digit hex colour. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two six-digit hex colours. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Returns the colour to use: the input when it is safe, otherwise the approved default. */
export function resolveBrand(input: unknown): string {
  if (!isHexColour(input)) return DEFAULT_BRAND;
  const normal = input.toUpperCase();
  return contrastRatio(normal, '#FFFFFF') >= WCAG_AA_TEXT ? normal : DEFAULT_BRAND;
}

/** Hover, deep and soft shades derived from the accent. */
export function brandPalette(hex: string): BrandPalette {
  return {
    brand: hex,
    hover: mix(hex, [0, 0, 0], 0.12),
    deep: mix(hex, [0, 0, 0], 0.3),
    soft: mix(hex, [255, 255, 255], 0.94),
  };
}

/** Writes the palette into CSS custom properties on the document root. Pure apart from the element it is given. */
export function applyBrandVariables(root: HTMLElement, hex: string): void {
  const p = brandPalette(hex);
  root.style.setProperty('--color-brand', p.brand);
  root.style.setProperty('--color-brand-hover', p.hover);
  root.style.setProperty('--color-brand-deep', p.deep);
  root.style.setProperty('--color-brand-soft', p.soft);
}
