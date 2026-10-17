/** @type {import('tailwindcss').Config} */
// Design tokens from the approved preview (BLW York Site.dc.html). Change values here, not in components.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Brand tokens read CSS variables so a published primary colour can restyle the site (see lib/brand.ts).
        brand: { DEFAULT: 'var(--color-brand)', hover: 'var(--color-brand-hover)', deep: 'var(--color-brand-deep)', soft: 'var(--color-brand-soft)' },
        // ink / paper use RGB-channel CSS variables so html.dark swaps the palette without touching components.
        ink: {
          DEFAULT: 'rgb(var(--color-ink) / <alpha-value>)',
          soft: 'rgb(var(--color-ink-soft) / <alpha-value>)',
          muted: 'rgb(var(--color-ink-muted) / <alpha-value>)',
        },
        paper: {
          DEFAULT: 'rgb(var(--color-paper) / <alpha-value>)',
          card: 'rgb(var(--color-paper-card) / <alpha-value>)',
          edge: 'rgb(var(--color-paper-edge) / <alpha-value>)',
        },
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
