/** @type {import('tailwindcss').Config} */
// Design tokens from the approved preview (BLW York Site.dc.html). Change values here, not in components.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Brand tokens read CSS variables so a published primary colour can restyle the site (see lib/brand.ts).
        brand: { DEFAULT: 'var(--color-brand)', hover: 'var(--color-brand-hover)', deep: 'var(--color-brand-deep)', soft: 'var(--color-brand-soft)' },
        ink: { DEFAULT: '#111827', soft: '#1F2937', muted: '#4B5563' },
        paper: { DEFAULT: '#FAFAF8', card: '#FFFFFF', edge: '#E8E8E8' },
      },
      fontFamily: {
        display: ['"Playfair Display"', 'Georgia', 'serif'],
        sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
        mono: ['"DM Mono"', 'ui-monospace', 'monospace'],
      },
      maxWidth: { content: '1200px', prose: '720px' },
    },
  },
  plugins: [],
};
