import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/runtime',
  testMatch: '**/*.runtime.test.mjs',
  timeout: 90000,
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3111',
    headless: true,
    screenshot: 'only-on-failure',
    launchOptions: {
      args: ['--autoplay-policy=no-user-gesture-required'],
    },
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3111',  // Wait for frontend; backend checked separately
    reuseExistingServer: true,
    timeout: 120000,
  }
});
