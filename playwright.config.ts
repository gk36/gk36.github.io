import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 45_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: 'http://localhost:4173/app/',
    trace: 'retain-on-failure',
    timezoneId: 'Europe/Athens',
    locale: 'en-GB',
    // Request mocks (page/context.route) don't see requests from pages a service worker controls
    // (WebKit), so the worker is off except in the offline spec, which opts back in.
    serviceWorkers: 'block',
  },
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173/app/',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'iphone-webkit', use: { ...devices['iPhone 15'] } },
  ],
});
