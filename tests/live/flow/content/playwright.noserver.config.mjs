// Minimal config that skips webServer startup
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './',
  testMatch: '**/*.runtime.test.mjs',
  timeout: 90000,
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3112',
    headless: true,
    screenshot: 'only-on-failure',
  },
  // No webServer - assume server is already running
});
