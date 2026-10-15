import { defineConfig, devices } from '@playwright/test';

// Release smoke: real local Supabase (never production), three viewports.
// Run with SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY from `supabase status`.
const supabaseUrl = process.env.SUPABASE_URL ?? '';
const anonKey = process.env.SUPABASE_ANON_KEY ?? '';

export default defineConfig({
  testDir: './e2e',
  testMatch: /release-smoke\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  expect: { timeout: 15_000 },
  use: {
    baseURL: 'http://localhost:3100',
    serviceWorkers: 'block',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: {
    command: 'node node_modules/react-scripts/scripts/start.js',
    url: 'http://localhost:3100',
    reuseExistingServer: false,
    timeout: 900_000,
    env: {
      PORT: '3100',
      BROWSER: 'none',
      REACT_APP_SUPABASE_URL: supabaseUrl,
      REACT_APP_SUPABASE_ANON_KEY: anonKey,
    },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'tablet-768', use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } } },
    { name: 'mobile-375', use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } } },
  ],
});
