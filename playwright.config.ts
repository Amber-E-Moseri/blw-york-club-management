import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.PLAYWRIGHT_PORT || '3100';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    serviceWorkers: 'block',
    trace: 'on-first-retry',
  },
  webServer: {
    command: `set PORT=${PORT}&&node node_modules/react-scripts/scripts/start.js`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI && !process.env.PLAYWRIGHT_ISOLATED,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
