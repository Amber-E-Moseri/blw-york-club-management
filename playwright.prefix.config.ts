import { defineConfig, devices } from '@playwright/test';

// Prefix-mounted verification: the unified /hub deployment. The build is served under /hub, exactly as the Hub is hosted,
// so a route, asset or service-worker scope that only works at the root fails here. Uses its own ports, so it never
// shares a process with the root-mounted config (playwright.production.config.ts).
process.env.PROD_MOUNT = process.env.PROD_MOUNT ?? '/hub';
const BUILD_DIR = process.env.PROD_BUILD_DIR ?? 'build-prefix';
const STATIC_PORT = process.env.PROD_PORT ?? '4183';
const AUTH_PORT = process.env.PROD_AUTH_PORT ?? '4184';

export default defineConfig({
  testDir: './e2e',
  testMatch: /(production-build|login-regression)\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${STATIC_PORT}`,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node e2e/support/buildServers.cjs static',
      env: { PROD_BUILD_DIR: BUILD_DIR, PROD_PORT: STATIC_PORT, PROD_MOUNT: process.env.PROD_MOUNT! },
      url: `http://127.0.0.1:${STATIC_PORT}${process.env.PROD_MOUNT}/`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'node e2e/support/buildServers.cjs auth',
      env: { PROD_AUTH_PORT: AUTH_PORT, PROD_ORIGIN: `http://127.0.0.1:${STATIC_PORT}` },
      url: `http://127.0.0.1:${AUTH_PORT}/`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // The iPhone 13 profile matches the root production config (webkit-iphone) and the hotfix verification procedure.
    { name: 'webkit', use: { ...devices['iPhone 13'] } },
  ],
});
