import { defineConfig } from '@playwright/test';

// E2E_BASE_URL defaults to production. Use a Vercel preview URL to test a branch.
// Browser: system Chrome (channel "chrome"), which is preinstalled on GitHub runners.
export default defineConfig({
  testDir: '.',
  timeout: 45_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'https://the-cut-tracker.vercel.app',
    channel: 'chrome',
    headless: true,
    trace: 'retain-on-failure',
  },
});
