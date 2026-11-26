import { defineConfig, devices } from '@playwright/test';

// Browser checks against the production build, served through vercel.json's routing rules.
// Build first: npm run build. Then: npx playwright test -c playwright.unified.config.ts --trace off
export default defineConfig({
  testDir: './e2e',
  testMatch: /unified-platform\.spec\.ts/,
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'off',
  },
  webServer: {
    command: 'node scripts/serve-unified.mjs',
    url: 'http://localhost:3100/',
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 5'] } },
  ],
});
