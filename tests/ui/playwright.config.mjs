import { defineConfig } from '@playwright/test';

// Mocked-backend UI tests: the real app in a real browser, with Supabase and the AI endpoint faked.
// Needs no network and no credentials. Browser: system Chrome.
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.mjs',
  timeout: 30_000,
  workers: 2,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    channel: 'chrome',
    headless: true,
    launchOptions: { args: ['--no-sandbox'] },
    serviceWorkers: 'block',
    viewport: { width: 1280, height: 900 },
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
  },
  webServer: { command: 'node server.mjs 4173', url: 'http://127.0.0.1:4173/', reuseExistingServer: true },
});
