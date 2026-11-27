import { defineConfig, devices } from '@playwright/test';

// Production-build login certification. Serves PROD_BUILD_DIR (default: ./build) on a dedicated port, and a local
// stand-in for the auth endpoint. Neither port is shared with the dev-server config (3100), so a run cannot test a
// process it did not start.
const BUILD_DIR = process.env.PROD_BUILD_DIR ?? 'build';
const STATIC_PORT = process.env.PROD_PORT ?? '4173';
const AUTH_PORT = process.env.PROD_AUTH_PORT ?? '4174';

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
      env: { PROD_BUILD_DIR: BUILD_DIR, PROD_PORT: STATIC_PORT },
      url: `http://127.0.0.1:${STATIC_PORT}/`,
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
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // WebKit with an iPhone 13 viewport. This is WebKit, not a real iPhone; see docs/hotfix-iphone-verification.md.
      name: 'webkit-iphone',
      use: { ...devices['iPhone 13'] },
    },
  ],
});
