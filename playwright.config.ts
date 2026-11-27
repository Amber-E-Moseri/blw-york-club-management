import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3100',
    serviceWorkers: 'block',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'set PORT=3100&&node node_modules/react-scripts/scripts/start.js',
    url: 'http://localhost:3100/hub',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // WebKit engine with an iPhone viewport. This simulates Safari's engine and layout. It is not a test on a real
      // iPhone, so real-device Safari still needs a manual check before the production sign-in fix is called verified.
      name: 'webkit-iphone',
      testMatch: /login-regression\.spec\.ts/,
      use: { ...devices['iPhone 13'] },
    },
  ],
});
