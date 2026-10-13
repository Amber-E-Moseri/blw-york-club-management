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
    // The port is passed through `env`, not a shell prefix: `set PORT=…&&` is cmd-only and does nothing under bash/sh.
    // The readiness probe uses 127.0.0.1 because the dev server binds IPv4 and `localhost` can resolve to ::1 first.
    command: 'node node_modules/react-scripts/scripts/start.js',
    env: { ...process.env, PORT },
    url: `http://127.0.0.1:${PORT}`,
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
