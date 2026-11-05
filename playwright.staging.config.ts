import { defineConfig, devices } from '@playwright/test';

/**
 * Checks a running staging deployment from the outside, the way a customer and the owner use it.
 * It never resets data: it adds fictional test orders and inquiries, which the demo reset removes.
 * Run it with scripts/staging.sh verify, which supplies the address and credentials at run time.
 */
const baseURL = process.env.STAGING_URL;
if (!baseURL) throw new Error('Set STAGING_URL, or run scripts/staging.sh verify.');

export default defineConfig({
  testDir: 'e2e/staging',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL,
    // The local staging address uses Caddy's own certificate authority. Public addresses use real certificates.
    ignoreHTTPSErrors: baseURL.startsWith('https://localhost'),
    actionTimeout: 20_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'phone', use: { ...devices['iPhone 13'], browserName: 'chromium' }, testMatch: /phone\.spec/ },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: /phone\.spec/ },
  ],
});
