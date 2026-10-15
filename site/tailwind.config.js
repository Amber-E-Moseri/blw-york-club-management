/** @type {import('tailwindcss').Config} */
// Design tokens from the approved preview (BLW York Site.dc.html). Change values here, not in components.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#C8102E', hover: '#A60D26', deep: '#8B0D1F', soft: '#FFF1F2' },
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
