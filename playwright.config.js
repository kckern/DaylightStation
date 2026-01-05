import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/runtime',
  testMatch: '**/*.runtime.test.mjs',
  timeout: 90000,
  use: {
    baseURL: 'http://localhost:3111',
    headless: true,
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3111',  // Wait for frontend; backend checked separately
    reuseExistingServer: true,
    timeout: 120000,
  }
});
